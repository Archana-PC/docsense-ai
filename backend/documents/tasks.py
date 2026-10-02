import time
# pyrefly: ignore [missing-import]
from celery import shared_task
import logging
# pyrefly: ignore [missing-import]
import pdfplumber
from .models import Document

logger = logging.getLogger(__name__)

@shared_task
def ping_task():
    logger.info("ping_task started: sleeping for 2 seconds...")
    time.sleep(2)
    logger.info("ping_task finished: returning pong")
    return "pong"

@shared_task
def extract_text_task(document_id):
    logger.info(f"Starting text extraction task for document ID {document_id}")
    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        logger.error(f"Document with ID {document_id} does not exist.")
        return f"Document {document_id} not found"

    document.status = 'processing'
    document.save(update_fields=['status'])

    try:
        extracted_text = ""
        with pdfplumber.open(document.file.path) as pdf:
            for i, page in enumerate(pdf.pages):
                logger.info(f"Extracting text from page {i+1}/{len(pdf.pages)} of document {document_id}")
                text = page.extract_text()
                if text:
                    extracted_text += text + "\n"
        
        document.extracted_text = extracted_text
        document.status = 'done'
        document.save(update_fields=['extracted_text', 'status'])
        logger.info(f"Text extraction succeeded for document ID {document_id}")
        return "success"
    except Exception as e:
        logger.exception(f"Text extraction failed for document ID {document_id}")
        document.status = 'failed'
        document.error_message = str(e)
        document.save(update_fields=['status', 'error_message'])
        return "failed"

