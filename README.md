# DocSense AI - Project Skeleton

This repository contains the project skeleton for **DocSense AI**, a RAG-based document Q&A application.

## Project Architecture
*   **Backend**: Django project (`docsense`) with an app (`documents`). Uses Django REST Framework for endpoints.
*   **Database**: PostgreSQL with `pgvector` enabled (via the `pgvector/pgvector:pg16` Docker image).
*   **Async Processing**: Celery task manager utilizing Redis as the message broker.
*   **Frontend**: React client scaffolded with Vite.
*   **Containerization**: Fully configured with Docker and Docker Compose.

---

## Prerequisites
*   Docker and Docker Compose installed on your system.

---

## Getting Started

1.  **Clone / Navigate to the Directory**:
    ```bash
    cd /home/archana/Projects/docsense-ai
    ```

2.  **Start the Services**:
    Run Docker Compose to spin up all containers (Database, Redis, Django backend, Celery worker, React frontend):
    ```bash
    docker compose up --build
    ```

3.  **Access the Applications**:
    *   **Frontend Client**: [http://localhost:5173](http://localhost:5173)
    *   **Backend Health Check**: [http://localhost:8000/api/health/](http://localhost:8000/api/health/)
    *   **Celery Health Check**: [http://localhost:8000/api/health/celery/](http://localhost:8000/api/health/celery/)

---

## API Endpoints

### 1. General Health Check
*   **URL**: `/api/health/`
*   **Method**: `GET`
*   **Response**:
    ```json
    {
      "status": "ok"
    }
    ```

### 2. Celery Health Check
*   **URL**: `/api/health/celery/`
*   **Method**: `GET`
*   **Response**:
    ```json
    {
      "status": "triggered",
      "task_id": "uuid-here"
    }
    ```
    *Note: This triggers a background task `ping_task` which sleeps for 2 seconds and returns `"pong"`. Check the logs of the `docsense_celery_worker` container to verify.*
