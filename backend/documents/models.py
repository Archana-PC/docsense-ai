# pyrefly: ignore [missing-import]
from django.db import models
# pyrefly: ignore [missing-import]
from pgvector.django import VectorField

class Document(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('done', 'Done'),
        ('failed', 'Failed'),
    ]

    file = models.FileField(upload_to='documents/')
    original_filename = models.CharField(max_length=255)
    status = models.CharField(
        max_length=20, 
        choices=STATUS_CHOICES, 
        default='pending'
    )
    extracted_text = models.TextField(blank=True, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    error_message = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"{self.original_filename} ({self.status})"


class DocumentChunk(models.Model):
    document = models.ForeignKey(
        Document, 
        on_delete=models.CASCADE, 
        related_name='chunks'
    )
    chunk_index = models.PositiveIntegerField()
    page_number = models.PositiveIntegerField(null=True, blank=True)
    content = models.TextField()
    # 768 dimensions for Google Gemini text-embedding-004
    embedding = VectorField(dimensions=768)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['chunk_index']

    def __str__(self):
        return f"Chunk {self.chunk_index} of {self.document.original_filename} (p. {self.page_number})"


class ChatSession(models.Model):
    document = models.ForeignKey(
        Document, 
        on_delete=models.CASCADE, 
        related_name='chat_sessions'
    )
    title = models.CharField(max_length=255, default='New Conversation')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"Session: {self.title} ({self.document.original_filename})"


class ChatMessage(models.Model):
    ROLE_CHOICES = [
        ('user', 'User'),
        ('assistant', 'Assistant'),
    ]

    session = models.ForeignKey(
        ChatSession, 
        on_delete=models.CASCADE, 
        related_name='messages'
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    sources = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.role}: {self.content[:40]}"
