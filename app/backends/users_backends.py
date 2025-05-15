"""
Concrete back-end factories for users_service.

- DynamoDB – fully implemented.
- LMS – uses LMS API with metadata for extension data.
"""

import asyncio
import json
import logging
import os
import base64
import time
import requests
import uuid
import boto3
from typing import Any, Dict, List, Optional
from botocore.exceptions import ClientError

class DynamoDBUserBackend:
    def __init__(self) -> None:
        # DynamoDB settings
        self.table_name = os.getenv("USERS_TABLE_NAME", "rosettacloud-users")
        self.region  = "me-central-1" # = os.getenv("AWS_REGION", "me-central-1")
        self.endpoint_url = os.getenv("DYNAMODB_ENDPOINT_URL", None)  # For local testing
        
        # Boto3 client
        self._dynamodb = None
        self._table = None
        
        # Cache of user data
        self._user_cache = {}
        
        # Logger
        self.logger = logging.getLogger(__name__)
        
    async def init(self) -> None:
        """Initialize the backend"""
        self.logger.info("Initializing user backend with DynamoDB")
        
        try:
            # Initialize DynamoDB session
            session = boto3.session.Session(region_name=self.region)
            self._dynamodb = session.resource('dynamodb', endpoint_url=self.endpoint_url)
            
            # Create table if it doesn't exist
            await self._ensure_table()
            
            # Get table reference
            self._table = self._dynamodb.Table(self.table_name)
            
            self.logger.info("User backend initialized successfully")
        except Exception as e:
            self.logger.error(f"Failed to initialize user backend: {e}")
            raise
    
    async def close(self) -> None:
        """Close any resources"""
        self.logger.info("Shutting down user backend")
        self._user_cache.clear()
    
    async def _ensure_table(self) -> None:
        """Create the DynamoDB table if it doesn't exist"""
        try:
            # Check if table exists
            client = boto3.client('dynamodb', region_name=self.region, endpoint_url=self.endpoint_url)
            existing_tables = await asyncio.to_thread(client.list_tables)
            
            if self.table_name not in existing_tables.get('TableNames', []):
                self.logger.info(f"Creating DynamoDB table {self.table_name}")
                
                # Create table
                await asyncio.to_thread(
                    client.create_table,
                    TableName=self.table_name,
                    KeySchema=[
                        {'AttributeName': 'user_id', 'KeyType': 'HASH'}
                    ],
                    AttributeDefinitions=[
                        {'AttributeName': 'user_id', 'AttributeType': 'S'},
                        {'AttributeName': 'email', 'AttributeType': 'S'}
                    ],
                    GlobalSecondaryIndexes=[
                        {
                            'IndexName': 'email-index',
                            'KeySchema': [
                                {'AttributeName': 'email', 'KeyType': 'HASH'}
                            ],
                            'Projection': {
                                'ProjectionType': 'ALL'
                            },
                            'ProvisionedThroughput': {
                                'ReadCapacityUnits': 5,
                                'WriteCapacityUnits': 5
                            }
                        }
                    ],
                    ProvisionedThroughput={
                        'ReadCapacityUnits': 5,
                        'WriteCapacityUnits': 5
                    }
                )
                
                # Wait for table to be created
                self.logger.info(f"Waiting for table {self.table_name} to be active...")
                waiter = client.get_waiter('table_exists')
                await asyncio.to_thread(waiter.wait, TableName=self.table_name)
                self.logger.info(f"Table {self.table_name} is now active")
            else:
                self.logger.info(f"Table {self.table_name} already exists")
                
        except Exception as e:
            self.logger.error(f"Error ensuring table exists: {e}")
            raise
    
    async def create_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new user"""
        # Generate a UUID if not provided
        if 'user_id' not in user_data:
            user_data['user_id'] = str(uuid.uuid4())[:8]
            
        # Add created timestamp
        if 'created_at' not in user_data:
            user_data['created_at'] = int(asyncio.get_event_loop().time())
            
        try:
            # Put item in DynamoDB
            await asyncio.to_thread(
                self._table.put_item,
                Item=user_data,
                ConditionExpression='attribute_not_exists(user_id)'
            )
            
            # Update cache
            self._user_cache[user_data['user_id']] = user_data
            
            return user_data
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                self.logger.warning(f"User with ID {user_data['user_id']} already exists")
                raise ValueError(f"User with ID {user_data['user_id']} already exists")
            else:
                self.logger.error(f"Failed to create user: {e}")
                raise
    
    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID"""
        # Check cache first
        if user_id in self._user_cache:
            return self._user_cache[user_id]
            
        try:
            # Get from DynamoDB
            response = await asyncio.to_thread(
                self._table.get_item,
                Key={'user_id': user_id}
            )
            
            user_data = response.get('Item')
            
            # Update cache if found
            if user_data:
                self._user_cache[user_id] = user_data
                
            return user_data
            
        except Exception as e:
            self.logger.error(f"Failed to get user {user_id}: {e}")
            return None
    
    async def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get user by email using GSI"""
        try:
            # Query DynamoDB using email index
            response = await asyncio.to_thread(
                self._table.query,
                IndexName='email-index',
                KeyConditionExpression=boto3.dynamodb.conditions.Key('email').eq(email)
            )
            
            items = response.get('Items', [])
            
            if items:
                user_data = items[0]
                # Update cache
                self._user_cache[user_data['user_id']] = user_data
                return user_data
                
            return None
            
        except Exception as e:
            self.logger.error(f"Failed to get user by email {email}: {e}")
            return None
    
    async def update_user(self, user_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update user data"""
        # Check if user exists
        existing_user = await self.get_user(user_id)
        if not existing_user:
            self.logger.warning(f"User {user_id} not found for update")
            return None
            
        # Prevent updating user_id
        if 'user_id' in update_data:
            del update_data['user_id']
            
        # Add updated timestamp
        update_data['updated_at'] = int(asyncio.get_event_loop().time())
        
        # Build update expression and attributes
        update_expression_parts = []
        expression_attr_names = {}
        expression_attr_values = {}
        
        for key, value in update_data.items():
            update_expression_parts.append(f"#{key} = :{key}")
            expression_attr_names[f"#{key}"] = key
            expression_attr_values[f":{key}"] = value
            
        update_expression = "SET " + ", ".join(update_expression_parts)
        
        try:
            # Update in DynamoDB
            response = await asyncio.to_thread(
                self._table.update_item,
                Key={'user_id': user_id},
                UpdateExpression=update_expression,
                ExpressionAttributeNames=expression_attr_names,
                ExpressionAttributeValues=expression_attr_values,
                ReturnValues="ALL_NEW"
            )
            
            updated_user = response.get('Attributes')
            
            # Update cache
            if updated_user:
                self._user_cache[user_id] = updated_user
                
            return updated_user
            
        except Exception as e:
            self.logger.error(f"Failed to update user {user_id}: {e}")
            return None
    
    async def delete_user(self, user_id: str) -> bool:
        """Delete a user"""
        try:
            # Delete from DynamoDB
            await asyncio.to_thread(
                self._table.delete_item,
                Key={'user_id': user_id}
            )
            
            # Remove from cache
            self._user_cache.pop(user_id, None)
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to delete user {user_id}: {e}")
            return False
    
    async def list_users(self, limit: int = 100, last_key: Optional[str] = None) -> Dict[str, Any]:
        """List users with pagination"""
        scan_kwargs = {
            'Limit': limit
        }
        
        if last_key:
            scan_kwargs['ExclusiveStartKey'] = {'user_id': last_key}
            
        try:
            # Scan DynamoDB
            response = await asyncio.to_thread(
                self._table.scan,
                **scan_kwargs
            )
            
            users = response.get('Items', [])
            
            # Update cache
            for user in users:
                self._user_cache[user['user_id']] = user
                
            result = {
                'users': users,
                'count': len(users)
            }
            
            # Add pagination token if more results
            if 'LastEvaluatedKey' in response:
                result['last_key'] = response['LastEvaluatedKey']['user_id']
                
            return result
            
        except Exception as e:
            self.logger.error(f"Failed to list users: {e}")
            return {'users': [], 'count': 0}
    
    async def link_lab_to_user(self, user_id: str, lab_id: str) -> bool:
        """Link a lab to a user"""
        try:
            # Get current labs for user
            user = await self.get_user(user_id)
            if not user:
                self.logger.warning(f"User {user_id} not found for lab linking")
                return False
                
            # Get current labs or initialize empty list
            labs = user.get('labs', [])
            
            # Add lab if not already linked
            if lab_id not in labs:
                labs.append(lab_id)
                
                # Update user
                await self.update_user(user_id, {'labs': labs})
                
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to link lab {lab_id} to user {user_id}: {e}")
            return False
    
    async def unlink_lab_from_user(self, user_id: str, lab_id: str) -> bool:
        """Unlink a lab from a user"""
        try:
            # Get current labs for user
            user = await self.get_user(user_id)
            if not user:
                self.logger.warning(f"User {user_id} not found for lab unlinking")
                return False
                
            # Get current labs
            labs = user.get('labs', [])
            
            # Remove lab if linked
            if lab_id in labs:
                labs.remove(lab_id)
                
                # Update user
                await self.update_user(user_id, {'labs': labs})
                
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to unlink lab {lab_id} from user {user_id}: {e}")
            return False
    
    async def get_user_labs(self, user_id: str) -> List[str]:
        """Get all labs linked to a user"""
        user = await self.get_user(user_id)
        if not user:
            self.logger.warning(f"User {user_id} not found when getting labs")
            return []
            
        return user.get('labs', [])
        
    async def track_user_progress(self, user_id: str, module_uuid: str, lesson_uuid: str, question_number: int, completed: bool) -> bool:
        """Track user's progress on questions"""
        try:
            # Get user
            user = await self.get_user(user_id)
            if not user:
                self.logger.warning(f"User {user_id} not found for progress tracking")
                return False
                
            # Initialize progress structure if needed
            progress = user.get('progress', {})
            module_progress = progress.get(module_uuid, {})
            lesson_progress = module_progress.get(lesson_uuid, {})
            
            # Update question completion status
            lesson_progress[str(question_number)] = completed
            
            # Update nested structure
            module_progress[lesson_uuid] = lesson_progress
            progress[module_uuid] = module_progress
            
            # Update user
            await self.update_user(user_id, {'progress': progress})
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to track progress for user {user_id}: {e}")
            return False
    
    async def get_user_progress(self, user_id: str, module_uuid: Optional[str] = None, lesson_uuid: Optional[str] = None) -> Dict[str, Any]:
        """Get user progress, optionally filtered by module or lesson"""
        user = await self.get_user(user_id)
        if not user:
            self.logger.warning(f"User {user_id} not found when getting progress")
            return {}
            
        progress = user.get('progress', {})
        
        # Filter by module if specified
        if module_uuid:
            module_progress = progress.get(module_uuid, {})
            
            # Filter by lesson if specified
            if lesson_uuid:
                return module_progress.get(lesson_uuid, {})
                
            return {module_uuid: module_progress}
            
        return progress

#
class LmsUserBackend:
    def __init__(self) -> None:
        # LMS API settings
        self.lms_base_url = os.getenv("LMS_BASE_URL", "https://learn.dev.rosettacloud.app")
        self.client_id = os.getenv("LMS_CLIENT_ID", "LA7WKe8R3gejiFHv7U8rwYAZAmBenq4oQvvbGB1m")
        self.client_secret = os.getenv("LMS_CLIENT_SECRET", "YrCL9iISCZN2iyDq6G1DcZ121Q5NUw3Ph5n9iDJWb6ccPcMgSmBn2s6Lm1dLhCzm3HzKFvmfwNnzKbKDuBpP87dWlPaCV3Sb9fifNHbv4Yn99fF6KEyJhS7xYI2bsmXJ")
        
        # Extension data namespace - used as a key in metadata
        self.ext_namespace = os.getenv("LMS_EXT_NAMESPACE", "rosettacloud")
        
        # Token management
        self._access_token = None
        self._refresh_token = None
        self._token_expires_at = 0
        
        # Cache setup
        self._user_cache = {}
        
        # Logger
        self.logger = logging.getLogger(__name__)
        
    async def init(self) -> None:
        """Initialize the backend by testing API connectivity"""
        self.logger.info("Initializing LMS user backend")
        
        try:
            # Test API connectivity by fetching a token
            await self._ensure_token()
            self.logger.info("LMS user backend initialized successfully")
        except Exception as e:
            self.logger.error(f"Failed to initialize LMS user backend: {e}")
            raise
    
    async def close(self) -> None:
        """Close any resources"""
        self.logger.info("Shutting down LMS user backend")
        self._user_cache.clear()
        self._access_token = None
        self._refresh_token = None
    
    async def _ensure_token(self) -> str:
        """Ensure we have a valid access token for LMS API calls"""
        current_time = time.time()
        
        # If token exists and is not expired, return it
        if self._access_token and current_time < self._token_expires_at:
            return self._access_token
        
        # If we have a refresh token, try to refresh first
        if hasattr(self, '_refresh_token') and self._refresh_token:
            try:
                refreshed_token = await self._refresh_access_token()
                if refreshed_token:
                    return refreshed_token
            except Exception as e:
                self.logger.warning(f"Failed to refresh token, will try to get a new one: {e}")
        
        # Otherwise, get a new token with client credentials
        try:
            credential = f"{self.client_id}:{self.client_secret}"
            encoded_credential = base64.b64encode(credential.encode("utf-8")).decode("utf-8")
            
            headers = {"Authorization": f"Basic {encoded_credential}", "Cache-Control": "no-cache"}
            data = {"grant_type": "client_credentials", "token_type": "jwt"}
            
            # Run in thread pool to avoid blocking
            response = await asyncio.to_thread(
                lambda: requests.post(
                    f"{self.lms_base_url}/oauth2/access_token",
                    headers=headers,
                    data=data
                )
            )
            
            # Ensure the request was successful
            response.raise_for_status()
            response_json = response.json()
            
            self._access_token = response_json["access_token"]
            # Set expiry (assuming token includes an expires_in field, otherwise use a default)
            expires_in = response_json.get("expires_in", 3600)  # Default to 1 hour
            self._token_expires_at = current_time + expires_in - 60  # 60 seconds buffer
            
            # Store refresh token if provided
            if "refresh_token" in response_json:
                self._refresh_token = response_json["refresh_token"]
            
            return self._access_token
            
        except Exception as e:
            self.logger.error(f"Failed to obtain access token: {e}")
            raise
    
    async def _refresh_access_token(self) -> Optional[str]:
        """Refresh the access token using the refresh token"""
        try:
            # Prepare the refresh request
            data = {
                "client_id": self.client_id,
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token,
                "token_type": "JWT",
            }
            
            # Run in thread pool to avoid blocking
            response = await asyncio.to_thread(
                lambda: requests.post(
                    f"{self.lms_base_url}/oauth2/access_token",
                    data=data
                )
            )
            
            # Ensure the request was successful
            response.raise_for_status()
            response_json = response.json()
            
            # Update tokens
            self._access_token = response_json["access_token"]
            if "refresh_token" in response_json:
                self._refresh_token = response_json["refresh_token"]
            
            # Update expiry
            current_time = time.time()
            expires_in = response_json.get("expires_in", 3600)  # Default to 1 hour
            self._token_expires_at = current_time + expires_in - 60  # 60 seconds buffer
            
            return self._access_token
            
        except Exception as e:
            self.logger.error(f"Failed to refresh access token: {e}")
            self._refresh_token = None  # Clear the refresh token as it's likely invalid
            return None
    
    async def _make_api_request(self, method, endpoint, data=None, params=None):
        """Make an authenticated request to the LMS API"""
        token = await self._ensure_token()
        headers = {"Authorization": f"JWT {token}", "Content-Type": "application/json"}
        
        url = f"{self.lms_base_url}/api{endpoint}"
        
        try:
            # Run in thread pool to avoid blocking
            if method == "GET":
                response = await asyncio.to_thread(
                    lambda: requests.get(url, headers=headers, params=params)
                )
            elif method == "POST":
                response = await asyncio.to_thread(
                    lambda: requests.post(url, headers=headers, json=data)
                )
            elif method == "PUT":
                response = await asyncio.to_thread(
                    lambda: requests.put(url, headers=headers, json=data)
                )
            elif method == "PATCH":
                response = await asyncio.to_thread(
                    lambda: requests.patch(url, headers=headers, json=data)
                )
            elif method == "DELETE":
                response = await asyncio.to_thread(
                    lambda: requests.delete(url, headers=headers)
                )
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            # Raise for status
            response.raise_for_status()
            
            # Return JSON if available, otherwise None
            if response.status_code != 204 and response.text:
                return response.json()
            return None
            
        except requests.exceptions.RequestException as e:
            if hasattr(e, 'response') and e.response is not None:
                if e.response.status_code == 401:
                    # Token might be expired despite our checks
                    self.logger.warning("Received 401 from API, clearing token cache")
                    self._access_token = None
                    self._token_expires_at = 0
                    
                    # Try once more with a fresh token
                    token = await self._ensure_token()
                    headers["Authorization"] = f"JWT {token}"
                    
                    # Retry the request
                    return await self._retry_request(method, url, headers, data, params)
                    
            self.logger.error(f"API request failed: {str(e)}")
            raise
    
    async def _retry_request(self, method, url, headers, data=None, params=None):
        """Retry a request with refreshed credentials"""
        try:
            if method == "GET":
                response = await asyncio.to_thread(
                    lambda: requests.get(url, headers=headers, params=params)
                )
            elif method == "POST":
                response = await asyncio.to_thread(
                    lambda: requests.post(url, headers=headers, json=data)
                )
            elif method == "PUT":
                response = await asyncio.to_thread(
                    lambda: requests.put(url, headers=headers, json=data)
                )
            elif method == "PATCH":
                response = await asyncio.to_thread(
                    lambda: requests.patch(url, headers=headers, json=data)
                )
            elif method == "DELETE":
                response = await asyncio.to_thread(
                    lambda: requests.delete(url, headers=headers)
                )
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            # Raise for status
            response.raise_for_status()
            
            # Return JSON if available, otherwise None
            if response.status_code != 204 and response.text:
                return response.json()
            return None
        
        except Exception as e:
            self.logger.error(f"Retry request failed: {str(e)}")
            raise
    
    async def _get_extension_data(self, lms_data: dict) -> dict:
        """Extract extension data from LMS metadata field"""
        metadata = lms_data.get("metadata", {})
        
        # Try to extract our app-specific extension data
        try:
            ext_str = metadata.get(self.ext_namespace, "{}")
            if isinstance(ext_str, dict):
                return ext_str  # Already a dict
            return json.loads(ext_str)
        except (json.JSONDecodeError, TypeError):
            return {}
    
    async def _update_extension_data(self, user_id: str, ext_data: dict) -> bool:
        """Update extension data in user's metadata field"""
        try:
            # Get current user data
            user = await self._make_api_request("GET", f"/user/v1/accounts/{user_id}")
            
            if not user:
                self.logger.warning(f"Failed to find user {user_id} for metadata update")
                return False
                
            # Extract current metadata
            metadata = user.get("metadata", {})
            if not isinstance(metadata, dict):
                metadata = {}
            
            # Update with extension data
            metadata[self.ext_namespace] = ext_data
            
            # Update user in LMS
            result = await self._make_api_request(
                "PATCH", 
                f"/user/v1/accounts/{user_id}", 
                data={"metadata": metadata}
            )
            
            return result is not None
        
        except Exception as e:
            self.logger.error(f"Failed to update extension data for {user_id}: {e}")
            return False
    
    async def create_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new user via the LMS API with extension data in metadata"""
        self.logger.info(f"Creating user with data: {user_data}")
        
        try:
            # Extract core fields for LMS
            lms_user_data = {
                "username": user_data.get("user_id"),
                "email": user_data.get("email"),
                "name": user_data.get("name"),
                "password": user_data.get("password"),
            }
            
            # Prepare extension data
            ext_data = {
                "labs": user_data.get("labs", []),
                "progress": user_data.get("progress", {}),
                "created_at": int(time.time())
            }
            
            # Add metadata with extension data
            lms_user_data["metadata"] = {
                self.ext_namespace: ext_data
            }
            
            # Create user in LMS
            result = await self._make_api_request("POST", "/user/v1/accounts", data=lms_user_data)
            
            if result:
                # Transform the result to match expected format
                transformed_result = {
                    "user_id": result.get("username", user_data.get("user_id")),
                    "email": result.get("email"),
                    "name": result.get("name"),
                    # Add extension data
                    "labs": ext_data.get("labs", []),
                    "progress": ext_data.get("progress", {}),
                    "created_at": ext_data.get("created_at")
                }
                
                # Update cache
                self._user_cache[transformed_result["user_id"]] = transformed_result
                
                return transformed_result
            
            raise Exception("Failed to create user in LMS")
            
        except Exception as e:
            self.logger.error(f"Failed to create user: {e}")
            raise
    
    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID from the LMS API, including extension data"""
        # Check cache first
        if user_id in self._user_cache:
            return self._user_cache[user_id]
            
        try:
            # Get from LMS API
            result = await self._make_api_request("GET", f"/user/v1/accounts/{user_id}")
            
            if result:
                # Extract extension data
                ext_data = await self._get_extension_data(result)
                
                # Transform the result to match expected format
                user_data = {
                    "user_id": result.get("username"),
                    "email": result.get("email"),
                    "name": result.get("name"),
                    # Add extension data
                    "labs": ext_data.get("labs", []),
                    "progress": ext_data.get("progress", {}),
                    "created_at": ext_data.get("created_at"),
                    "updated_at": ext_data.get("updated_at")
                }
                
                # Update cache
                self._user_cache[user_id] = user_data
                
                return user_data
            
            return None
            
        except Exception as e:
            if hasattr(e, 'response') and e.response is not None and e.response.status_code == 404:
                # User not found
                return None
            self.logger.error(f"Failed to get user {user_id}: {e}")
            return None
    
    
    
    async def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get user by email from the LMS API"""
        try:
            # Search users by email
            result = await self._make_api_request("GET", f"/user/v1/accounts", params={"email": email})
            
            if result and result.get("results") and len(result["results"]) > 0:
                user_data = result["results"][0]
                
                # Now get the full user data with extension data
                user_id = user_data.get("username")
                return await self.get_user(user_id)
                
            return None
            
        except Exception as e:
            self.logger.error(f"Failed to get user by email {email}: {e}")
            return None
    
    async def update_user(self, user_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update user data via the LMS API"""
        # Check if user exists
        existing_user = await self.get_user(user_id)
        if not existing_user:
            self.logger.warning(f"User {user_id} not found for update")
            return None
            
        try:
            # Separate core LMS fields from extension data
            lms_update_data = {}
            ext_update_data = {}
            
            # Map standard fields to LMS
            if "name" in update_data:
                lms_update_data["name"] = update_data["name"]
            if "email" in update_data:
                lms_update_data["email"] = update_data["email"]
            
            # Identify extension data fields
            if "labs" in update_data:
                ext_update_data["labs"] = update_data["labs"]
            if "progress" in update_data:
                ext_update_data["progress"] = update_data["progress"]
            
            # Get current extension data
            current_ext_data = await self._get_extension_data(
                await self._make_api_request("GET", f"/user/v1/accounts/{user_id}")
            )
            
            # Update extension data with new values
            updated_ext_data = {**current_ext_data, **ext_update_data}
            updated_ext_data["updated_at"] = int(time.time())
            
            # Update extension data in metadata
            if ext_update_data:
                ext_success = await self._update_extension_data(user_id, updated_ext_data)
                if not ext_success:
                    self.logger.warning(f"Failed to update extension data for user {user_id}")
            
            # Update core LMS fields if any
            if lms_update_data:
                lms_result = await self._make_api_request(
                    "PATCH", 
                    f"/user/v1/accounts/{user_id}", 
                    data=lms_update_data
                )
                if not lms_result:
                    self.logger.warning(f"Failed to update core data for user {user_id}")
            
            # Refresh the user data from LMS to get the latest
            updated_user = await self.get_user(user_id)
            
            # Update cache
            if updated_user:
                self._user_cache[user_id] = updated_user
            
            return updated_user
                
        except Exception as e:
            self.logger.error(f"Failed to update user {user_id}: {e}")
            return None
    
    async def delete_user(self, user_id: str) -> bool:
        """Delete a user via the LMS API"""
        try:
            # Delete from LMS
            await self._make_api_request("DELETE", f"/user/v1/accounts/{user_id}")
            
            # Remove from cache
            self._user_cache.pop(user_id, None)
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to delete user {user_id}: {e}")
            return False
    
    async def list_users(self, limit: int = 100, last_key: Optional[str] = None) -> Dict[str, Any]:
        """List users via the LMS API"""
        try:
            params = {
                "page_size": limit
            }
            
            if last_key:
                params["page"] = last_key
                
            # Get from LMS API
            result = await self._make_api_request("GET", "/user/v1/accounts", params=params)
            
            if result:
                users = []
                for user_data in result.get("results", []):
                    # Get the full user data with extension data
                    user_id = user_data.get("username")
                    full_user = await self.get_user(user_id)
                    if full_user:
                        users.append(full_user)
                
                # Prepare pagination info
                next_page = None
                if result.get("next"):
                    # Extract page number from next URL if available
                    next_page = result.get("next").split("page=")[-1].split("&")[0]
                
                return {
                    "users": users,
                    "count": len(users),
                    "last_key": next_page
                }
                
            return {"users": [], "count": 0}
            
        except Exception as e:
            self.logger.error(f"Failed to list users: {e}")
            return {"users": [], "count": 0}
    
    async def link_lab_to_user(self, user_id: str, lab_id: str) -> bool:
        """Link a lab to a user"""
        try:
            # Get user
            user = await self.get_user(user_id)
            if not user:
                self.logger.warning(f"User {user_id} not found for lab linking")
                return False
                
            # Get current labs
            labs = user.get("labs", [])
            
            # Add lab if not already linked
            if lab_id not in labs:
                labs.append(lab_id)
                
                # Update user with new labs list
                update_result = await self.update_user(user_id, {"labs": labs})
                
                return update_result is not None
            
            return True  # Lab was already linked
            
        except Exception as e:
            self.logger.error(f"Failed to link lab {lab_id} to user {user_id}: {e}")
            return False
    
    async def unlink_lab_from_user(self, user_id: str, lab_id: str) -> bool:
        """Unlink a lab from a user"""
        try:
            # Get user
            user = await self.get_user(user_id)
            if not user:
                self.logger.warning(f"User {user_id} not found for lab unlinking")
                return False
                
            # Get current labs
            labs = user.get("labs", [])
            
            # Remove lab if linked
            if lab_id in labs:
                labs.remove(lab_id)
                
                # Update user with new labs list
                update_result = await self.update_user(user_id, {"labs": labs})
                
                return update_result is not None
            
            return True  # Lab was not linked
            
        except Exception as e:
            self.logger.error(f"Failed to unlink lab {lab_id} from user {user_id}: {e}")
            return False
    
    async def get_user_labs(self, user_id: str) -> List[str]:
        """Get all labs linked to a user"""
        user = await self.get_user(user_id)
        if not user:
            self.logger.warning(f"User {user_id} not found when getting labs")
            return []
            
        return user.get("labs", [])
    
    async def track_user_progress(self, user_id: str, module_uuid: str, lesson_uuid: str, question_number: int, completed: bool) -> bool:
        """Track user's progress on questions"""
        try:
            # Get user
            user = await self.get_user(user_id)
            if not user:
                self.logger.warning(f"User {user_id} not found for progress tracking")
                return False
                
            # Get current progress
            progress = user.get("progress", {})
            
            # Initialize if needed
            if module_uuid not in progress:
                progress[module_uuid] = {}
            if lesson_uuid not in progress[module_uuid]:
                progress[module_uuid][lesson_uuid] = {}
                
            # Update progress
            progress[module_uuid][lesson_uuid][str(question_number)] = completed
            
            # Update user
            update_result = await self.update_user(user_id, {"progress": progress})
            
            return update_result is not None
            
        except Exception as e:
            self.logger.error(f"Failed to track progress for user {user_id}: {e}")
            return False
    
    async def get_user_progress(self, user_id: str, module_uuid: Optional[str] = None, lesson_uuid: Optional[str] = None) -> Dict[str, Any]:
        """Get user progress, optionally filtered by module or lesson"""
        user = await self.get_user(user_id)
        if not user:
            self.logger.warning(f"User {user_id} not found when getting progress")
            return {}
            
        progress = user.get("progress", {})
        
        # Filter by module if specified
        if module_uuid:
            module_progress = progress.get(module_uuid, {})
            
            # Filter by lesson if specified
            if lesson_uuid:
                return module_progress.get(lesson_uuid, {})
                
            return {module_uuid: module_progress}
            
        return progress
# Factory functions
def get_dynamodb_backend():
    """Create and return a DynamoDB user backend instance"""
    return DynamoDBUserBackend()


def get_lms_backend():
    """Create and return an LMS user backend instance that uses metadata for extension data"""
    return LmsUserBackend()