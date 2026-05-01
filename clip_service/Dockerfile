FROM python:3.8-slim

WORKDIR /app

# Install system dependencies required by Faiss and PyTorch
RUN apt-get update && apt-get install -y \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all source files
COPY . .

# Explicitly fix the OpenMP error for Faiss
ENV KMP_DUPLICATE_LIB_OK="TRUE"

EXPOSE 8000

CMD ["python", "app.py"]
