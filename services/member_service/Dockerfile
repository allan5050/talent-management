# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set a unique working directory for the member service
WORKDIR /app/member_service

# Copy the requirements file into the container
COPY ./requirements.txt /app/member_service/

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application's code into the container's app directory
COPY ./app /app/member_service/app

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]