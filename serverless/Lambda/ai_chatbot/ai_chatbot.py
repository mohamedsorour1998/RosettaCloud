import json
import os
import boto3
import lancedb
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_community.chat_message_histories import DynamoDBChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

# Update imports to use the newer recommended packages
from langchain_aws import ChatBedrock as BedrockChat
from langchain_aws import BedrockEmbeddings

from langchain_community.vectorstores import LanceDB
from langchain_community.retrievers import TFIDFRetriever

# Configuration from environment variables with defaults
LANCEDB_S3_URI = os.environ.get('LANCEDB_S3_URI', "s3://rosettacloud-shared-interactive-labs-vector")
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', "shell-scripts-knowledge-base")
DYNAMO_TABLE = os.environ.get('DYNAMO_TABLE', 'SessionTable')
BEDROCK_REGION = 'us-east-1'  # Hardcode Bedrock region to us-east-1 where it's available
DEFAULT_REGION = os.environ.get('AWS_REGION', 'me-central-1')  # Default to me-central-1
API_ENDPOINT = None  # Will be dynamically determined from the event

# Define RAG chain creation functions
def create_stuff_documents_chain(llm, prompt):
    """Create a chain that stuffs documents into a prompt."""
    def format_docs(docs):
        return "\n\n".join([d.page_content for d in docs])
    
    return (
        RunnablePassthrough.assign(context=lambda x: format_docs(x["context"]))
        | prompt
        | llm
        | StrOutputParser()
    )

def create_retrieval_chain(retriever, combine_docs_chain):
    """Create a chain that retrieves documents and then combines them."""
    return (
        RunnablePassthrough.assign(
            context=lambda x: retriever.get_relevant_documents(x["input"])
        )
        | combine_docs_chain
    )

def create_history_aware_retriever(llm, retriever, prompt):
    """Create a retriever that's aware of chat history."""
    def get_context_aware_query(inputs):
        chat_history = inputs.get("chat_history", [])
        question = inputs["input"]
        if not chat_history:
            return question
        
        # Use the LLM to generate a standalone question
        context_prompt = prompt.format_messages(chat_history=chat_history, input=question)
        response = llm.invoke(context_prompt)
        standalone_question = response.content if hasattr(response, "content") else str(response)
        
        return standalone_question
    
    class HistoryAwareRetriever:
        def __init__(self, base_retriever):
            self.base_retriever = base_retriever
            
        def get_relevant_documents(self, query):
            if isinstance(query, dict) and "input" in query and "chat_history" in query:
                # Process through context-aware logic
                standalone_query = get_context_aware_query(query)
                return self.base_retriever.get_relevant_documents(standalone_query)
            else:
                # Direct query
                return self.base_retriever.get_relevant_documents(query)
    
    return HistoryAwareRetriever(retriever)

class BedrockStreamer:
    def __init__(self, connectionId, session_id, api_endpoint):
        """Initialize connections and parameters for Bedrock streaming."""
        self.region = DEFAULT_REGION  # Use me-central-1 as default region
        self.api_endpoint = api_endpoint
        self.api_client = boto3.client(
            "apigatewaymanagementapi", 
            endpoint_url=self.api_endpoint, 
            region_name=self.region
        )
        # Use specific region for Bedrock only
        self.bedrock_client = boto3.client(
            service_name='bedrock-runtime', 
            region_name=BEDROCK_REGION
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
                MessagesPlaceholder(variable_name="chat_history"),
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
                MessagesPlaceholder(variable_name="chat_history"),
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
            return TFIDFRetriever.from_texts(["No documents found in vector database"], k=1)
        
        # Open the table
        table = db.open_table(knowledge_base_id)
        
        # Get embedding dimensions from schema if available
        dimensions = 1536  # Default for titan-embed-text-v2
        try:
            # Try to get dimensions from vector field using different approaches
            if hasattr(table.schema, 'field') and callable(getattr(table.schema, 'field', None)):
                vector_field = table.schema.field("vector")
                if hasattr(vector_field.type, 'list_size'):
                    dimensions = vector_field.type.list_size
            elif hasattr(table.schema, 'fields'):
                # Alternative approach if fields attribute exists
                for field in table.schema.fields:
                    if field.name == "vector" and hasattr(field.type, 'list_size'):
                        dimensions = field.type.list_size
                        break
        except Exception as e:
            print(f"Could not determine vector dimensions from schema: {str(e)}")
            print("Using default dimensions: 1536")
        
        # Initialize embeddings with same model as indexer
        bedrock_embeddings = BedrockEmbeddings(
            model_id="amazon.titan-embed-text-v2:0",
            client=self.bedrock_client,
            model_kwargs={
                "dimensions": dimensions, 
                "embeddingTypes": ["float"]  # Match indexer format
            }
        )
        
        # Initialize vector store
        vector_store = LanceDB(
            uri=db.uri,
            region=self.region,  # Use me-central-1 for LanceDB
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
            # Safe approach to check if file_type exists in the schema
            has_file_type = False
            try:
                # Check if field_names exists and has file_type
                if hasattr(table.schema, 'field_names') and callable(getattr(table.schema, 'field_names', None)):
                    field_names = table.schema.field_names()
                    has_file_type = 'file_type' in field_names
                # Alternative method to check
                elif hasattr(table.schema, 'fields') and isinstance(table.schema.fields, list):
                    has_file_type = any(f.name == 'file_type' for f in table.schema.fields)
                # Another way to check for field names
                elif hasattr(table.schema, 'names') and callable(getattr(table.schema, 'names', None)):
                    has_file_type = 'file_type' in table.schema.names()
            except Exception as e:
                print(f"Error checking for file_type field: {str(e)}")
            
            # Create retriever with or without filtering
            retriever = vector_store.as_retriever(
                search_kwargs={
                    "filter": {
                        'sql_filter': "file_type='shell_script'",
                        'prefilter': True
                    } if has_file_type else None,
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

        # Prepare model kwargs based on the model being used
        prepared_model_kwargs = model_kwargs.copy()
        
        # Initialize Bedrock LLM with streaming enabled
        if "claude" in bedrock_model_id.lower() or "anthropic" in bedrock_model_id.lower():
            # For Claude models, ensure proper parameters are set
            if "max_tokens_to_sample" not in prepared_model_kwargs:
                prepared_model_kwargs["max_tokens_to_sample"] = 4096
        elif "titan" in bedrock_model_id.lower():
            # For Titan models, convert to the expected format
            if "maxTokenCount" not in prepared_model_kwargs and "max_token_count" not in prepared_model_kwargs:
                prepared_model_kwargs["maxTokenCount"] = 2048
        
        llm = BedrockChat(
            model_id=bedrock_model_id,
            model_kwargs=prepared_model_kwargs,
            streaming=True,  # Enable streaming
            client=self.bedrock_client  # Use the same client for consistent region
        )

        # Create history-aware retriever, QA chain, and retrieval chain
        history_aware_retriever = create_history_aware_retriever(llm, retriever, contextualize_q_prompt)
        question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)
        rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)

        # Add message history to make it conversational
        conversational_rag_chain = RunnableWithMessageHistory(
            rag_chain,
            lambda session_id: DynamoDBChatMessageHistory(
                table_name=DYNAMO_TABLE,
                session_id=self.session_id,
                boto3_session=boto3.Session(region_name=self.region)
            ),
            input_messages_key="input",
            history_messages_key="chat_history",
            output_key="output",  # Changed from output_messages_key="answer" to output_key="output"
        )
        return conversational_rag_chain
    
    def stream_response(self, chain, prompt):
        """Stream responses from the RAG chain back to the WebSocket connection."""
        # Reset document sources
        self.doc_sources = []
        
        # Send a message that we're starting processing
        self._send_status_message("Analyzing your shell script question...")
        
        try:
            # First try to create the DynamoDB table if it doesn't exist
            try:
                dynamo_client = boto3.client('dynamodb', region_name=self.region)
                dynamo_client.describe_table(TableName=DYNAMO_TABLE)
                print(f"DynamoDB table {DYNAMO_TABLE} exists")
            except dynamo_client.exceptions.ResourceNotFoundException:
                print(f"DynamoDB table {DYNAMO_TABLE} does not exist, creating it")
                # Create the table
                dynamo_client.create_table(
                    TableName=DYNAMO_TABLE,
                    KeySchema=[
                        {'AttributeName': 'SessionId', 'KeyType': 'HASH'}
                    ],
                    AttributeDefinitions=[
                        {'AttributeName': 'SessionId', 'AttributeType': 'S'}
                    ],
                    BillingMode='PAY_PER_REQUEST'
                )
                # Wait for table to be created
                waiter = dynamo_client.get_waiter('table_exists')
                waiter.wait(TableName=DYNAMO_TABLE)
                print(f"DynamoDB table {DYNAMO_TABLE} created successfully")
            
            # Use invoke instead of stream to simplify troubleshooting
            print(f"Invoking chain with prompt: {prompt}")
            response = chain.invoke(
                {"input": prompt},
                config={"configurable": {"session_id": self.session_id}},
            )
            
            # Log the full response for debugging
            print(f"Response structure: {response}")
            
            # Extract the answer from the response based on different possible structures
            output_content = ""
            if isinstance(response, dict):
                # Try different possible keys
                if "output" in response:
                    output_content = response["output"]
                elif "answer" in response:
                    output_content = response["answer"]
                elif "result" in response:
                    output_content = response["result"]
                else:
                    # If we can't find a specific key, use the whole response
                    output_content = str(response)
            else:
                # If response is not a dict, convert to string
                output_content = str(response)
            
            # Send the response content
            yield json.dumps({
                "type": "chunk",
                "content": output_content
            })
            
            # Send document sources if available in the response
            if "context" in response and isinstance(response["context"], list):
                for doc in response["context"]:
                    if hasattr(doc, "metadata"):
                        source_info = {
                            "filename": doc.metadata.get("file_name", "Unknown"),
                            "path": doc.metadata.get("full_path", "Unknown"),
                            "bucket": doc.metadata.get("volume_junction_path", "Unknown")
                        }
                        
                        # Add MCQ info if available
                        if "question_type" in doc.metadata and "mcq" in doc.metadata.get("question_type", "").lower():
                            source_info["question_type"] = "MCQ"
                            source_info["question"] = doc.metadata.get("question", "")
                            source_info["answers"] = doc.metadata.get("answers_text", "")
                            source_info["correct_answer"] = doc.metadata.get("correct_answer", "")
                        
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
            import traceback
            print(traceback.format_exc())
            yield json.dumps({
                "type": "error",
                "content": f"Error during processing: {str(e)}"
            })

def get_api_endpoint_from_event(event):
    """
    Dynamically determine the API endpoint from the event data.
    Works with both custom domains and default API Gateway endpoints.
    """
    # First check if it's explicitly set in environment variables
    api_endpoint = os.environ.get('API_ENDPOINT')
    if api_endpoint:
        # Remove any trailing slashes
        api_endpoint = api_endpoint.rstrip('/')
        # If the endpoint starts with wss://, convert to https://
        if api_endpoint.startswith('wss://'):
            api_endpoint = 'https://' + api_endpoint[6:]
        return api_endpoint
        
    # If not set, extract from the event
    try:
        # Get domain and stage from event requestContext
        domain_name = event.get('requestContext', {}).get('domainName')
        stage = event.get('requestContext', {}).get('stage')
        
        if domain_name and stage:
            # Check if this is a custom domain (no 'execute-api' in the domain)
            if 'execute-api' not in domain_name:
                # Custom domain - just use the domain with https://
                return f"https://{domain_name}/{stage}"
            else:
                # API Gateway default domain
                return f"https://{domain_name}/{stage}"
        else:
            raise ValueError("Could not extract domain and stage from event")
    except Exception as e:
        print(f"Error determining API endpoint: {str(e)}")
        raise ValueError("Failed to determine API Gateway endpoint. Please set API_ENDPOINT environment variable.")

def handle_connect(event, context):
    """Handle a new WebSocket connection."""
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    print(f"New connection established: {connection_id}")
    
    # Log the domain used for connection
    domain = event.get('requestContext', {}).get('domainName', 'unknown')
    stage = event.get('requestContext', {}).get('stage', 'unknown')
    print(f"Connection domain: {domain}, stage: {stage}")
    
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
    
    # Get API endpoint for this request
    try:
        api_endpoint = get_api_endpoint_from_event(event)
        print(f"Using API endpoint: {api_endpoint}")
    except ValueError as e:
        return {
            'statusCode': 500,
            'body': json.dumps(str(e))
        }
    
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
    
    try:
        # Initialize Bedrock streamer with API endpoint
        streamer = BedrockStreamer(connection_id, session_id, api_endpoint)
        
        # Create conversational RAG chain
        conversation = streamer.create_rag_chain(
            LANCEDB_S3_URI, knowledge_base_id, bedrock_model_id, model_kwargs, file_filter
        )
        
        # Stream responses back to the WebSocket
        for response in streamer.stream_response(conversation, prompt):
            try:
                streamer.params["Data"] = response
                streamer.api_client.post_to_connection(**streamer.params)
            except Exception as e:
                print(f"Error posting to connection: {str(e)}")
                # Continue trying to send other messages even if one fails
                continue
        
        return {
            "statusCode": 200,
            "body": json.dumps("Success")
        }
    
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        print(traceback.format_exc())
        
        # Try to send error message to client if connection still active
        try:
            api_client = boto3.client(
                "apigatewaymanagementapi",
                endpoint_url=api_endpoint,
                region_name=DEFAULT_REGION  # Use me-central-1 for API Gateway
            )
            api_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps({"type": "error", "content": f"Error processing request: {str(e)}"})
            )
        except Exception:
            pass
            
        return {
            "statusCode": 500,
            "body": json.dumps(f"Error processing request: {str(e)}")
        }

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