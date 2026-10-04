 ## Python 3.9 slim image is used as the base image for the Docker container. 
FROM python:3.9-slim

## The following commands update the package list, install necessary dependencies, and clean up unnecessary files to reduce the image size.
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

## The working directory inside the container is set to /app, and the requirements.txt file is copied into this directory. The dependencies listed in requirements.txt are then installed using pip. Finally, the entire application code is copied into the container, and the command to run the FastAPI application using uvicorn is specified.
WORKDIR /app
COPY requirements.txt .

## The following command installs the Python dependencies listed in the requirements.txt file without using the cache to reduce the image size.
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
## The CMD instruction specifies the command to run the FastAPI application using gunicorn, with the main module and app instance specified.
# products-api
CMD ["gunicorn", "--bind", "0.0.0.0:5002", "app:app"]
