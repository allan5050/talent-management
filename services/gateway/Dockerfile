# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set a unique working directory for the gateway service
WORKDIR /app/gateway

# Copy the requirements file into the container
COPY ./requirements.txt /app/gateway/

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application's code into the container's app directory
COPY ./app /app/gateway/app

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]