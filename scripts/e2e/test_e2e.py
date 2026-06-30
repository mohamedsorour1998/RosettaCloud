#!/usr/bin/env python3
"""RosettaCloud full-stack e2e probe.

Runs against the k3s-deployed stack via port-forwards (see e2e-k3s.yml):
  user-service :8081, chat-service :8084, analytics-service :8085, mock-oidc :8080, localstack :4566

Exercises the genuine cross-service flow with a REAL Bedrock Nova Lite 2 reply.
Exits non-zero on any failed assertion.
"""
import base64
import json
import sys
import time

import boto3
import httpx

USER = "http://localhost:8081"
CHAT = "http://localhost:8084"
ANALYTICS = "http://localhost:8085"
OIDC = "http://mock-oidc:8080/default"      # hostname mapped to 127.0.0.1 so `iss` matches the services
LOCALSTACK = "http://localhost:4566"
TABLE = "rosettacloud-users"

failures = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name} {detail}")
    if not cond:
        failures.append(name)


def wait_health(name, base, timeout=180):
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
    check(f"{name} health", False, "(never became UP)")
    return False


def create_table():
    ddb = boto3.client("dynamodb", endpoint_url=LOCALSTACK, region_name="us-east-1",
                       aws_access_key_id="test", aws_secret_access_key="test")
    existing = ddb.list_tables().get("TableNames", [])
    if TABLE not in existing:
        ddb.create_table(
            TableName=TABLE,
            AttributeDefinitions=[
                {"AttributeName": "user_id", "AttributeType": "S"},
                {"AttributeName": "email", "AttributeType": "S"},
            ],
            KeySchema=[{"AttributeName": "user_id", "KeyType": "HASH"}],
            GlobalSecondaryIndexes=[{
                "IndexName": "email-index",
                "KeySchema": [{"AttributeName": "email", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            }],
            BillingMode="PAY_PER_REQUEST",
        )
        ddb.get_waiter("table_exists").wait(TableName=TABLE)
    print(f"[setup] DynamoDB table {TABLE} ready")
    return ddb


def token_for(client_id):
    r = httpx.post(f"{OIDC}/token", data={
        "grant_type": "client_credentials", "client_id": client_id,
        "client_secret": "x", "scope": "openid",
    }, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def jwt_sub(tok):
    payload = tok.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload)).get("sub")


def main():
    for n, b in [("user", USER), ("chat", CHAT), ("analytics", ANALYTICS)]:
        wait_health(n, b)
    ddb = create_table()

    # Mint a token and seed the matching user (identity = JWT sub, per the controllers).
    tok = token_for("e2e-user-1")
    sub = jwt_sub(tok)
    check("oidc token minted", bool(sub), f"sub={sub}")
    ddb.put_item(TableName=TABLE, Item={
        "user_id": {"S": sub}, "email": {"S": "e2e@rosettacloud.app"},
        "name": {"S": "E2E User"}, "role": {"S": "user"},
    })
    auth = {"Authorization": f"Bearer {tok}"}

    # 1) public create (no auth)
    r = httpx.post(f"{USER}/users", json={"email": "new@rc.app", "name": "New", "password": "secret123"}, timeout=15)
    check("POST /users public -> 201", r.status_code == 201, f"(got {r.status_code})")

    # 2) lab quota (authenticated; identity = sub)
    r = httpx.get(f"{USER}/users/{sub}/lab-quota", headers=auth, timeout=15)
    check("GET lab-quota -> 200", r.status_code == 200, f"(got {r.status_code})")
    if r.status_code == 200:
        check("lab quota = 120", r.json().get("minutes_remaining") == 120, str(r.json()))

    # 3) unauthenticated is rejected
    r = httpx.get(f"{USER}/users/{sub}/lab-quota", timeout=15)
    check("GET lab-quota no-auth -> 401", r.status_code == 401, f"(got {r.status_code})")

    # 4) REAL Nova Lite 2 chat
    r = httpx.post(f"{CHAT}/chat", headers=auth, timeout=60, json={
        "message": "In one short sentence, what is a Linux container?",
        "session_id": "e2e-sess-1", "type": "chat",
    })
    check("POST /chat -> 200", r.status_code == 200, f"(got {r.status_code})")
    if r.status_code == 200:
        body = r.json()
        check("chat reply non-empty (real Nova Lite 2)", bool(body.get("response", "").strip()),
              f"agent={body.get('agent')} reply='{body.get('response','')[:80]}'")

    # 5) public stats
    r = httpx.get(f"{ANALYTICS}/public/stats", timeout=15)
    check("GET /public/stats -> 200", r.status_code == 200, f"(got {r.status_code})")

    # 6) admin metrics forbidden for non-admin (THE authorization fix)
    r = httpx.get(f"{ANALYTICS}/admin/metrics", headers=auth, timeout=15)
    check("GET /admin/metrics non-admin -> 403", r.status_code == 403, f"(got {r.status_code})")

    print("\n==== E2E SUMMARY ====")
    if failures:
        print("FAILED:", failures)
        sys.exit(1)
    print("ALL E2E CHECKS PASSED")


if __name__ == "__main__":
    main()
