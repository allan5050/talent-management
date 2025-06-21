# TalentManagement Microservices Platform

This project implements a microservice-based system as part of a technical leadership assignment. It features a `Feedback Service` for managing company feedback and a `Member Service` for managing organization members, with a `Gateway Service` acting as a single entry point.

The solution is designed with a focus on clean architecture, separation of concerns, and production-ready practices, including configuration management, containerization, and a simplified API design.

## Project Philosophy

As a simulation of a real-world technical lead assignment, this project prioritizes:

- **Clarity and Simplicity**: The architecture is straightforward, and the code is written to be easily understood and maintained.
- **Correctness**: The implementation strictly follows the provided specification, particularly regarding the API contract.
- **Developer Experience**: The entire system can be set up and run with a single command, with clear instructions and tooling.
- **Testability**: The services are designed to be testable, with a full suite of unit and integration tests to ensure reliability.

## Setup instructions using Docker

### Prerequisites

- Docker and Docker Compose must be installed on your system.
- A shell environment (like Git Bash on Windows, or any standard Linux/macOS shell).

### 1. Set Up Environment Variables

The services are configured using a `.env` file. A sample is provided to get you started.

```bash
# Create a copy of the example environment file
cp .env.example .env
```

The default settings in `.env.example` are pre-configured to work with the `docker-compose` setup. This includes database connection strings and the default organization ID used by the services.

### 2. Build and Run the Services

The entire application stack (services, gateway, and database) can be launched using Docker Compose:

```bash
docker-compose up --build
```

This command builds the service images, starts all containers, and connects them to a shared network. The services will be available at:

- **Gateway Service**: `http://localhost:8000` (All API requests go here)
- **Feedback Service**: `http://localhost:8001`
- **Member Service**: `http://localhost:8002`
- **PostgreSQL Database**: `localhost:5432`

## How to seed sample data

With the services running, you can populate the database with initial sample data. Open a new terminal and execute the seeding script:

```bash
./scripts/seed-db.sh
```

This script populates the database with a default organization, along with sample members and feedback, making the API immediately available for use.

## How to access APIs and Swagger docs

All API requests are made through the **Gateway** at `http://localhost:8000`. The gateway routes requests to the appropriate downstream service.

### Feedback Service (`/feedback`)

- `POST /feedback`: Create feedback for the default organization.
  - **Request Body**: `{ "feedback": "Great team culture and clear communication." }`
- `GET /feedback`: Get all non-deleted feedbacks for the organization.
- `DELETE /feedback`: Soft-delete all feedbacks for the organization.

### Member Service (`/members`)

- `POST /members`: Create a new member for the default organization.
  - **Request Body**: `{ "first_name": "John", "last_name": "Doe", ... }`
- `GET /members`: Get all non-deleted members, sorted by followers descending.
- `DELETE /members`: Soft-delete all members of the organization.

### Swagger Interactive Documentation

Interactive Swagger/OpenAPI documentation is automatically generated and available for each service once they are running:

- **Gateway**: `http://localhost:8000/docs`
- **Feedback Service**: `http://localhost:8001/docs`
- **Member Service**: `http://localhost:8002/docs`

The Gateway's documentation provides a consolidated view of all exposed endpoints.

## How to run tests

The project includes a comprehensive test suite using `pytest`. The tests are containerized and can be run against the services to ensure everything is working correctly.

To run all unit and integration tests, execute the following command:

```bash
docker-compose run --rm tests
```

This command will start a temporary container, install the test dependencies, and run `pytest`, which will discover and run all tests in the `tests/` directory.

## ⚙️ Key Architectural Decisions

- **Single Organization Context**: To align with the assignment's simplified API specification, the services operate on a single, default organization context. The ID of this organization is managed via environment variables, making the API cleaner and simpler for the end-user.
- **Gateway Routing**: The gateway uses specific route definitions rather than a generic catch-all proxy. This provides a more secure and explicit API contract at the entrypoint.
- **Configuration Management**: All configuration is managed via environment variables and a `.env` file, following 12-factor app principles. This separates configuration from code and makes the services more portable.
- **Soft Deletes**: All delete operations are soft deletes (`deleted_at` timestamp), preserving data history and preventing accidental data loss.
