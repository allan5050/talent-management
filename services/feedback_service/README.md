# Feedback Service

This microservice is responsible for managing feedback for organizations.

## Responsibilities

-   Creating, retrieving, and soft-deleting feedback records.
-   All data is associated with an organization.

## Database

This service connects to the `feedback_db` PostgreSQL database. The service's models are responsible for creating the necessary tables on startup. 