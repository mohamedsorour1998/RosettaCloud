FROM public.ecr.aws/lambda/python:3.9

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install -r requirements.txt

# Copy function code
COPY ai_chatbot.py ${LAMBDA_TASK_ROOT}

# Set the CMD to handler
CMD [ "ai_chatbot.lambda_handler" ]