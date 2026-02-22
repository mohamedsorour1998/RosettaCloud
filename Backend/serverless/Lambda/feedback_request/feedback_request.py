import json
import os
import logging
from datetime import datetime

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SQS_QUEUE_URL = os.getenv("SQS_QUEUE_URL", "")

sqs = boto3.client("sqs", region_name=os.getenv("AWS_REGION", "us-east-1"))

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
}


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        logger.info("Received event: %s", json.dumps(event))

        if "body" not in event:
            logger.error("Missing request body")
            return {
                "statusCode": 400,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Missing request body"}),
            }

        body = json.loads(event["body"]) if isinstance(event["body"], str) else event["body"]

        user_id = body.get("user_id")
        module_uuid = body.get("module_uuid")
        lesson_uuid = body.get("lesson_uuid")
        feedback_id = body.get("feedback_id")
        questions = body.get("questions", [])
        progress = body.get("progress", {})

        if not all([user_id, module_uuid, lesson_uuid, feedback_id]):
            logger.error("Missing required parameters")
            return {
                "statusCode": 400,
                "headers": CORS_HEADERS,
                "body": json.dumps({
                    "error": "Missing required parameters: user_id, module_uuid, lesson_uuid, and feedback_id are required"
                }),
            }

        message = {
            "feedback_id": feedback_id,
            "user_id": user_id,
            "module_uuid": module_uuid,
            "lesson_uuid": lesson_uuid,
            "questions": questions,
            "progress": progress,
            "timestamp": datetime.utcnow().isoformat(),
        }

        logger.info("Sending message to SQS for feedback_id: %s", feedback_id)
        sqs.send_message(QueueUrl=SQS_QUEUE_URL, MessageBody=json.dumps(message))

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "feedback_id": feedback_id,
                "status": "pending",
                "message": "Feedback request submitted successfully",
            }),
        }

    except Exception as e:
        logger.error("Error processing feedback request: %s", str(e))
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": f"Internal server error: {str(e)}"}),
        }
