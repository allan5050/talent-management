# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set a unique working directory for the feedback service
WORKDIR /app/feedback_service

# Copy the requirements file into the container
COPY ./requirements.txt /app/feedback_service/

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application's code into the container's app directory
COPY ./app /app/feedback_service/app

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
