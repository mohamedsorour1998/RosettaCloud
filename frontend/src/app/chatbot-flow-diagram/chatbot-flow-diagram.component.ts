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
  activeTab: string = 'platform';
  feedbackSteps: any[] = [];

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
    progressIntegration: {
      title: 'Progress Data Integration',
      description: 'System that connects lab progress with feedback generation',
      details: [
        'Retrieves user progress data from DynamoDB',
        'Collects question metadata from cached questions',
        'Formats data as context for AI feedback',
        'Provides personalized assistance based on completed questions',
      ],
      code: `
    // Collect data for feedback generation
    async def request_feedback(
        user_id: str,
        module_uuid: str,
        lesson_uuid: str,
        feedback_id: str
    ) -> JSONResponse:
        # Get user progress
        progress = await user_service.get_user_progress(
            user_id,
            module_uuid,
            lesson_uuid
        )

        # Get questions for the module/lesson
        questions_response = await questions_service.get_questions(
            module_uuid,
            lesson_uuid
        )
        questions = questions_response.get("questions", [])

        # Format data for feedback
        feedback_request = {
            "user_id": user_id,
            "module_uuid": module_uuid,
            "lesson_uuid": lesson_uuid,
            "feedback_id": feedback_id,
            "questions": questions,
            "progress": progress,
            "timestamp": datetime.utcnow().isoformat()
        }

        # Publish to FeedbackRequested topic
        await momento_service.publish(
            "FeedbackRequested",
            json.dumps(feedback_request)
        )

        return JSONResponse({
            "status": "processing",
            "feedback_id": feedback_id,
            "message": "Feedback request submitted successfully"
        })
      `,
    },
  };

  labsNodeDetails = {
    angularFrontend: {
      title: 'Angular Frontend (Lab Component)',
      description:
        'User interface for launching and interacting with lab environments',
      details: [
        'Provides interface for launching and managing lab environments',
        'Displays questions and verifies solutions',
        'Embeds lab environment via iframe',
        'Integrates with AI chatbot and feedback services',
      ],
      code: `
  // Launch lab environment
  initializeNewLab(): void {
    try {
      sessionStorage.removeItem(this.qStateKey);
      this.questions = [];
      this.currentQuestionIndex = 0;
      this.selectedOption = null;
      this.showFeedback = false;
      this.feedbackMessage = '';
      this.isAnswerCorrect = false;
    } catch (e) {
      console.error('Error clearing question state:', e);
    }
    this.launchNewLab().subscribe();
  }
      `,
    },
    labService: {
      title: 'Lab Management Service',
      description:
        'Backend service that orchestrates lab containers in Kubernetes',
      details: [
        'Creates, manages, and terminates lab containers in Kubernetes',
        'Provisions pods, services, and ingress routes',
        'Tracks active labs and enforces time limits',
        'Provides APIs for lab lifecycle management',
      ],
      code: `
  async def launch(self, *, tag: str | None = None) -> str:
      """Launch a new lab pod and return its ID"""
      LOG.info("Launching new lab pod")

      # Generate a unique lab ID if not provided
      lab_id = tag or f"lab-{uuid.uuid4().hex[:8]}"

      try:
          # Create the pod with pre-built lab image
          pod_id = await self._create_lab_pod(lab_id)

          # Create the service
          await self._create_lab_svc(lab_id)

          # Update the ingress
          await self._patch_ingress(lab_id, add=True)

          # Track the active lab
          self._active[lab_id] = pod_id
          self._created[lab_id] = dt.datetime.now(dt.timezone.utc).timestamp()

          LOG.info(f"Lab {lab_id} launched successfully with pod {pod_id}")
          return lab_id
      except Exception as e:
          LOG.error(f"Failed to launch lab {lab_id}: {e}")
          # Clean up if needed
          with contextlib.suppress(Exception):
              await self.stop(lab_id)
          raise RuntimeError(f"Failed to launch lab: {str(e)}")
      `,
    },
    labContainer: {
      title: 'Lab Container Environment',
      description:
        'Containerized VS Code (Code-Server) with integrated tools for hands-on learning',
      details: [
        'Provides browser-based VS Code environment',
        'Includes Docker-in-Docker for container exercises',
        'Pre-configured with Kubernetes tools and CLI utilities',
        'Isolated environment per user session',
      ],
      code: `
  #!/usr/bin/env bash
  set -e

  # 1) Start code-server
  sudo -u coder /usr/bin/code-server \\
    --host 127.0.0.1 \\
    --port 8080 \\
    --auth none \\
    --user-data-dir /data \\
    --extensions-dir /data/extensions \\
    /home/coder/lab &

  # 2) Start Caddy
  caddy run --config /etc/caddy/Caddyfile &

  # 3) Start Docker & wait
  nohup dockerd-entrypoint.sh dockerd > /var/log/dockerd.log 2>&1 &
  while ! docker info > /dev/null 2>&1; do sleep 1; done

  # 4) Load Kind image and create cluster as coder
  docker load -i /kind-node.tar
  sudo -u coder bash -lc "kind create cluster --image=kindest/node:v1.33.0 --name rosettacloud"

  # 5) Keep script alive
  wait
      `,
    },
    questionService: {
      title: 'Question Service',
      description:
        'Backend service that manages lab questions and validates solutions',
      details: [
        'Retrieves questions from S3 storage',
        'Parses and caches question scripts',
        "Runs setup and validation scripts in user's lab environment",
        'Updates progress when questions are completed successfully',
      ],
      code: `
  async def execute_check_by_number(
      self,
      pod_name: str,
      module_uuid: str,
      lesson_uuid: str,
      question_number: int,
  ) -> bool:
      """Run the '-c' section of one question inside the pod."""
      shell = await self._get_shell_by_number(module_uuid, lesson_uuid, question_number)
      if not shell:
          logging.error("Question #%s not found", question_number)
          return False
      return await self._exec_script_in_pod(pod_name, shell, part="c", question_number=question_number)

  async def _exec_script_in_pod(self, pod: str, shell: str, part: str, question_number: int) -> bool:
      """Extract -q or -c, copy to pod, execute, return success."""
      extractor = self._extract_question_script if part == "q" else self._extract_check_script
      script_body = extractor(shell)

      # write temp file
      with tempfile.NamedTemporaryFile("w+", suffix=".sh", delete=False) as tf:
          tf.write("#!/bin/bash\\n")
          tf.write(script_body)
          tf.write("\\nexit $?\\n")
          path = tf.name
      os.chmod(path, 0o755)

      try:
          # kubectl cp
          dst = f"{pod}:/tmp/{question_number}_{part}_script.sh"
          cp = subprocess.run(
              ["kubectl", "cp", path, dst, "-n", self.namespace],
              capture_output=True, text=True
          )
          if cp.returncode:
              logging.error("kubectl cp failed: %s", cp.stderr)
              return False

          # kubectl exec
          exec_cmd = f"chmod +x /tmp/{question_number}_{part}_script.sh && /tmp/{question_number}_{part}_script.sh"
          ex = subprocess.run(
              ["kubectl", "exec", pod, "-n", self.namespace, "--", "bash", "-c", exec_cmd],
              capture_output=True, text=True
          )
          return ex.returncode == 0
      finally:
          os.unlink(path)
      `,
    },
    userService: {
      title: 'User Service',
      description: 'Service that manages user data and progress tracking',
      details: [
        'Stores and retrieves user progress in DynamoDB',
        'Handles authentication and authorization',
        'Tracks completion status for exercises and modules',
        'Links lab environments to user accounts',
      ],
      code: `
  async def track_user_progress(self, user_id: str, module_uuid: str,
                                lesson_uuid: str, question_number: int, completed: bool) -> bool:
      try:
          # Get user
          user = await self.get_user(user_id)
          if not user:
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
          return False
      `,
    },
    s3Storage: {
      title: 'S3 Content Storage',
      description: 'Object storage for lab content and question scripts',
      details: [
        'Stores shell scripts that define lab questions',
        'Organizes content by module and lesson structure',
        'Provides versioning and access control',
        'Enables dynamic content updates without service deployments',
      ],
      code: `
  async def _fetch_shells(self, module_uuid: str, lesson_uuid: str) -> List[str]:
      cache_key = f"shells:{module_uuid}:{lesson_uuid}"
      cached = await cache.get(self.cache_name, cache_key)
      if cached is not None:
          try:
              return json.loads(cached)
          except Exception:
              logging.warning("Corrupt cache entry %s – refetching", cache_key)

      try:
          async with aioboto3.Session().client("s3") as s3:
              prefix = f"{module_uuid}/{lesson_uuid}/"
              resp = await s3.list_objects_v2(Bucket=self.bucket_name, Prefix=prefix)
              keys = [o["Key"] for o in resp.get("Contents", []) if o["Key"].endswith(".sh")]

              shells: List[str] = []
              for key in keys:
                  obj = await s3.get_object(Bucket=self.bucket_name, Key=key)
                  body = await obj["Body"].read()
                  shells.append(body.decode())

          await cache.set(self.cache_name, cache_key, json.dumps(shells), self.ttl_secs)
          return shells
      except Exception as exc:
          logging.error("Fetch shells failed: %s", exc)
          return []
      `,
    },
    kubernetes: {
      title: 'Kubernetes Orchestration',
      description:
        'Container orchestration platform that hosts the lab environments',
      details: [
        'Manages pods for individual lab sessions',
        'Provides network isolation between lab environments',
        'Enforces resource limits and quotas',
        'Enables scaling based on demand',
      ],
      code: `
  async def _create_lab_pod(self, lab_id: str) -> str:
      pod_id = pod_name(lab_id)

      async with self._k8s() as (core, *_):
          pod = client.V1Pod(
              metadata=client.V1ObjectMeta(
                  name=pod_id,
                  namespace=NAMESPACE,
                  labels={"app": "interactive-labs", "lab-id": lab_id}
              ),
              spec=client.V1PodSpec(
                  containers=[client.V1Container(
                      name="lab",
                      image=POD_IMAGE,
                      ports=[client.V1ContainerPort(container_port=80)],
                      resources=client.V1ResourceRequirements(
                          requests={"cpu": "500m", "memory": "1Gi"},
                          limits={"cpu": "2", "memory": "4Gi"}
                      ),
                      security_context=client.V1SecurityContext(
                          privileged=True  # Required for Docker-in-Docker
                      )
                  )],
                  restart_policy="Always"
              )
          )

          await asyncio.to_thread(core.create_namespaced_pod, NAMESPACE, pod)
          return pod_id
      `,
    },
    momentoCache: {
      title: 'Momento Cache Service',
      description:
        'High-performance distributed cache for lab state and questions',
      details: [
        'Caches active lab IDs by user to prevent duplicate sessions',
        'Stores parsed question data to reduce S3 access',
        'Provides fast access to frequently requested content',
        'Reduces latency and backend load',
      ],
      code: `
  // Check if user already has an active lab
  async def new_lab(request: LaunchLabRequest):
      user_id = request.user_id
      await verify_user(user_id)

      # Check Momento cache first for active labs
      active_lab = await cache_events.get("active_labs", user_id)
      if active_lab and active_lab != "null":
          raise HTTPException(
              status_code=status.HTTP_400_BAD_REQUEST,
              detail="You already have an active lab. Please terminate the existing lab first."
          )

      # If no active lab found in cache, also check DynamoDB as fallback
      user_labs = await user_service.get_user_labs(user_id)
      if user_labs and len(user_labs.labs) > 0:
          raise HTTPException(
              status_code=status.HTTP_400_BAD_REQUEST,
              detail="You already have an active lab in our records. Please terminate it first."
          )

      # No active lab found, proceed with creation
      lab_id = await lab_service.launch()

      # Store in cache and database
      await cache_events.set("active_labs", user_id, lab_id, TTL_SECONDS)
      await user_service.link_lab_to_user(user_id, lab_id)

      return {"lab_id": lab_id}
      `,
    },
    dynamoDB: {
      title: 'DynamoDB Storage',
      description:
        'Persistent NoSQL database for user data and progress tracking',
      details: [
        'Stores user accounts and authentication details',
        'Maintains user-to-lab mappings for access control',
        'Tracks progress on questions, lessons, and modules',
        'Provides data for progress visualization and feedback',
      ],
      code: `
  // User progress structure in DynamoDB
  {
    "user_id": "user-12345",
    "email": "user@example.com",
    "name": "Test User",
    "created_at": 1651234567,
    "labs": ["lab-8a7b6c5d"],
    "progress": {
      "module-uuid-1": {
        "lesson-uuid-1": {
          "1": true,  // Question 1 completed
          "2": true,  // Question 2 completed
          "3": false  // Question 3 not completed
        },
        "lesson-uuid-2": {
          "1": true,
          "2": false
        }
      },
      "module-uuid-2": {
        // Additional module progress...
      }
    }
  }
      `,
    },
    questionScripts: {
      title: 'Question Shell Scripts',
      description:
        'Shell scripts defining question content, setup, and verification',
      details: [
        'Defines question text, type, and difficulty',
        'Contains setup code (-q flag) to prepare lab environment',
        'Contains verification code (-c flag) to check solutions',
        'Uses exit codes to indicate success or failure',
      ],
      code: `
  #!/bin/bash

  # Question Number: 3
  # Question: Create a Docker container running nginx and expose it on port 8081 of the host machine. The container should be named "nginx-test" and store its logs in /home/coder/lab/nginx-logs.
  # Question Type: Check
  # Question Difficulty: Medium

  # -q flag: Clean up any existing container with the same name and create the log directory
  if [[ "$1" == "-q" ]]; then
    echo "Cleaning up any existing nginx-test container..."
    docker rm -f nginx-test 2>/dev/null
    mkdir -p /home/coder/lab/nginx-logs
    exit 0
  fi

  # -c flag: Check if the container is running and exposing port 8081
  if [[ "$1" == "-c" ]]; then
    # Check if container exists and is running
    if docker ps | grep -q "nginx-test"; then
      # Check if port 8081 is mapped
      port_mapping=$(docker port nginx-test)
      # Check if the volume is mounted correctly
      volume_mapping=$(docker inspect nginx-test --format='{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}')

      if [[ "$port_mapping" == *"8081"* && "$port_mapping" == *"80"* &&
            "$volume_mapping" == *"/home/coder/lab/nginx-logs"* ]]; then
        echo "Container 'nginx-test' is running with correct port and volume mapping."
        exit 0
      else
        echo "Container 'nginx-test' is running but configuration is incorrect."
        exit 1
      fi
    else
      echo "Container 'nginx-test' is not running."
      exit 1
    fi
  fi
      `,
    },
    progressTracking: {
      title: 'Progress Tracking System',
      description:
        'Backend system that tracks user progress across learning modules',
      details: [
        'Records completion status for each question',
        'Updates DynamoDB when solutions are verified as correct',
        'Provides progress data to frontend for visualization',
        'Integrates with feedback generation for personalized guidance',
      ],
      code: `
  // When a solution is verified as correct
  async def check_question(
      pod_name: str,
      module_uuid: str,
      lesson_uuid: str,
      question_number: int,
      user_id: str,
      additional_data: Optional[Dict[str, Any]] = None
  ) -> JSONResponse:
      # Run the check script in the pod
      is_correct = await questions_service.execute_check_by_number(
          pod_name,
          module_uuid,
          lesson_uuid,
          question_number
      )

      # If the solution is correct, update user progress
      if is_correct:
          await user_service.track_user_progress(
              user_id,
              module_uuid,
              lesson_uuid,
              question_number,
              True  # completed
          )
          return JSONResponse({
              "status": "success",
              "message": "Your solution is correct!",
              "completed": True
          })
      else:
          return JSONResponse({
              "status": "failure",
              "message": "Your solution is not correct. Please try again.",
              "completed": False
          })
      `,
    },
    feedbackIntegration: {
      title: 'Feedback Integration',
      description:
        'System that connects lab progress data with the feedback service',
      details: [
        'Retrieves user progress data from DynamoDB',
        'Collects question metadata for context',
        'Formats data for AI feedback generation',
        'Provides personalized guidance based on progress',
      ],
      code: `
  // Collect data for feedback generation
  async def request_feedback(
      user_id: str,
      module_uuid: str,
      lesson_uuid: str,
      feedback_id: str
  ) -> JSONResponse:
      # Get user progress
      progress = await user_service.get_user_progress(
          user_id,
          module_uuid,
          lesson_uuid
      )

      # Get questions for the module/lesson
      questions_response = await questions_service.get_questions(
          module_uuid,
          lesson_uuid
      )
      questions = questions_response.get("questions", [])

      # Format data for feedback
      feedback_request = {
          "user_id": user_id,
          "module_uuid": module_uuid,
          "lesson_uuid": lesson_uuid,
          "feedback_id": feedback_id,
          "questions": questions,
          "progress": progress,
          "timestamp": datetime.utcnow().isoformat()
      }

      # Publish to FeedbackRequested topic
      await momento_service.publish(
          "FeedbackRequested",
          json.dumps(feedback_request)
      )

      return JSONResponse({
          "status": "processing",
          "feedback_id": feedback_id,
          "message": "Feedback request submitted successfully"
      })
      `,
    },
  };

  // Add lab workflow steps
  labWorkflows = {
    launch: [
      {
        number: 1,
        description: 'User clicks "Launch Lab" button in frontend',
        component: 'Frontend',
      },
      {
        number: 2,
        description: 'Backend checks Momento cache for existing active lab',
        component: 'Cache',
      },
      {
        number: 3,
        description: 'If not in cache, backend checks DynamoDB as fallback',
        component: 'Database',
      },
      {
        number: 4,
        description: 'Lab service creates K8s pod with lab container',
        component: 'Kubernetes',
      },
      {
        number: 5,
        description: 'Lab service creates service and updates ingress',
        component: 'Kubernetes',
      },
      {
        number: 6,
        description: 'Lab ID stored in Momento cache with user ID as key',
        component: 'Cache',
      },
      {
        number: 7,
        description: 'User-to-lab mapping saved in DynamoDB for persistence',
        component: 'Database',
      },
      {
        number: 8,
        description: 'Container starts Code-Server, Docker, and Kind',
        component: 'Lab Container',
      },
      {
        number: 9,
        description: 'Frontend loads lab in iframe using generated URL',
        component: 'Frontend',
      },
    ],
    question: [
      {
        number: 1,
        description: 'Frontend requests questions for module/lesson',
        component: 'Frontend',
      },
      {
        number: 2,
        description: 'Backend checks Momento cache for cached questions',
        component: 'Cache',
      },
      {
        number: 3,
        description: 'If not cached, backend fetches from S3 and parses',
        component: 'S3 Storage',
      },
      {
        number: 4,
        description: 'Backend caches parsed questions in Momento',
        component: 'Cache',
      },
      {
        number: 5,
        description: 'Questions returned to frontend with metadata',
        component: 'Frontend',
      },
      {
        number: 6,
        description: 'For Check-type question: Backend extracts -q flag script',
        component: 'Question Service',
      },
      {
        number: 7,
        description: 'Setup script copied to pod via kubectl cp',
        component: 'Kubernetes',
      },
      {
        number: 8,
        description: 'Setup script executed in pod environment',
        component: 'Lab Container',
      },
      {
        number: 9,
        description: 'User works on solution in VS Code environment',
        component: 'Lab Container',
      },
      {
        number: 10,
        description: 'User clicks "Check Solution" button',
        component: 'Frontend',
      },
      {
        number: 11,
        description: 'Backend extracts -c flag script for verification',
        component: 'Question Service',
      },
      {
        number: 12,
        description: 'Verification script copied to pod via kubectl cp',
        component: 'Kubernetes',
      },
      {
        number: 13,
        description: 'Verification script executed to check solution',
        component: 'Lab Container',
      },
      {
        number: 14,
        description: 'Success/failure determined by script exit code',
        component: 'Question Service',
      },
      {
        number: 15,
        description: 'If correct, progress updated in DynamoDB',
        component: 'User Service',
      },
      {
        number: 16,
        description: 'Updated progress returned to frontend',
        component: 'Frontend',
      },
    ],
    feedback: [
      {
        number: 1,
        description: 'User requests feedback on lab progress',
        component: 'Frontend',
      },
      {
        number: 2,
        description: 'Backend fetches user progress from DynamoDB',
        component: 'Database',
      },
      {
        number: 3,
        description: 'Backend gets question metadata from cache or S3',
        component: 'Cache/S3',
      },
      {
        number: 4,
        description: 'Data formatted with feedback ID for tracking',
        component: 'Backend',
      },
      {
        number: 5,
        description: 'Request published to FeedbackRequested topic',
        component: 'Momento',
      },
      {
        number: 6,
        description: 'Feedback service processes request with AI',
        component: 'AI Service',
      },
      {
        number: 7,
        description: 'Generated feedback published to FeedbackGiven topic',
        component: 'Momento',
      },
      {
        number: 8,
        description: 'Frontend receives feedback via WebSocket subscription',
        component: 'Frontend',
      },
      {
        number: 9,
        description: 'Feedback displayed to user with formatted markdown',
        component: 'Frontend',
      },
    ],
  };

  // First, let's add a new nodeDetails section in chatbot-flow-diagram.component.ts

  platformNodeDetails = {
    backendAPI: {
      title: 'Backend API Service',
      description:
        'Central FastAPI application that serves as the hub for all platform services',
      details: [
        'Exposes REST endpoints for user management, lab provisioning, and questions',
        'Connects to Kubernetes for container orchestration',
        'Integrates with AI services for feedback and assistance',
        'Manages caching and event streaming through Momento',
        'Handles authentication and authorization',
      ],
      code: `
# Main FastAPI application (app/main.py)
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="RosettaCloud API",
    description="Interactive lab platform for technical training",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(user_router, prefix="/users", tags=["users"])
app.include_router(lab_router, prefix="/labs", tags=["labs"])
app.include_router(question_router, prefix="/questions", tags=["questions"])
app.include_router(auth_router, prefix="/auth", tags=["auth"])

@app.get("/health-check")
async def health_check():
    """Simple health check endpoint."""
    return "OK"
    `,
    },
    labContainer: {
      title: 'Containerized Lab Environments',
      description:
        'Isolated Kubernetes pods providing secure development environments',
      details: [
        'Custom Docker images with pre-installed development tools',
        'Code-Server (VS Code in browser) as the main interface',
        'Docker-in-Docker capability for container exercises',
        'Time-limited sessions with automatic cleanup',
        'Resource restrictions for fair usage',
      ],
      code: `
# Kubernetes deployment manifest
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lab-deployment
  namespace: interactive-labs
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lab-environment
  template:
    metadata:
      labels:
        app: lab-environment
    spec:
      containers:
      - name: lab-container
        image: rosettacloud/lab-environment:latest
        resources:
          limits:
            cpu: "2"
            memory: "4Gi"
          requests:
            cpu: "500m"
            memory: "1Gi"
        securityContext:
          privileged: true  # Required for Docker-in-Docker
        ports:
        - containerPort: 8080
        volumeMounts:
        - name: docker-graph-storage
          mountPath: /var/lib/docker
      volumes:
      - name: docker-graph-storage
        emptyDir: {}
    `,
    },
    aiServices: {
      title: 'AI System',
      description: 'Intelligent services for real-time assistance and feedback',
      details: [
        'Integration with AWS Bedrock (Nova LLM) for natural language responses',
        'Enabling Chatbot functionality',
        'Real-time feedback on student progress and solutions',
        'Retrieval-Augmented Generation (RAG) for context-aware assistance',
        'Automatic evaluation of exercise submissions',
        'Personalized learning recommendations',
      ],
      code: `
# AI service module (ai_service.py)
from typing import Union, AsyncGenerator
import json
import boto3
import logging

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOKENS = 1024
DEFAULT_TEMPERATURE = 0.7
DEFAULT_MODEL_ID = "amazon.nova-lite-v1:0"
DEFAULT_SYSTEM_ROLE = "You are an educational assistant providing help with shell scripting."

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
    serverlessComponents: {
      title: 'Serverless Components',
      description:
        'AWS Lambda functions providing auxiliary platform functionality',
      details: [
        'WebSocket-based chatbot assistant using API Gateway and Lambda',
        'Document indexing pipeline for educational content',
        'Feedback generation service for student progress',
        'Token vending service for secure Momento access',
        'Event-driven architecture for scalability',
      ],
      code: `
// Token vending Lambda
const { AuthClient, CredentialProvider, ExpiresIn, AllTopics, TokenScopes } = require('@gomomento/sdk');

exports.handler = async (event) => {
  try {
    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const userId = queryParams.user_id;
    const cacheName = process.env.CACHE_NAME || 'interactive-labs';
    const expiryMinutes = parseInt(queryParams.expiry_minutes || '60', 10);

    if (!userId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing required parameter: user_id' })
      };
    }

    // Generate token
    const result = await generateToken(
      process.env.MOMENTO_API_KEY,
      userId,
      cacheName,
      expiryMinutes
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: result.authToken
    };
  } catch (error) {
    console.error('Error generating token:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: Internal server error })
    };
  }
};
    `,
    },
    eventDriven: {
      title: 'Event-Driven Architecture',
      description:
        'Real-time messaging and caching system powering the platform',
      details: [
        'Momento cache for high-performance data storage',
        'Pub/sub topics for asynchronous communication',
        'WebSocket integration for real-time updates',
        'Event-based triggers for serverless functions',
        'Decoupled components for maintainability and scaling',
      ],
      code: `
# Momento service implementation
async def publish(topic_name: str, message: str) -> bool:
    """Publish a message to a Momento topic."""
    try:
        client = await get_momento_client()
        response = await client.publish(
            cache_name=CACHE_NAME,
            topic_name=topic_name,
            value=message
        )

        if isinstance(response, TopicPublish.Success):
            logger.info(f"Successfully published to {topic_name}")
            return True
        else:
            logger.error(f"Failed to publish to {topic_name}: {response.message()}")
            return False
    except Exception as e:
        logger.exception(f"Error publishing to Momento: {e}")
        return False

# Angular subscription component
async subscribeToTopic(topic: string, feedbackId: string): Promise<void> {
  try {
    // Get authentication token
    const token = await this.getAuthToken();

    // Initialize Momento client
    this.topicClient = new TopicClient({
      configuration: Configurations.Browser.v1(),
      credentialProvider: CredentialProvider.fromString({ apiKey: token }),
    });

    // Subscribe to topic
    const response = await this.topicClient.subscribe(this.cacheName, topic, {
      onItem: (item) => {
        const data = JSON.parse(item.valueString());
        if (data.feedback_id === feedbackId) {
          this.zone.run(() => this.messageReceived.next(data));
        }
      },
      onError: (err) => {
        console.error("Subscription error:", err);
        this.zone.run(() => this.errorOccurred.next(err));
      }
    });

    // Store subscription for later cleanup
    this.subscription = response;

  } catch (err) {
    console.error("Failed to subscribe:", err);
  }
}
    `,
    },
    integrationPoints: {
      title: 'Integration Points',
      description: 'Connectors and APIs for external system integration',
      details: [
        'OpenEdX LMS integration for seamless learning experiences',
        'REST APIs for third-party system connectivity',
        'WebSocket APIs for real-time applications',
        'Content management system integration',
        'Authentication provider connectors',
      ],
      code: `
# OpenEdX integration adapter (planned)
class OpenEdxAdapter:
    """Adapter for OpenEdX LMS integration."""

    def __init__(self, api_url: str, client_id: str, client_secret: str):
        self.api_url = api_url
        self.client_id = client_id
        self.client_secret = client_secret
        self._token = None
        self._token_expiry = 0

    async def get_course_content(self, course_id: str) -> dict:
        """Get course content from OpenEdX."""
        token = await self._ensure_token()
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.api_url}/api/courses/v1/courses/{course_id}/",
                headers=headers
            )
            response.raise_for_status()
            return response.json()

    async def update_grade(self, user_id: str, course_id: str, grade: float) -> bool:
        """Update student grade in OpenEdX."""
        token = await self._ensure_token()
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/api/grades/v1/gradebook/{course_id}/users/",
                headers=headers,
                json={
                    "user_id": user_id,
                    "grade": grade,
                    "comment": "Updated from RosettaCloud"
                }
            )
            return response.status_code == 200
    `,
    },
    deploymentArch: {
      title: 'Deployment Architecture',
      description: 'AWS cloud services powering the platform infrastructure',
      details: [
        'Amazon EKS for Kubernetes orchestration of lab environments',
        'Lambda for serverless components and microservices',
        'API Gateway for WebSocket and HTTP endpoints',
        'S3 for content storage and static files',
        'ECR for Docker image registry',
        'Momento for caching and pub/sub messaging',
      ],
      code: `
# Terraform deployment snippet (infrastructure as code)
provider "aws" {
  region = "us-east-1"
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"

  cluster_name                   = "rosettacloud-cluster"
  cluster_version                = "1.27"
  cluster_endpoint_public_access = true

  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnets
  control_plane_subnet_ids = module.vpc.intra_subnets

  # EKS Managed Node Group(s)
  eks_managed_node_group_defaults = {
    instance_types = ["m5.large", "m5a.large"]
  }

  eks_managed_node_groups = {
    labs = {
      min_size     = 2
      max_size     = 10
      desired_size = 2

      instance_types = ["m5.large"]
      capacity_type  = "ON_DEMAND"
    }
  }
}

# Lambda functions
resource "aws_lambda_function" "ai_chatbot" {
  function_name = "ai-chatbot"
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30
  memory_size   = 512

  role = aws_iam_role.lambda_role.arn

  environment {
    variables = {
      CACHE_NAME = "interactive-labs"
    }
  }
}
    `,
    },
    securityModel: {
      title: 'Security Model',
      description:
        'Security architecture ensuring safe and isolated environments',
      details: [
        'Kubernetes namespace isolation for lab environments',
        'API authentication and authorization',
        'Short-lived token generation for services',
        'Content security policies and data protection',
        'Network security with VPC and security groups',
      ],
      code: `
# Security middleware for API endpoints
from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def get_api_key(api_key_header: str = Security(api_key_header)):
    if api_key_header is None or not verify_api_key(api_key_header):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return api_key_header

async def verify_user_access(user_id: str, resource_id: str, action: str) -> bool:
    """Verify if a user has access to a resource for a given action."""
    # Implementation would check permissions in database
    try:
        # Check if user exists
        user = await get_user_by_id(user_id)
        if not user:
            return False

        # Check resource ownership
        if action in ["read", "update", "delete"]:
            resource = await get_resource_by_id(resource_id)
            if not resource or resource.owner_id != user_id:
                # Admins can access all resources
                return user.role == "admin"

        # Additional permission checks as needed
        return True
    except Exception as e:
        logger.error(f"Error verifying user access: {e}")
        return False
    `,
    },
    lmsIntegration: {
      title: 'Learning Management System Integration',
      description:
        'Connectors for seamless LMS interaction and grade synchronization',
      details: [
        'OpenEdX integration for course content and grades',
        'SSO support for seamless authentication',
        'xAPI support for learning analytics',
        'Grade passback using LTI standards',
        'Content synchronization for course materials',
      ],
      code: `
# LTI Consumer implementation for grade passback
from pylti1p3.grade import Grade
from pylti1p3.lineitem import LineItem

async def send_grade_to_lms(user_id: str, assignment_id: str, score: float, max_score: float = 100.0):
    """Send a grade back to the LMS through LTI 1.3."""
    try:
        # Get tool and registration data
        tool_conf = get_lti_config()
        registration = tool_conf.get_registration_by_issuer(current_issuer)

        # Create line item if it doesn't exist
        line_item_service = LineItemService()
        line_items = await line_item_service.get_line_items()

        line_item = None
        for item in line_items:
            if item.get('tag') == assignment_id:
                line_item = item
                break

        if not line_item:
            # Create a new line item
            line_item = LineItem()
            line_item.set_tag(assignment_id)
            line_item.set_score_maximum(max_score)
            line_item.set_label(f"Assignment {assignment_id}")
            line_item = await line_item_service.create_line_item(line_item)

        # Submit the grade
        grade = Grade()
        grade.set_score_given(score)
        grade.set_score_maximum(max_score)
        grade.set_user_id(user_id)
        grade.set_timestamp(datetime.datetime.now().isoformat())
        grade.set_activity_progress('Completed')
        grade.set_grading_progress('FullyGraded')

        result = await line_item_service.submit_score(line_item['id'], grade)
        return result.get('status_code') == 200
    except Exception as e:
        logger.error(f"Error sending grade to LMS: {e}")
        return False
    `,
    },
    infrastructure: {
      title: 'Infrastructure Components',
      description: 'Core infrastructure elements powering the platform',
      details: [
        'Kubernetes clusters for containerized lab environments',
        'Amazon VPC for network isolation',
        'Load balancers for traffic distribution',
        'Auto-scaling for handling variable demand',
        'Monitoring and logging infrastructure',
      ],
      code: `
# Kubernetes configuration for lab infrastructure
apiVersion: v1
kind: Namespace
metadata:
  name: interactive-labs
  labels:
    app: rosettacloud
    environment: production

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: lab-ingress
  namespace: interactive-labs
  annotations:
    kubernetes.io/ingress.class: "nginx"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/server-snippet: |
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
spec:
  rules:
  - host: "*.labs.rosettacloud.com"
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: lab-service
            port:
              number: 80
  tls:
  - hosts:
    - "*.labs.rosettacloud.com"
    secretName: labs-tls-certificate
    `,
    },
  };

  // Add new tab workflows in chatbot-flow-diagram.component.ts
  platformWorkflows = {
    userJourney: [
      {
        number: 1,
        description:
          'User authenticates through the frontend application or LMS',
        component: 'Authentication',
      },
      {
        number: 2,
        description: 'Frontend requests lab environment from the API',
        component: 'API',
      },
      {
        number: 3,
        description: 'Backend service provisions a Kubernetes pod for the lab',
        component: 'Lab Service',
      },
      {
        number: 4,
        description: 'User accesses the lab environment through an iframe',
        component: 'Frontend',
      },
      {
        number: 5,
        description: 'User works through exercises in the lab environment',
        component: 'Lab Container',
      },
      {
        number: 6,
        description: 'Verification scripts check solutions for correctness',
        component: 'Question Service',
      },
      {
        number: 7,
        description: 'User progress is updated in the database',
        component: 'User Service',
      },
      {
        number: 8,
        description: 'User requests AI assistance through the chatbot',
        component: 'Chatbot',
      },
      {
        number: 9,
        description: 'Upon completion, user requests personalized feedback',
        component: 'Feedback Service',
      },
      {
        number: 10,
        description: 'Progress data is synchronized back to LMS (future)',
        component: 'LMS Integration',
      },
    ],
    dataFlow: [
      {
        number: 1,
        description: 'Educational content added to S3 storage',
        component: 'Content',
      },
      {
        number: 2,
        description: 'Document indexing pipeline processes content',
        component: 'Indexing',
      },
      {
        number: 3,
        description: 'Embeddings stored in vector database for retrieval',
        component: 'Storage',
      },
      {
        number: 4,
        description: 'User interactions generate usage data',
        component: 'Usage',
      },
      {
        number: 5,
        description: 'Progress tracked in database for persistence',
        component: 'Database',
      },
      {
        number: 6,
        description: 'Real-time events flow through Momento topics',
        component: 'Events',
      },
      {
        number: 7,
        description: 'AI services access data for personalized responses',
        component: 'AI',
      },
      {
        number: 8,
        description: 'Aggregated analytics data for reporting (future)',
        component: 'Analytics',
      },
    ],
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
          description:
            'Angular frontend requests Momento token from Lambda via API Gateway',
          from: 'angularFrontend',
          to: 'tokenVending',
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
      const nodeExists =
        tab === 'platform'
          ? this.expandedNode !== null &&
            Object.keys(this.platformNodeDetails).includes(this.expandedNode)
          : tab === 'labs'
          ? this.expandedNode !== null &&
            Object.keys(this.labsNodeDetails).includes(this.expandedNode)
          : tab === 'chatbot'
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
