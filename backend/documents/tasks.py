import time
# pyrefly: ignore [missing-import]
from celery import shared_task
import logging
# pyrefly: ignore [missing-import]
import pdfplumber
from .models import Document, DocumentChunk
from .services.chunking import chunk_text_by_pages
from .services.gemini import is_gemini_configured, generate_embeddings_batch, EMBEDDING_DIMENSIONS

logger = logging.getLogger(__name__)

@shared_task
def ping_task():
    logger.info("ping_task started: sleeping for 2 seconds...")
    time.sleep(2)
    logger.info("ping_task finished: returning pong")
    return "pong"

@shared_task
def extract_text_task(document_id):
    logger.info(f"Starting text extraction and chunking for document ID {document_id}")
    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        logger.error(f"Document with ID {document_id} does not exist.")
        return f"Document {document_id} not found"

    document.status = 'processing'
    document.error_message = None
    document.save(update_fields=['status', 'error_message'])

    try:
        pages_data = []
        full_text = ""

        with pdfplumber.open(document.file.path) as pdf:
            total_pages = len(pdf.pages)
            for i, page in enumerate(pdf.pages):
                page_num = i + 1
                logger.info(f"Extracting text from page {page_num}/{total_pages} of doc {document_id}")
                text = page.extract_text() or ""
                if text.strip():
                    pages_data.append({'page_number': page_num, 'text': text})
                    full_text += f"--- Page {page_num} ---\n" + text + "\n\n"

        document.extracted_text = full_text
        document.save(update_fields=['extracted_text'])

        # 2. Chunk text
        chunks = chunk_text_by_pages(pages_data, chunk_size=600, chunk_overlap=100)
        logger.info(f"Generated {len(chunks)} chunks for document ID {document_id}")

        # Delete any previous chunks for this document
        DocumentChunk.objects.filter(document=document).delete()

        # 3. Generate embeddings
        if chunks:
            chunk_texts = [c['content'] for c in chunks]
            embeddings = None

            if is_gemini_configured():
                try:
                    logger.info(f"Generating Gemini embeddings for {len(chunks)} chunks...")
                    embeddings = generate_embeddings_batch(chunk_texts)
                except Exception as embed_err:
                    logger.warning(
                        f"Gemini embedding generation failed: {embed_err}. "
                        "Saving chunks with zero vectors as fallback."
                    )
            else:
                logger.info("Gemini API key not set. Storing chunks with placeholder vectors.")

            # Bulk create DocumentChunk records
            chunk_objects = []
            for idx, c in enumerate(chunks):
                vector = embeddings[idx] if embeddings and idx < len(embeddings) else [0.0] * EMBEDDING_DIMENSIONS
                chunk_objects.append(
                    DocumentChunk(
                        document=document,
                        chunk_index=c['chunk_index'],
                        page_number=c['page_number'],
                        content=c['content'],
                        embedding=vector
                    )
                )

            DocumentChunk.objects.bulk_create(chunk_objects)
            logger.info(f"Saved {len(chunk_objects)} DocumentChunk records to database.")

        document.status = 'done'
        document.save(update_fields=['status'])
        logger.info(f"Extraction and ingestion successfully completed for document ID {document_id}")
        return "success"

    except Exception as e:
        logger.exception(f"Text extraction and ingestion failed for document ID {document_id}")
        document.status = 'failed'
        document.error_message = str(e)
        document.save(update_fields=['status', 'error_message'])
        return "failed"

