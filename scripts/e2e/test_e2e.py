#!/usr/bin/env python3
"""RosettaCloud full-stack e2e probe — exercises ALL FIVE microservices end-to-end.

Against the k3s-deployed stack via port-forwards (see e2e-k3s.yml):
  user :8081, lab :8082, question :8083, chat :8084, analytics :8085, mock-oidc :8080, localstack :4566

Flow: create user -> mint OIDC JWT -> lab-quota -> launch lab (lab-stub pod) -> poll running ->
fetch questions (S3/LocalStack) -> setup + check (in-pod exec) -> REAL Nova Lite 2 chat -> public
stats -> admin 403 -> terminate lab. Exits non-zero on any failed assertion.
"""
import base64
import json
import sys
import time

import boto3
import httpx

USER = "http://localhost:8081"
LAB = "http://localhost:8082"
QUESTION = "http://localhost:8083"
CHAT = "http://localhost:8084"
ANALYTICS = "http://localhost:8085"
OIDC = "http://mock-oidc:8080/default"
LOCALSTACK = "http://localhost:4566"
TABLE = "rosettacloud-users"
BUCKET = "rosettacloud-shared-interactive-labs"
MODULE, LESSON = "linux-docker-k8s-101", "intro-lesson-01"

Q1_SH = """#!/bin/bash
# Question Number: 1
# Question: e2e smoke question
# Question Type: Check
# Question Difficulty: Easy
if [[ "$1" == "-q" ]]; then
  echo "setup ok"
  exit 0
fi
if [[ "$1" == "-c" ]]; then
  echo "check ok"
  exit 0
fi
"""

failures = []


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")
    if not cond:
        failures.append(name)


def wait_health(name, base, timeout=210):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(f"{base}/actuator/health", timeout=5)
            if r.status_code == 200 and r.json().get("status") == "UP":
                print(f"[ready] {name}")
                return True
        except Exception:
            pass
        time.sleep(5)
    check(f"{name} health", False, "(never UP)")
    return False


def aws(service):
    return boto3.client(service, endpoint_url=LOCALSTACK, region_name="us-east-1",
                        aws_access_key_id="test", aws_secret_access_key="test")


def seed():
    ddb = aws("dynamodb")
    if TABLE not in ddb.list_tables().get("TableNames", []):
        ddb.create_table(
            TableName=TABLE,
            AttributeDefinitions=[{"AttributeName": "user_id", "AttributeType": "S"},
                                  {"AttributeName": "email", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "user_id", "KeyType": "HASH"}],
            GlobalSecondaryIndexes=[{"IndexName": "email-index",
                                     "KeySchema": [{"AttributeName": "email", "KeyType": "HASH"}],
                                     "Projection": {"ProjectionType": "ALL"}}],
            BillingMode="PAY_PER_REQUEST")
        ddb.get_waiter("table_exists").wait(TableName=TABLE)
    s3 = aws("s3")
    try:
        s3.create_bucket(Bucket=BUCKET)
    except Exception:
        pass
    s3.put_object(Bucket=BUCKET, Key=f"{MODULE}/{LESSON}/q1.sh", Body=Q1_SH.encode())
    # Event backbone: SNS topic -> SQS queue (raw delivery so the body is our JSON)
    sns, sqs = aws("sns"), aws("sqs")
    topic_arn = sns.create_topic(Name="rosettacloud-events")["TopicArn"]
    queue_url = sqs.create_queue(QueueName="rosettacloud-analytics")["QueueUrl"]
    queue_arn = sqs.get_queue_attributes(QueueUrl=queue_url, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    sns.subscribe(TopicArn=topic_arn, Protocol="sqs", Endpoint=queue_arn,
                  Attributes={"RawMessageDelivery": "true"})
    print(f"[setup] DynamoDB + S3 + SNS/SQS event backbone seeded ({topic_arn})")
    return ddb


def token_for(client_id):
    r = httpx.post(f"{OIDC}/token", data={"grant_type": "client_credentials",
                   "client_id": client_id, "client_secret": "x", "scope": "openid"}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def jwt_sub(tok):
    p = tok.split(".")[1]
    p += "=" * (-len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p)).get("sub")


def main():
    skip_chat = __import__("os").environ.get("SKIP_CHAT") == "1"
    for n, b in [("user", USER), ("lab", LAB), ("question", QUESTION), ("chat", CHAT), ("analytics", ANALYTICS)]:
        wait_health(n, b)
    ddb = seed()

    tok = token_for("e2e-user-1")
    sub = jwt_sub(tok)
    check("oidc token minted", bool(sub), f"sub={sub}")
    ddb.put_item(TableName=TABLE, Item={"user_id": {"S": sub}, "email": {"S": "e2e@rc.app"},
                 "name": {"S": "E2E"}, "role": {"S": "user"}})
    auth = {"Authorization": f"Bearer {tok}"}

    r = httpx.post(f"{USER}/users", json={"email": "new@rc.app", "name": "New", "password": "secret123"}, timeout=15)
    check("POST /users public -> 201", r.status_code == 201, f"({r.status_code})")

    r = httpx.get(f"{USER}/users/{sub}/lab-quota", headers=auth, timeout=15)
    check("GET lab-quota = 120", r.status_code == 200 and r.json().get("minutes_remaining") == 120, f"({r.status_code})")

    r = httpx.get(f"{USER}/users/{sub}/lab-quota", timeout=15)
    check("GET lab-quota no-auth -> 401", r.status_code == 401, f"({r.status_code})")

    # ── lab-service: launch + poll running ──
    r = httpx.post(f"{LAB}/labs", headers=auth, timeout=30)
    check("POST /labs -> 201", r.status_code == 201, f"({r.status_code})")
    lab_id = r.json().get("lab_id") if r.status_code == 201 else None
    pod_name, status = None, None
    if lab_id:
        for _ in range(40):
            ri = httpx.get(f"{LAB}/labs/{lab_id}", headers=auth, timeout=15)
            if ri.status_code == 200 and "error" not in ri.json():
                status = ri.json().get("status")
                pod_name = ri.json().get("pod_name")
                if status == "running":
                    break
            time.sleep(5)
    check("lab reaches running", status == "running", f"(status={status})")

    # ── question-service: fetch + setup + check (in-pod exec on lab-stub) ──
    r = httpx.get(f"{QUESTION}/questions/{MODULE}/{LESSON}", headers=auth, timeout=20)
    check("GET /questions -> 200", r.status_code == 200, f"({r.status_code})")
    check("questions parsed from S3", r.status_code == 200 and r.json().get("total_count", 0) >= 1,
          str(r.json() if r.status_code == 200 else ""))
    if pod_name:
        rs = httpx.post(f"{QUESTION}/questions/{MODULE}/{LESSON}/1/setup", headers=auth,
                        json={"pod_name": pod_name}, timeout=40)
        check("POST setup -> success", rs.status_code == 200 and rs.json().get("completed"), f"({rs.status_code})")
        rc = httpx.post(f"{QUESTION}/questions/{MODULE}/{LESSON}/1/check", headers=auth,
                        json={"pod_name": pod_name}, timeout=40)
        check("POST check -> completed", rc.status_code == 200 and rc.json().get("completed"), f"({rc.status_code})")

    # ── chat-service: REAL Nova Lite 2 (skipped in the k3s deploy smoke — no Bedrock cost) ──
    if not skip_chat:
        r = httpx.post(f"{CHAT}/chat", headers=auth, timeout=60,
                       json={"message": "In one short sentence, what is a Linux container?",
                             "session_id": "e2e-sess-1", "type": "chat"})
        ok = r.status_code == 200 and bool(r.json().get("response", "").strip())
        check("POST /chat real Nova Lite 2", ok,
              f"agent={r.json().get('agent') if r.status_code == 200 else r.status_code} "
              f"reply='{r.json().get('response','')[:70] if r.status_code==200 else ''}'")
    else:
        # still exercise the deployed chat-service health so its pod readiness is proven
        check("chat-service health (deploy smoke)", httpx.get(f"{CHAT}/actuator/health", timeout=15).status_code == 200)

    r = httpx.get(f"{ANALYTICS}/public/stats", timeout=15)
    check("GET /public/stats -> 200", r.status_code == 200, f"({r.status_code})")
    r = httpx.get(f"{ANALYTICS}/admin/metrics", headers=auth, timeout=15)
    check("GET /admin/metrics non-admin -> 403", r.status_code == 403, f"({r.status_code})")

    # ── event backbone: live stats reflect the actions above (async via SQS poller) ──
    live = False
    for _ in range(20):
        try:
            s = httpx.get(f"{ANALYTICS}/public/stats", timeout=10).json()
            if s.get("labs_launched", 0) >= 1 and s.get("questions_answered", 0) >= 1 and (skip_chat or s.get("ai_messages", 0) >= 1):
                live = True
                break
        except Exception:
            pass
        time.sleep(3)
    check("live stats incremented via SNS/SQS events", live,
          str(httpx.get(f"{ANALYTICS}/public/stats", timeout=10).json()))

    # ── terminate lab ──
    if lab_id:
        r = httpx.delete(f"{LAB}/labs/{lab_id}", headers=auth, timeout=30)
        check("DELETE /labs -> deleted", r.status_code == 200 and r.json().get("deleted"), f"({r.status_code})")

    print("\n==== E2E SUMMARY ====")
    if failures:
        print("FAILED:", failures)
        sys.exit(1)
    print("ALL E2E CHECKS PASSED (5 microservices"
          + (", ECR images on k3s runner)" if skip_chat else " + real Nova Lite 2)"))


if __name__ == "__main__":
    main()
