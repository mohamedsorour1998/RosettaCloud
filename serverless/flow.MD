1- User completes all questions and clicks "Get Feedback"
2- Frontend sends request to API Gateway
3- Lambda function processes request and publishes to "FeedbackRequested" topic
4- AI service extension receives the request, generates feedback, and publishes to "FeedbackGiven" topic
5- WebSocket endpoint delivers the feedback to the frontend
6- Frontend displays the feedback to the user
