#!/bin/bash
# This script executes SQL seed files against the running PostgreSQL container.

DB_CONTAINER_NAME="talent-management-db-1"
DB_USER="user"
DB_NAME_FEEDBACK="feedback_db"
DB_NAME_MEMBER="member_db"

echo "Waiting for PostgreSQL to be ready..."
until docker exec $DB_CONTAINER_NAME pg_isready -U $DB_USER -d $DB_NAME_FEEDBACK -q; do
  sleep 1
done

echo "PostgreSQL is ready."

echo "Creating member_db database if it does not exist..."
docker exec $DB_CONTAINER_NAME psql -U $DB_USER -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME_MEMBER'" | grep -q 1 || \
docker exec $DB_CONTAINER_NAME psql -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME_MEMBER"

echo "Seeding organizations table..."
docker exec -i $DB_CONTAINER_NAME psql -U $DB_USER -d $DB_NAME_MEMBER < ./database/seeds/organizations.sql

echo "Seeding members table..."
docker exec -i $DB_CONTAINER_NAME psql -U $DB_USER -d $DB_NAME_MEMBER < ./database/seeds/members.sql

echo "Seeding feedbacks table..."
docker exec -i $DB_CONTAINER_NAME psql -U $DB_USER -d $DB_NAME_FEEDBACK < ./database/seeds/feedback.sql

echo "Database seeding complete." 