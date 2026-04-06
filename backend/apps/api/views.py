import torch
import base64
import cv2
import numpy as np
from ai_engine.proctoring_pipeline import analyze_proctoring_frame, cleanup_pipeline, warmup_pipeline
from ai_engine.audio import detect_speech_simple
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.authtoken.models import Token
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth import authenticate, get_user_model
from django.utils import timezone
from django.db.models import Q
from django.conf import settings
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
import os
from datetime import datetime
import logging
from apps.exams.models import Exam, Question
from apps.proctoring.models import ExamAttempt, Violation, ProctoringSession
from .serializers import (
    UserSerializer, UserRegistrationSerializer,
    ExamSerializer, ExamDetailSerializer,
    QuestionSerializer, QuestionDetailSerializer,
    ExamAttemptSerializer, ExamAttemptDetailSerializer,
    ViolationSerializer, ProctoringSessionSerializer,
    FaceRegistrationSerializer
)

User = get_user_model()

logger = logging.getLogger(__name__)

def count_violations(attempt, violation_type):
    """Count violations of a specific type for an attempt"""
    return attempt.violations.filter(violation_type=violation_type).count()


def calculate_weighted_trust_score(attempt):

    violations = {
        'face_mismatch': count_violations(attempt, 'FACE_MISMATCH'),
        'multi_person': count_violations(attempt, 'MULTIPLE_FACES'),
        'gaze_violation': count_violations(attempt, 'GAZE_DEVIATION'),
        'audio_violation': count_violations(attempt, 'AUDIO_DETECTED'),
        'tab_switch': count_violations(attempt, 'TAB_SWITCH'),
        'fullscreen_exit': count_violations(attempt, 'FULLSCREEN_EXIT'),
        'no_face': count_violations(attempt, 'FACE_NOT_DETECTED'),

        'devtools_violations': (
                count_violations(attempt, 'RIGHT_CLICK_BLOCKED') +
                count_violations(attempt, 'F12_BLOCKED') +
                count_violations(attempt, 'INSPECT_BLOCKED') +
                count_violations(attempt, 'CONSOLE_BLOCKED') +
                count_violations(attempt, 'ELEMENT_PICKER_BLOCKED') +
                count_violations(attempt, 'VIEW_SOURCE_BLOCKED') +
                count_violations(attempt, 'SAVE_PAGE_BLOCKED') +
                count_violations(attempt, 'PRINT_BLOCKED') +
                count_violations(attempt, 'DEVTOOLS_OPEN')
        ),
        'screenshot_attempt': count_violations(attempt, 'SCREENSHOT_ATTEMPT'),
        'copy_blocked': count_violations(attempt, 'COPY_BLOCKED'),
        'window_blur': count_violations(attempt, 'WINDOW_BLUR'),
    }

    WEIGHTS = {
        'face_mismatch': 15,
        'multi_person': 20,
        'gaze_violation': 3,
        'audio_violation': 8,
        'tab_switch': 2,
        'fullscreen_exit': 2,
        'no_face': 5,
        'devtools_violations': 10,
        'screenshot_attempt': 15,
        'copy_blocked': 2,
        'window_blur': 1,
    }

    score = 100.0
    deductions = {}

    for violation_type, count in violations.items():
        deduction = count * WEIGHTS[violation_type]
        deductions[violation_type] = deduction
        score -= deduction

    final_score = max(0.0, min(100.0, score))

    return {
        'trust_score': final_score,
        'violations': violations,
        'deductions': deductions,
        'total_deduction': 100 - final_score
    }


def save_violation_frame(frame_base64, attempt_id, violation_type):

    try:
        violation_dirs = {
            'FACE_MISMATCH': settings.FACE_MISMATCH_DIR,
            'FACE_NOT_DETECTED': settings.FACE_MISMATCH_DIR,
            'MULTIPLE_FACES': settings.MULTI_PERSON_DIR,
            'GAZE_DEVIATION': settings.GAZE_CAPTURES_DIR,
        }

        base_dir = violation_dirs.get(violation_type, os.path.join(settings.MEDIA_ROOT, 'violation_frames'))

        save_dir = os.path.join(base_dir, f'attempt_{attempt_id}')
        os.makedirs(save_dir, exist_ok=True)

        # Decode base64 image
        if ',' in frame_base64:
            frame_base64 = frame_base64.split(',')[1]

        image_data = base64.b64decode(frame_base64)
        nparr = np.frombuffer(image_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            logger.error(f"Failed to decode frame for {violation_type}")
            return None

        # Generate filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'{timestamp}_{violation_type}.jpg'
        filepath = os.path.join(save_dir, filename)

        # Save the frame
        cv2.imwrite(filepath, frame)

        logger.info(f'[SAVE] {violation_type} frame saved: {filepath}')

        # Also log to file
        log_violation_save(attempt_id, violation_type, filepath)

        return filepath

    except Exception as e:
        logger.error(f'[ERROR] Failed to save {violation_type} frame: {str(e)}')
        return None


def save_audio_violation(audio_base64, attempt_id):

    try:
        import wave

        # Create directory for this attempt
        save_dir = os.path.join(
            settings.AUDIO_CAPTURES_DIR,
            f'attempt_{attempt_id}'
        )
        os.makedirs(save_dir, exist_ok=True)

        # Decode base64 audio
        if ',' in audio_base64:
            audio_base64 = audio_base64.split(',')[1]

        audio_bytes = base64.b64decode(audio_base64)

        # Generate filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'{timestamp}_audio_violation.wav'
        filepath = os.path.join(save_dir, filename)

        # Save as WAV file
        with open(filepath, 'wb') as f:
            f.write(audio_bytes)

        logger.info(f'[SAVE] Audio violation saved: {filepath}')

        # Also log to file
        log_violation_save(attempt_id, 'AUDIO_DETECTED', filepath)

        return filepath

    except Exception as e:
        logger.error(f'[ERROR] Failed to save audio violation: {str(e)}')
        return None


def log_violation_save(attempt_id, violation_type, filepath):

    try:
        log_dir = os.path.join(settings.LOGS_DIR, f'attempt_{attempt_id}')
        os.makedirs(log_dir, exist_ok=True)

        log_file = os.path.join(log_dir, 'violations.log')

        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f'[{timestamp}] {violation_type} | Saved: {filepath}\n'

        with open(log_file, 'a') as f:
            f.write(log_entry)

    except Exception as e:
        logger.error(f'[ERROR] Failed to log violation: {str(e)}')

# Authentication Views

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def register_user(request):
    """Register a new user"""
    serializer = UserRegistrationSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response({
            'user': UserSerializer(user).data,
            'token': token.key
        }, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def register_face(request):

    user = request.user

    # Check if user is a student
    if user.user_type != 'STUDENT':
        return Response(
            {'error': 'Only students can register faces'},
            status=status.HTTP_403_FORBIDDEN
        )

    # Use serializer for validation
    serializer = FaceRegistrationSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    face_image = serializer.validated_data['face_image']

    try:
        # Create directory for user's face images
        user_face_dir = os.path.join('face_registrations', f'user_{user.id}')
        full_path = os.path.join(settings.MEDIA_ROOT, user_face_dir)
        os.makedirs(full_path, exist_ok=True)

        # Clear old images if re-registering
        if os.path.exists(full_path):
            for old_file in os.listdir(full_path):
                old_file_path = os.path.join(full_path, old_file)
                if os.path.isfile(old_file_path):
                    os.remove(old_file_path)

        # Save new image with user ID and timestamp for uniqueness
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'face_{user.id}_{timestamp}.jpg'
        filepath = os.path.join(user_face_dir, filename)

        # Save file
        path = default_storage.save(filepath, ContentFile(face_image.read()))

        # Update user model - use is_face_registered field
        user.is_face_registered = True
        user.save()

        return Response({
            'success': True,
            'message': 'Face registered successfully',
            'filename': filename,
            'path': path
        }, status=status.HTTP_200_OK)

    except Exception as e:
        print(f"Face registration error: {str(e)}")
        return Response(
            {'error': f'Failed to save face image: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def check_face_registration(request):
    user = request.user
    return Response({
        'is_registered': user.is_face_registered,
        'user_id': user.id,
        'username': user.username
    })

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login_user(request):
    """Login user and return token"""
    username = request.data.get('username')
    password = request.data.get('password')

    user = authenticate(username=username, password=password)

    if user:
        token, _ = Token.objects.get_or_create(user=user)
        return Response({
            'user': UserSerializer(user).data,
            'token': token.key
        })

    return Response(
        {'error': 'Invalid credentials'},
        status=status.HTTP_401_UNAUTHORIZED
    )


@api_view(['POST'])
def logout_user(request):
    """Logout user by deleting token"""
    request.user.auth_token.delete()
    return Response({'message': 'Successfully logged out'})


@api_view(['GET'])
def current_user(request):
    """Get current user details"""
    serializer = UserSerializer(request.user)
    return Response(serializer.data)

# User Views

class UserViewSet(viewsets.ModelViewSet):
    """ViewSet for users"""
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """Filter based on user type"""
        user = self.request.user
        if user.is_teacher or user.is_admin_user:
            return User.objects.all()
        return User.objects.filter(id=user.id)

    @action(detail=False, methods=['post'])
    def register_face(self, request):
        user = request.user
        face_image = request.FILES.get('face_image')

        if not face_image:
            return Response(
                {'error': 'Face image is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # TODO: Process face image and store encoding
        user.face_image = face_image
        user.face_registered = True
        user.save()

        return Response({
            'message': 'Face registered successfully',
            'user': UserSerializer(user).data
        })

    @action(detail=False, methods=['post'])
    def calibrate_gaze(self, request):
        """Calibrate gaze tracking for user"""
        user = request.user
        calibration_data = request.data.get('calibration_data')

        if not calibration_data:
            return Response(
                {'error': 'Calibration data is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user.gaze_calibration_data = calibration_data
        user.gaze_calibrated = True
        user.save()

        return Response({
            'message': 'Gaze calibrated successfully',
            'user': UserSerializer(user).data
        })

# Exam Views

class ExamViewSet(viewsets.ModelViewSet):
    """ViewSet for exams"""
    queryset = Exam.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ExamDetailSerializer
        return ExamSerializer

    def get_queryset(self):
        """Filter exams based on user type, auto-expiring and auto-republishing as needed."""
        user = self.request.user
        now = timezone.now()

        if user.is_teacher or user.is_admin_user:

            # 1. PUBLISHED → COMPLETED when end_time has passed
            overdue_ids = list(
                Exam.objects.filter(created_by=user, status='PUBLISHED', end_time__lt=now)
                            .values_list('id', flat=True)
            )
            if overdue_ids:
                Exam.objects.filter(id__in=overdue_ids).update(status='COMPLETED')
                ExamAttempt.objects.filter(
                    exam_id__in=overdue_ids, status='IN_PROGRESS'
                ).update(status='SUBMITTED', submitted_at=now)

            # 2. COMPLETED → PUBLISHED when end_time extended into the future
            #    Fresh query — not reusing any cached queryset from step 1
            reactivate_ids = list(
                Exam.objects.filter(created_by=user, status='COMPLETED', end_time__gt=now)
                            .values_list('id', flat=True)
            )
            if reactivate_ids:
                Exam.objects.filter(id__in=reactivate_ids).update(status='PUBLISHED')

            return Exam.objects.filter(created_by=user)

        # Students see only published exams that haven't expired yet
        return Exam.objects.filter(status='PUBLISHED', end_time__gt=now)

    def perform_create(self, serializer):
        """Set created_by to current user"""
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):

        instance = serializer.save()
        now = timezone.now()
        end = instance.end_time

        if end and instance.status != 'DRAFT':
            correct_status = 'PUBLISHED' if end > now else 'COMPLETED'
            if instance.status != correct_status:
                instance.status = correct_status
                instance.save(update_fields=['status'])
        elif not end and instance.status == 'COMPLETED':
            # No end_time set — treat as published if teacher saved it
            instance.status = 'PUBLISHED'
            instance.save(update_fields=['status'])

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """Publish an exam"""
        exam = self.get_object()

        if not request.user.is_teacher:
            return Response(
                {'error': 'Only teachers can publish exams'},
                status=status.HTTP_403_FORBIDDEN
            )

        exam.status = 'PUBLISHED'
        exam.save()

        return Response({
            'message': 'Exam published successfully',
            'exam': ExamSerializer(exam).data
        })

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        """Get exam results (for teachers)"""
        exam = self.get_object()

        if not request.user.is_teacher:
            return Response(
                {'error': 'Only teachers can view results'},
                status=status.HTTP_403_FORBIDDEN
            )

        attempts = ExamAttempt.objects.filter(exam=exam).select_related('student')
        serializer = ExamAttemptSerializer(attempts, many=True)

        return Response(serializer.data)

# Question Views

class QuestionViewSet(viewsets.ModelViewSet):
    """ViewSet for questions"""
    queryset = Question.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.user.is_teacher:
            return QuestionDetailSerializer
        return QuestionSerializer

    def get_queryset(self):
        """Filter questions by exam"""
        exam_id = self.request.query_params.get('exam_id')
        if exam_id:
            return Question.objects.filter(exam_id=exam_id)
        return Question.objects.all()

# Exam Attempt Views

class ExamAttemptViewSet(viewsets.ModelViewSet):
    """ViewSet for exam attempts"""
    queryset = ExamAttempt.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ExamAttemptDetailSerializer
        return ExamAttemptSerializer

    def get_queryset(self):
        """Filter attempts based on user"""
        user = self.request.user

        if user.is_teacher or user.is_admin_user:
            # Teachers see all attempts for their exams
            return ExamAttempt.objects.filter(exam__created_by=user)

        # Students see only their attempts
        return ExamAttempt.objects.filter(student=user)

    @action(detail=False, methods=['post'])
    def start_exam(self, request):
        """Start a new exam attempt"""
        exam_id = request.data.get('exam_id')

        try:
            exam = Exam.objects.get(id=exam_id)
        except Exam.DoesNotExist:
            return Response(
                {'error': 'Exam not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if exam is published
        if exam.status != 'PUBLISHED':
            return Response(
                {'error': 'Exam is not available'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if student already has an attempt
        existing_attempt = ExamAttempt.objects.filter(
            exam=exam,
            student=request.user
        ).first()

        if existing_attempt:
            return Response(
                {'error': 'You have already attempted this exam'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check face registration if required
        if exam.require_face_registration and not request.user.is_face_registered:
            return Response(
                {'error': 'Face registration required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        attempt = ExamAttempt.objects.create(
            exam=exam,
            student=request.user
        )

        try:
            warmup_pipeline(attempt.id, request.user.id)
            logger.info(f"[WARMUP] Pipeline warmed up for attempt {attempt.id}")
        except Exception as warmup_error:
            logger.warning(f"[WARMUP] Non-fatal: {warmup_error}")

        return Response(
            ExamAttemptSerializer(attempt).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['post'])
    def submit_exam(self, request, pk=None):
        """Submit exam answers"""
        attempt = self.get_object()

        if attempt.student != request.user:
            return Response(
                {'error': 'You can only submit your own exam'},
                status=status.HTTP_403_FORBIDDEN
            )

        if attempt.status != 'IN_PROGRESS':
            return Response(
                {'error': 'Exam already submitted'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get answers
        answers = request.data.get('answers', {})

        # Calculate marks
        total_marks = 0
        questions = Question.objects.filter(exam=attempt.exam)

        for question in questions:
            student_answer = answers.get(str(question.id))
            if student_answer and student_answer == question.correct_answer:
                total_marks += question.marks

        # Update attempt
        attempt.answers = answers
        attempt.obtained_marks = total_marks
        attempt.end_time = timezone.now()
        attempt.submitted_at = timezone.now()
        attempt.status = 'SUBMITTED'

        if attempt.trust_score >= 75:
            attempt.status = 'APPROVED'
            attempt.requires_manual_review = False
        elif attempt.trust_score < 20:
            attempt.status = 'DISQUALIFIED'
            attempt.requires_manual_review = False
        else:
            attempt.status = 'FLAGGED'
            attempt.requires_manual_review = True

        attempt.save()

        # Clean up proctoring pipeline to free GPU memory
        try:
            cleanup_pipeline(attempt.id)
            logger.info(f"[CLEANUP] Freed pipeline resources for attempt {attempt.id}")
        except Exception as cleanup_error:
            logger.error(f"[CLEANUP] Failed to cleanup pipeline: {cleanup_error}")

        return Response(ExamAttemptSerializer(attempt).data)

    @action(detail=True, methods=['post'])
    def review_attempt(self, request, pk=None):
        """Teacher reviews a flagged attempt"""
        attempt = self.get_object()

        if not request.user.is_teacher:
            return Response(
                {'error': 'Only teachers can review attempts'},
                status=status.HTTP_403_FORBIDDEN
            )

        review_notes = request.data.get('review_notes', '')
        approved = request.data.get('approved', False)

        attempt.reviewed_by = request.user
        attempt.review_notes = review_notes

        if approved:
            attempt.status = 'SUBMITTED'
            attempt.requires_manual_review = False

        attempt.save()

        return Response(ExamAttemptSerializer(attempt).data)

    @action(detail=True, methods=['get'])
    def trust_score_breakdown(self, request, pk=None):
        """Get detailed breakdown of trust score calculation"""
        attempt = self.get_object()

        # Check permissions - student can view their own, teachers can view all
        if not (request.user == attempt.student or
                request.user.is_teacher or
                request.user.is_admin_user):
            return Response(
                {'error': 'You do not have permission to view this'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Get the detailed breakdown
        score_data = calculate_weighted_trust_score(attempt)

        # Violation descriptions
        violation_descriptions = {
            'face_mismatch': 'Face does not match registered face',
            'multi_person': 'Multiple people detected',
            'gaze_violation': 'Looking away from screen',
            'audio_violation': 'Suspicious audio detected',
            'tab_switch': 'Switched browser tabs',
            'fullscreen_exit': 'Exited fullscreen mode',
            'no_face': 'Face not detected',
            'devtools_violations': 'Developer tools / inspect attempts',
            'screenshot_attempt': 'Screenshot attempts',
            'copy_blocked': 'Copy/paste attempts',
            'window_blur': 'Window lost focus',
        }

        # Add additional context
        breakdown = {
            'trust_score': score_data['trust_score'],
            'starting_score': 100.0,
            'total_violations': sum(score_data['violations'].values()),
            'total_deduction': score_data['total_deduction'],
            'violation_details': [],
            'status': attempt.status,
            'requires_manual_review': attempt.requires_manual_review,
            'exam_title': attempt.exam.title,
            'student_name': f"{attempt.student.first_name} {attempt.student.last_name}",
        }

        for violation_type, count in score_data['violations'].items():
            if count > 0:  # Only show violations that occurred
                breakdown['violation_details'].append({
                    'type': violation_type,
                    'description': violation_descriptions.get(violation_type, 'Unknown violation'),
                    'count': count,
                    'deduction': score_data['deductions'][violation_type],
                })

        return Response(breakdown)

# Proctoring Views

class ViolationViewSet(viewsets.ModelViewSet):
    """ViewSet for violations"""
    queryset = Violation.objects.all()
    serializer_class = ViolationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """Filter violations by attempt"""
        attempt_id = self.request.query_params.get('attempt_id')
        if attempt_id:
            return Violation.objects.filter(attempt_id=attempt_id)
        return Violation.objects.all()


class ProctoringSessionViewSet(viewsets.ModelViewSet):
    """ViewSet for proctoring sessions"""
    queryset = ProctoringSession.objects.all()
    serializer_class = ProctoringSessionSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['post'])
    def log_session(self, request):
        """Log a proctoring session snapshot"""
        attempt_id = request.data.get('attempt_id')

        try:
            attempt = ExamAttempt.objects.get(id=attempt_id)
        except ExamAttempt.DoesNotExist:
            return Response(
                {'error': 'Exam attempt not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Create session log
        session = ProctoringSession.objects.create(
            attempt=attempt,
            face_detected=request.data.get('face_detected', False),
            face_confidence=request.data.get('face_confidence', 0.0),
            gaze_on_screen=request.data.get('gaze_on_screen', False),
            gaze_x=request.data.get('gaze_x'),
            gaze_y=request.data.get('gaze_y'),
            audio_level=request.data.get('audio_level', 0.0),
            speech_detected=request.data.get('speech_detected', False),
            tab_focused=request.data.get('tab_focused', True),
            fullscreen_active=request.data.get('fullscreen_active', True),
        )

        violations_detected = []

        if not session.tab_focused:
            violations_detected.append('TAB_SWITCH')

        if not session.fullscreen_active:
            violations_detected.append('FULLSCREEN_EXIT')

        # Create violation records
        for violation_type in violations_detected:
            Violation.objects.create(
                attempt=attempt,
                violation_type=violation_type,
                severity='MEDIUM'
            )

        # Update trust score using weighted scoring
        score_data = calculate_weighted_trust_score(attempt)
        attempt.trust_score = score_data['trust_score']
        attempt.save()

        return Response(ProctoringSessionSerializer(session).data)

# Dashboard Views

@api_view(['GET'])
def student_dashboard(request):
    """Get student dashboard data"""
    user = request.user

    # Available exams
    available_exams = Exam.objects.filter(
        status='PUBLISHED',
        start_time__lte=timezone.now(),
        end_time__gte=timezone.now()
    ).exclude(
        attempts__student=user
    )

    # Past attempts
    past_attempts = ExamAttempt.objects.filter(student=user)

    return Response({
        'available_exams': ExamSerializer(available_exams, many=True).data,
        'past_attempts': ExamAttemptSerializer(past_attempts, many=True).data,
        'is_face_registered': user.is_face_registered,
    })


@api_view(['GET'])
def teacher_dashboard(request):
    """Get teacher dashboard data"""
    if not request.user.is_teacher:
        return Response(
            {'error': 'Only teachers can access this'},
            status=status.HTTP_403_FORBIDDEN
        )

    user = request.user

    # Teacher's exams
    exams = Exam.objects.filter(created_by=user)

    # Attempts needing review
    pending_reviews = ExamAttempt.objects.filter(
        exam__created_by=user,
        requires_manual_review=True,
        reviewed_by__isnull=True
    )

    # Recent attempts
    recent_attempts = ExamAttempt.objects.filter(
        exam__created_by=user
    ).order_by('-created_at')[:10]

    return Response({
        'total_exams': exams.count(),
        'draft_exams': exams.filter(status='DRAFT').count(),
        'published_exams': exams.filter(status='PUBLISHED').count(),
        'completed_exams': exams.filter(status='COMPLETED').count(),
        'pending_reviews': ExamAttemptSerializer(pending_reviews, many=True).data,
        'recent_attempts': ExamAttemptSerializer(recent_attempts, many=True).data,
    })

import base64
import cv2
import numpy as np
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


def filter_response_for_student(analysis_results, user):
    """Remove sensitive proctoring data from API response for students"""
    if user.is_teacher or user.is_admin_user:
        return analysis_results

    return {
        'face_detected': analysis_results.get('face_detected', False),
        'calibration_phase': analysis_results.get('calibration_phase', True),
        'num_faces': analysis_results.get('num_faces', 0),
        'trust_score': analysis_results.get('trust_score', 100),
        'violations': analysis_results.get('violations', []),
        'message': 'Please maintain proper exam posture' if analysis_results.get('violations') else 'Monitoring active',
    }


def save_violation_frame_from_array(frame_array, attempt_id, violation_type):

    try:
        # Map violation types to directories
        violation_dirs = {
            'FACE_MISMATCH': settings.FACE_MISMATCH_DIR,
            'FACE_NOT_DETECTED': settings.FACE_MISMATCH_DIR,
            'MULTIPLE_FACES': settings.MULTI_PERSON_DIR,
            'GAZE_DEVIATION': settings.GAZE_CAPTURES_DIR,
            'TAB_SWITCH': os.path.join(settings.MEDIA_ROOT, 'tab_switches'),
            'FULLSCREEN_EXIT': os.path.join(settings.MEDIA_ROOT, 'fullscreen_exits'),
            'AUDIO_DETECTED': settings.AUDIO_CAPTURES_DIR,
        }

        # Get the appropriate directory
        base_dir = violation_dirs.get(
            violation_type,
            os.path.join(settings.MEDIA_ROOT, 'violation_frames')
        )

        # Create attempt-specific subdirectory
        save_dir = os.path.join(base_dir, f'attempt_{attempt_id}')
        os.makedirs(save_dir, exist_ok=True)

        # Generate filename with timestamp (including microseconds for uniqueness)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:19]
        filename = f'{timestamp}_{violation_type}.jpg'
        filepath = os.path.join(save_dir, filename)

        # Save the frame directly (no decode/encode needed!)
        success = cv2.imwrite(filepath, frame_array, [cv2.IMWRITE_JPEG_QUALITY, 85])

        if not success:
            logger.error(f'[ERROR] cv2.imwrite failed for {violation_type}')
            return None

        logger.info(f'[SAVE]  {violation_type} frame saved: {filepath}')

        # Also log to file
        log_violation_save(attempt_id, violation_type, filepath)

        return filepath

    except Exception as e:
        logger.error(f'[ERROR] Failed to save {violation_type} frame: {str(e)}', exc_info=True)
        return None
# ============================================================================
# AI MODEL FRAME ANALYSIS ENDPOINT
# ============================================================================

def filter_response_for_student(analysis_results, user):

    # Teachers and admins see everything
    if user.is_teacher or user.is_admin_user:
        return analysis_results

    # For students, create filtered response
    filtered_response = {
        # Basic status - students should know if their setup is working
        'face_detected': analysis_results.get('face_detected', False),
        'calibration_phase': analysis_results.get('calibration_phase', True),
        'num_faces': analysis_results.get('num_faces', 0),

        # Trust score - but NOT the breakdown
        'trust_score': analysis_results.get('trust_score', 100),

        # Violation types only - NO details about what triggered them
        'violations': analysis_results.get('violations', []),

        # Signal frontend when backend baseline is locked so it can
        # complete calibration immediately instead of waiting its own timer.
        'baseline_ready': analysis_results.get('baseline_ready', False),

        # Generic message if there are violations
        'message': 'Please maintain proper exam posture' if analysis_results.get('violations') else 'Monitoring active',
    }

    return filtered_response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def analyze_frame(request):

    try:
        # ====================================================================
        # GET REQUEST DATA
        # ====================================================================
        attempt_id = request.data.get('attempt_id')
        frame_base64 = request.data.get('frame')
        calibration_complete = request.data.get('calibration_complete', False)

        logger.info(f'[REQUEST] Received frame for attempt {attempt_id}')
        logger.info(f'[REQUEST] Frame data length: {len(frame_base64) if frame_base64 else 0}')

        if not attempt_id or not frame_base64:
            return Response(
                {'error': 'attempt_id and frame are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # GET EXAM ATTEMPT
        from apps.proctoring.models import ExamAttempt, Violation
        try:
            attempt = ExamAttempt.objects.get(id=attempt_id)
        except ExamAttempt.DoesNotExist:
            return Response(
                {'error': 'Exam attempt not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # DECODE FRAME (ONLY ONCE!)
        decoded_frame = None
        try:
            # Remove data URI prefix if present
            if ',' in frame_base64:
                frame_base64_clean = frame_base64.split(',')[1]
            else:
                frame_base64_clean = frame_base64

            # Decode base64 to bytes
            frame_bytes = base64.b64decode(frame_base64_clean)
            frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)

            # Decode to image
            decoded_frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)

            if decoded_frame is None:
                raise ValueError("cv2.imdecode returned None")

            logger.info(f"[DECODE] ✅ Frame decoded: shape={decoded_frame.shape}, dtype={decoded_frame.dtype}")

        except Exception as decode_error:
            logger.error(f"[DECODE] ❌ Frame decode error: {decode_error}", exc_info=True)
            return Response({
                'error': f'Frame decode failed: {str(decode_error)}',
                'face_detected': False,
                'violations': ['FRAME_DECODE_ERROR']
            }, status=status.HTTP_400_BAD_REQUEST)

        # AI PROCESSING (Using cached pipeline)
        analysis_results = None

        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # Use cached pipeline function (reuses pipeline for entire exam)
            analysis_results = analyze_proctoring_frame(
                attempt_id=attempt.id,
                user_id=attempt.student.id,
                frame_base64=frame_base64,
                calibration_complete=calibration_complete
            )

            # Check if rate limited
            if 'error' in analysis_results and analysis_results['error'] == 'Rate limited':
                logger.warning(f"[RATE LIMIT] Frame dropped for attempt {attempt.id}")
                return Response(analysis_results, status=status.HTTP_429_TOO_MANY_REQUESTS)

        except RuntimeError as gpu_error:
            logger.error(f"[GPU] GPU error during frame analysis: {gpu_error}")

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()

            analysis_results = {
                'face_detected': True,
                'face_match': True,
                'num_faces': 1,
                'gaze_on_screen': True,
                'violations': [],
                'processing_mode': 'gpu_error_fallback',
                'error': f'GPU error: {str(gpu_error)}'
            }

        except Exception as ai_error:
            logger.error(f"[AI] AI processing error: {ai_error}", exc_info=True)

            analysis_results = {
                'face_detected': True,
                'face_match': True,
                'num_faces': 1,
                'gaze_on_screen': True,
                'violations': [],
                'processing_mode': 'ai_error_fallback',
                'error': f'AI error: {str(ai_error)}'
            }
        violations = analysis_results.get('violations', [])
        saved_paths = {}

        logger.info(f"[ANALYSIS] Violations detected: {violations}")
        logger.info(f"[ANALYSIS] decoded_frame available: {decoded_frame is not None}")

        if violations and decoded_frame is not None:
            logger.info(f'[VIOLATIONS] Detected {len(violations)} violations, saving frames...')

            # 🔧 FIX: Save directly from decoded_frame (no re-encoding!)
            for violation_type in violations:
                try:
                    logger.info(f'[SAVE] Attempting to save {violation_type}...')

                    saved_path = save_violation_frame_from_array(
                        decoded_frame,  # ← Pass the already-decoded numpy array
                        attempt_id,
                        violation_type
                    )

                    if saved_path:
                        saved_paths[violation_type] = saved_path
                        logger.info(f'[SAVE] ✅ Saved {violation_type} to: {saved_path}')
                    else:
                        logger.warning(f'[SAVE] ⚠️ Failed to save {violation_type} (returned None)')

                except Exception as save_error:
                    logger.error(f'[ERROR] Exception saving {violation_type}: {str(save_error)}', exc_info=True)

        elif violations and decoded_frame is None:
            logger.error('[SAVE] ❌ Violations detected but decoded_frame is None!')
        else:
            logger.info('[SAVE] No violations to save')

        for violation_type in violations:
            try:
                # Determine severity
                if violation_type in ['FACE_MISMATCH', 'MULTIPLE_FACES']:
                    severity = 'HIGH'
                elif violation_type in ['FACE_NOT_DETECTED', 'AUDIO_DETECTED']:
                    severity = 'MEDIUM'
                elif violation_type == 'GAZE_DEVIATION':
                    severity = 'LOW'
                else:
                    severity = 'MEDIUM'

                # 🔒 SAVE FULL DETAILS TO DATABASE (including sensitive data)
                Violation.objects.create(
                    attempt=attempt,
                    violation_type=violation_type,
                    severity=severity,
                    metadata={
                        # All sensitive data saved here for admin review
                        'frame_analysis': True,
                        'num_faces': analysis_results.get('num_faces', 0),
                        'face_detected': analysis_results.get('face_detected', False),
                        'face_match': analysis_results.get('face_match', False),
                        'face_match_confidence': analysis_results.get('face_match_confidence', 0),
                        'gaze_confidence': analysis_results.get('gaze_confidence', 0),
                        'gaze_coords': analysis_results.get('gaze_coords'),
                        'head_pose_angles': analysis_results.get('head_pose_angles'),
                        'head_pose_confidence': analysis_results.get('head_pose_confidence', 0),
                        'calibration_phase': analysis_results.get('calibration_phase', False),
                        'analysis_details': analysis_results.get('details', {}),
                        'saved_path': saved_paths.get(violation_type, ''),
                    }
                )
                logger.info(f'✅ [DB] Created violation record: {violation_type} (severity: {severity})')

            except Exception as viol_error:
                logger.error(f"[DB] Violation creation error for {violation_type}: {viol_error}", exc_info=True)

        try:
            score_data = calculate_weighted_trust_score(attempt)
            attempt.trust_score = score_data['trust_score']
            attempt.save()

            # Add to full results (will be filtered for students)
            analysis_results['trust_score'] = attempt.trust_score
            analysis_results['trust_score_breakdown'] = score_data

            logger.info(f"[TRUST] Trust score updated: {attempt.trust_score}% "
                        f"(deductions: {score_data.get('total_deduction', 0)})")

        except Exception as score_error:
            logger.error(f"[TRUST] Trust score error: {score_error}", exc_info=True)
            analysis_results['trust_score'] = 100

        logger.info(f"✅ [COMPLETE] Frame analysis complete for attempt {attempt_id}: "
                    f"{len(violations)} violations, trust_score={analysis_results.get('trust_score', 100)}")

        # Filter sensitive data for students
        filtered_response = filter_response_for_student(analysis_results, request.user)

        # Log what we're sending to student
        if not (request.user.is_teacher or request.user.is_admin_user):
            logger.info(f"[PRIVACY] Filtered response for student. "
                        f"Removed: gaze_coords, head_pose, confidence scores, details")

        return Response(filtered_response)

    except Exception as e:
        logger.error(f"[CRITICAL] analyze_frame failed completely: {e}", exc_info=True)

        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except:
            pass

        return Response({
            'face_detected': False,
            'violations': ['PROCESSING_ERROR'],
            'trust_score': 100,
            'message': 'Processing error occurred',
            'error': str(e) if request.user.is_teacher else 'An error occurred'
        }, status=status.HTTP_200_OK)

def load_registered_face_embedding(user_id):
    """
    Load the registered face embedding for a user
    Returns numpy array or None
    """
    try:
        import os
        from django.conf import settings
        from ai_engine.model_manager import ModelManager

        # Path to user's registered face image
        user_face_dir = os.path.join(settings.MEDIA_ROOT, 'face_registrations', f'user_{user_id}')

        if not os.path.exists(user_face_dir):
            logger.warning(f"Face registration directory not found for user {user_id}")
            return None

        # Get the most recent face image
        face_files = [f for f in os.listdir(user_face_dir) if f.endswith(('.jpg', '.png'))]
        if not face_files:
            logger.warning(f"No face images found for user {user_id}")
            return None

        # Use the most recent file
        face_files.sort(reverse=True)
        face_image_path = os.path.join(user_face_dir, face_files[0])

        # Load image and compute embedding
        frame = cv2.imread(face_image_path)
        if frame is None:
            logger.error(f"Failed to load face image: {face_image_path}")
            return None

        # Get face embedding
        model_manager = ModelManager()
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = model_manager.face_detector(gray, 1)

        if len(faces) == 0:
            logger.error(f"No face detected in registered image: {face_image_path}")
            return None

        face = faces[0]
        shape = model_manager.shape_predictor(gray, face)
        face_descriptor = model_manager.face_recognizer.compute_face_descriptor(frame, shape)

        return np.array(face_descriptor)

    except Exception as e:
        logger.error(f"Error loading registered face embedding: {e}", exc_info=True)
        return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def proctoring_test(request):

    return Response({
        'status': 'ok',
        'message': 'Proctoring system is operational',
        'timestamp': timezone.now().isoformat(),
        'user': request.user.username,
        'api_version': '1.0'
    }, status=status.HTTP_200_OK)

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def analyze_audio(request):

    try:
        # Get request data
        attempt_id = request.data.get('attempt_id')
        audio_base64 = request.data.get('audio_data')

        # Validate input
        if not attempt_id or not audio_base64:
            return Response(
                {'error': 'attempt_id and audio_data are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get exam attempt from database
        from apps.proctoring.models import ExamAttempt, Violation
        try:
            attempt = ExamAttempt.objects.get(id=attempt_id)
        except ExamAttempt.DoesNotExist:
            return Response(
                {'error': 'Exam attempt not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        if attempt.submitted_at is not None:
            return Response({
                'speech_detected': False,
                'message': 'Exam already submitted — audio ignored',
                'trust_score': attempt.trust_score,
            })

        # Decode base64
        if ',' in audio_base64:
            audio_base64_clean = audio_base64.split(',')[1]
        else:
            audio_base64_clean = audio_base64

        audio_bytes = base64.b64decode(audio_base64_clean)

        # Analyze audio
        result = detect_speech_simple(audio_bytes)

        # Save audio violation if speech detected
        if result['speech_detected']:
            logger.info(f'[AUDIO] Speech detected for attempt {attempt_id}')

            # Save audio file
            try:
                saved_path = save_audio_violation(audio_base64, attempt_id)
                if saved_path:
                    logger.info(f'[SAVE] Audio violation saved to: {saved_path}')
                    result['saved_path'] = saved_path
                else:
                    logger.warning(f'[SAVE] Failed to save audio violation')
            except Exception as save_error:
                logger.error(f'[ERROR] Error saving audio: {str(save_error)}')

            # Create violation record
            Violation.objects.create(
                attempt=attempt,
                violation_type='AUDIO_DETECTED',
                severity='MEDIUM',
                metadata={
                    'audio_level': result['audio_level'],
                    'confidence': result['confidence'],
                    'saved_path': result.get('saved_path', '')
                }
            )

            try:
                logger.info(f"[TRUST SCORE] Recalculating after audio violation...")

                score_data = calculate_weighted_trust_score(attempt)
                old_score = attempt.trust_score
                attempt.trust_score = score_data['trust_score']
                attempt.save()

                result['trust_score'] = attempt.trust_score
                result['trust_score_breakdown'] = score_data
                result['previous_trust_score'] = old_score
                result['trust_score_change'] = attempt.trust_score - old_score

                logger.info(f"✅ [TRUST SCORE] Updated: {old_score}% → {attempt.trust_score}% "
                            f"(change: {attempt.trust_score - old_score}%)")
                logger.info(f"[TRUST SCORE] Audio violations: {score_data['violations']['audio_violation']}, "
                            f"Deduction: {score_data['deductions']['audio_violation']} points")

            except Exception as score_error:
                logger.error(f"❌ [TRUST SCORE] Update failed: {score_error}", exc_info=True)
                result['trust_score'] = attempt.trust_score  # Use existing score
                result['trust_score_error'] = str(score_error)

        else:
            # No speech detected - no violation
            logger.info(f'[AUDIO] No speech detected for attempt {attempt_id}')
            result['trust_score'] = attempt.trust_score  # Current score unchanged

        return Response(result)

    except Exception as e:
        logger.error(f"Audio analysis error: {e}", exc_info=True)
        return Response(
            {'error': f'Audio analysis failed: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
# Recalculate trust score on demand (for frontend violations)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def recalculate_trust_score(request):

    try:
        attempt_id = request.data.get('attempt_id')

        if not attempt_id:
            return Response(
                {'error': 'attempt_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        from apps.proctoring.models import ExamAttempt

        try:
            attempt = ExamAttempt.objects.get(id=attempt_id)
        except ExamAttempt.DoesNotExist:
            return Response(
                {'error': 'Exam attempt not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Recalculate trust score
        old_score = attempt.trust_score
        score_data = calculate_weighted_trust_score(attempt)
        attempt.trust_score = score_data['trust_score']
        attempt.save()

        logger.info(f"✅ [TRUST SCORE] Recalculated: {old_score}% → {attempt.trust_score}% "
                    f"for attempt {attempt_id}")

        # Return filtered response based on user role
        if request.user.is_teacher or request.user.is_admin_user:
            # Teachers get full breakdown
            return Response({
                'trust_score': attempt.trust_score,
                'previous_score': old_score,
                'change': attempt.trust_score - old_score,
                'breakdown': score_data,
                'message': 'Trust score updated successfully'
            })
        else:
            # Students only get current score
            return Response({
                'trust_score': attempt.trust_score,
                'message': 'Score updated'
            })

    except Exception as e:
        logger.error(f"Trust score recalculation error: {e}", exc_info=True)
        return Response(
            {'error': f'Failed to recalculate trust score: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
