import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeedbackFlowDiagramComponent } from '../feedback-flow-diagram/feedback-flow-diagram.component';

@Component({
  selector: 'app-chatbot-flow-diagram',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chatbot-flow-diagram.component.html',
  styleUrls: ['./chatbot-flow-diagram.component.scss'],
})
export class ChatbotFlowDiagramComponent implements OnInit {
  expandedNode: string | null = null;
  activeTab: string = 'chatbot'; // Default to chatbot tab
  feedbackSteps: any[] = []; // Will be populated from the feedback component

  // Node information to display when expanded for Chatbot Flow
  nodeDetails = {
    angularFrontend: {
      title: 'Angular Frontend (ChatbotComponent)',
      description:
        'The frontend component that manages the user interface and WebSocket communication',
      details: [
        'Manages WebSocket connection to the AI Chatbot backend',
        'Handles message rendering, including markdown formatting',
        'Provides streaming responses with real-time updates',
        'Displays source references for transparency',
      ],
      code: `
// Example WebSocket message handling
this.socket.onmessage = (event) => {
  const response = JSON.parse(event.data);

  switch (response.type) {
    case 'chunk':
      // Update message with new content chunk
      this.updateMessageContent(response.content);
      break;
    case 'source':
      // Add source reference
      this.sources.push(response.content);
      break;
    case 'complete':
      this.loading = false;
      break;
  }
};
      `,
    },
    webSocketApi: {
      title: 'WebSocket API Gateway',
      description:
        'Managed WebSocket service that handles client connections and message routing',
      details: [
        'Maintains stateful connections with clients',
        'Routes messages to Lambda functions',
        'Handles connection authentication',
        'Manages connection IDs and sessions',
      ],
      code: `
// Route definition in serverless.yml
websocketApi:
  handler: handlers/websocket_handler.handler
  events:
    - websocket:
        route: $connect
    - websocket:
        route: $disconnect
    - websocket:
        route: $default
      `,
    },
    aiChatbotLambda: {
      title: 'AI Chatbot Lambda (ai_chatbot.py)',
      description:
        'Core processing Lambda that orchestrates the RAG pipeline and streaming responses',
      details: [
        'Processes incoming WebSocket messages',
        'Creates RAG chains using LangChain',
        'Manages conversational context',
        'Streams response chunks back to clients',
      ],
      code: `
# Core RAG pipeline setup
def create_rag_chain(self):
    # Initialize LLM
    llm = Bedrock(
        model_id=self.model_id,
        model_kwargs=self.model_kwargs,
        streaming=True
    )

    # Create RAG chain
    question_generator = LLMChain(llm=llm, prompt=CONDENSE_QUESTION_PROMPT)
    doc_chain = load_qa_chain(llm, chain_type="stuff", prompt=QA_PROMPT)

    return ConversationalRetrievalChain(
        retriever=self.retriever,
        question_generator=question_generator,
        combine_docs_chain=doc_chain,
        return_source_documents=True
    )
      `,
    },
    dynamoDB: {
      title: 'DynamoDB Chat History',
      description:
        'Serverless database that stores conversation history for contextual understanding',
      details: [
        'Stores messages with session_id as key',
        'Enables stateless Lambda functions to access conversation context',
        'Scales automatically with usage',
        "Used by LangChain's DynamoDBChatMessageHistory",
      ],
      code: `
# Initialize chat history from DynamoDB
message_history = DynamoDBChatMessageHistory(
    table_name=HISTORY_TABLE_NAME,
    session_id=session_id,
    key="message_store"
)

# Access previous messages
chat_history = message_history.messages
      `,
    },
    lanceDB: {
      title: 'LanceDB Vector Database',
      description: 'Vector database that stores embeddings for semantic search',
      details: [
        'S3-backed persistent vector store',
        'Stores embeddings of shell script documents',
        'Enables semantic similarity search',
        "Integrated with LangChain's retrieval system",
      ],
      code: `
# Initialize vector store
def get_lancedb_retriever(self, query_embedding_model):
    uri = "s3://shell-scripts-knowledge-base"
    db = lancedb.connect(uri)
    table = db.open_table("embeddings")

    # Create retriever with metadata filter
    retriever = LanceDBRetriever(
        table=table,
        embedding_model=query_embedding_model,
        search_kwargs={"k": 4}
    )

    return retriever
      `,
    },
    bedrock: {
      title: 'Amazon Bedrock',
      description: 'Managed service that provides access to foundation models',
      details: [
        'Hosts Nova and Titan LLMs',
        'Provides embeddings generation',
        'Supports streaming responses',
        'Handles token usage and throttling',
      ],
      code: `
# Set up Bedrock client
bedrock_runtime = boto3.client(
    service_name="bedrock-runtime",
    region_name="us-east-1"
)

# Generate embeddings
def get_embeddings(text, model_id="amazon.titan-embed-text-v1"):
    response = bedrock_runtime.invoke_model(
        modelId=model_id,
        contentType="application/json",
        body=json.dumps({
            "inputText": text
        })
    )

    return json.loads(response["body"].read())["embedding"]
      `,
    },
    responseStreaming: {
      title: 'Response Streaming',
      description: 'System that streams LLM outputs back to users in real-time',
      details: [
        'Chunks responses for immediate feedback',
        'Sends WebSocket messages for each chunk',
        'Includes source metadata',
        'Maintains connection with heartbeat messages',
      ],
      code: `
# Stream response back to client
def stream_response(self, response_stream):
    for chunk in response_stream:
        # Send chunk to client
        self.send_message({
            "type": "chunk",
            "content": chunk.content
        })

        # Send heartbeat every few seconds
        self._maybe_send_heartbeat()

    # Send sources when available
    if hasattr(response_stream, "source_documents"):
        for doc in response_stream.source_documents:
            self.send_message({
                "type": "source",
                "content": {
                    "filename": doc.metadata.get("filename"),
                    "path": doc.metadata.get("path")
                }
            })
      `,
    },
    s3Bucket: {
      title: 'S3 Document Storage',
      description: 'Object storage for shell script documents',
      details: [
        'Stores original shell script documents',
        'Triggers document processing workflows',
        'Provides versioning and access control',
        'Integrated with indexing pipeline',
      ],
      code: `
# S3 event trigger configuration
resources:
  Resources:
    DocumentBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: shell-scripts-documents
        NotificationConfiguration:
          EventBridgeConfiguration:
            EventBridgeEnabled: true
      `,
    },
    documentIndexer: {
      title: 'Document Indexer Lambda',
      description:
        'Processing Lambda that converts documents into searchable embeddings',
      details: [
        'Extracts text from shell scripts',
        'Splits documents into chunks',
        'Generates embeddings using Titan model',
        'Stores vectors in LanceDB',
      ],
      code: `
# Document processing pipeline
def process_document(event, context):
    # Get document from S3
    s3_client = boto3.client('s3')
    bucket = event['detail']['bucket']['name']
    key = event['detail']['object']['key']

    # Extract text content
    response = s3_client.get_object(Bucket=bucket, Key=key)
    document_text = response['Body'].read().decode('utf-8')

    # Split into chunks
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )
    chunks = text_splitter.split_text(document_text)

    # Generate embeddings and store
    for chunk in chunks:
        embedding = get_embeddings(chunk)
        store_in_vectordb(chunk, embedding, metadata={
            "filename": key,
            "source": "s3",
            "bucket": bucket
        })
      `,
    },
  };

  // Node information for Feedback Flow
  feedbackNodeDetails = {
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


  constructor() {}

  ngOnInit(): void {
    // Import feedbackSteps from the FeedbackFlowDiagramComponent
    try {
      const feedbackComponent = new FeedbackFlowDiagramComponent();
      feedbackComponent.ngOnInit(); // Initialize it to generate the steps
      this.feedbackSteps = feedbackComponent.steps;
    } catch (error) {
      console.error('Error importing feedback steps:', error);
      // Fallback steps in case import fails
      this.feedbackSteps = [
        {
          number: 1,
          description: 'Angular frontend requests Momento token from Lambda via API Gateway',
          from: 'angularFrontend',
          to: 'tokenVending'
        },
        // Add the rest of your steps...
      ];
    }
  }
  // This function should be updated in chatbot-flow-diagram.component.ts
  // to ensure both tabs maintain their state:

  setActiveTab(tab: string): void {
    if (this.activeTab !== tab) {
      this.activeTab = tab;

      // Don't reset expanded node when switching between tabs
      // Only reset if the type of expanded node doesn't exist in new tab
      const nodeExists =
        tab === 'chatbot'
          ? this.expandedNode !== null &&
            Object.keys(this.nodeDetails).includes(this.expandedNode)
          : this.expandedNode !== null &&
            Object.keys(this.feedbackNodeDetails).includes(this.expandedNode);

      if (!nodeExists) {
        this.expandedNode = null;
      }

      // Scroll to top when switching tabs
      window.scrollTo(0, 0);
    }
  }

  // Toggle expanded node details
  toggleNodeDetails(nodeId: string): void {
    if (this.expandedNode === nodeId) {
      this.expandedNode = null;
    } else {
      this.expandedNode = nodeId;
    }
  }
}
