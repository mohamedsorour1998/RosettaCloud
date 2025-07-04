## Event-Driven Serverless Architecture

This architecture uses two Lambda functions that communicate through EventBridge to create an efficient feedback system.

### Components:

1. **REST API Gateway → Feedback Request Lambda**
   - Handles incoming feedback requests
   - Publishes to "FeedbackRequested" Momento topic
   - Triggers a notification event to the WebSocket Lambda

2. **WebSocket API Gateway ↔ WebSocket Handler Lambda**
   - Handles WebSocket connections/disconnections
   - Listens for notification events
   - Pulls specific feedback from "FeedbackGiven" topic
   - Sends feedback to connected clients

3. **Amazon EventBridge**
   - Passes notification events between Lambdas
   - Contains feedback_id to identify which feedback to pull

### Data Flow:

1. User requests feedback through frontend
2. REST API Gateway calls Feedback Request Lambda
3. Feedback Request Lambda:
   - Publishes request to "FeedbackRequested" Momento topic
   - Sends notification event with feedback_id to EventBridge
   - Returns feedback_id to frontend

4. AI Service processes the request and publishes to "FeedbackGiven"

5. WebSocket Handler Lambda:
   - Receives notification event with feedback_id
   - Pulls the specific feedback from "FeedbackGiven" topic
   - Sends feedback to connected WebSocket clients

### Benefits:

- **Truly Serverless**: No long-running processes
- **Efficient**: WebSocket Lambda only pulls feedback when notified
- **Minimalist**: No need for DynamoDB or extra storage
- **Fast**: Event-driven architecture reduces latency