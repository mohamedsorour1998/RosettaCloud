"""
Feedback service for providing AI-generated feedback on lab exercises.
"""
import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, Any

# Import the AI service and cache events service
from app.services import ai_service as ai
from app.services import cache_events_service as cache_events

# Configure logging
logger = logging.getLogger("feedback_service")
logger.setLevel(logging.INFO)

# Constants
FEEDBACK_REQUEST_TOPIC = "FeedbackRequested"
FEEDBACK_GIVEN_TOPIC = "FeedbackGiven"
DEFAULT_MAX_TOKENS = 1500
DEFAULT_TEMPERATURE = 0.7

# Flag to track if the feedback service has been started
_feedback_service_started = False

async def format_ai_prompt(request_data: Dict[str, Any]) -> str:
    """
    Format a prompt for the AI based on the user's progress and questions
    """
    user_id = request_data.get('user_id', 'unknown')
    module_uuid = request_data.get('module_uuid', 'unknown')
    lesson_uuid = request_data.get('lesson_uuid', 'unknown')
    questions = request_data.get('questions', [])
    progress = request_data.get('progress', {})
    
    prompt_lines = [
        f"User {user_id} has completed a lab exercise for Module {module_uuid}, Lesson {lesson_uuid}.",
        "Please provide comprehensive educational feedback on their performance.",
        "\nHere are the questions and their progress:\n"
    ]
    
    # Process each question
    for question in questions:
        q_id = question.get('id')
        q_text = question.get('question', 'Unknown question')
        q_type = question.get('type', 'Unknown')
        q_difficulty = question.get('question_difficulty', 'Medium')
        
        # Check if question was completed successfully
        q_completed = False
        if progress and str(q_id) in progress:
            q_completed = progress[str(q_id)] == True
        elif question.get('completed', False):
            q_completed = True
            
        status = "completed successfully" if q_completed else "did not complete"
        
        prompt_lines.append(f"\nQuestion {q_id} ({q_type}, {q_difficulty}): {q_text}")
        prompt_lines.append(f"Status: User {status} this question.")
        
        # For MCQ questions, add more details
        if q_type.lower() == 'mcq':
            options = question.get('options', [])
            correct_answer = question.get('correctAnswer', '')
            user_answer = question.get('userAnswer', '')
            
            if options:
                prompt_lines.append("Options:")
                for i, option in enumerate(options):
                    prompt_lines.append(f"  {i+1}. {option}")
                
            if correct_answer:
                prompt_lines.append(f"Correct answer: {correct_answer}")
                
            if user_answer:
                prompt_lines.append(f"User's answer: {user_answer}")
    
    # Add instructions for the AI
    prompt_lines.extend([
        "\nPlease provide:",
        "1. An overall assessment of the user's performance",
        "2. Specific feedback for each question, especially those they struggled with",
        "3. Suggestions for improvement and next steps for learning",
        "4. Encouraging remarks to keep the user motivated",
        "\nKeep the feedback constructive, specific, and educational. Format your response with clear paragraphs and bullet points where appropriate."
    ])
    
    return "\n".join(prompt_lines)

async def process_feedback_request(message: str) -> None:
    """
    Process a feedback request message from the FeedbackRequested topic
    """
    try:
        # Parse the message
        data = json.loads(message)
        
        request_id = data.get('request_id')
        if not request_id:
            logger.error("Missing request_id in feedback request")
            return
            
        logger.info(f"Processing feedback request: {request_id}")
        
        # Format prompt for the AI
        prompt = await format_ai_prompt(data)
        
        # Generate feedback using AI service
        logger.info(f"Generating feedback for request: {request_id}")
        system_role = "You are an educational assistant providing feedback on coding labs. Be specific, constructive, and encouraging."
        
        feedback = await ai.chat(
            prompt=prompt,
            system_role=system_role,
            max_tokens=DEFAULT_MAX_TOKENS,
            temperature=DEFAULT_TEMPERATURE
        )
        
        # Publish feedback to the FeedbackGiven topic
        response = {
            'type': 'feedback',
            'request_id': request_id,
            'content': feedback,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        logger.info(f"Publishing feedback for request: {request_id}")
        await cache_events.publish(FEEDBACK_GIVEN_TOPIC, json.dumps(response))
        
    except Exception as e:
        logger.error(f"Error processing feedback request: {str(e)}")

async def feedback_subscription_handler() -> None:
    """
    Handle subscriptions to the FeedbackRequested topic
    """
    logger.info(f"Starting feedback subscription handler, subscribing to {FEEDBACK_REQUEST_TOPIC}")
    
    try:
        # Subscribe to the FeedbackRequested topic
        async for message in cache_events.subscribe(FEEDBACK_REQUEST_TOPIC):
            # Process each message in a new task to avoid blocking the subscription
            asyncio.create_task(process_feedback_request(message))
            
    except Exception as e:
        logger.error(f"Error in feedback subscription handler: {str(e)}")
        # Try to restart the subscription handler after a delay
        await asyncio.sleep(5)
        asyncio.create_task(feedback_subscription_handler())

# Original ai.init
original_init = ai.init

async def extended_init() -> None:
    """
    Extended initialization function that also starts the feedback service
    """
    global _feedback_service_started
    
    # Call the original init function
    await original_init()
    
    # Start the feedback service if not already started
    if not _feedback_service_started:
        logger.info("Starting feedback service...")
        asyncio.create_task(feedback_subscription_handler())
        _feedback_service_started = True
        logger.info("Feedback service started")

# Replace the original init function with our extended version
ai.init = extended_init