from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from .tasks import ping_task, extract_text_task
from .models import Document
import logging

logger = logging.getLogger(__name__)

class HealthCheckView(APIView):
    """
    Simple API endpoint to check if backend is running.
    """
    def get(self, request):
        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class CeleryHealthCheckView(APIView):
    """
    API endpoint to trigger a Celery task and verify the worker works.
    """
    def get(self, request):
        task = ping_task.delay()
        return Response({
            "status": "triggered",
            "task_id": task.id
        }, status=status.HTTP_202_ACCEPTED)


class DocumentUploadView(APIView):
    """
    Endpoint POST /api/documents/upload/ to upload a PDF file and initiate extraction.
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
            # Create Document record
            document = Document.objects.create(
                file=file_obj,
                original_filename=file_obj.name,
                status='pending'
            )
            
            # Trigger Celery text extraction task
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
                "error_message": document.error_message
            }, status=status.HTTP_200_OK)
        except Document.DoesNotExist:
            return Response(
                {"error": "Document not found."}, 
                status=status.HTTP_404_NOT_FOUND
            )


class DocumentDetailView(APIView):
    """
    Endpoint GET /api/documents/<id>/ to get full document details including text.
    """
    def get(self, request, id, *args, **kwargs):
        try:
            document = Document.objects.get(id=id)
            return Response({
                "id": document.id,
                "status": document.status,
                "original_filename": document.original_filename,
                "extracted_text": document.extracted_text,
                "error_message": document.error_message,
                "uploaded_at": document.uploaded_at
            }, status=status.HTTP_200_OK)
        except Document.DoesNotExist:
            return Response(
                {"error": "Document not found."}, 
                status=status.HTTP_404_NOT_FOUND
            )
