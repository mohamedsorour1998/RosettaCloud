import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-chatbot-flow-diagram',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chatbot-flow-diagram.component.html',
  styleUrls: ['./chatbot-flow-diagram.component.scss'],
})
export class ChatbotFlowDiagramComponent implements OnInit {
  expandedNode: string | null = null;

  // Node information to display when expanded
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
