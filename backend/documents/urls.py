from django.urls import path
from .views import (
    HealthCheckView, 
    CeleryHealthCheckView,
    ConfigStatusView,
    DocumentListView,
    DocumentUploadView,
    DocumentStatusView,
    DocumentDetailView,
    DocumentChunksView,
    DocumentChatView,
    ChatSessionListCreateView,
    ChatSessionDetailView,
    SessionChatView,
    SessionStreamChatView,
)

urlpatterns = [
    path('health/', HealthCheckView.as_view(), name='health_check'),
    path('health/celery/', CeleryHealthCheckView.as_view(), name='celery_health_check'),
    path('config/status/', ConfigStatusView.as_view(), name='config_status'),
    path('documents/', DocumentListView.as_view(), name='document_list'),
    path('documents/upload/', DocumentUploadView.as_view(), name='document_upload'),
    path('documents/<int:id>/status/', DocumentStatusView.as_view(), name='document_status'),
    path('documents/<int:id>/', DocumentDetailView.as_view(), name='document_detail'),
    path('documents/<int:id>/chunks/', DocumentChunksView.as_view(), name='document_chunks'),
    path('documents/<int:id>/chat/', DocumentChatView.as_view(), name='document_chat'),
    path('documents/<int:id>/sessions/', ChatSessionListCreateView.as_view(), name='document_sessions'),
    path('sessions/<int:session_id>/', ChatSessionDetailView.as_view(), name='session_detail'),
    path('sessions/<int:session_id>/chat/', SessionChatView.as_view(), name='session_chat'),
    path('sessions/<int:session_id>/stream_chat/', SessionStreamChatView.as_view(), name='session_stream_chat'),
]
