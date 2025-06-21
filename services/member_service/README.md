# Member Service

This microservice is responsible for managing the members of organizations.

## Responsibilities

-   Creating, retrieving, and soft-deleting member records.
-   All data is associated with an organization.
-   Sorting members by follower count.

## Database

This service connects to the `member_db` PostgreSQL database. The service's models are responsible for creating the necessary tables on startup. 