"""
Proctoring models for tracking exam attempts and violations.
"""
from django.db import models
from django.conf import settings
from apps.exams.models import Exam


class ExamAttempt(models.Model):
    """Tracks student exam attempts"""

    STATUS_CHOICES = (
        ('IN_PROGRESS', 'In Progress'),
        ('SUBMITTED', 'Submitted'),
        ('AUTO_SUBMITTED', 'Auto Submitted'),
        ('FLAGGED', 'Flagged for Review'),
    )

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='attempts')
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='exam_attempts')

    # Attempt details
    start_time = models.DateTimeField(auto_now_add=True)
    end_time = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    # Scores
    obtained_marks = models.IntegerField(default=0)
    trust_score = models.FloatField(default=100.0, help_text="AI-calculated trust score (0-100)")

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='IN_PROGRESS')
    requires_manual_review = models.BooleanField(default=False)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_attempts'
    )
    review_notes = models.TextField(blank=True)

    # Answers
    answers = models.JSONField(default=dict, help_text="Student's answers")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'exam_attempts'
        unique_together = ['exam', 'student']
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.student.username} - {self.exam.title} ({self.get_status_display()})"


class Violation(models.Model):
    """Tracks proctoring violations during exams"""

    VIOLATION_TYPES = (
        # AI-Generated Violations (from face detection, gaze tracking, audio)
        ('FACE_NOT_DETECTED', 'Face Not Detected'),
        ('MULTIPLE_FACES', 'Multiple Faces Detected'),
        ('FACE_MISMATCH', 'Face Mismatch'),
        ('GAZE_DEVIATION', 'Gaze Deviation'),
        ('TAB_SWITCH', 'Tab Switched'),
        ('FULLSCREEN_EXIT', 'Exited Fullscreen'),
        ('AUDIO_DETECTED', 'Suspicious Audio'),
        ('NO_FACE_LONG', 'No Face for Extended Period'),

        # Frontend-Generated Violations (from DevTools blocker)
        ('RIGHT_CLICK_BLOCKED', 'Right Click Blocked'),
        ('F12_BLOCKED', 'F12 Key Blocked'),
        ('INSPECT_BLOCKED', 'Inspect Element Blocked'),
        ('CONSOLE_BLOCKED', 'Console Blocked'),
        ('ELEMENT_PICKER_BLOCKED', 'Element Picker Blocked'),
        ('VIEW_SOURCE_BLOCKED', 'View Source Blocked'),
        ('SAVE_PAGE_BLOCKED', 'Save Page Blocked'),
        ('PRINT_BLOCKED', 'Print Blocked'),
        ('SCREENSHOT_ATTEMPT', 'Screenshot Attempt'),
        ('DEVTOOLS_OPEN', 'DevTools Opened'),
        ('COPY_BLOCKED', 'Copy Blocked'),
        ('WINDOW_BLUR', 'Window Lost Focus'),
    )

    SEVERITY_LEVELS = (
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
        ('CRITICAL', 'Critical'),
    )

    attempt = models.ForeignKey(ExamAttempt, on_delete=models.CASCADE, related_name='violations')
    violation_type = models.CharField(max_length=50, choices=VIOLATION_TYPES)
    severity = models.CharField(max_length=10, choices=SEVERITY_LEVELS, default='MEDIUM')

    # Evidence
    screenshot = models.ImageField(upload_to='violations/screenshots/', null=True, blank=True)
    audio_clip = models.FileField(upload_to='violations/audio/', null=True, blank=True)
    metadata = models.JSONField(default=dict, help_text="Additional violation data")

    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'violations'
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.get_violation_type_display()} - {self.attempt.student.username} ({self.timestamp})"


class ProctoringSession(models.Model):
    """Real-time proctoring session data"""

    attempt = models.ForeignKey(ExamAttempt, on_delete=models.CASCADE, related_name='sessions')

    # Face detection
    face_detected = models.BooleanField(default=False)
    face_confidence = models.FloatField(default=0.0)

    # Gaze tracking
    gaze_on_screen = models.BooleanField(default=False)
    gaze_x = models.FloatField(null=True, blank=True)
    gaze_y = models.FloatField(null=True, blank=True)

    # Audio
    audio_level = models.FloatField(default=0.0)
    speech_detected = models.BooleanField(default=False)

    # Tab/Window
    tab_focused = models.BooleanField(default=True)
    fullscreen_active = models.BooleanField(default=True)

    # Snapshot
    snapshot = models.ImageField(upload_to='proctoring/snapshots/', null=True, blank=True)

    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'proctoring_sessions'
        ordering = ['-timestamp']

    def __str__(self):
        return f"Session - {self.attempt.student.username} at {self.timestamp}"