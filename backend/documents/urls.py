# pyrefly: ignore [missing-import]
from django.urls import path
from .views import (
    HealthCheckView, 
    CeleryHealthCheckView,
    DocumentUploadView,
    DocumentStatusView,
    DocumentDetailView
)

urlpatterns = [
    path('health/', HealthCheckView.as_view(), name='health_check'),
    path('health/celery/', CeleryHealthCheckView.as_view(), name='celery_health_check'),
    path('documents/upload/', DocumentUploadView.as_view(), name='document_upload'),
    path('documents/<int:id>/status/', DocumentStatusView.as_view(), name='document_status'),
    path('documents/<int:id>/', DocumentDetailView.as_view(), name='document_detail'),
]
