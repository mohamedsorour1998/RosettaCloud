import json
import os
import boto3
import lancedb
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.chains import create_stuff_documents_chain, create_retrieval_chain, create_history_aware_retriever
from langchain.memory.chat_message_histories import DynamoDBChatMessageHistory
from langchain.chains.history_aware_retriever import RunnableWithMessageHistory
from langchain_aws import BedrockChat, BedrockEmbeddings
from langchain_community.vectorstores import LanceDB

# Configuration from environment variables with defaults
LANCEDB_S3_URI = os.environ.get('LANCEDB_S3_URI', "s3://bedrock-lancedb-shellscripts/vectordb")
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', "shell-scripts-knowledge-base")
API_ENDPOINT = os.environ.get('API_ENDPOINT')
DYNAMO_TABLE = os.environ.get('DYNAMO_TABLE', 'SessionTable')
BEDROCK_REGION = os.environ.get('AWS_REGION', 'us-east-1')

class BedrockStreamer:
    def __init__(self, connectionId, session_id):
        """Initialize connections and parameters for Bedrock streaming."""
        self.region = os.environ.get('AWS_REGION', 'us-east-1')
        self.api_client = boto3.client(
            "apigatewaymanagementapi", 
            endpoint_url=API_ENDPOINT, 
            region_name=self.region
        )
        self.bedrock_client = boto3.client(
            service_name='bedrock-runtime', 
            region_name=self.region
        )
        self.session_id = session_id
        self.doc_sources = []
        self.params = {
            "Data": "",
            "ConnectionId": connectionId
        }
    
    def set_prompt(self):
        """Set up the prompt templates for question contextualization and answering."""
        # Prompt for reformulating questions based on chat history
        contextualize_q_system_prompt = (
            "Given a chat history and the latest user question "
            "which might reference context in the chat history, "
            "formulate a standalone question which can be understood "
            "without the chat history. Do NOT answer the question, "
            "just reformulate it if needed and otherwise return it as is."
        )
        contextualize_q_prompt = ChatPromptTemplate.from_messages(
            [
                ("system", contextualize_q_system_prompt),
                MessagesPlaceholder("chat_history"),
                ("human", "{input}"),
            ]
        )

        # Prompt for answering questions about shell scripts
        system_prompt = (
            "You are an assistant specializing in shell scripts. "
            "Use the following pieces of retrieved context to answer "
            "the question about shell scripts. If you don't know the answer, "
            "say that you don't know. Be clear and concise, but provide "
            "detailed technical information when necessary. When showing code examples, "
            "format them properly with markdown syntax."
            "\n\n"
            "{context}"
        )
        qa_prompt = ChatPromptTemplate.from_messages(
            [
                ("system", system_prompt),
                MessagesPlaceholder("chat_history"),
                ("human", "{input}"),
            ]
        )
        return qa_prompt, contextualize_q_prompt
    
    def init_retriever(self, lancedb_uri, knowledge_base_id, file_filter=None):
        """Initialize LanceDB as a vector store for retrieval."""
        # Connect to LanceDB
        db = lancedb.connect(lancedb_uri)
        
        # Send status update to client
        self._send_status_message(f"Connecting to vector database: {knowledge_base_id}")
        
        # Check if the knowledge base exists
        if knowledge_base_id not in db.table_names():
            self._send_status_message(f"Vector database {knowledge_base_id} not found. Try uploading some shell scripts first.")
            # Return a simple retriever that will always return empty results
            from langchain.retrievers import TFIDFRetriever
            return TFIDFRetriever.from_texts(["No documents found in vector database"], k=1)
        
        # Open the table
        table = db.open_table(knowledge_base_id)
        dimensions = table.schema.field("vector").type.list_size
        
        # Initialize embeddings
        bedrock_embeddings = BedrockEmbeddings(
            model_id="amazon.titan-embed-text-v2:0",
            client=self.bedrock_client,
            model_kwargs={"dimensions": dimensions}
        )
        
        # Initialize vector store
        vector_store = LanceDB(
            uri=db.uri,
            region=self.region,
            embedding=bedrock_embeddings,
            text_key='document',
            table_name=knowledge_base_id   
        )
        
        # Apply filtering if file_filter is provided
        if file_filter and file_filter.strip():
            self._send_status_message(f"Filtering results to file: {file_filter}")
            sql_filter = f"file_name='{file_filter}'"
            retriever = vector_store.as_retriever(
                search_kwargs={
                    "filter": {
                        'sql_filter': sql_filter,
                        'prefilter': True
                    },
                    "k": 5  # Return top 5 results
                }
            )
        else:
            # For shell scripts, add a file type filter if available
            retriever = vector_store.as_retriever(
                search_kwargs={
                    "filter": {
                        'sql_filter': "file_type='shell_script'",
                        'prefilter': True
                    } if table.schema.field_names.count('file_type') > 0 else None,
                    "k": 5  # Return top 5 results
                }
            )
        
        self._send_status_message("Shell script retriever initialized")
        return retriever
    
    def _send_status_message(self, message):
        """Send a status message to the client."""
        try:
            self.api_client.post_to_connection(
                ConnectionId=self.params["ConnectionId"],
                Data=json.dumps({"type": "status", "content": message})
            )
        except Exception as e:
            print(f"Error sending status message: {str(e)}")
    
    def create_rag_chain(self, lancedb_uri, knowledge_base_id, bedrock_model_id, 
                    model_kwargs, file_filter=None):
        """Set up conversational RAG chain with Bedrock and LanceDB."""
        # Get prompt templates
        qa_prompt, contextualize_q_prompt = self.set_prompt()

        # Initialize vector store retriever
        retriever = self.init_retriever(lancedb_uri, knowledge_base_id, file_filter)

        # Initialize Bedrock LLM with streaming enabled
        llm = BedrockChat(
            model_id=bedrock_model_id,
            model_kwargs=model_kwargs,
            streaming=True  # Enable streaming
        )

        # Create history-aware retriever to handle conversational context
        history_aware_retriever = create_history_aware_retriever(
            llm, retriever, contextualize_q_prompt
        )

        # Create chain for answering questions using retrieved documents
        question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)
        
        # Create retrieval chain combining the retriever and QA chain
        rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)

        # Add message history to make it conversational
        conversational_rag_chain = RunnableWithMessageHistory(
            rag_chain,
            lambda session_id: DynamoDBChatMessageHistory(
                table_name=DYNAMO_TABLE,
                session_id=self.session_id,
                boto3_session=boto3.Session(region_name=self.region)),
            input_messages_key="input",
            history_messages_key="chat_history",
            output_messages_key="answer",
        )
        return conversational_rag_chain
    
    def stream_response(self, chain, prompt):
        """Stream responses from the RAG chain back to the WebSocket connection."""
        # Reset document sources
        self.doc_sources = []
        
        # Send a message that we're starting processing
        self._send_status_message("Analyzing your shell script question...")
        
        # Stream the response
        try:
            response = chain.stream(
                {"input": prompt},
                config={"configurable": {"session_id": self.session_id}},
            )
            
            # Process each chunk in the stream
            for chunk in response:
                for key in chunk:
                    if key == 'answer':
                        # Send answer chunks as JSON
                        yield json.dumps({
                            "type": "chunk",
                            "content": chunk[key]
                        })
                    if key == 'context':
                        # Extract document source information
                        for doc in chunk[key]:
                            source_info = {
                                "filename": doc.metadata.get("file_name", "Unknown"),
                                "path": doc.metadata.get("full_path", "Unknown"),
                                "bucket": doc.metadata.get("volume_junction_path", "Unknown")
                            }
                            
                            # Add to sources if not already present
                            if source_info not in self.doc_sources:
                                self.doc_sources.append(source_info)
                                
                                # Send source information
                                yield json.dumps({
                                    "type": "source",
                                    "content": source_info
                                })
            
            # Send all collected document sources at the end
            if self.doc_sources:
                yield json.dumps({
                    "type": "sources",
                    "content": self.doc_sources
                })
                
            # Send completion message
            yield json.dumps({
                "type": "complete",
                "content": "Response complete"
            })
            
        except Exception as e:
            print(f"Error in streaming: {str(e)}")
            yield json.dumps({
                "type": "error",
                "content": f"Error during processing: {str(e)}"
            })

def lambda_handler(event, context):
    """
    Universal WebSocket handler for connection, streaming, and disconnection events.
    Uses the route key to determine the handling logic.
    """
    # Extract the route key to determine the action
    route_key = event.get('requestContext', {}).get('routeKey', '')
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    
    print(f"Handling route: {route_key} for connection: {connection_id}")
    
    # Handle connection event
    if route_key == '$connect':
        return handle_connect(event, context)
    
    # Handle disconnection event
    elif route_key == '$disconnect':
        return handle_disconnect(event, context)
    
    # Handle default (message) event
    elif route_key == '$default':
        return handle_message(event, context)
    
    # Unknown route
    else:
        return {
            'statusCode': 400,
            'body': json.dumps(f'Unknown route: {route_key}')
        }

def handle_connect(event, context):
    """Handle a new WebSocket connection."""
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    print(f"New connection established: {connection_id}")
    
    return {
        'statusCode': 200,
        'body': json.dumps('Connected to Shell Script AI Assistant')
    }

def handle_disconnect(event, context):
    """Handle a WebSocket disconnection."""
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    print(f"Connection closed: {connection_id}")
    
    return {
        'statusCode': 200,
        'body': json.dumps('Disconnected')
    }

def handle_message(event, context):
    """Handle a message from the client and stream Bedrock responses."""
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    
    # Parse the body from the WebSocket event
    body_str = event.get("body", "{}")
    try:
        body = json.loads(body_str)
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'body': json.dumps("Invalid JSON in request body.")
        }
    
    # Validate required fields
    required_fields = [
        "session_id", "prompt", "bedrock_model_id", "model_kwargs"
    ]
    
    for field in required_fields:
        if field not in body:
            return {
                'statusCode': 400,
                'body': json.dumps(f"Invalid input. Missing required field: {field}")
            }
    
    # Extract fields from the request
    prompt = body["prompt"]
    bedrock_model_id = body["bedrock_model_id"]
    model_kwargs = body["model_kwargs"]
    file_filter = body.get("file_filter", "")
    session_id = body["session_id"]
    
    # Knowledge base ID can be overridden in the request
    knowledge_base_id = body.get("knowledge_base_id", KNOWLEDGE_BASE_ID)
    
    # Validate model parameters
    if "temperature" in model_kwargs and not (0 <= model_kwargs["temperature"] <= 1):
        return {
            'statusCode': 400,
            'body': json.dumps("Invalid input. temperature value must be between 0 and 1.")
        }
    
    if "top_p" in model_kwargs and not (0 <= model_kwargs["top_p"] <= 1):
        return {
            'statusCode': 400,
            'body': json.dumps("Invalid input. top_p value must be between 0 and 1.")
        }
    
    if "top_k" in model_kwargs and not (0 <= model_kwargs["top_k"] <= 500):
        return {
            'statusCode': 400,
            'body': json.dumps("Invalid input. top_k value must be between 0 and 500.")
        }
    
    # Verify API endpoint is set
    if not API_ENDPOINT:
        return {
            'statusCode': 400,
            'body': json.dumps("Invalid configuration. API_ENDPOINT environment variable is not set.")
        }
    
    try:
        # Initialize Bedrock streamer
        streamer = BedrockStreamer(connection_id, session_id)
        
        # Create conversational RAG chain
        conversation = streamer.create_rag_chain(
            LANCEDB_S3_URI, knowledge_base_id, bedrock_model_id, model_kwargs, file_filter
        )
        
        # Stream responses back to the WebSocket
        for response in streamer.stream_response(conversation, prompt):
            streamer.params["Data"] = response
            streamer.api_client.post_to_connection(**streamer.params)
        
        return {
            "statusCode": 200,
            "body": json.dumps("Success")
        }
    
    except Exception as e:
        print(f"Error: {str(e)}")
        # Try to send error message to client if connection still active
        try:
            api_client = boto3.client(
                "apigatewaymanagementapi",
                endpoint_url=API_ENDPOINT,
                region_name=os.environ.get('AWS_REGION', 'us-east-1')
            )
            api_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps({"type": "error", "content": str(e)})
            )
        except Exception:
            pass
            
        return {
            "statusCode": 500,
            "body": json.dumps(f"Error processing request: {str(e)}")
        }