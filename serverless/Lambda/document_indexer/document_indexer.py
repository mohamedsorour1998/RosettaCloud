import boto3
import os
import json
import tempfile
import re
import lancedb
import time
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema.document import Document

# Configuration
LANCEDB_S3_URI = os.environ.get('LANCEDB_S3_URI', "s3://rosettacloud-shared-interactive-labs-vector")
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', "shell-scripts-knowledge-base")
BEDROCK_REGION = 'us-east-1'
S3_REGION = os.environ.get('S3_REGION', os.environ.get('AWS_REGION', 'me-central-1'))

# Supported extensions
SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.doc', '.docx', '.csv', '.json', '.sh']

# Educational lab data for scripts
LAB_METADATA = {
    'course': 'Software Engineering',
    'lab_type': 'Shell Scripting',
    'educational': True
}

def load_file_from_s3(bucket, key):
    s3_client = boto3.client('s3', region_name=S3_REGION)
    
    try:
        _, file_extension = os.path.splitext(key)
        file_extension = file_extension.lower()
        
        if file_extension not in SUPPORTED_EXTENSIONS:
            print(f"Unsupported file type: {file_extension}")
            return None
        
        if file_extension in ['.txt', '.md', '.sh', '.json', '.csv']:
            with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                s3_client.download_file(bucket, key, temp_file.name)
                
                with open(temp_file.name, 'r', encoding='utf-8', errors='ignore') as file:
                    content = file.read()
                
                os.unlink(temp_file.name)
                
                metadata = {
                    "source": f"s3://{bucket}/{key}",
                    "file_name": os.path.basename(key),
                    "file_type": file_extension[1:]
                }
                
                return [Document(page_content=content, metadata=metadata)]
        else:
            print(f"Skipping non-text file: {key}")
            return None
    
    except Exception as e:
        print(f"Error loading file from S3: {str(e)}")
        return None

def custom_embed_query(text, bedrock_client):
    try:
        request_body = json.dumps({
            "inputText": text,
            "embeddingTypes": ["float"]
        })
        
        response = bedrock_client.invoke_model(
            body=request_body, 
            modelId="amazon.titan-embed-text-v2:0",
            accept="application/json",
            contentType="application/json"
        )
        
        response_body = json.loads(response.get('body').read())
        
        if 'embeddingsByType' in response_body and 'float' in response_body['embeddingsByType']:
            return response_body['embeddingsByType']['float']
        else:
            raise ValueError("Unexpected response format: no embedding found")
            
    except Exception as e:
        print(f"Error in custom_embed_query: {str(e)}")
        import traceback
        print(traceback.format_exc())
        raise

def extract_mcq_data(comments):
    mcq_data = {
        'possible_answers': [],
        'correct_answer': ''
    }
    
    answer_pattern = re.compile(r'^\s*-\s*(answer_\w+|[A-Za-z])\s*:\s*(.+)$')
    correct_answer_pattern = re.compile(r'^\s*Correct\s+answer\s*:\s*(\w+)\s*$', re.IGNORECASE)
    
    for comment in comments:
        answer_match = answer_pattern.match(comment)
        if answer_match:
            answer_id = answer_match.group(1)
            answer_text = answer_match.group(2)
            mcq_data['possible_answers'].append({'id': answer_id, 'text': answer_text})
        
        correct_match = correct_answer_pattern.match(comment)
        if correct_match:
            mcq_data['correct_answer'] = correct_match.group(1)
    
    return mcq_data

def extract_flag_handlers(text):
    flag_handlers = {
        'question_flag': '',
        'check_flag': ''
    }
    
    q_flag_pattern = re.compile(r'#.*-q\s+flag.*\n(if.*?\[\[\s*"\$1"\s*==\s*"-q"\s*\]\].*?\n(.*?\n)*?.*?fi)', re.DOTALL)
    c_flag_pattern = re.compile(r'#.*-c\s+flag.*\n(if.*?\[\[\s*"\$1"\s*==\s*"-c"\s*\]\].*?\n(.*?\n)*?.*?fi)', re.DOTALL)
    
    q_flag_alt_pattern = re.compile(r'if\s*\[\[\s*"\$1"\s*==\s*"-q"\s*\]\].*?\n(.*?\n)*?.*?fi', re.DOTALL)
    c_flag_alt_pattern = re.compile(r'if\s*\[\[\s*"\$1"\s*==\s*"-c"\s*\]\].*?\n(.*?\n)*?.*?fi', re.DOTALL)
    
    q_match = q_flag_pattern.search(text)
    if q_match:
        flag_handlers['question_flag'] = q_match.group(1)
    else:
        q_alt_match = q_flag_alt_pattern.search(text)
        if q_alt_match:
            flag_handlers['question_flag'] = q_alt_match.group(0)
    
    c_match = c_flag_pattern.search(text)
    if c_match:
        flag_handlers['check_flag'] = c_match.group(1)
    else:
        c_alt_match = c_flag_alt_pattern.search(text)
        if c_alt_match:
            flag_handlers['check_flag'] = c_alt_match.group(0)
    
    return flag_handlers

def process_shell_script(text, filename):
    comments = []
    command_blocks = []
    
    lab_info = {
        'exercise_name': '',
        'difficulty': '',
        'learning_objectives': [],
        'question_number': '',
        'question': '',
        'question_type': '',
        'possible_answers': [],
        'correct_answer': '',
        'question_flag': '',
        'check_flag': ''
    }
    
    flag_handlers = extract_flag_handlers(text)
    lab_info['question_flag'] = flag_handlers['question_flag']
    lab_info['check_flag'] = flag_handlers['check_flag']
    
    current_command_block = []
    current_comment_block = []
    in_mcq_section = False
    in_possible_answers = False
    
    for line in text.split('\n'):
        line_stripped = line.strip()
        
        if line_stripped.startswith('#'):
            comment_text = line_stripped[1:].strip()
            comments.append(comment_text)
            current_comment_block.append(comment_text)
            
            if "Possible answers" in comment_text:
                in_possible_answers = True
                in_mcq_section = True
            
            if ':' in comment_text:
                parts = comment_text.split(':', 1)
                if len(parts) == 2:
                    key = parts[0].strip().lower()
                    value = parts[1].strip()
                    
                    if 'exercise' in key:
                        lab_info['exercise_name'] = value
                    elif 'difficulty' in key:
                        lab_info['difficulty'] = value
                    elif 'objective' in key:
                        lab_info['learning_objectives'].append(value)
                    elif 'question number' in key:
                        lab_info['question_number'] = value
                    elif 'question type' in key:
                        lab_info['question_type'] = value
                        if 'mcq' in value.lower():
                            in_mcq_section = True
                    elif key == 'question':
                        lab_info['question'] = value
            
            if in_mcq_section and not comment_text.strip() and in_possible_answers:
                in_mcq_section = False
                in_possible_answers = False
                
                if current_comment_block:
                    mcq_data = extract_mcq_data(current_comment_block)
                    lab_info['possible_answers'] = mcq_data['possible_answers']
                    lab_info['correct_answer'] = mcq_data['correct_answer']
                
                current_comment_block = []
        else:
            if current_comment_block:
                if in_mcq_section and in_possible_answers:
                    mcq_data = extract_mcq_data(current_comment_block)
                    lab_info['possible_answers'] = mcq_data['possible_answers']
                    lab_info['correct_answer'] = mcq_data['correct_answer']
                
                current_comment_block = []
                in_mcq_section = False
                in_possible_answers = False
            
            if line_stripped.startswith('if [[ "$1" =='):
                continue
            
            if line_stripped and not line_stripped.startswith('#'):
                current_command_block.append(line)
            elif current_command_block:
                command_blocks.append('\n'.join(current_command_block))
                current_command_block = []
    
    if in_mcq_section and current_comment_block:
        mcq_data = extract_mcq_data(current_comment_block)
        lab_info['possible_answers'] = mcq_data['possible_answers']
        lab_info['correct_answer'] = mcq_data['correct_answer']
    
    if current_command_block:
        command_blocks.append('\n'.join(current_command_block))
    
    if lab_info['question_type'] and 'mcq' in lab_info['question_type'].lower() and not lab_info['possible_answers']:
        mcq_data = extract_mcq_data(comments)
        lab_info['possible_answers'] = mcq_data['possible_answers']
        lab_info['correct_answer'] = mcq_data['correct_answer']
    
    enhanced_text = f"""
SCRIPT NAME: {filename}

ORIGINAL CONTENT:
{text}

SUMMARY OF COMMENTS:
{chr(10).join(comments)}

MAIN COMMAND BLOCKS:
{chr(10) + chr(10).join([f"Block {i+1}:{chr(10)}{block}" for i, block in enumerate(command_blocks)])}
"""

    lab_metadata_texts = []
    if lab_info['question_number']:
        lab_metadata_texts.append(f"Question Number: {lab_info['question_number']}")
    if lab_info['question']:
        lab_metadata_texts.append(f"Question: {lab_info['question']}")
    if lab_info['question_type']:
        lab_metadata_texts.append(f"Question Type: {lab_info['question_type']}")
    if lab_info['difficulty']:
        lab_metadata_texts.append(f"Difficulty Level: {lab_info['difficulty']}")
    if lab_info['exercise_name']:
        lab_metadata_texts.append(f"Exercise Name: {lab_info['exercise_name']}")
    if lab_info['learning_objectives']:
        objectives_text = '\n'.join([f"- {obj}" for obj in lab_info['learning_objectives']])
        lab_metadata_texts.append(f"Learning Objectives:\n{objectives_text}")
    
    if lab_info['possible_answers']:
        answers_text = '\n'.join([f"- {a['id']}: {a['text']}" for a in lab_info['possible_answers']])
        lab_metadata_texts.append(f"Possible Answers:\n{answers_text}")
    if lab_info['correct_answer']:
        lab_metadata_texts.append(f"Correct Answer: {lab_info['correct_answer']}")
    
    if lab_info['question_flag']:
        lab_metadata_texts.append(f"\nQuestion Flag Handler (-q):\n{lab_info['question_flag']}")
    if lab_info['check_flag']:
        lab_metadata_texts.append(f"\nCheck Flag Handler (-c):\n{lab_info['check_flag']}")
    
    if lab_metadata_texts:
        lab_metadata = "\nLAB QUESTION INFORMATION:\n" + "\n".join(lab_metadata_texts)
        enhanced_text += lab_metadata
    
    return enhanced_text, lab_info

def prepare_document_for_lancedb(doc):
    """Convert document to a format safe for LanceDB"""
    result = {}
    for key, value in doc.items():
        # If key is vector, keep it as is
        if key == 'vector':
            result[key] = value
        # Convert complex types (lists, dicts) to JSON strings
        elif isinstance(value, (list, dict)):
            result[key] = json.dumps(value)
        # Convert bool to string
        elif isinstance(value, bool):
            result[key] = str(value).lower()
        # For all other non-None values, convert to string
        elif value is not None:
            result[key] = str(value)
        # Skip None values
        else:
            continue
            
    return result

def process_s3_object(bucket, key):
    print(f"Processing file: s3://{bucket}/{key}")
    
    if LANCEDB_S3_URI and LANCEDB_S3_URI.startswith(f"s3://{bucket}"):
        if key.startswith(LANCEDB_S3_URI.replace(f"s3://{bucket}/", "")):
            print("Skipping LanceDB file to prevent recursive processing")
            return
    
    bedrock_client = boto3.client(service_name='bedrock-runtime', region_name='us-east-1')
    
    documents = load_file_from_s3(bucket, key)
    
    if not documents:
        print(f"No content loaded from {key}")
        return
        
    print(f"Loaded document: {key} with {len(documents)} pages/sections")
    
    filename = os.path.basename(key)
    lab_info = {}
    
    if key.lower().endswith('.sh'):
        for doc in documents:
            try:
                enhanced_content, lab_metadata = process_shell_script(doc.page_content, filename)
                doc.page_content = enhanced_content
                lab_info = lab_metadata
                print("Applied shell script-specific processing for educational lab context")
            except Exception as e:
                print(f"Error processing shell script content: {str(e)}")
                print("Using original content without processing")
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )
    chunks = text_splitter.split_documents(documents)
    print(f"Split into {len(chunks)} chunks")
    
    for chunk in chunks:
        chunk.metadata["file_name"] = filename
        chunk.metadata["full_path"] = key
        chunk.metadata["volume_junction_path"] = bucket
        chunk.metadata["indexed_at"] = time.time()
        
        if key.lower().endswith('.sh'):
            chunk.metadata["file_type"] = "shell_script"
            
            chunk.metadata["course"] = LAB_METADATA['course']
            chunk.metadata["lab_type"] = LAB_METADATA['lab_type']
            chunk.metadata["educational"] = LAB_METADATA['educational']
            
            for meta_key in ["exercise_name", "difficulty", "question_number", "question", "question_type"]:
                if meta_key in lab_info and lab_info[meta_key]:
                    chunk.metadata[meta_key] = lab_info[meta_key]
            
            if 'possible_answers' in lab_info and lab_info['possible_answers']:
                answers_text = '; '.join([f"{a['id']}: {a['text']}" for a in lab_info['possible_answers']])
                chunk.metadata["possible_answers_text"] = answers_text
            if 'correct_answer' in lab_info and lab_info['correct_answer']:
                chunk.metadata["correct_answer"] = lab_info['correct_answer']
            
            if 'question_flag' in lab_info and lab_info['question_flag']:
                chunk.metadata["question_flag"] = lab_info['question_flag']
            if 'check_flag' in lab_info and lab_info['check_flag']:
                chunk.metadata["check_flag"] = lab_info['check_flag']
    
    print("Creating embeddings...")
    embedded_documents = []
    for chunk in chunks:
        try:
            vector = custom_embed_query(chunk.page_content, bedrock_client)
            
            doc_with_vector = {
                "vector": vector,
                "document": chunk.page_content,
                "file_name": chunk.metadata.get("file_name", ""),
                "full_path": chunk.metadata.get("full_path", ""),
                "volume_junction_path": chunk.metadata.get("volume_junction_path", ""),
                "indexed_at": chunk.metadata.get("indexed_at", 0),
                "file_type": chunk.metadata.get("file_type", "")
            }
            
            for meta_key in chunk.metadata:
                if meta_key not in doc_with_vector and chunk.metadata[meta_key]:
                    doc_with_vector[meta_key] = chunk.metadata[meta_key]
            
            # Convert document to LanceDB-safe format
            safe_doc = prepare_document_for_lancedb(doc_with_vector)
            embedded_documents.append(safe_doc)
            
        except Exception as e:
            print(f"Error creating embedding for chunk: {str(e)}")
            import traceback
            print(traceback.format_exc())
    
    try:
        print(f"Connecting to vector database at {LANCEDB_S3_URI}")
        db = lancedb.connect(LANCEDB_S3_URI)
        
        # Try to create the table first
        try:
            print(f"Creating new table: {KNOWLEDGE_BASE_ID}")
            table = db.create_table(KNOWLEDGE_BASE_ID, data=embedded_documents)
            print(f"Successfully created table and indexed {len(embedded_documents)} document chunks")
        except ValueError as ve:
            # Table already exists, first try a simple append
            if "already exists" in str(ve):
                print(f"Table already exists, attempting to add documents")
                try:
                    table = db.open_table(KNOWLEDGE_BASE_ID)
                    table.add(embedded_documents)
                    print(f"Successfully added {len(embedded_documents)} document chunks")
                except Exception as add_error:
                    # If direct add fails, try creating a new table and merging
                    print(f"Error adding to table: {str(add_error)}")
                    print("Trying alternate approach with temporary table")
                    
                    # Create temp table with this batch
                    temp_table_name = f"{KNOWLEDGE_BASE_ID}_temp_{int(time.time())}"
                    temp_table = db.create_table(temp_table_name, data=embedded_documents)
                    print(f"Created temporary table {temp_table_name}")
                    
                    # Get data from temp table
                    all_data = temp_table.to_pandas()
                    print(f"Retrieved {len(all_data)} rows from temporary table")
                    
                    # Add to existing table
                    main_table = db.open_table(KNOWLEDGE_BASE_ID)
                    main_table.add(all_data)
                    print(f"Successfully added data to main table")
                    
                    # Clean up
                    db.drop_table(temp_table_name)
                    print(f"Cleaned up temporary table")
            else:
                raise
                
    except Exception as e:
        print(f"Error working with LanceDB: {str(e)}")
        import traceback
        print(traceback.format_exc())

def lambda_handler(event, context):
    try:
        print("Received event:", json.dumps(event))
        
        if 'detail-type' in event and event['detail-type'] == 'Object Created' and 'source' in event and event['source'] == 'aws.s3':
            if 'detail' in event and 'bucket' in event['detail'] and 'object' in event['detail']:
                bucket = event['detail']['bucket']['name']
                key = event['detail']['object']['key']
                
                print(f"Extracted from EventBridge: bucket={bucket}, key={key}")
                
                process_s3_object(bucket, key)
                
                return {
                    'statusCode': 200,
                    'body': json.dumps(f'Successfully processed file: s3://{bucket}/{key}')
                }
        
        print("Could not extract bucket and key from event")
        print("Event structure:", event)
        return {
            'statusCode': 400,
            'body': json.dumps('Could not extract bucket and key from event')
        }
    except Exception as e:
        print(f"Error in lambda handler: {str(e)}")
        import traceback
        print(traceback.format_exc())
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error processing event: {str(e)}')
        }