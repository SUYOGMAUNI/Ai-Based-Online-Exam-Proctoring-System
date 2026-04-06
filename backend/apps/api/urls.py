"""
API URL Configuration
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from .views import analyze_frame, analyze_audio, proctoring_test, recalculate_trust_score
from .teacher_views import (
    teacher_attempt_review,
    attempt_violations_with_evidence,
    teacher_approve_attempt,
    teacher_reject_attempt,
    teacher_expire_exam,
)

router = DefaultRouter()
router.register(r'users', views.UserViewSet, basename='user')
router.register(r'exams', views.ExamViewSet, basename='exam')
router.register(r'questions', views.QuestionViewSet, basename='question')
router.register(r'attempts', views.ExamAttemptViewSet, basename='attempt')
router.register(r'violations', views.ViolationViewSet, basename='violation')
router.register(r'proctoring', views.ProctoringSessionViewSet, basename='proctoring')

urlpatterns = [
    path('auth/register/', views.register_user, name='register'),
    path('auth/login/', views.login_user, name='login'),
    path('auth/logout/', views.logout_user, name='logout'),
    path('auth/me/', views.current_user, name='current-user'),
    path('dashboard/student/', views.student_dashboard, name='student-dashboard'),
    path('dashboard/teacher/', views.teacher_dashboard, name='teacher-dashboard'),
    path('student/register-face/', views.register_face, name='register-face'),
    path('student/check-face-registration/', views.check_face_registration, name='check-face-registration'),
    path('proctoring/analyze-frame/', analyze_frame, name='analyze-frame'),
    path('proctoring/analyze-audio/', analyze_audio, name='analyze-audio'),
    path('proctoring/test/', proctoring_test, name='proctoring-test'),
    path('proctoring/recalculate-trust-score/', recalculate_trust_score, name='recalculate-trust-score'),
    # Teacher review endpoints
    path('teacher/attempt/<int:attempt_id>/review/', teacher_attempt_review, name='teacher-attempt-review'),
    path('attempts/<int:attempt_id>/violations-with-evidence/', attempt_violations_with_evidence, name='attempt-violations-with-evidence'),
    path('teacher/attempt/<int:attempt_id>/approve/', teacher_approve_attempt, name='teacher-attempt-approve'),
    path('teacher/attempt/<int:attempt_id>/reject/', teacher_reject_attempt, name='teacher-attempt-reject'),
    path('exams/<int:exam_id>/expire/', teacher_expire_exam, name='teacher-expire-exam'),
    path('', include(router.urls)),
]