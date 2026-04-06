"""
AI Engine Configuration - Updated to match actual models
Configuration settings for gaze tracking, face detection, and audio monitoring
"""

# =============================================================================
# Gaze Tracking Configuration (gaze1.py + gaze2.py)
# =============================================================================

# Calibration settings
CALIBRATION_DURATION = 10  # seconds
CALIBRATION_MIN_SAMPLES = 30

# Inference settings
INFERENCE_FPS = 10  # frames per second
FRAME_SKIP = 2  # process every Nth frame

# Thresholds
GAZE_THRESHOLD = 0.05  # 5% deviation threshold (STRICT)
GAZE_EYE_SENSITIVITY = 0.3  # very sensitive to eye movement
GAZE_HEAD_POSE_YAW_LIMIT = 50  # degrees
GAZE_HEAD_POSE_PITCH_LIMIT = 40  # degrees

# Safe zone (screen coordinates 0.0 - 1.0)
GAZE_SAFE_ZONE = {
    'x_min': 0.40,
    'x_max': 0.65,
    'y_min': 0.20,
    'y_max': 0.50
}

# Warning system
GAZE_WARNING_LIMIT = 10
GAZE_VIOLATION_COOLDOWN = 5  # seconds

# Temporal filtering
GAZE_TEMPORAL_WINDOW = 3  # frames
GAZE_TEMPORAL_THRESHOLD = 0.66  # 2 out of 3 frames

# Model preprocessing
GAZE_MEAN = [0.485, 0.456, 0.406]  # ImageNet normalization
GAZE_STD = [0.229, 0.224, 0.225]

# =============================================================================
# Face Detection & Recognition Configuration (new_face.py)
# =============================================================================

# Face matching
FACE_MATCH_THRESHOLD = 0.6  # Euclidean distance threshold
FACE_CHECK_INTERVAL = 5  # check every N seconds
FACE_WARNING_THRESHOLD = 3
MULTI_PERSON_WARNING_THRESHOLD = 2

# Performance optimization
FACE_DETECTION_FRAME_SKIP = 2  # process every Nth frame
FACE_DETECTION_SCALE = 0.5  # downscale for faster detection

# Dlib models
DLIB_UPSAMPLE = 0  # 0 for speed, 1 for accuracy

# =============================================================================
# Audio Monitoring Configuration (audio.py)
# =============================================================================

# Audio parameters
AUDIO_SAMPLE_RATE = 16000  # Hz
AUDIO_CHUNK_SIZE = 1024  # samples per frame
AUDIO_THRESHOLD = 0.01  # amplitude threshold

# Detection parameters
AUDIO_TRIGGER_WINDOW = 0.5  # seconds above threshold to trigger
AUDIO_CAPTURE_DURATION = 30  # seconds to record after trigger

# Warning system
AUDIO_WARNING_THRESHOLD = 3
AUDIO_COOLDOWN_PERIOD = 60  # seconds

# =============================================================================
# Model Paths
# =============================================================================

# Gaze tracking model (PyTorch)
GAZE_MODEL_FILENAME = 'best_model.pth'  # in ai_models/gaze/

# Dlib models (for face detection/recognition)
DLIB_LANDMARKS_FILENAME = 'shape_predictor_68_face_landmarks.dat'  # in ai_models/dlib/
DLIB_FACE_REC_FILENAME = 'dlib_face_recognition_resnet_model_v1.dat'  # in ai_models/dlib/

# =============================================================================
# Processing Settings
# =============================================================================

# GPU/CPU
USE_GPU = True  # use CUDA if available
GPU_MEMORY_FRACTION = 0.3

# Threading
NUM_INFERENCE_THREADS = 1
QUEUE_MAX_SIZE = 2  # max frames in processing queue

# =============================================================================
# Violation Detection Settings
# =============================================================================

# Combined violation thresholds (affects when exam is flagged)
MAX_TOTAL_VIOLATIONS = 20  # across all detection types
CRITICAL_VIOLATION_THRESHOLD = 15  # triggers critical alert

# Violation types and weights - MATCHES views.py EXACTLY
# NOTE: These are for REFERENCE ONLY - actual weights are in views.py calculate_weighted_trust_score()
VIOLATION_WEIGHTS = {
    # AI-Generated Violations
    'face_mismatch': 15,  # Wrong person detected - serious
    'multi_person': 20,  # Multiple people - critical
    'gaze_violation': 3,  # Looking away - medium
    'audio_violation': 8,  # Speech/audio detected - serious
    'tab_switch': 2,  # Tab switch - minor (often accidental)
    'fullscreen_exit': 2,  # Exit fullscreen - minor
    'no_face': 5,  # No face detected - suspicious

    # Frontend DevTools Violations (grouped in views.py)
    'devtools_violations': 10,  # Right-click, F12, Inspect, Console, etc. - serious
    'screenshot_attempt': 15,  # Print Screen attempts - very serious
    'copy_blocked': 2,  # Copy/paste attempts - minor
    'window_blur': 1,  # Window focus loss - very minor

    # Individual DevTools types (for reference - grouped as 'devtools_violations' in views.py)
    # 'right_click_blocked': 10,
    # 'f12_blocked': 10,
    # 'inspect_blocked': 10,
    # 'console_blocked': 10,
    # 'element_picker_blocked': 10,
    # 'view_source_blocked': 10,
    # 'save_page_blocked': 10,
    # 'print_blocked': 10,
    # 'devtools_open': 10,
}

# =============================================================================
# Debug Settings
# =============================================================================

DEBUG_MODE = True  # Enable verbose logging
SAVE_DEBUG_FRAMES = False
DEBUG_FRAME_PATH = 'debug_frames/'

# Logging levels
LOG_LEVEL = 'DEBUG'  # DEBUG, INFO, WARNING, ERROR, CRITICAL

# =============================================================================
# Feature Flags
# =============================================================================

ENABLE_GAZE_TRACKING = True
ENABLE_FACE_DETECTION = True
ENABLE_FACE_RECOGNITION = True
ENABLE_MULTI_PERSON_DETECTION = True
ENABLE_AUDIO_MONITORING = True

# =============================================================================
# Display Settings (for monitoring windows)
# =============================================================================

# Window settings
DISPLAY_WIDTH = 640
DISPLAY_HEIGHT = 480
SHOW_FPS = True
SHOW_GAZE_POINT = True
SHOW_SAFE_ZONE = True

# Colors (BGR format)
COLOR_SUCCESS = (0, 255, 0)  # green
COLOR_WARNING = (0, 255, 255)  # yellow
COLOR_CRITICAL = (0, 0, 255)  # red
COLOR_INFO = (255, 255, 255)  # white