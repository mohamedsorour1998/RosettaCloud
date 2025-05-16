import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-feedback-flow-diagram',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback-flow-diagram.component.html',
  styleUrls: ['./feedback-flow-diagram.component.scss'],
})
export class FeedbackFlowDiagramComponent implements OnInit {
  expandedNode: string | null = null;

  // Node information to display when expanded
  nodeDetails = {
    angularFrontend: {
      title: 'Angular Frontend',
      description: 'User interface for requesting and displaying feedback',
      details: [
        'Requests token from Lambda via API Gateway',
        'Opens WebSocket connection to Momento',
        'Subscribes to FeedbackGiven topic',
        'Sends feedback requests to API Gateway',
        'Displays feedback with markdown formatting',
      ],
      code: `
// Angular frontend service
async requestMomentoToken(userId: string): Promise<string> {
  const response = await this.http.get(
    \`\${API_BASE_URL}/momento/token?user_id=\${userId}&scope=both&expiry_minutes=30\`
  ).toPromise();
  return response as string;
}

// Connect to Momento and subscribe
connectToMomento(token: string, feedbackId: string): void {
  const topicClient = new Momento.TopicClient({
    configuration: Momento.TopicClientConfigurations.Default.latest(),
    credentialProvider: Momento.CredentialProvider.fromString(token),
  });

  // Subscribe to FeedbackGiven topic
  this.subscription = topicClient.subscribe("interactive-labs", "FeedbackGiven", {
    onItem: (item) => {
      // Parse the feedback message
      const feedback = JSON.parse(item.valueString());

      // Check if this feedback matches our request ID
      if (feedback.feedback_id === feedbackId) {
        this.feedbackContent = feedback.content;
        this.feedbackReceived.next(feedback);
      }
    }
  });
}
      `,
    },
    tokenVending: {
      title: 'Momento Token Vending Lambda',
      description:
        'Generates temporary Momento authentication tokens for the frontend',
      details: [
        'Validates user permissions',
        'Generates disposable token with appropriate scopes',
        'Sets expiration time for security',
        'Returns token to frontend via API Gateway',
      ],
      code: `
// Lambda function (index.js)
async function generateToken(apiKey, userId, cacheName, expiryMinutes, scope) {
  // Initialize auth client if not already done
  if (!_momentoAuthClient) {
    _momentoAuthClient = new AuthClient({
      credentialProvider: CredentialProvider.fromString({ apiKey }),
    });
  }

  // Determine token scope - both publish and subscribe
  let tokenScope = TokenScopes.topicPublishSubscribe(cacheName, AllTopics);

  // Generate token
  const response = await _momentoAuthClient.generateDisposableToken(
    tokenScope,
    ExpiresIn.minutes(expiryMinutes),
    { tokenId: userId }
  );

  if (response.type === GenerateDisposableTokenResponse.Success) {
    return {
      authToken: response.authToken,
      expiresAt: response.expiresAt.epoch(),
    };
  } else {
    throw new Error(\`Failed to generate token: \${response.message()}\`);
  }
}
      `,
    },
    feedbackRequest: {
      title: 'Feedback Request Lambda',
      description: 'Processes feedback requests and publishes to Momento',
      details: [
        'Receives request from API Gateway',
        'Validates request parameters',
        'Formats request for backend processing',
        'Publishes to FeedbackRequested topic',
      ],
      code: `
# Lambda function (feedback_request.py)
async def async_lambda_handler(event, context):
    try:
        # Initialize Momento client
        momento_client = MomentoClient()
        await momento_client.init()

        # Parse request body
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']

        # Extract parameters
        user_id = body.get('user_id')
        module_uuid = body.get('module_uuid')
        lesson_uuid = body.get('lesson_uuid')
        feedback_id = body.get('feedback_id')
        questions = body.get('questions', [])
        progress = body.get('progress', {})

        # Format the message for Momento
        message = {
            'feedback_id': feedback_id,
            'user_id': user_id,
            'module_uuid': module_uuid,
            'lesson_uuid': lesson_uuid,
            'questions': questions,
            'progress': progress,
            'timestamp': datetime.utcnow().isoformat()
        }

        # Publish to Momento topic
        logger.info(f"Publishing request to FeedbackRequested topic: {feedback_id}")
        await momento_client.publish('FeedbackRequested', json.dumps(message))

        # Return success response
        return {
            'statusCode': 200,
            'headers': CORS_HEADERS,
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
            'headers': CORS_HEADERS,
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }
      `,
    },
    momento: {
      title: 'Momento Pub/Sub Service',
      description: 'Real-time messaging backbone for the feedback service',
      details: [
        'Provides WebSocket connections for real-time updates',
        'Handles FeedbackRequested topic for incoming requests',
        'Handles FeedbackGiven topic for completed feedback',
        'Enables filtering by feedback_id for message routing',
      ],
      code: `
// Angular Subscription to FeedbackGiven topic
onItem: (item) => {
  try {
    // Parse the feedback message
    const feedback = JSON.parse(item.valueString());

    // Check if this feedback matches our request ID
    if (feedback.feedback_id === this.currentFeedbackId) {
      this.feedbackContent = feedback.content;
      this.feedbackStatus = 'received';
      this.enablePrintButton = true;

      // Notify any listeners
      this.feedbackReceived.next(feedback);
    }
  } catch (e) {
    console.error("Error processing feedback message:", e);
  }
}
      `,
    },
    feedbackService: {
      title: 'Feedback Service Backend',
      description: 'Serverless service that processes feedback requests',
      details: [
        'Subscribes to FeedbackRequested topic',
        'Processes each request in a separate async task',
        'Builds AI prompt based on user progress and questions',
        'Publishes generated feedback to FeedbackGiven topic',
      ],
      code: `
# feedback_service.py
async def _handle(raw_msg: str) -> None:
    logger.debug("Raw message: %s", raw_msg)
    try:
        data = json.loads(raw_msg)
        feedback_id = data["feedback_id"]

        prompt = _build_prompt(data)
        logger.info("Calling AI for request %s", feedback_id)

        system_role = (
            "You are an educational assistant providing feedback on lab exercises. "
            "Provide concise but meaningful feedback due to message size constraints. "
            "Do not mention any user IDs or specific identifiers in your feedback. "
            "Address the student generically without any personal references. "
            "Focus on the educational content and performance only."
        )

        # Use the configured token limit
        ai_response = await ai.chat(
            prompt=prompt,
            stream=False,
            max_tokens=DEFAULT_MAX_TOKENS,
            temperature=DEFAULT_TEMPERATURE,
            system_role=system_role
        )

        # Prepare payload
        payload_data = {
            "type": "feedback",
            "feedback_id": feedback_id,
            "content": ai_response,
            "timestamp": datetime.utcnow().isoformat(),
        }

        payload = json.dumps(payload_data)

        # Publish the payload
        pub = await _publish(FEEDBACK_GIVEN_TOPIC, payload)
        if isinstance(pub, TopicPublish.Error):
            logger.error("Publish failed: %s", pub.message)
        else:
            logger.info("Feedback %s published to %s", feedback_id, FEEDBACK_GIVEN_TOPIC)

    except Exception as exc:
        logger.exception("Failed to handle message: %s", exc)
      `,
    },
    aiService: {
      title: 'AI Service',
      description: 'Generates educational feedback using language models',
      details: [
        'Processes feedback requests from the backend service',
        'Uses Bedrock/Nova LLM for feedback generation',
        'Formats responses for educational context',
        'Includes customized system prompts for tailored feedback',
      ],
      code: `
# ai_service.py
async def chat(
    prompt: str,
    stream: bool = False,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    temperature: float = DEFAULT_TEMPERATURE,
    model_id: str = DEFAULT_MODEL_ID,
    system_role: str = DEFAULT_SYSTEM_ROLE,
) -> Union[str, AsyncGenerator[str, None]]:
    """Generate a chat response from the AI model."""

    # Create the messages array with system role and user prompt
    messages = [
        {"role": "system", "content": system_role},
        {"role": "user", "content": prompt}
    ]

    # Generate response from chosen AI model (Nova/Bedrock)
    try:
        if stream:
            # Implementation for streaming responses
            return _stream_response(messages, max_tokens, temperature, model_id)
        else:
            # Implementation for single response
            response = await _client.invoke_model(
                modelId=model_id,
                body=json.dumps({
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature
                }),
                contentType="application/json",
                accept="application/json"
            )
            response_body = json.loads(await response["body"].read())
            return response_body["completion"]
    except Exception as e:
        logger.exception("Error generating AI response: %s", e)
        return f"Error generating response: {str(e)}"
      `,
    },
    displayComponent: {
      title: 'Feedback Display Component',
      description: 'Angular component for displaying and printing feedback',
      details: [
        'Formats markdown feedback for HTML display',
        'Provides countdown timer for lab termination',
        'Enables saving feedback as text files',
        'Handles modal overlay and accessibility',
      ],
      code: `
// Angular component
displayFeedback(feedback: any): void {
  this.feedbackHtml = this.sanitizer.bypassSecurityTrustHtml(
    this.markdownService.render(feedback.content)
  );
  this.isPrintable = true;
}

saveFeedback(): void {
  if (!this.feedback) return;

  try {
    const formattedContent = this.formatFeedbackForDownload(this.feedback);
    const feedbackBlob = new Blob([formattedContent], { type: 'text/plain' });
    const downloadLink = document.createElement('a');
    downloadLink.href = URL.createObjectURL(feedbackBlob);
    downloadLink.download = \`Feedback-Module\${this.moduleUuid}-\${
      new Date().toISOString().split('T')[0]
    }.txt\`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    this.showSaveSuccess = true;
    this.saveSuccessTimeout = setTimeout(() => {
      this.showSaveSuccess = false;
    }, 3000);
  } catch (error) {
    console.error('Error downloading feedback:', error);
  }
}
      `,
    },
  };

  // Steps in the feedback flow process
  steps = [
    {
      number: 1,
      description:
        'Angular frontend requests Momento token from Lambda via API Gateway',
      from: 'angularFrontend',
      to: 'tokenVending',
    },
    {
      number: 2,
      description:
        'Lambda authenticates and returns a disposable Momento token',
      from: 'tokenVending',
      to: 'angularFrontend',
    },
    {
      number: 3,
      description:
        'Angular opens WebSocket and subscribes to FeedbackGiven topic',
      from: 'angularFrontend',
      to: 'momento',
    },
    {
      number: 4,
      description:
        'User initiates feedback request; Angular sends to API Gateway',
      from: 'angularFrontend',
      to: 'feedbackRequest',
    },
    {
      number: 5,
      description:
        'Feedback Request Lambda publishes to FeedbackRequested topic',
      from: 'feedbackRequest',
      to: 'momento',
    },
    {
      number: 6,
      description: 'Backend service listens on FeedbackRequested topic',
      from: 'momento',
      to: 'feedbackService',
    },
    {
      number: 7,
      description:
        'Backend service parses request and builds prompt for AI service',
      from: 'feedbackService',
      to: 'aiService',
    },
    {
      number: 8,
      description:
        'AI service generates feedback and returns to backend service',
      from: 'aiService',
      to: 'feedbackService',
    },
    {
      number: 9,
      description: 'Backend service publishes feedback to FeedbackGiven topic',
      from: 'feedbackService',
      to: 'momento',
    },
    {
      number: 10,
      description:
        'Angular receives feedback, filters by feedback_id, and displays it',
      from: 'momento',
      to: 'angularFrontend',
    },
    {
      number: 11,
      description: 'User can save feedback as a text file or terminate lab',
      from: 'angularFrontend',
      to: 'displayComponent',
    },
  ];

  constructor() {}

  ngOnInit(): void {}

  // Toggle expanded node details
  toggleNodeDetails(nodeId: string): void {
    if (this.expandedNode === nodeId) {
      this.expandedNode = null;
    } else {
      this.expandedNode = nodeId;
    }
  }
}
