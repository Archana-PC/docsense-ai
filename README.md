# DocSense AI — RAG Document Intelligence Platform

**DocSense AI** is a production-grade **Retrieval-Augmented Generation (RAG)** application designed for intelligent document question-answering and semantic search.

---

## Architecture & Tech Stack

```
                     ┌────────────────────────────────────────────────────────┐
                     │              Frontend (React 19 + Vite)                │
                     │                 http://localhost:5173                  │
                     └───────────────▲────────────────────────▲───────────────┘
                                     │                        │
                   POST /api/documents/upload/        POST /api/documents/<id>/chat/
                                     │                        │
                                     ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                Django REST API (Backend)                                    │
│                                  http://localhost:8000                                      │
└──────────────┬───────────────────────────────┬──────────────────────────────▲───────────────┘
               │                               │                              │
         Saves metadata             Dispatches Task `extract_text`            │
               │                               │                              │
               ▼                               ▼                              │
┌─────────────────────────────┐  ┌───────────────────────────┐                │
│    PostgreSQL 16 + pgvector │  │       Redis Broker        │                │
│    (docsense_db:5432)       │  │   (docsense_redis:6379)   │                │
└──────────────▲──────────────┘  └─────────────┬─────────────┘                │
               │                               │                              │
               │                               ▼                              │
               │                 ┌───────────────────────────┐                │
               │                 │       Celery Worker       │                │
               └─────────────────┤  (docsense_celery_worker) ├────────────────┘
                   Stores chunks │   - pdfplumber text parser│
                   & 768-d vectors│  - Text chunking engine  │
                                 │   - Gemini embeddings     │
                                 └───────────────────────────┘
```

* **Frontend**: React 19 SPA scaffolded with Vite, styled with modern dark glassmorphism, featuring split-pane document reader, interactive AI chat, source citations, and chunk viewer.
* **Backend**: Django 5.0 + Django REST Framework.
* **Vector Store**: PostgreSQL 16 with the native `pgvector` extension and `VectorField(dimensions=768)`.
* **Async Task Queue**: Celery 5.3 worker with Redis 7 broker.
* **AI Engine**: Google Gemini API (`models/text-embedding-004` for 768-dim embeddings and `gemini-1.5-flash` for RAG Q&A).
* **Containerization**: Full Docker & Docker Compose orchestration.

---

## Getting Started

### 1. Prerequisites
* Docker and Docker Compose installed on your system.
* (Optional) A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey) (Free tier available).

### 2. Configure Environment Variables
In your root `.env` file:
```env
DEBUG=True
SECRET_KEY=your-django-secret-key
ALLOWED_HOSTS=localhost,127.0.0.1,backend,web
DATABASE_URL=postgres://postgres:postgres@db:5432/docsense
CELERY_BROKER_URL=redis://redis:6379/0

# Optional: You can also set this directly in the React UI
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Start the Application
```bash
docker compose up -d --build
```

### 4. Access the Applications
* **Web Client**: [http://localhost:5173](http://localhost:5173)
* **API Root**: [http://localhost:8000/api/](http://localhost:8000/api/)
* **Health Check**: [http://localhost:8000/api/health/](http://localhost:8000/api/health/)

---

## API Endpoints Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health/` | `GET` | Backend service health check |
| `/api/health/celery/` | `GET` | Dispatches dummy background Celery task |
| `/api/config/status/` | `GET` | Returns AI model and vector engine status |
| `/api/documents/` | `GET` | Lists all uploaded documents with chunk counts |
| `/api/documents/upload/` | `POST` | Uploads PDF and triggers background chunking & embedding |
| `/api/documents/<id>/status/` | `GET` | Polls document processing status (`pending`, `processing`, `done`) |
| `/api/documents/<id>/` | `GET` / `DELETE` | Retrieves full document metadata or deletes document |
| `/api/documents/<id>/chunks/` | `GET` | Lists generated text chunks, page numbers, and vector status |
| `/api/documents/<id>/chat/` | `POST` | Single-shot semantic search + Gemini RAG answer |
| `/api/documents/<id>/sessions/` | `GET` / `POST` | Lists or creates multi-turn chat threads for a document |
| `/api/sessions/<id>/` | `GET` / `DELETE` | Retrieves full message history of a thread or deletes it |
| `/api/sessions/<id>/chat/` | `POST` | Sends follow-up message with conversation memory |

### Example Chat Request:
```bash
curl -X POST http://localhost:8000/api/documents/1/chat/ \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the main findings in section 2?",
    "api_key": "optional-key-if-not-in-env"
  }'
```
