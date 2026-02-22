FROM public.ecr.aws/lambda/python:3.12

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy function code
COPY ai_chatbot.py ${LAMBDA_TASK_ROOT}

# Set the CMD to handler
CMD [ "ai_chatbot.lambda_handler" ]