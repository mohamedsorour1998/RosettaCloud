FROM public.ecr.aws/lambda/python:3.9

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install -r requirements.txt

# Copy function code
COPY document_indexer.py ${LAMBDA_TASK_ROOT}

# Set the CMD to handler
CMD [ "document_indexer.lambda_handler" ]