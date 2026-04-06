"""
Admin configuration for exams app.
"""
from django.contrib import admin
from .models import Exam, Question


class QuestionInline(admin.TabularInline):
    """Inline admin for questions"""
    model = Question
    extra = 1
    fields = ['question_number', 'question_type', 'question_text', 'correct_answer', 'marks']


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    """Exam admin"""
    list_display = ['title', 'created_by', 'status', 'start_time', 'duration_minutes', 'total_questions', 'created_at']
    list_filter = ['status', 'created_at', 'start_time']
    search_fields = ['title', 'description']
    inlines = [QuestionInline]

    fieldsets = (
        ('Basic Info', {
            'fields': ('title', 'description', 'created_by', 'status')
        }),
        ('Exam Settings', {
            'fields': ('duration_minutes', 'total_marks', 'passing_marks')
        }),
        ('Schedule', {
            'fields': ('start_time', 'end_time')
        }),
        ('Proctoring Settings', {
            'fields': (
                'require_face_registration',
                'require_gaze_calibration',
                'enable_audio_monitoring',
                'enable_tab_monitoring',
                'enable_fullscreen_mode',
                'trust_score_valid_threshold',
                'trust_score_review_threshold',
            )
        }),
    )


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    """Question admin"""
    list_display = ['question_number', 'exam', 'question_type', 'marks']
    list_filter = ['question_type', 'exam']
    search_fields = ['question_text']