# TalentManagement Microservices Platform

This project is a microservice-based system built for a technical assignment. It includes a Feedback Service, a Member Service, and a Gateway to route requests.

## 🚀 Getting Started

### Prerequisites

- Docker and Docker Compose must be installed on your system.

### 1. Set Up Environment Variables

This project uses `.env` files for configuration. You will need to create one for your local setup.

```bash
cp .env.example .env
```

Now, you can edit the `.env` file if you need to change any default ports or service URLs, but the defaults are configured to work with `docker-compose`.

### 2. Build and Run the Services

The entire stack can be brought up using Docker Compose:

```bash
docker-compose up --build
```

This command will:
- Build the Docker images for the `gateway`, `feedback-service`, and `member-service`.
- Start a container for each service.
- Start a PostgreSQL database container.
- Set up a network for the containers to communicate.

The services will be available at the following ports on your local machine:
- **Gateway**: `http://localhost:8000`
- **Feedback Service**: `http://localhost:8001`
- **Member Service**: `http://localhost:8002`
- **PostgreSQL**: `localhost:5432`

### 3. Seed the Database

Once the containers are running, you can seed the database with initial sample data. Open a new terminal and run:

```bash
./scripts/seed-db.sh
```

This will populate the database with a sample organization, members, and feedback.

## 📡 API Endpoints

All API requests should be made through the **Gateway** at `http://localhost:8000`.

### Feedback Service

- `POST /feedback`: Create feedback for an organization.
  - **Body**: `{ "feedback": "...", "organization_id": "..." }`
- `GET /feedback/organization/{organization_id}`: Get all feedbacks for an organization.
- `DELETE /feedback/organization/{organization_id}`: Soft-delete all feedbacks for an organization.

### Member Service

- `POST /members`: Create a new member.
  - **Body**: `{ "first_name": "...", "last_name": "...", "login": "...", ... }`
- `GET /members/organization/{organization_id}`: Get all members for an organization, sorted by followers descending.
- `DELETE /members/organization/{organization_id}`: Soft-delete all members for an organization.

## 📄 API Documentation (Swagger)

Once the services are running, you can access the automatically generated Swagger/OpenAPI documentation for each service:

- **Gateway**: `http://localhost:8000/docs`
- **Feedback Service**: `http://localhost:8001/docs`
- **Member Service**: `http://localhost:8002/docs`

## 🧪 Running Tests (TODO)

The project is structured to include unit and integration tests, but these have not been implemented yet. To run them, you would typically use `pytest`:

```bash
# This is a placeholder for how you would run tests
pytest
```
