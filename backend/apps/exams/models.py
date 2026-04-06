"""
Exam models for the proctoring system.
"""
from django.db import models
from django.conf import settings


class Exam(models.Model):
    """Exam model"""

    STATUS_CHOICES = (
        ('DRAFT', 'Draft'),
        ('PUBLISHED', 'Published'),
        ('ONGOING', 'Ongoing'),
        ('COMPLETED', 'Completed'),
    )

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='created_exams')

    # Exam settings
    duration_minutes = models.IntegerField(help_text="Duration in minutes")
    total_marks = models.IntegerField(default=100)
    passing_marks = models.IntegerField(default=40)

    # Schedule
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()

    # Proctoring settings
    require_face_registration = models.BooleanField(default=True)
    require_gaze_calibration = models.BooleanField(default=True)
    enable_audio_monitoring = models.BooleanField(default=True)
    enable_tab_monitoring = models.BooleanField(default=True)
    enable_fullscreen_mode = models.BooleanField(default=True)

    # Trust score thresholds
    trust_score_valid_threshold = models.IntegerField(default=75, help_text="Minimum score for auto-approval")
    trust_score_review_threshold = models.IntegerField(default=50, help_text="Minimum score to allow review")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'exams'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"

    @property
    def total_questions(self):
        return self.questions.count()


class Question(models.Model):
    """Question model"""

    QUESTION_TYPES = (
        ('MCQ', 'Multiple Choice'),
        ('TRUE_FALSE', 'True/False'),
        ('SHORT_ANSWER', 'Short Answer'),
    )

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='questions')
    question_number = models.IntegerField()
    question_type = models.CharField(max_length=20, choices=QUESTION_TYPES, default='MCQ')
    question_text = models.TextField()

    # MCQ options
    option_a = models.CharField(max_length=500, blank=True)
    option_b = models.CharField(max_length=500, blank=True)
    option_c = models.CharField(max_length=500, blank=True)
    option_d = models.CharField(max_length=500, blank=True)

    correct_answer = models.CharField(max_length=500)
    marks = models.IntegerField(default=1)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'questions'
        ordering = ['question_number']
        unique_together = ['exam', 'question_number']

    def __str__(self):
        return f"Q{self.question_number}: {self.question_text[:50]}"