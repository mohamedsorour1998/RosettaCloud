import boto3
import os
import json
import urllib.parse
import lancedb
import time
import tempfile
from langchain_aws import BedrockEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema.document import Document

# Configuration from environment variables with defaults
LANCEDB_S3_URI = os.environ.get('LANCEDB_S3_URI', "s3://rosettacloud-shared-interactive-labs-vector")
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', "shell-scripts-knowledge-base")
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', os.environ.get('AWS_REGION', 'us-east-1'))
S3_REGION = os.environ.get('S3_REGION', os.environ.get('AWS_REGION', 'us-east-1'))

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

def process_shell_script(text, filename):
    """Special processing for shell scripts to improve embeddings quality"""
    # Extract comments which often contain useful information
    comments = []
    command_blocks = []
    
    # Track lab exercise information
    lab_info = {
        'exercise_name': '',
        'difficulty': '',
        'learning_objectives': []
    }
    
    current_command_block = []
    
    for line in text.split('\n'):
        line_stripped = line.strip()
        
        # Extract education-specific information from comments
        if line_stripped.startswith('#'):
            comment_text = line_stripped[1:].strip()
            comments.append(comment_text)
            
            # Look for lab exercise metadata in comments
            if 'exercise:' in comment_text.lower():
                lab_info['exercise_name'] = comment_text.split('exercise:')[1].strip()
            elif 'difficulty:' in comment_text.lower():
                lab_info['difficulty'] = comment_text.split('difficulty:')[1].strip()
            elif 'objective:' in comment_text.lower():
                objective = comment_text.split('objective:')[1].strip()
                lab_info['learning_objectives'].append(objective)
        else:
            # Track command blocks for better understanding of script functionality
            if line_stripped and not line_stripped.startswith('#'):
                current_command_block.append(line)
            elif current_command_block:
                command_blocks.append('\n'.join(current_command_block))
                current_command_block = []
    
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
    if lab_info['exercise_name'] or lab_info['difficulty'] or lab_info['learning_objectives']:
        learning_obj_text = '\n'.join([f"- {obj}" for obj in lab_info['learning_objectives']])
        lab_metadata = f"""
LAB EXERCISE INFORMATION:
Exercise Name: {lab_info['exercise_name']}
Difficulty Level: {lab_info['difficulty']}
Learning Objectives:
{learning_obj_text}
"""
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
    
    # Initialize Bedrock client
    bedrock_client = boto3.client(service_name='bedrock-runtime', region_name=BEDROCK_REGION)
    
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
            enhanced_content, lab_metadata = process_shell_script(doc.page_content, filename)
            doc.page_content = enhanced_content
            lab_info = lab_metadata
        print("Applied shell script-specific processing for educational lab context")
    
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
            if lab_info.get('exercise_name'):
                chunk.metadata["exercise_name"] = lab_info['exercise_name']
            if lab_info.get('difficulty'):
                chunk.metadata["difficulty"] = lab_info['difficulty']
    
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
        
        # Add educational metadata
        for meta_key in ["course", "lab_type", "educational", "exercise_name", "difficulty"]:
            if meta_key in chunk.metadata:
                doc_with_vector[meta_key] = chunk.metadata.get(meta_key)
        
        embedded_documents.append(doc_with_vector)
    
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

def lambda_handler(event, context):
    """
    Handle both S3 direct events and EventBridge events
    """
    print("Received event:", json.dumps(event, indent=2))
    
    processed_count = 0
    
    # Check if this is an S3 event (via S3 notification)
    if 'Records' in event:
        for record in event['Records']:
            # Check if this is an S3 event
            if record.get('eventSource') == 'aws:s3' or 's3' in record:
                bucket = record['s3']['bucket']['name']
                key = urllib.parse.unquote_plus(record['s3']['object']['key'])
                process_s3_object(bucket, key)
                processed_count += 1
    
    # Check if this is an EventBridge event
    elif 'detail-type' in event and event.get('detail-type') == 'Object Created' and event.get('source') == 'aws.s3':
        bucket = event['detail']['bucket']['name']
        key = event['detail']['object']['key']
        process_s3_object(bucket, key)
        processed_count += 1
    
    # If neither, log error
    else:
        print("Unsupported event format:", event)
        return {
            'statusCode': 400,
            'body': json.dumps('Unsupported event format')
        }
    
    return {
        'statusCode': 200,
        'body': json.dumps(f'Successfully processed {processed_count} files')
    }