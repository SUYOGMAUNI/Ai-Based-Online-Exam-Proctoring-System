"""
API Serializers for all models.
"""
from rest_framework import serializers
from django.contrib.auth import get_user_model
from apps.exams.models import Exam, Question
from apps.proctoring.models import ExamAttempt, Violation, ProctoringSession

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """User serializer"""

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'user_type',
                  'is_face_registered']
        read_only_fields = ['id']


class UserRegistrationSerializer(serializers.ModelSerializer):
    """User registration serializer"""
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'user_type', 'phone']

    def create(self, validated_data):
        user = User.objects.create_user(**validated_data)
        return user


class QuestionSerializer(serializers.ModelSerializer):
    """Question serializer (for students - no correct answer)"""

    class Meta:
        model = Question
        fields = ['id', 'question_number', 'question_type', 'question_text',
                  'option_a', 'option_b', 'option_c', 'option_d', 'marks']
        read_only_fields = ['id']


class QuestionDetailSerializer(serializers.ModelSerializer):
    """Question detail serializer with correct answer (for teachers)"""

    class Meta:
        model = Question
        fields = ['id', 'exam', 'question_number', 'question_type', 'question_text',
                  'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
                  'marks', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class ExamSerializer(serializers.ModelSerializer):
    """Exam serializer (list view)"""
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    total_questions = serializers.IntegerField(read_only=True)

    class Meta:
        model = Exam
        fields = ['id', 'title', 'description', 'created_by', 'created_by_name',
                  'duration_minutes', 'total_marks', 'passing_marks',
                  'start_time', 'end_time', 'status', 'total_questions',
                  'require_face_registration', 'require_gaze_calibration',
                  'enable_audio_monitoring', 'enable_tab_monitoring',
                  'enable_fullscreen_mode', 'trust_score_valid_threshold',
                  'trust_score_review_threshold', 'created_at']
        read_only_fields = ['id', 'created_by', 'created_at', 'total_questions']


class ExamDetailSerializer(serializers.ModelSerializer):
    """Exam detail with questions"""
    questions = QuestionSerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    total_questions = serializers.IntegerField(read_only=True)

    class Meta:
        model = Exam
        fields = ['id', 'title', 'description', 'created_by', 'created_by_name',
                  'duration_minutes', 'total_marks', 'passing_marks',
                  'start_time', 'end_time', 'status', 'total_questions',
                  'require_face_registration', 'require_gaze_calibration',
                  'enable_audio_monitoring', 'enable_tab_monitoring',
                  'enable_fullscreen_mode', 'trust_score_valid_threshold',
                  'trust_score_review_threshold', 'questions', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at', 'total_questions']


class ViolationSerializer(serializers.ModelSerializer):
    """Violation serializer"""
    violation_type_display = serializers.CharField(source='get_violation_type_display', read_only=True)
    severity_display = serializers.CharField(source='get_severity_display', read_only=True)

    class Meta:
        model = Violation
        fields = ['id', 'attempt', 'violation_type', 'violation_type_display',
                  'severity', 'severity_display', 'screenshot', 'audio_clip',
                  'metadata', 'timestamp']
        read_only_fields = ['id', 'timestamp']


class ExamAttemptSerializer(serializers.ModelSerializer):
    """Exam attempt serializer (list view)"""
    student_name = serializers.CharField(source='student.get_full_name', read_only=True)
    student_username = serializers.CharField(source='student.username', read_only=True)
    exam_title = serializers.CharField(source='exam.title', read_only=True)
    total_marks = serializers.IntegerField(source='exam.total_marks', read_only=True)
    violations_count = serializers.IntegerField(source='violations.count', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = ExamAttempt
        fields = ['id', 'exam', 'exam_title', 'total_marks', 'student', 'student_name', 'student_username',
                  'start_time', 'end_time', 'submitted_at', 'obtained_marks',
                  'trust_score', 'status', 'status_display', 'requires_manual_review',
                  'violations_count', 'reviewed_by', 'review_notes']
        read_only_fields = ['id', 'start_time', 'trust_score', 'violations_count']


class ExamAttemptDetailSerializer(serializers.ModelSerializer):
    """Exam attempt detail with violations and full data"""
    violations = ViolationSerializer(many=True, read_only=True)
    student = UserSerializer(read_only=True)
    exam = ExamSerializer(read_only=True)
    reviewed_by_name = serializers.CharField(source='reviewed_by.get_full_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = ExamAttempt
        fields = ['id', 'exam', 'student', 'start_time', 'end_time', 'submitted_at',
                  'obtained_marks', 'trust_score', 'status', 'status_display',
                  'requires_manual_review', 'reviewed_by', 'reviewed_by_name',
                  'review_notes', 'answers', 'violations', 'created_at', 'updated_at']
        read_only_fields = ['id', 'start_time', 'created_at', 'updated_at']


class ExamAttemptCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating exam attempts"""

    class Meta:
        model = ExamAttempt
        fields = ['exam']

    def validate_exam(self, value):
        """Validate exam is published and available"""
        if value.status != 'PUBLISHED':
            raise serializers.ValidationError("This exam is not available yet.")
        return value

    def create(self, validated_data):
        validated_data['student'] = self.context['request'].user
        return super().create(validated_data)


class ExamAttemptSubmitSerializer(serializers.Serializer):
    """Serializer for submitting exam answers"""
    answers = serializers.JSONField()

    def validate_answers(self, value):
        """Validate answers format"""
        if not isinstance(value, dict):
            raise serializers.ValidationError("Answers must be a dictionary")
        return value


class ProctoringSessionSerializer(serializers.ModelSerializer):
    """Proctoring session serializer"""

    class Meta:
        model = ProctoringSession
        fields = ['id', 'attempt', 'face_detected', 'face_confidence',
                  'gaze_on_screen', 'gaze_x', 'gaze_y', 'audio_level',
                  'speech_detected', 'tab_focused', 'fullscreen_active',
                  'snapshot', 'timestamp']
        read_only_fields = ['id', 'timestamp']


class ProctoringSessionCreateSerializer(serializers.Serializer):
    """Serializer for creating proctoring session logs"""
    attempt_id = serializers.IntegerField()
    face_detected = serializers.BooleanField(default=False)
    face_confidence = serializers.FloatField(default=0.0, min_value=0.0, max_value=1.0)
    gaze_on_screen = serializers.BooleanField(default=False)
    gaze_x = serializers.FloatField(required=False, allow_null=True)
    gaze_y = serializers.FloatField(required=False, allow_null=True)
    audio_level = serializers.FloatField(default=0.0, min_value=0.0)
    speech_detected = serializers.BooleanField(default=False)
    tab_focused = serializers.BooleanField(default=True)
    fullscreen_active = serializers.BooleanField(default=True)
    snapshot = serializers.ImageField(required=False, allow_null=True)


class FaceRegistrationSerializer(serializers.Serializer):
    """Serializer for face registration"""
    face_image = serializers.ImageField()

    def validate_face_image(self, value):
        """Validate face image"""
        # Check file size (max 5MB)
        if value.size > 5 * 1024 * 1024:
            raise serializers.ValidationError("Image file too large ( > 5MB )")

        # Check file type
        if not value.content_type.startswith('image/'):
            raise serializers.ValidationError("File is not an image")

        return value


class GazeCalibrationSerializer(serializers.Serializer):
    """Serializer for gaze calibration"""
    calibration_data = serializers.JSONField()

    def validate_calibration_data(self, value):
        """Validate calibration data structure"""
        if not isinstance(value, dict):
            raise serializers.ValidationError("Calibration data must be a dictionary")

        # You can add more specific validation here based on your calibration format
        required_keys = ['calibration_points', 'timestamp']
        for key in required_keys:
            if key not in value:
                raise serializers.ValidationError(f"Missing required key: {key}")

        return value


class ExamReviewSerializer(serializers.Serializer):
    """Serializer for reviewing exam attempts"""
    review_notes = serializers.CharField(required=False, allow_blank=True)
    approved = serializers.BooleanField(default=False)


class DashboardStatsSerializer(serializers.Serializer):
    """Serializer for dashboard statistics"""
    total_exams = serializers.IntegerField()
    draft_exams = serializers.IntegerField()
    published_exams = serializers.IntegerField()
    completed_exams = serializers.IntegerField()
    total_attempts = serializers.IntegerField()
    pending_reviews = serializers.IntegerField()