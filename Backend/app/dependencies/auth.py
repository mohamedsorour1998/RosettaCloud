import jwt
from fastapi import Header, HTTPException


def get_current_user(authorization: str = Header(None)) -> dict:
    """
    Decode the Cognito JWT from the Authorization header.

    API Gateway's JWT authorizer has already verified the signature and
    expiry before the request reaches FastAPI, so we skip re-verification
    and only decode the payload to extract claims.

    Returns the decoded claims dict with an extra key:
        claims["resolved_user_id"] — custom:user_id if present, else Cognito sub
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = authorization.split(" ", 1)[1]
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = claims.get("custom:user_id") or claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user_id claim")

    claims["resolved_user_id"] = user_id
    return claims
