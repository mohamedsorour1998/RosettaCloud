import json
import os
import boto3
import lancedb
import threading
import time
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_community.chat_message_histories import DynamoDBChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_aws import ChatBedrock as BedrockChat
from langchain_aws import BedrockEmbeddings
from langchain_community.vectorstores import LanceDB
from langchain_community.retrievers import TFIDFRetriever

# Configuration
LANCEDB_S3_URI = os.environ.get('LANCEDB_S3_URI', "s3://rosettacloud-shared-interactive-labs-vector")
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', "shell-scripts-knowledge-base")
DYNAMO_TABLE = os.environ.get('DYNAMO_TABLE', 'SessionTable')
BEDROCK_REGION = 'us-east-1'
DEFAULT_REGION = os.environ.get('AWS_REGION', 'me-central-1')
LAMBDA_TIMEOUT = int(os.environ.get('LAMBDA_TIMEOUT', '900'))  # 15 minutes max

def create_stuff_documents_chain(llm, prompt):
    def format_docs(docs):
        return "\n\n".join([d.page_content for d in docs])
    
    return (
        RunnablePassthrough.assign(context=lambda x: format_docs(x["context"]))
        | prompt
        | llm
        | StrOutputParser()
    )

def create_retrieval_chain(retriever, combine_docs_chain):
    return (
        RunnablePassthrough.assign(
            context=lambda x: retriever.get_relevant_documents(x["input"])
        )
        | combine_docs_chain
    )

def create_history_aware_retriever(llm, retriever, prompt):
    def get_context_aware_query(inputs):
        chat_history = inputs.get("chat_history", [])
        question = inputs["input"]
        if not chat_history:
            return question
        
        context_prompt = prompt.format_messages(chat_history=chat_history, input=question)
        response = llm.invoke(context_prompt)
        standalone_question = response.content if hasattr(response, "content") else str(response)
        return standalone_question
    
    class HistoryAwareRetriever:
        def __init__(self, base_retriever):
            self.base_retriever = base_retriever
            
        def get_relevant_documents(self, query):
            if isinstance(query, dict) and "input" in query and "chat_history" in query:
                standalone_query = get_context_aware_query(query)
                return self.base_retriever.get_relevant_documents(standalone_query)
            else:
                return self.base_retriever.get_relevant_documents(query)
    
    return HistoryAwareRetriever(retriever)

class BedrockStreamer:
    def __init__(self, connectionId, session_id, api_endpoint):
        self.region = DEFAULT_REGION
        self.api_endpoint = api_endpoint
        self.api_client = boto3.client(
            "apigatewaymanagementapi", 
            endpoint_url=self.api_endpoint, 
            region_name=self.region
        )
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
        self.heartbeat_active = False
    
    def start_heartbeat(self):
        self.heartbeat_active = True
        
        def send_heartbeat():
            while self.heartbeat_active:
                try:
                    self.api_client.post_to_connection(
                        ConnectionId=self.params["ConnectionId"],
                        Data=json.dumps({"type": "heartbeat"})
                    )
                except Exception:
                    break
                time.sleep(10)  # Send heartbeat every 10 seconds
        
        heartbeat_thread = threading.Thread(target=send_heartbeat)
        heartbeat_thread.daemon = True
        heartbeat_thread.start()
    
    def stop_heartbeat(self):
        self.heartbeat_active = False
    
    def set_prompt(self):
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
        db = lancedb.connect(lancedb_uri)
        
        self._send_status_message(f"Connecting to vector database: {knowledge_base_id}")
        
        if knowledge_base_id not in db.table_names():
            self._send_status_message(f"Vector database {knowledge_base_id} not found. Try uploading some shell scripts first.")
            return TFIDFRetriever.from_texts(["No documents found in vector database"], k=1)
        
        table = db.open_table(knowledge_base_id)
        
        dimensions = 1536
        try:
            if hasattr(table.schema, 'field') and callable(getattr(table.schema, 'field', None)):
                vector_field = table.schema.field("vector")
                if hasattr(vector_field.type, 'list_size'):
                    dimensions = vector_field.type.list_size
            elif hasattr(table.schema, 'fields'):
                for field in table.schema.fields:
                    if field.name == "vector" and hasattr(field.type, 'list_size'):
                        dimensions = field.type.list_size
                        break
        except Exception as e:
            print(f"Could not determine vector dimensions from schema: {str(e)}")
            
        bedrock_embeddings = BedrockEmbeddings(
            model_id="amazon.titan-embed-text-v2:0",
            client=self.bedrock_client,
            model_kwargs={"dimensions": dimensions, "embeddingTypes": ["float"]}
        )
        
        vector_store = LanceDB(
            uri=db.uri,
            region=self.region,
            embedding=bedrock_embeddings,
            text_key='document',
            table_name=knowledge_base_id   
        )
        
        if file_filter and file_filter.strip():
            self._send_status_message(f"Filtering results to file: {file_filter}")
            retriever = vector_store.as_retriever(
                search_kwargs={
                    "filter": {
                        'sql_filter': f"file_name='{file_filter}'",
                        'prefilter': True
                    },
                    "k": 5
                }
            )
        else:
            has_file_type = False
            try:
                if hasattr(table.schema, 'field_names') and callable(getattr(table.schema, 'field_names', None)):
                    field_names = table.schema.field_names()
                    has_file_type = 'file_type' in field_names
                elif hasattr(table.schema, 'fields') and isinstance(table.schema.fields, list):
                    has_file_type = any(f.name == 'file_type' for f in table.schema.fields)
                elif hasattr(table.schema, 'names') and callable(getattr(table.schema, 'names', None)):
                    has_file_type = 'file_type' in table.schema.names()
            except Exception as e:
                print(f"Error checking for file_type field: {str(e)}")
            
            retriever = vector_store.as_retriever(
                search_kwargs={
                    "filter": {
                        'sql_filter': "file_type='shell_script'",
                        'prefilter': True
                    } if has_file_type else None,
                    "k": 5
                }
            )
        
        self._send_status_message("Shell script retriever initialized")
        return retriever
    
    def _send_status_message(self, message):
        try:
            self.api_client.post_to_connection(
                ConnectionId=self.params["ConnectionId"],
                Data=json.dumps({"type": "status", "content": message})
            )
        except Exception as e:
            print(f"Error sending status message: {str(e)}")
    
    def create_rag_chain(self, lancedb_uri, knowledge_base_id, bedrock_model_id, 
                    model_kwargs, file_filter=None):
        qa_prompt, contextualize_q_prompt = self.set_prompt()
        retriever = self.init_retriever(lancedb_uri, knowledge_base_id, file_filter)
        
        prepared_model_kwargs = model_kwargs.copy()
        
        if "claude" in bedrock_model_id.lower() or "anthropic" in bedrock_model_id.lower():
            if "max_tokens_to_sample" not in prepared_model_kwargs:
                prepared_model_kwargs["max_tokens_to_sample"] = 4096
        elif "titan" in bedrock_model_id.lower():
            if "maxTokenCount" not in prepared_model_kwargs and "max_token_count" not in prepared_model_kwargs:
                prepared_model_kwargs["maxTokenCount"] = 2048
        
        llm = BedrockChat(
            model_id=bedrock_model_id,
            model_kwargs=prepared_model_kwargs,
            streaming=True,
            client=self.bedrock_client
        )

        history_aware_retriever = create_history_aware_retriever(llm, retriever, contextualize_q_prompt)
        question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)
        rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)

        ensure_dynamodb_table_exists(self.region, DYNAMO_TABLE)
        
        conversational_rag_chain = RunnableWithMessageHistory(
            rag_chain,
            lambda session_id: DynamoDBChatMessageHistory(
                table_name=DYNAMO_TABLE,
                session_id=self.session_id,
                boto3_session=boto3.Session(region_name=self.region)
            ),
            input_messages_key="input",
            history_messages_key="chat_history",
            output_key="output",
        )
        return conversational_rag_chain
    
    def stream_response(self, chain, prompt):
        self.doc_sources = []
        self._send_status_message("Analyzing your shell script question...")
        
        # Start heartbeat to keep WebSocket alive
        self.start_heartbeat()
        
        try:
            print(f"Invoking chain with prompt: {prompt}")
            response = chain.invoke(
                {"input": prompt},
                config={"configurable": {"session_id": self.session_id}},
            )
            
            print(f"Response structure: {response}")
            
            # Extract content
            output_content = ""
            if isinstance(response, dict):
                if "output" in response:
                    output_content = response["output"]
                elif "answer" in response:
                    output_content = response["answer"]
                elif "result" in response:
                    output_content = response["result"]
                else:
                    output_content = str(response)
            else:
                output_content = str(response)
            
            # Send the response
            yield json.dumps({
                "type": "chunk",
                "content": output_content
            })
            
            # Process document sources
            if "context" in response and isinstance(response["context"], list):
                for doc in response["context"]:
                    if hasattr(doc, "metadata"):
                        source_info = {
                            "filename": doc.metadata.get("file_name", "Unknown"),
                            "path": doc.metadata.get("full_path", "Unknown"),
                            "bucket": doc.metadata.get("volume_junction_path", "Unknown")
                        }
                        
                        if "question_type" in doc.metadata and "mcq" in doc.metadata.get("question_type", "").lower():
                            source_info["question_type"] = "MCQ"
                            source_info["question"] = doc.metadata.get("question", "")
                            source_info["answers"] = doc.metadata.get("answers_text", "")
                            source_info["correct_answer"] = doc.metadata.get("correct_answer", "")
                        
                        if source_info not in self.doc_sources:
                            self.doc_sources.append(source_info)
                            yield json.dumps({
                                "type": "source",
                                "content": source_info
                            })
            
            if self.doc_sources:
                yield json.dumps({
                    "type": "sources",
                    "content": self.doc_sources
                })
            
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
        finally:
            # Stop heartbeat
            self.stop_heartbeat()

def ensure_dynamodb_table_exists(region, table_name):
    try:
        dynamo_client = boto3.client('dynamodb', region_name=region)
        dynamo_client.describe_table(TableName=table_name)
        print(f"DynamoDB table {table_name} exists")
    except dynamo_client.exceptions.ResourceNotFoundException:
        print(f"DynamoDB table {table_name} does not exist, creating it")
        dynamo_client.create_table(
            TableName=table_name,
            KeySchema=[
                {'AttributeName': 'SessionId', 'KeyType': 'HASH'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'SessionId', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        waiter = dynamo_client.get_waiter('table_exists')
        waiter.wait(TableName=table_name)
        print(f"DynamoDB table {table_name} created successfully")

def get_api_endpoint_from_event(event):
    api_endpoint = os.environ.get('API_ENDPOINT')
    if api_endpoint:
        api_endpoint = api_endpoint.rstrip('/')
        if api_endpoint.startswith('wss://'):
            api_endpoint = 'https://' + api_endpoint[6:]
        return api_endpoint
        
    try:
        domain_name = event.get('requestContext', {}).get('domainName')
        stage = event.get('requestContext', {}).get('stage')
        
        if domain_name and stage:
            return f"https://{domain_name}/{stage}"
        else:
            raise ValueError("Could not extract domain and stage from event")
    except Exception as e:
        print(f"Error determining API endpoint: {str(e)}")
        raise ValueError("Failed to determine API Gateway endpoint")

def handle_connect(event, context):
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    print(f"New connection established: {connection_id}")
    return {
        'statusCode': 200,
        'body': json.dumps('Connected to Shell Script AI Assistant')
    }

def handle_disconnect(event, context):
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    print(f"Connection closed: {connection_id}")
    return {
        'statusCode': 200,
        'body': json.dumps('Disconnected')
    }

def handle_message(event, context):
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    
    try:
        api_endpoint = get_api_endpoint_from_event(event)
        print(f"Using API endpoint: {api_endpoint}")
    except ValueError as e:
        return {'statusCode': 500, 'body': json.dumps(str(e))}
    
    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return {'statusCode': 400, 'body': json.dumps("Invalid JSON in request body.")}
    
    required_fields = ["session_id", "prompt", "bedrock_model_id", "model_kwargs"]
    
    for field in required_fields:
        if field not in body:
            return {'statusCode': 400, 'body': json.dumps(f"Invalid input. Missing required field: {field}")}
    
    prompt = body["prompt"]
    bedrock_model_id = body["bedrock_model_id"]
    model_kwargs = body["model_kwargs"]
    file_filter = body.get("file_filter", "")
    session_id = body["session_id"]
    knowledge_base_id = body.get("knowledge_base_id", KNOWLEDGE_BASE_ID)
    
    # Validate parameters
    if "temperature" in model_kwargs and not (0 <= model_kwargs["temperature"] <= 1):
        return {'statusCode': 400, 'body': json.dumps("Invalid input. temperature value must be between 0 and 1.")}
    
    if "top_p" in model_kwargs and not (0 <= model_kwargs["top_p"] <= 1):
        return {'statusCode': 400, 'body': json.dumps("Invalid input. top_p value must be between 0 and 1.")}
    
    if "top_k" in model_kwargs and not (0 <= model_kwargs["top_k"] <= 500):
        return {'statusCode': 400, 'body': json.dumps("Invalid input. top_k value must be between 0 and 500.")}
    
    try:
        streamer = BedrockStreamer(connection_id, session_id, api_endpoint)
        conversation = streamer.create_rag_chain(LANCEDB_S3_URI, knowledge_base_id, bedrock_model_id, model_kwargs, file_filter)
        
        for response in streamer.stream_response(conversation, prompt):
            try:
                streamer.params["Data"] = response
                streamer.api_client.post_to_connection(**streamer.params)
            except Exception as e:
                print(f"Error posting to connection: {str(e)}")
                continue
        
        return {"statusCode": 200, "body": json.dumps("Success")}
    
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        print(traceback.format_exc())
        
        try:
            api_client = boto3.client(
                "apigatewaymanagementapi",
                endpoint_url=api_endpoint,
                region_name=DEFAULT_REGION
            )
            api_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps({"type": "error", "content": f"Error processing request: {str(e)}"})
            )
        except Exception:
            pass
            
        return {"statusCode": 500, "body": json.dumps(f"Error processing request: {str(e)}")}

def lambda_handler(event, context):
    route_key = event.get('requestContext', {}).get('routeKey', '')
    connection_id = event.get('requestContext', {}).get('connectionId', '')
    
    print(f"Handling route: {route_key} for connection: {connection_id}")
    
    if route_key == '$connect':
        return handle_connect(event, context)
    elif route_key == '$disconnect':
        return handle_disconnect(event, context)
    elif route_key == '$default':
        return handle_message(event, context)
    else:
        return {'statusCode': 400, 'body': json.dumps(f'Unknown route: {route_key}')}