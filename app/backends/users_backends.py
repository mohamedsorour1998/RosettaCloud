"""
Concrete back-end factories for users_service.

• DynamoDB – fully implemented.
"""

import asyncio
import json
import logging
import os
import uuid
import boto3
from botocore.exceptions import ClientError
from typing import Any, Dict, List, Optional

class UserBackend:
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

# Factory
def get_dynamodb_backend() -> UserBackend:
    """Create and return a DynamoDB user backend instance"""
    return UserBackend()