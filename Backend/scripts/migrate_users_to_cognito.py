"""
Migrate existing DynamoDB users to Cognito.

Usage:
    python migrate_users_to_cognito.py <USER_POOL_ID>

Obtains USER_POOL_ID from:
    terraform output -raw cognito_user_pool_id

What it does:
  - Creates a Cognito user for every item in the 'rosettacloud-users' DynamoDB table
  - Sets email_verified = true and suppresses the welcome email
  - Copies the internal user_id into the custom:user_id attribute
  - Removes the plaintext 'password' field from DynamoDB
"""

import sys
import boto3

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} <USER_POOL_ID>")
    sys.exit(1)

USER_POOL_ID = sys.argv[1]
REGION = "us-east-1"
TABLE_NAME = "rosettacloud-users"

dynamodb = boto3.resource("dynamodb", region_name=REGION)
cognito = boto3.client("cognito-idp", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)


def migrate():
    paginator_kwargs = {}
    while True:
        response = table.scan(**paginator_kwargs)
        for user in response.get("Items", []):
            email = user.get("email", "")
            if not email:
                print(f"SKIP (no email): {user.get('user_id')}")
                continue

            try:
                cognito.admin_create_user(
                    UserPoolId=USER_POOL_ID,
                    Username=email,
                    UserAttributes=[
                        {"Name": "email",          "Value": email},
                        {"Name": "email_verified", "Value": "true"},
                        {"Name": "name",           "Value": user.get("name", "")},
                        {"Name": "custom:user_id", "Value": user["user_id"]},
                    ],
                    MessageAction="SUPPRESS",   # no welcome email; send password-reset separately
                    ForceAliasCreation=False,
                )
                print(f"OK: {email}")
            except cognito.exceptions.UsernameExistsException:
                print(f"SKIP (exists): {email}")
                continue
            except Exception as exc:
                print(f"ERROR: {email} — {exc}")
                continue

            # Remove plaintext password from DynamoDB
            try:
                table.update_item(
                    Key={"user_id": user["user_id"]},
                    UpdateExpression="REMOVE #p",
                    ExpressionAttributeNames={"#p": "password"},
                )
            except Exception as exc:
                print(f"  WARN: could not remove password for {email} — {exc}")

        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        paginator_kwargs["ExclusiveStartKey"] = last_key


if __name__ == "__main__":
    migrate()
    print("Migration complete.")
