# ----- Build stage ------------------------------------------------------------
    FROM python:3.12-slim AS builder

    ENV PYTHONDONTWRITEBYTECODE=1 \
        PYTHONUNBUFFERED=1
    
    WORKDIR /app
    
    # Optional: copy requirements first to leverage Docker cache
    COPY requirements.txt ./
    RUN pip install --no-cache-dir --prefix=/install -r requirements.txt
    
    # ----- Runtime stage ----------------------------------------------------------
    FROM python:3.12-slim
    
    ENV PYTHONDONTWRITEBYTECODE=1 \
        PYTHONUNBUFFERED=1
    
    WORKDIR /app
    
    # Copy Python deps from the builder stage
    COPY --from=builder /install /usr/local
    
    # Copy application source
    COPY app ./app
    COPY app/main.py .
    
    # Expose (optional) – Fargate ignores but good for docs
    EXPOSE 80
    
    CMD ["uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "80"]
    