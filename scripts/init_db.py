import time
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
import os

# Give the database time to start up
time.sleep(10)

DATABASE_URL = os.environ.get("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")

engine = create_engine(DATABASE_URL)

def connect_to_db():
    retries = 5
    while retries > 0:
        try:
            engine.connect()
            print("Database connection successful")
            return
        except OperationalError:
            print("Database not ready, retrying...")
            retries -= 1
            time.sleep(5)
    raise Exception("Could not connect to the database")

if __name__ == "__main__":
    connect_to_db()
    # This is where you would run migrations in a real application
    # For this project, the tables are created in the service startup
    print("Database initialized.") 