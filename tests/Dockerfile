# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy the entire project into the container
COPY . .

# Install test dependencies
RUN pip install --no-cache-dir -r tests/requirements.txt

# The command to run tests will be provided by docker-compose
CMD ["pytest"] 