import os
from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework import viewsets

from apps.proctoring.models import ExamAttempt, Violation, ProctoringSession
from apps.exams.models import Exam

def _path_to_url(request, filepath):

    if not filepath:
        return None
    try:
        # Make path relative to MEDIA_ROOT
        rel = os.path.relpath(filepath, settings.MEDIA_ROOT)
        # Normalise Windows backslashes
        rel = rel.replace('\\', '/')
        media_url = settings.MEDIA_URL.rstrip('/')
        return request.build_absolute_uri(f'{media_url}/{rel}')
    except Exception:
        return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def teacher_attempt_review(request, attempt_id):

    # Only teachers / admins
    if not (request.user.is_teacher or request.user.is_admin_user):
        return Response(
            {'error': 'Only teachers can access this endpoint'},
            status=status.HTTP_403_FORBIDDEN
        )

    # Fetch attempt
    try:
        attempt = ExamAttempt.objects.select_related('exam', 'student').get(pk=attempt_id)
    except ExamAttempt.DoesNotExist:
        return Response({'error': 'Attempt not found'}, status=status.HTTP_404_NOT_FOUND)

    # Verify the teacher owns this exam
    if attempt.exam.created_by != request.user and not request.user.is_admin_user:
        return Response(
            {'error': 'You do not have permission to review this attempt'},
            status=status.HTTP_403_FORBIDDEN
        )

    violations_qs = Violation.objects.filter(attempt=attempt).order_by('timestamp')

    violation_summary = {}
    for v in violations_qs:
        violation_summary[v.violation_type] = violation_summary.get(v.violation_type, 0) + 1

    duration_seconds = None
    if attempt.start_time and attempt.end_time:
        duration_seconds = int((attempt.end_time - attempt.start_time).total_seconds())
    elif attempt.start_time and attempt.submitted_at:
        duration_seconds = int((attempt.submitted_at - attempt.start_time).total_seconds())

    attempt_data = {
        'id': attempt.id,
        'student_name': f"{attempt.student.first_name} {attempt.student.last_name}".strip()
                        or attempt.student.username,
        'student_username': attempt.student.username,
        'exam_title': attempt.exam.title,
        'obtained_marks': attempt.obtained_marks,
        'total_marks': attempt.exam.total_marks,
        'trust_score': attempt.trust_score,
        'status': attempt.status,
        'result_status': _get_result_status(attempt),
        'start_time': attempt.start_time,
        'end_time': attempt.end_time,
        'submitted_at': attempt.submitted_at,
        'duration_seconds': duration_seconds,
        'requires_manual_review': attempt.requires_manual_review,
        'teacher_comments': getattr(attempt, 'teacher_comments', None)
                            or getattr(attempt, 'review_notes', None),
        'violation_summary': violation_summary,
    }

    logs = []
    for v in violations_qs:
        logs.append({
            'id': v.id,
            'log_type': 'VIOLATION',
            'violation_type': v.violation_type,
            'timestamp': v.timestamp,
            'message': _violation_message(v),
        })

    # Also add session events (start / end)
    if attempt.start_time:
        logs.append({
            'id': f'start_{attempt.id}',
            'log_type': 'INFO',
            'violation_type': None,
            'timestamp': attempt.start_time,
            'message': 'Exam started',
        })
    if attempt.submitted_at:
        logs.append({
            'id': f'end_{attempt.id}',
            'log_type': 'INFO',
            'violation_type': None,
            'timestamp': attempt.submitted_at,
            'message': f'Exam submitted — score: {attempt.obtained_marks}/{attempt.exam.total_marks}',
        })

    # Sort chronologically
    logs.sort(key=lambda x: x['timestamp'] if x['timestamp'] else '')

    return Response({
        'attempt': attempt_data,
        'logs': logs,
    })

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def attempt_violations_with_evidence(request, attempt_id):

    try:
        attempt = ExamAttempt.objects.select_related('exam', 'student').get(pk=attempt_id)
    except ExamAttempt.DoesNotExist:
        return Response({'error': 'Attempt not found'}, status=status.HTTP_404_NOT_FOUND)

    # Permission check
    is_teacher = request.user.is_teacher or request.user.is_admin_user
    is_owner   = request.user == attempt.student

    if not is_teacher and not is_owner:
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    violations_qs = Violation.objects.filter(attempt=attempt).order_by('timestamp')

    data = []
    for v in violations_qs:
        screenshot_url = None
        audio_clip_url = None

        if is_teacher:
            # 1. Try FileField / CharField on the model itself
            screenshot_path = getattr(v, 'screenshot', None) or ''
            audio_path      = getattr(v, 'audio_clip', None) or ''

            if screenshot_path:
                p = str(screenshot_path)
                abs_p = p if os.path.isabs(p) else os.path.join(settings.MEDIA_ROOT, p)
                screenshot_url = _path_to_url(request, abs_p)

            if audio_path:
                p = str(audio_path)
                abs_p = p if os.path.isabs(p) else os.path.join(settings.MEDIA_ROOT, p)
                audio_clip_url = _path_to_url(request, abs_p)

            # 2. Try saved_path stored in metadata (populated by analyze_frame)
            if not screenshot_url and v.metadata:
                saved = v.metadata.get('saved_path', '')
                if saved and not any(x in saved for x in ('.wav', '.mp3', '.webm', 'audio')):
                    screenshot_url = _path_to_url(request, saved)

            if not audio_clip_url and v.metadata:
                saved = v.metadata.get('saved_path', '')
                if saved and any(x in saved for x in ('.wav', '.mp3', '.webm', 'audio')):
                    audio_clip_url = _path_to_url(request, saved)

            # 3. Filesystem scan — walk the violation directory for this attempt
            if not screenshot_url:
                screenshot_url = _scan_for_violation_frame(request, attempt.id, v.violation_type, v.timestamp)

            if not audio_clip_url:
                audio_clip_url = _scan_for_audio_clip(request, attempt.id, v.timestamp)

            import logging as _log
            _log.getLogger(__name__).warning(
                f'[EVIDENCE] v={v.id} type={v.violation_type} '
                f'screenshot={screenshot_url} audio={audio_clip_url} '
                f'metadata={v.metadata}'
            )

        entry = {
            'id': v.id,
            'violation_type': v.violation_type,
            'violation_type_display': _violation_display_name(v.violation_type),
            'severity': v.severity,
            'timestamp': v.timestamp,
            'description': _violation_message(v),
            'penalty': _violation_penalty(v.violation_type),
            'screenshot_url': screenshot_url,
            'audio_clip_url': audio_clip_url,
        }
        data.append(entry)

    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def teacher_approve_attempt(request, attempt_id):
    """Mark an attempt as APPROVED."""
    if not (request.user.is_teacher or request.user.is_admin_user):
        return Response({'error': 'Teachers only'}, status=status.HTTP_403_FORBIDDEN)

    try:
        attempt = ExamAttempt.objects.get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'error': 'Attempt not found'}, status=status.HTTP_404_NOT_FOUND)

    attempt.status = 'APPROVED'
    attempt.requires_manual_review = False
    attempt.reviewed_by = request.user
    comments = request.data.get('comments', '')
    if hasattr(attempt, 'teacher_comments'):
        attempt.teacher_comments = comments
    elif hasattr(attempt, 'review_notes'):
        attempt.review_notes = comments
    attempt.save()

    return Response({'message': 'Attempt approved', 'status': attempt.status})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def teacher_reject_attempt(request, attempt_id):
    """Mark an attempt as DISQUALIFIED."""
    if not (request.user.is_teacher or request.user.is_admin_user):
        return Response({'error': 'Teachers only'}, status=status.HTTP_403_FORBIDDEN)

    try:
        attempt = ExamAttempt.objects.get(pk=attempt_id, exam__created_by=request.user)
    except ExamAttempt.DoesNotExist:
        return Response({'error': 'Attempt not found'}, status=status.HTTP_404_NOT_FOUND)

    attempt.status = 'DISQUALIFIED'
    attempt.requires_manual_review = False
    attempt.reviewed_by = request.user
    comments = request.data.get('comments', '')
    if hasattr(attempt, 'teacher_comments'):
        attempt.teacher_comments = comments
    elif hasattr(attempt, 'review_notes'):
        attempt.review_notes = comments
    attempt.save()

    return Response({'message': 'Attempt rejected', 'status': attempt.status})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def teacher_expire_exam(request, exam_id):

    if not (request.user.is_teacher or request.user.is_admin_user):
        return Response({'error': 'Teachers only'}, status=status.HTTP_403_FORBIDDEN)

    try:
        exam = Exam.objects.get(pk=exam_id, created_by=request.user)
    except Exam.DoesNotExist:
        return Response({'error': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)

    if exam.status == 'COMPLETED':
        return Response({'detail': 'Exam is already completed.'})

    if exam.status != 'PUBLISHED':
        return Response({'detail': f'Exam is {exam.status}, not PUBLISHED.'}, status=status.HTTP_400_BAD_REQUEST)

    now = timezone.now()
    end = exam.end_time
    if end and end > now:
        return Response(
            {'detail': 'Exam end time has not been reached yet.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Mark exam completed
    exam.status = 'COMPLETED'
    exam.save(update_fields=['status'])

    # Auto-submit any IN_PROGRESS attempts
    in_progress = ExamAttempt.objects.filter(exam=exam, status='IN_PROGRESS')
    auto_submitted = in_progress.count()
    in_progress.update(status='SUBMITTED', submitted_at=now)

    return Response({
        'detail': 'Exam marked as completed.',
        'auto_submitted': auto_submitted,
    })


def _get_result_status(attempt):
    if attempt.status == 'DISQUALIFIED':
        return 'Disqualified'
    if attempt.status == 'APPROVED':
        return 'Approved'
    if attempt.status == 'FLAGGED':
        return 'Flagged for Review'
    if attempt.obtained_marks is not None and attempt.exam.passing_marks is not None:
        return 'PASS' if attempt.obtained_marks >= attempt.exam.passing_marks else 'FAIL'
    return 'Pending'


def _violation_display_name(vtype):
    return {
        'FACE_MISMATCH':     'Face Mismatch',
        'MULTIPLE_FACES':    'Multiple Faces Detected',
        'GAZE_DEVIATION':    'Gaze Deviation',
        'GAZE_AWAY':         'Gaze Away',
        'AUDIO_DETECTED':    'Suspicious Audio',
        'TAB_SWITCH':        'Tab Switch',
        'FULLSCREEN_EXIT':   'Exited Fullscreen',
        'FACE_NOT_DETECTED': 'Face Not Detected',
        'NO_FACE_LONG':      'Face Missing (Extended)',
    }.get(vtype, vtype.replace('_', ' ').title())


def _violation_message(v):
    base = _violation_display_name(v.violation_type)
    if v.metadata:
        if v.violation_type == 'GAZE_DEVIATION':
            yaw = v.metadata.get('yaw') or v.metadata.get('head_pose', {}).get('yaw')
            if yaw is not None:
                return f'{base} — head yaw {float(yaw):.1f}°'
        if v.violation_type == 'AUDIO_DETECTED':
            lvl = v.metadata.get('audio_level')
            if lvl is not None:
                return f'{base} — audio level {float(lvl):.3f}'
        if v.violation_type == 'FACE_MISMATCH':
            conf = v.metadata.get('confidence')
            if conf is not None:
                return f'{base} — confidence {float(conf):.1f}%'
    return base


def _violation_penalty(vtype):
    return {
        'FACE_MISMATCH':     15,
        'MULTIPLE_FACES':    20,
        'GAZE_DEVIATION':     3,
        'AUDIO_DETECTED':     8,
        'TAB_SWITCH':         2,
        'FULLSCREEN_EXIT':    2,
        'FACE_NOT_DETECTED':  5,
    }.get(vtype, 5)

def _violation_dir(violation_type):
    """Return the settings directory for a given violation type."""
    return {
        'FACE_MISMATCH':     getattr(settings, 'FACE_MISMATCH_DIR', None),
        'FACE_NOT_DETECTED': getattr(settings, 'FACE_MISMATCH_DIR', None),
        'MULTIPLE_FACES':    getattr(settings, 'MULTI_PERSON_DIR', None),
        'GAZE_DEVIATION':    getattr(settings, 'GAZE_CAPTURES_DIR', None),
        'AUDIO_DETECTED':    getattr(settings, 'AUDIO_CAPTURES_DIR', None),
    }.get(violation_type) or os.path.join(settings.MEDIA_ROOT, 'violation_frames')


def _scan_for_violation_frame(request, attempt_id, violation_type, timestamp):

    import glob

    attempt_dir = os.path.join(_violation_dir(violation_type), f'attempt_{attempt_id}')
    if not os.path.isdir(attempt_dir):
        return None

    files = glob.glob(os.path.join(attempt_dir, '*.jpg')) + glob.glob(os.path.join(attempt_dir, '*.png'))
    if not files:
        return None

    ts_epoch = timestamp.timestamp() if hasattr(timestamp, 'timestamp') else None
    best_path, best_delta = None, float('inf')

    for fpath in files:
        if ts_epoch is not None:
            delta = abs(os.path.getmtime(fpath) - ts_epoch)
            if delta < best_delta:
                best_delta, best_path = delta, fpath
        else:
            return _path_to_url(request, fpath)

    # 30s window — generous to cover server processing lag
    if best_path and (ts_epoch is None or best_delta <= 30):
        return _path_to_url(request, best_path)
    return None

def _scan_for_audio_clip(request, attempt_id, timestamp):
    """Find the closest audio clip using file mtime (UTC)."""
    import glob

    audio_dir = os.path.join(
        getattr(settings, 'AUDIO_CAPTURES_DIR', os.path.join(settings.MEDIA_ROOT, 'audio_captures')),
        f'attempt_{attempt_id}'
    )
    if not os.path.isdir(audio_dir):
        return None

    files = (glob.glob(os.path.join(audio_dir, '*.wav')) +
             glob.glob(os.path.join(audio_dir, '*.mp3')) +
             glob.glob(os.path.join(audio_dir, '*.webm')))
    if not files:
        return None

    ts_epoch = timestamp.timestamp() if hasattr(timestamp, 'timestamp') else None
    best_path, best_delta = None, float('inf')

    for fpath in files:
        if ts_epoch is not None:
            delta = abs(os.path.getmtime(fpath) - ts_epoch)
            if delta < best_delta:
                best_delta, best_path = delta, fpath
        else:
            return _path_to_url(request, fpath)

    if best_path and (ts_epoch is None or best_delta <= 30):
        return _path_to_url(request, best_path)
    return None
