from app.backends.questions_backends import QuestionBackend
from app.services import ai_service
import logging

class QuestionService:
    def __init__(self, ai_service, backend: QuestionBackend):
        self.ai_service = ai_service
        self.backend = backend
    
    async def get_questions(self, module_uuid: str, lesson_uuid: str, user_id: str):
        """
        Get all questions for a specific module and lesson,
        and also trigger the first question setup.
        """
        result = await self.backend.get_questions(module_uuid, lesson_uuid)
        questions = result.get("questions", [])
        
        # Optionally adjust difficulty based on user performance
        # This could involve getting user performance data from a cache or database
        # user_performance = await self.backend.cache_events.get_performance(user_id, module_uuid, lesson_uuid)
        # adjusted_questions = self.backend.adjust_difficulty(questions, user_performance)
        
        return {
            "questions": questions,
            "total_count": result.get("total_count", len(questions))
        }
    
    async def execute_question_setup(self, pod_name: str, module_uuid: str, lesson_uuid: str, question_number: int) -> dict:
        try:
            result = await self.backend.execute_question_by_number(
                pod_name, module_uuid, lesson_uuid, question_number
            )
            
            if not result:
                return {
                    "status": "error", 
                    "message": f"Failed to execute question {question_number} setup in the pod",
                    "completed": False
                }
            
            return {
                "status": "success", 
                "message": f"Question {question_number} setup executed successfully",
                "completed": True
            }
            
        except Exception as e:
            logging.error(f"Error executing question setup: {e}")
            return {
                "status": "error", 
                "message": f"Error executing question setup: {e}",
                "completed": False
            }
    
    async def execute_question_check(self, pod_name: str, module_uuid: str, lesson_uuid: str, question_number: int) -> dict:
        try:
            result = await self.backend.execute_check_by_number(
                pod_name, module_uuid, lesson_uuid, question_number
            )
            
            if not result:
                return {
                    "status": "error", 
                    "message": f"Failed validation for question {question_number}",
                    "completed": False
                }
                
            return {
                "status": "success", 
                "message": f"Question {question_number} completed successfully",
                "completed": True
            }
            
        except Exception as e:
            logging.error(f"Error executing question check: {e}")
            return {
                "status": "error", 
                "message": f"Error executing question check: {e}",
                "completed": False
            }
    