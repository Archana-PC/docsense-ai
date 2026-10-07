import logging
import json
from django.http import StreamingHttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from pgvector.django import CosineDistance

from .tasks import ping_task, extract_text_task
from .models import Document, DocumentChunk, ChatSession, ChatMessage
from .services.gemini import (
    is_gemini_configured,
    generate_embedding,
    contextualize_query,
    answer_question_with_context,
    stream_answer_with_context
)

logger = logging.getLogger(__name__)


class HealthCheckView(APIView):
    """Simple API endpoint to check if backend is running."""
    def get(self, request):
        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class ConfigStatusView(APIView):
    """Endpoint to check configured services (e.g. Gemini AI)."""
    def get(self, request):
        return Response({
            "gemini_configured": is_gemini_configured(),
            "vector_engine": "pgvector (PostgreSQL 16)",
            "embedding_model": "models/text-embedding-004 (768 dimensions)",
            "chat_model": "gemini-1.5-flash",
        }, status=status.HTTP_200_OK)


class CeleryHealthCheckView(APIView):
    """API endpoint to trigger a Celery task and verify the worker works."""
    def get(self, request):
        task = ping_task.delay()
        return Response({
            "status": "triggered",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


class DocumentListView(APIView):
    """
    Endpoint GET /api/documents/ to list all documents with metadata and chunk count.
    """
    def get(self, request):
        documents = Document.objects.all().order_by('-uploaded_at')
        data = []
        for doc in documents:
            data.append({
                "id": doc.id,
                "original_filename": doc.original_filename,
                "status": doc.status,
                "chunks_count": doc.chunks.count(),
                "sessions_count": doc.chat_sessions.count(),
                "uploaded_at": doc.uploaded_at,
                "error_message": doc.error_message
            })
        return Response(data, status=status.HTTP_200_OK)


class DocumentUploadView(APIView):
    """
    Endpoint POST /api/documents/upload/ to upload a PDF file and initiate extraction & chunking.
    """
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        if 'file' not in request.FILES:
            return Response(
                {"error": "No file was uploaded. Please provide a file under the 'file' key."}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        file_obj = request.FILES['file']
        
        # Validate that the file is a PDF
        if not file_obj.name.lower().endswith('.pdf'):
            return Response(
                {"error": "Invalid file type. Only PDF files are allowed."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            document = Document.objects.create(
                file=file_obj,
                original_filename=file_obj.name,
                status='pending'
            )
            
            logger.info(f"Triggering extract_text_task for document id {document.id}")
            extract_text_task.delay(document.id)

            return Response({
                "id": document.id,
                "status": document.status,
                "original_filename": document.original_filename
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.exception("Failed to create document record.")
            return Response(
                {"error": f"An error occurred during file upload: {str(e)}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DocumentStatusView(APIView):
    """
    Endpoint GET /api/documents/<id>/status/ to poll processing status.
    """
    def get(self, request, id, *args, **kwargs):
        try:
            document = Document.objects.get(id=id)
            return Response({
                "id": document.id,
                "status": document.status,
                "original_filename": document.original_filename,
                "chunks_count": document.chunks.count(),
                "error_message": document.error_message
            }, status=status.HTTP_200_OK)
        except Document.DoesNotExist:
            return Response(
                {"error": "Document not found."}, 
                status=status.HTTP_404_NOT_FOUND
            )


class DocumentDetailView(APIView):
    """
    Endpoint GET /api/documents/<id>/ to get full document details.
    DELETE /api/documents/<id>/ to delete document.
    """
    def get(self, request, id, *args, **kwargs):
        try:
            document = Document.objects.get(id=id)
            return Response({
                "id": document.id,
                "status": document.status,
                "original_filename": document.original_filename,
                "extracted_text": document.extracted_text,
                "chunks_count": document.chunks.count(),
                "sessions_count": document.chat_sessions.count(),
                "error_message": document.error_message,
                "uploaded_at": document.uploaded_at
            }, status=status.HTTP_200_OK)
        except Document.DoesNotExist:
            return Response(
                {"error": "Document not found."}, 
                status=status.HTTP_404_NOT_FOUND
            )

    def delete(self, request, id, *args, **kwargs):
        try:
            document = Document.objects.get(id=id)
            document.delete()
            return Response({"message": "Document deleted successfully."}, status=status.HTTP_200_OK)
        except Document.DoesNotExist:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)


class DocumentChunksView(APIView):
    """
    Endpoint GET /api/documents/<id>/chunks/ to view chunks and embeddings status.
    """
    def get(self, request, id, *args, **kwargs):
        try:
            document = Document.objects.get(id=id)
            chunks = document.chunks.all()[:50]
            data = [{
                "id": c.id,
                "chunk_index": c.chunk_index,
                "page_number": c.page_number,
                "content": c.content,
                "has_embedding": c.embedding is not None and len(c.embedding) > 0 and c.embedding[0] != 0.0
            } for c in chunks]
            return Response(data, status=status.HTTP_200_OK)
        except Document.DoesNotExist:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)


class DocumentChatView(APIView):
    """
    Single-shot RAG Endpoint POST /api/documents/<id>/chat/
    Performs semantic vector search against document chunks and generates an answer with Gemini.
    """
    def post(self, request, id, *args, **kwargs):
        question = request.data.get('question', '').strip()
        custom_api_key = request.data.get('api_key', '').strip() or None

        if not question:
            return Response(
                {"error": "Question is required."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            document = Document.objects.get(id=id)
        except Document.DoesNotExist:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)

        if document.status != 'done':
            return Response(
                {"error": f"Document is not ready for querying (Current status: {document.status})."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        total_chunks = document.chunks.count()
        if total_chunks == 0:
            return Response(
                {"error": "No text chunks found for this document to answer questions."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check Gemini API Key
        if not is_gemini_configured(custom_api_key):
            return Response({
                "error": "Google Gemini API Key is required to perform semantic search and generate answers.",
                "needs_api_key": True,
                "instruction": "Please set GEMINI_API_KEY in your .env file or provide 'api_key' in the request."
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            # 1. Generate Question Embedding
            logger.info(f"Generating query embedding for question: '{question}'")
            query_vector = generate_embedding(question, api_key=custom_api_key, is_query=True)

            # 2. Vector Similarity Search via pgvector
            top_k = 4
            matching_chunks = document.chunks.annotate(
                distance=CosineDistance('embedding', query_vector)
            ).order_by('distance')[:top_k]

            context_chunks = []
            sources = []
            for chunk in matching_chunks:
                context_chunks.append({
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_number,
                    "content": chunk.content
                })
                sources.append({
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_number,
                    "snippet": chunk.content[:160] + "..." if len(chunk.content) > 160 else chunk.content,
                    "similarity": round(float(1 - (chunk.distance if hasattr(chunk, 'distance') and chunk.distance is not None else 1)), 3)
                })

            # 3. LLM Generation
            logger.info(f"Passing {len(context_chunks)} chunks to Gemini for answer generation...")
            answer = answer_question_with_context(
                question=question,
                context_chunks=context_chunks,
                chat_history=[],
                api_key=custom_api_key
            )

            return Response({
                "question": question,
                "answer": answer,
                "document_id": document.id,
                "document_filename": document.original_filename,
                "sources": sources
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.exception("Error during RAG chat completion.")
            return Response(
                {"error": f"Failed to generate answer: {str(e)}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


# ==============================================================================
# Multi-turn Chat Session Endpoints with Conversation Memory
# ==============================================================================

class ChatSessionListCreateView(APIView):
    """
    GET /api/documents/<id>/sessions/  -> list sessions for a document
    POST /api/documents/<id>/sessions/ -> create a new chat session
    """
    def get(self, request, id):
        try:
            document = Document.objects.get(id=id)
        except Document.DoesNotExist:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)

        sessions = document.chat_sessions.all()
        data = [{
            "id": s.id,
            "title": s.title,
            "messages_count": s.messages.count(),
            "created_at": s.created_at,
            "updated_at": s.updated_at
        } for s in sessions]
        return Response(data, status=status.HTTP_200_OK)

    def post(self, request, id):
        try:
            document = Document.objects.get(id=id)
        except Document.DoesNotExist:
            return Response({"error": "Document not found."}, status=status.HTTP_404_NOT_FOUND)

        title = request.data.get('title', 'New Conversation').strip() or 'New Conversation'
        session = ChatSession.objects.create(document=document, title=title)
        return Response({
            "id": session.id,
            "title": session.title,
            "messages_count": 0,
            "created_at": session.created_at,
            "updated_at": session.updated_at
        }, status=status.HTTP_201_CREATED)


class ChatSessionDetailView(APIView):
    """
    GET /api/sessions/<session_id>/  -> get session details and full messages history
    DELETE /api/sessions/<session_id>/ -> delete session
    """
    def get(self, request, session_id):
        try:
            session = ChatSession.objects.get(id=session_id)
        except ChatSession.DoesNotExist:
            return Response({"error": "Chat session not found."}, status=status.HTTP_404_NOT_FOUND)

        messages = session.messages.all()
        return Response({
            "id": session.id,
            "document_id": session.document.id,
            "document_filename": session.document.original_filename,
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "messages": [{
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "sources": m.sources,
                "created_at": m.created_at
            } for m in messages]
        }, status=status.HTTP_200_OK)

    def delete(self, request, session_id):
        try:
            session = ChatSession.objects.get(id=session_id)
            session.delete()
            return Response({"message": "Chat session deleted successfully."}, status=status.HTTP_200_OK)
        except ChatSession.DoesNotExist:
            return Response({"error": "Chat session not found."}, status=status.HTTP_404_NOT_FOUND)


class SessionChatView(APIView):
    """
    POST /api/sessions/<session_id>/chat/
    Sends a message in a multi-turn conversation session:
    1. Fetches previous conversation history
    2. Contextualizes the follow-up query for vector search
    3. Runs cosine similarity search against document chunks in pgvector
    4. Generates an answer with Gemini keeping conversational memory
    5. Stores user and assistant messages in PostgreSQL
    """
    def post(self, request, session_id):
        question = request.data.get('question', '').strip()
        custom_api_key = request.data.get('api_key', '').strip() or None

        if not question:
            return Response({"error": "Question is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            session = ChatSession.objects.get(id=session_id)
        except ChatSession.DoesNotExist:
            return Response({"error": "Chat session not found."}, status=status.HTTP_404_NOT_FOUND)

        document = session.document
        if document.status != 'done':
            return Response(
                {"error": f"Document is not ready (Current status: {document.status})."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        if document.chunks.count() == 0:
            return Response(
                {"error": "No text chunks found for this document to answer questions."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check Gemini API Key
        if not is_gemini_configured(custom_api_key):
            return Response({
                "error": "Google Gemini API Key is required to perform semantic search and generate answers.",
                "needs_api_key": True,
                "instruction": "Please set GEMINI_API_KEY in your .env file or provide 'api_key' in the request."
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            # 1. Fetch previous conversation history
            past_messages = list(session.messages.all().order_by('created_at'))
            chat_history = [
                {"role": m.role, "content": m.content} 
                for m in past_messages[-10:]  # Last 5 turns
            ]

            # 2. Contextualize query for vector retrieval
            search_query = contextualize_query(question, chat_history, custom_api_key)
            logger.info(f"Session {session_id}: Original='{question}', SearchQuery='{search_query}'")

            # 3. Vector Similarity Search via pgvector
            query_vector = generate_embedding(search_query, api_key=custom_api_key, is_query=True)
            top_k = 4
            matching_chunks = document.chunks.annotate(
                distance=CosineDistance('embedding', query_vector)
            ).order_by('distance')[:top_k]

            context_chunks = []
            sources = []
            for chunk in matching_chunks:
                context_chunks.append({
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_number,
                    "content": chunk.content
                })
                sources.append({
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_number,
                    "snippet": chunk.content[:160] + "..." if len(chunk.content) > 160 else chunk.content,
                    "similarity": round(float(1 - (chunk.distance if hasattr(chunk, 'distance') and chunk.distance is not None else 1)), 3)
                })

            # 4. Generate answer with Gemini passing conversation history
            answer = answer_question_with_context(
                question=question,
                context_chunks=context_chunks,
                chat_history=chat_history,
                api_key=custom_api_key
            )

            # 5. Persist user and assistant messages in database
            user_msg = ChatMessage.objects.create(
                session=session,
                role='user',
                content=question
            )
            ai_msg = ChatMessage.objects.create(
                session=session,
                role='assistant',
                content=answer,
                sources=sources
            )

            # Update session title if it was default
            if session.title in ['New Conversation', 'New Chat']:
                summary_title = question[:40] + ('...' if len(question) > 40 else '')
                session.title = summary_title
                session.save(update_fields=['title', 'updated_at'])
            else:
                session.save(update_fields=['updated_at'])

            return Response({
                "session_id": session.id,
                "session_title": session.title,
                "question": question,
                "search_query": search_query,
                "answer": answer,
                "sources": sources,
                "user_message_id": user_msg.id,
                "assistant_message_id": ai_msg.id
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.exception(f"Error during session chat in session {session_id}")
            return Response(
                {"error": f"Failed to generate answer: {str(e)}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class SessionStreamChatView(APIView):
    """
    POST /api/sessions/<session_id>/stream_chat/
    Streams AI answer tokens in real time via Server-Sent Events (SSE).
    """
    def post(self, request, session_id):
        question = request.data.get('question', '').strip()
        custom_api_key = request.data.get('api_key', '').strip() or None

        if not question:
            return Response({"error": "Question is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            session = ChatSession.objects.get(id=session_id)
        except ChatSession.DoesNotExist:
            return Response({"error": "Chat session not found."}, status=status.HTTP_404_NOT_FOUND)

        document = session.document
        if document.status != 'done':
            return Response(
                {"error": f"Document is not ready (Current status: {document.status})."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        if document.chunks.count() == 0:
            return Response(
                {"error": "No text chunks found for this document to answer questions."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        if not is_gemini_configured(custom_api_key):
            return Response({
                "error": "Google Gemini API Key is required to perform semantic search and generate answers.",
                "needs_api_key": True,
                "instruction": "Please set GEMINI_API_KEY in your .env file or provide 'api_key' in the request."
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            # 1. Fetch conversation history
            past_messages = list(session.messages.all().order_by('created_at'))
            chat_history = [
                {"role": m.role, "content": m.content} 
                for m in past_messages[-10:]
            ]

            # 2. Contextualize query
            search_query = contextualize_query(question, chat_history, custom_api_key)

            # 3. Vector Similarity Search via pgvector
            query_vector = generate_embedding(search_query, api_key=custom_api_key, is_query=True)
            top_k = 4
            matching_chunks = document.chunks.annotate(
                distance=CosineDistance('embedding', query_vector)
            ).order_by('distance')[:top_k]

            context_chunks = []
            sources = []
            for chunk in matching_chunks:
                context_chunks.append({
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_number,
                    "content": chunk.content
                })
                sources.append({
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_number,
                    "snippet": chunk.content[:160] + "..." if len(chunk.content) > 160 else chunk.content,
                    "similarity": round(float(1 - (chunk.distance if hasattr(chunk, 'distance') and chunk.distance is not None else 1)), 3)
                })

            # Save user message immediately in DB
            ChatMessage.objects.create(
                session=session,
                role='user',
                content=question
            )

            def event_stream():
                # Initial event sending metadata and sources
                start_payload = {
                    "type": "start",
                    "sources": sources,
                    "search_query": search_query
                }
                yield f"data: {json.dumps(start_payload)}\n\n"

                full_answer = []
                try:
                    for token in stream_answer_with_context(
                        question=question,
                        context_chunks=context_chunks,
                        chat_history=chat_history,
                        api_key=custom_api_key
                    ):
                        full_answer.append(token)
                        token_payload = {"type": "token", "token": token}
                        yield f"data: {json.dumps(token_payload)}\n\n"

                    final_text = "".join(full_answer)

                    # Persist assistant response in DB
                    ai_msg = ChatMessage.objects.create(
                        session=session,
                        role='assistant',
                        content=final_text,
                        sources=sources
                    )

                    # Update session title if default
                    if session.title in ['New Conversation', 'New Chat']:
                        summary_title = question[:40] + ('...' if len(question) > 40 else '')
                        session.title = summary_title
                        session.save(update_fields=['title', 'updated_at'])
                    else:
                        session.save(update_fields=['updated_at'])

                    done_payload = {
                        "type": "done",
                        "assistant_message_id": ai_msg.id,
                        "session_title": session.title
                    }
                    yield f"data: {json.dumps(done_payload)}\n\n"

                except Exception as e:
                    logger.exception("Error during streaming generation")
                    err_payload = {"type": "error", "error": str(e)}
                    yield f"data: {json.dumps(err_payload)}\n\n"

            response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
            response['Cache-Control'] = 'no-cache'
            response['X-Accel-Buffering'] = 'no'
            return response

        except Exception as e:
            logger.exception("Error initiating stream chat")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
