import boto3
import os
import json
import tempfile
import re
import lancedb
import time
from langchain_aws import BedrockEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema.document import Document

# Configuration from environment variables with defaults
LANCEDB_S3_URI = os.environ.get('LANCEDB_S3_URI', "s3://rosettacloud-shared-interactive-labs-vector")
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', "shell-scripts-knowledge-base")
# Force Bedrock region to us-east-1 since it's not available in me-central-1
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'us-east-1')
S3_REGION = os.environ.get('S3_REGION', os.environ.get('AWS_REGION', 'me-central-1'))

# Add .sh to the supported extensions
SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.doc', '.docx', '.csv', '.json', '.sh']

# Educational lab data for scripts
LAB_METADATA = {
    'course': 'Software Engineering',
    'lab_type': 'Shell Scripting',
    'educational': True
}

def load_file_from_s3(bucket, key):
    """Download a file from S3 and read its content"""
    s3_client = boto3.client('s3', region_name=S3_REGION)
    
    try:
        _, file_extension = os.path.splitext(key)
        file_extension = file_extension.lower()
        
        if file_extension not in SUPPORTED_EXTENSIONS:
            print(f"Unsupported file type: {file_extension}")
            return None
        
        # Only process text files for now since we don't have unstructured
        if file_extension in ['.txt', '.md', '.sh', '.json', '.csv']:
            # Download file to temp directory
            with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                s3_client.download_file(bucket, key, temp_file.name)
                
                # Read the file content
                with open(temp_file.name, 'r', encoding='utf-8', errors='ignore') as file:
                    content = file.read()
                
                # Clean up temp file
                os.unlink(temp_file.name)
                
                # Create a Document object
                metadata = {
                    "source": f"s3://{bucket}/{key}",
                    "file_name": os.path.basename(key),
                    "file_type": file_extension[1:]  # Remove the dot
                }
                
                return [Document(page_content=content, metadata=metadata)]
        else:
            print(f"Skipping non-text file: {key} (need unstructured package to process this type)")
            return None
    
    except Exception as e:
        print(f"Error loading file from S3: {str(e)}")
        return None

def extract_mcq_data(comments):
    """Extract MCQ-specific data from comments"""
    mcq_data = {
        'possible_answers': [],
        'correct_answer': ''
    }
    
    # Look for possible answers and correct answer
    answer_pattern = re.compile(r'^\s*-\s*(\w+):\s*(.+)$')
    correct_answer_pattern = re.compile(r'^\s*Correct answer:\s*(\w+)\s*$', re.IGNORECASE)
    
    for comment in comments:
        # Check for possible answers
        answer_match = answer_pattern.match(comment)
        if answer_match:
            answer_id = answer_match.group(1)
            answer_text = answer_match.group(2)
            mcq_data['possible_answers'].append({'id': answer_id, 'text': answer_text})
        
        # Check for correct answer
        correct_match = correct_answer_pattern.match(comment)
        if correct_match:
            mcq_data['correct_answer'] = correct_match.group(1)
    
    return mcq_data

def extract_flag_handlers(text):
    """Extract flag handlers for -q and -c flags"""
    flag_handlers = {
        'question_flag': '',   # -q flag handler
        'check_flag': ''    # -c flag handler
    }
    
    # Use regex to extract flag handlers
    q_flag_pattern = re.compile(r'#.*-q\s+flag.*\n(if.*?\[\[\s*"\$1"\s*==\s*"-q"\s*\]\].*?\n(.*?\n)*?.*?fi)', re.DOTALL)
    c_flag_pattern = re.compile(r'#.*-c\s+flag.*\n(if.*?\[\[\s*"\$1"\s*==\s*"-c"\s*\]\].*?\n(.*?\n)*?.*?fi)', re.DOTALL)
    
    # Extract -q flag handler
    q_match = q_flag_pattern.search(text)
    if q_match:
        flag_handlers['question_flag'] = q_match.group(1)
    
    # Extract -c flag handler
    c_match = c_flag_pattern.search(text)
    if c_match:
        flag_handlers['check_flag'] = c_match.group(1)
    
    return flag_handlers

def process_shell_script(text, filename):
    """Special processing for shell scripts to improve embeddings quality"""
    # Extract comments which often contain useful information
    comments = []
    command_blocks = []
    
    # Track lab exercise information
    lab_info = {
        'exercise_name': '',
        'difficulty': '',
        'learning_objectives': [],
        'question_number': '',
        'question': '',
        'question_type': '',
        'possible_answers': [],
        'correct_answer': '',
        'question_flag': '',   # -q flag handler
        'check_flag': ''    # -c flag handler
    }
    
    # Extract flag handlers first
    flag_handlers = extract_flag_handlers(text)
    lab_info['question_flag'] = flag_handlers['question_flag']
    lab_info['check_flag'] = flag_handlers['check_flag']
    
    current_command_block = []
    current_comment_block = []
    in_mcq_section = False
    
    for line in text.split('\n'):
        line_stripped = line.strip()
        
        # Extract education-specific information from comments
        if line_stripped.startswith('#'):
            comment_text = line_stripped[1:].strip()
            comments.append(comment_text)
            current_comment_block.append(comment_text)
            
            # Look for lab exercise metadata in comments using different formats
            if ':' in comment_text:
                parts = comment_text.split(':', 1)  # Split only on first colon
                if len(parts) == 2:
                    key = parts[0].strip().lower()
                    value = parts[1].strip()
                    
                    # Map to lab info fields
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
                        # Check if this is an MCQ question
                        if 'mcq' in value.lower():
                            in_mcq_section = True
                    elif key == 'question':
                        lab_info['question'] = value
            
            # End of MCQ section (blank comment or new section)
            if in_mcq_section and not comment_text.strip():
                in_mcq_section = False
                
                # Process the MCQ data
                if current_comment_block:
                    mcq_data = extract_mcq_data(current_comment_block)
                    lab_info['possible_answers'] = mcq_data['possible_answers']
                    lab_info['correct_answer'] = mcq_data['correct_answer']
                
                current_comment_block = []
        else:
            # End of comment block
            if current_comment_block:
                # Process the MCQ data if we were in an MCQ section
                if in_mcq_section:
                    mcq_data = extract_mcq_data(current_comment_block)
                    lab_info['possible_answers'] = mcq_data['possible_answers']
                    lab_info['correct_answer'] = mcq_data['correct_answer']
                
                current_comment_block = []
                in_mcq_section = False
            
            # Skip flag handler sections since we extracted them separately
            if line_stripped.startswith('if [[ "$1" =='):
                continue
            
            # Track command blocks for better understanding of script functionality
            if line_stripped and not line_stripped.startswith('#'):
                current_command_block.append(line)
            elif current_command_block:
                command_blocks.append('\n'.join(current_command_block))
                current_command_block = []
    
    # Process any remaining comment block
    if in_mcq_section and current_comment_block:
        mcq_data = extract_mcq_data(current_comment_block)
        lab_info['possible_answers'] = mcq_data['possible_answers']
        lab_info['correct_answer'] = mcq_data['correct_answer']
    
    # Add the last command block if not empty
    if current_command_block:
        command_blocks.append('\n'.join(current_command_block))
    
    # Create an enhanced version of the script with educational metadata
    enhanced_text = f"""
SCRIPT NAME: {filename}

ORIGINAL CONTENT:
{text}

SUMMARY OF COMMENTS:
{chr(10).join(comments)}

MAIN COMMAND BLOCKS:
{chr(10) + chr(10).join([f"Block {i+1}:{chr(10)}{block}" for i, block in enumerate(command_blocks)])}
"""

    # Add lab metadata if found
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
    
    # Add MCQ specific data if available
    if lab_info['possible_answers']:
        answers_text = '\n'.join([f"- {a['id']}: {a['text']}" for a in lab_info['possible_answers']])
        lab_metadata_texts.append(f"Possible Answers:\n{answers_text}")
    if lab_info['correct_answer']:
        lab_metadata_texts.append(f"Correct Answer: {lab_info['correct_answer']}")
    
    # Add flag handlers if available
    if lab_info['question_flag']:
        lab_metadata_texts.append(f"\nQuestion Flag Handler (-q):\n{lab_info['question_flag']}")
    if lab_info['check_flag']:
        lab_metadata_texts.append(f"\nCheck Flag Handler (-c):\n{lab_info['check_flag']}")
    
    if lab_metadata_texts:
        lab_metadata = "\nLAB QUESTION INFORMATION:\n" + "\n".join(lab_metadata_texts)
        enhanced_text += lab_metadata
    
    return enhanced_text, lab_info

def process_s3_object(bucket, key):
    """Process a single S3 object and index it into LanceDB"""
    print(f"Processing file: s3://{bucket}/{key}")
    
    # Skip processing if the file is in the LanceDB bucket (to avoid infinite loops)
    if LANCEDB_S3_URI and LANCEDB_S3_URI.startswith(f"s3://{bucket}"):
        if key.startswith(LANCEDB_S3_URI.replace(f"s3://{bucket}/", "")):
            print("Skipping LanceDB file to prevent recursive processing")
            return
    
    # Initialize Bedrock client - explicitly set to us-east-1 where the service is available
    bedrock_client = boto3.client(service_name='bedrock-runtime', region_name='us-east-1')
    
    # Initialize the embedding model
    embeddings = BedrockEmbeddings(
        model_id="amazon.titan-embed-text-v2:0",
        client=bedrock_client,
        model_kwargs={"dimensions": 1536}
    )
    
    # Load the document using direct S3 access instead of S3FileLoader
    documents = load_file_from_s3(bucket, key)
    
    if not documents:
        print(f"No content loaded from {key}")
        return
        
    print(f"Loaded document: {key} with {len(documents)} pages/sections")
    
    # Special processing for shell scripts
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
                # Continue with original content
                print("Using original content without processing")
    
    # Split the document into chunks
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200  # Increased overlap for better context preservation
    )
    chunks = text_splitter.split_documents(documents)
    print(f"Split into {len(chunks)} chunks")
    
    # Add metadata to each chunk
    for chunk in chunks:
        # Extract filename from source path
        chunk.metadata["file_name"] = filename
        chunk.metadata["full_path"] = key
        chunk.metadata["volume_junction_path"] = bucket
        chunk.metadata["indexed_at"] = time.time()
        
        # Add script-specific metadata for shell scripts
        if key.lower().endswith('.sh'):
            chunk.metadata["file_type"] = "shell_script"
            
            # Add educational lab metadata
            chunk.metadata["course"] = LAB_METADATA['course']
            chunk.metadata["lab_type"] = LAB_METADATA['lab_type']
            chunk.metadata["educational"] = LAB_METADATA['educational']
            
            # Add lab exercise info if available
            for meta_key in ["exercise_name", "difficulty", "question_number", "question", "question_type"]:
                if meta_key in lab_info and lab_info[meta_key]:
                    chunk.metadata[meta_key] = lab_info[meta_key]
            
            # Add MCQ specific metadata
            if 'possible_answers' in lab_info and lab_info['possible_answers']:
                # Store as JSON string to preserve structure
                chunk.metadata["possible_answers"] = json.dumps(lab_info['possible_answers'])
            if 'correct_answer' in lab_info and lab_info['correct_answer']:
                chunk.metadata["correct_answer"] = lab_info['correct_answer']
            
            # Add flag handlers
            if 'question_flag' in lab_info and lab_info['question_flag']:
                chunk.metadata["question_flag"] = lab_info['question_flag']
            if 'check_flag' in lab_info and lab_info['check_flag']:
                chunk.metadata["check_flag"] = lab_info['check_flag']
    
    # Create embeddings for all chunks
    print("Creating embeddings...")
    embedded_documents = []
    for chunk in chunks:
        vector = embeddings.embed_query(chunk.page_content)
        
        # Create document with all metadata
        doc_with_vector = {
            "vector": vector,
            "document": chunk.page_content,
            "file_name": chunk.metadata.get("file_name", ""),
            "full_path": chunk.metadata.get("full_path", ""),
            "volume_junction_path": chunk.metadata.get("volume_junction_path", ""),
            "indexed_at": chunk.metadata.get("indexed_at", 0),
            "file_type": chunk.metadata.get("file_type", "")
        }
        
        # Add all metadata fields
        for meta_key in chunk.metadata:
            if meta_key not in doc_with_vector and chunk.metadata[meta_key]:
                doc_with_vector[meta_key] = chunk.metadata[meta_key]
        
        embedded_documents.append(doc_with_vector)
    
    try:
        # Connect to LanceDB and create or update table
        print(f"Connecting to vector database at {LANCEDB_S3_URI}")
        db = lancedb.connect(LANCEDB_S3_URI)
        
        # Create or update LanceDB table
        if KNOWLEDGE_BASE_ID in db.table_names():
            print(f"Updating existing table: {KNOWLEDGE_BASE_ID}")
            table = db.open_table(KNOWLEDGE_BASE_ID)
            table.add(embedded_documents)
        else:
            print(f"Creating new table: {KNOWLEDGE_BASE_ID}")
            table = db.create_table(KNOWLEDGE_BASE_ID, data=embedded_documents)
        
        print(f"Successfully indexed {len(embedded_documents)} document chunks")
    except Exception as e:
        print(f"Error connecting to LanceDB: {str(e)}")

def lambda_handler(event, context):
    """
    Lambda handler that processes a specific S3 object provided in the event
    """
    try:
        # Extract bucket and key from the event - support both direct invocation and EventBridge events
        if 'detail' in event and 'bucket' in event['detail'] and 'object' in event['detail']:
            # This is an EventBridge event
            bucket = event['detail']['bucket']['name']
            key = event['detail']['object']['key']
        else:
            # This is a direct invocation
            bucket = event.get('bucket')
            key = event.get('key')
        
        if not bucket or not key:
            print("Missing bucket or key in event:", event)
            return {
                'statusCode': 400,
                'body': json.dumps('Missing bucket or key parameters')
            }
        
        # Process the specific S3 object
        process_s3_object(bucket, key)
        
        return {
            'statusCode': 200,
            'body': json.dumps(f'Successfully processed file: s3://{bucket}/{key}')
        }
    except Exception as e:
        print(f"Error in lambda handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error processing event: {str(e)}')
        }