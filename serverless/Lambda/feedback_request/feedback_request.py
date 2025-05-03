import json
import os
import logging
import asyncio
import boto3
from datetime import datetime, timedelta
from momento import (
    CacheClientAsync,
    Configurations,
    CredentialProvider,
    TopicClientAsync,
    TopicConfigurations,
)
from momento.responses import (
    CacheGet,
    CacheSet,
    CreateCache,
    TopicPublish,
)

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Default cache name from environment
DEFAULT_CACHE = os.getenv("CACHE_EVENTS_DEFAULT_CACHE", "interactive-labs")
DEFAULT_TTL = int(os.getenv("CACHE_EVENTS_DEFAULT_TTL", "900"))

class MomentoClient:
    _known: set[str] = set()
    _lock = None
    _cache = None
    _topic = None
    
    async def init(self):
        """Initialize the Momento client"""
        if self._cache:
            return
            
        # Initialize lock if not already done
        if self._lock is None:
            self._lock = asyncio.Lock()
            
        token = os.getenv("MOMENTO_API_KEY")
        if not token:
            raise RuntimeError("MOMENTO_API_KEY env var not set")

        try:
            creds = CredentialProvider.from_string(token)
        except Exception as e:
            raise RuntimeError(f"Invalid MOMENTO_API_KEY: {e}") from e

        self._cache = await CacheClientAsync.create(
            Configurations.Laptop.v1(), creds, timedelta(seconds=DEFAULT_TTL)
        )
        self._topic = TopicClientAsync(TopicConfigurations.Default.v1(), creds)
        await self._ensure_cache(DEFAULT_CACHE)
        logger.info(f"Momento client initialized with cache: {DEFAULT_CACHE}")
    
    async def _ensure_cache(self, name: str) -> None:
        """Ensure the cache exists"""
        if name in self._known:
            return
            
        async with self._lock:
            if name in self._known:
                return
                
            resp = await self._cache.create_cache(name)
            if isinstance(resp, CreateCache.Error):
                raise RuntimeError(resp.message)
                
            self._known.add(name)
    
    async def publish(self, topic, payload, cache=DEFAULT_CACHE):
        """Publish a message to a Momento topic"""
        await self._ensure_cache(cache)
        resp = await self._topic.publish(cache, topic, payload)
        if isinstance(resp, TopicPublish.Error):
            raise RuntimeError(resp.message)
        return resp

# Lambda handler using asyncio
def lambda_handler(event, context):
    """
    AWS Lambda entry point
    """
    return asyncio.get_event_loop().run_until_complete(async_lambda_handler(event, context))

async def async_lambda_handler(event, context):
    """
    Lambda handler function for API Gateway requests
    
    This function:
    1. Parses the request from API Gateway
    2. Validates the required parameters
    3. Uses the feedback_id provided by the UI
    4. Publishes the request to the FeedbackRequested Momento topic
    5. Returns a response to the API Gateway
    """
    try:
        # Initialize Momento client
        momento_client = MomentoClient()
        await momento_client.init()
        
        # Log the event for debugging
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Parse request body
        if 'body' not in event:
            logger.error("Missing request body")
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
                },
                'body': json.dumps({'error': 'Missing request body'})
            }
            
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        
        # Extract parameters
        user_id = body.get('user_id')
        module_uuid = body.get('module_uuid')
        lesson_uuid = body.get('lesson_uuid')
        feedback_id = body.get('feedback_id')
        questions = body.get('questions', [])
        progress = body.get('progress', {})
        
        # Validate required parameters
        if not all([user_id, module_uuid, lesson_uuid, feedback_id]):
            logger.error("Missing required parameters")
            return {
                'statusCode': 400,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
                },
                'body': json.dumps({'error': 'Missing required parameters: user_id, module_uuid, lesson_uuid, and feedback_id are required'})
            }
            
        timestamp = datetime.utcnow().isoformat()
        
        # Format the message for Momento
        message = {
            'feedback_id': feedback_id,
            'user_id': user_id,
            'module_uuid': module_uuid,
            'lesson_uuid': lesson_uuid,
            'questions': questions,
            'progress': progress,
            'timestamp': timestamp
        }
        
        # Publish to Momento topic
        logger.info(f"Publishing request to FeedbackRequested topic: {feedback_id}")
        await momento_client.publish('FeedbackRequested', json.dumps(message))
        
        # Return success response
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            'body': json.dumps({
                'feedback_id': feedback_id,
                'status': 'pending',
                'message': 'Feedback request submitted successfully'
            })
        }
        
    except Exception as e:
        logger.error(f"Error processing feedback request: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }