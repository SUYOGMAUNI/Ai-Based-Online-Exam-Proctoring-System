"""
Admin configuration for proctoring app.
"""
from django.contrib import admin
from .models import ExamAttempt, Violation, ProctoringSession

@admin.register(ExamAttempt)
class ExamAttemptAdmin(admin.ModelAdmin):
    """Exam Attempt admin"""
    list_display = ['student', 'exam', 'status', 'trust_score', 'obtained_marks', 'start_time', 'requires_manual_review']
    list_filter = ['status', 'requires_manual_review', 'exam']
    search_fields = ['student__username', 'exam__title']
    readonly_fields = ['start_time', 'created_at', 'updated_at']

@admin.register(Violation)
class ViolationAdmin(admin.ModelAdmin):
    """Violation admin"""
    list_display = ['attempt', 'violation_type', 'severity', 'timestamp']
    list_filter = ['violation_type', 'severity', 'timestamp']
    search_fields = ['attempt__student__username', 'attempt__exam__title']
    readonly_fields = ['timestamp']

@admin.register(ProctoringSession)
class ProctoringSessionAdmin(admin.ModelAdmin):
    """Proctoring Session admin"""
    list_display = ['attempt', 'face_detected', 'gaze_on_screen', 'tab_focused', 'fullscreen_active', 'timestamp']
    list_filter = ['face_detected', 'gaze_on_screen', 'tab_focused', 'fullscreen_active']
    readonly_fields = ['timestamp']