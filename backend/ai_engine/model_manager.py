"""
Singleton Model Manager - Preloads ALL AI models at Django startup
File: backend/ai_engine/model_manager.py

This loads:
- Face detection models (dlib)
- Face recognition models (dlib)
- Gaze tracking models (gaze1.py)
- Face matching (new_face.py)

Models are loaded ONCE when server starts, then reused for all requests.
"""

import torch
import dlib
import cv2
import numpy as np
from pathlib import Path
from django.conf import settings
import logging
import os
import sys
import threading
_model_lock = threading.Lock()


logger = logging.getLogger(__name__)


class ModelManager:
    """
    Singleton class to manage all AI models.
    Loads models once at server startup, reuses them for all requests.
    """
    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        with _model_lock:
            if self._initialized:
                return
            print("\n" + "=" * 60)
            print("AI MODEL MANAGER - Loading models...")
            print("=" * 60)
            self._load_models()
            ModelManager._initialized = True

    def _load_models(self):
        """Load all AI models into memory"""
        try:
            # Get models directory
            models_dir = Path(settings.BASE_DIR) / 'ai_models'

            # ================================================================
            # 1. DLIB MODELS (Face Detection & Recognition)
            # ================================================================
            print("Loading dlib models...")

            # Face detector
            self.face_detector = dlib.get_frontal_face_detector()
            print("   ✓ Face detector loaded")

            # Facial landmarks predictor
            landmarks_path = models_dir / 'dlib' / 'shape_predictor_68_face_landmarks.dat'
            if landmarks_path.exists():
                self.shape_predictor = dlib.shape_predictor(str(landmarks_path))
                print(f"   ✓ Landmark predictor loaded from {landmarks_path.name}")
            else:
                logger.warning(f"   ⚠ Landmark predictor not found at {landmarks_path}")
                self.shape_predictor = None

            # Face recognition model
            face_rec_path = models_dir / 'dlib' / 'dlib_face_recognition_resnet_model_v1.dat'
            if face_rec_path.exists():
                self.face_recognizer = dlib.face_recognition_model_v1(str(face_rec_path))
                print(f"   ✓ Face recognizer loaded from {face_rec_path.name}")
            else:
                logger.warning(f"   ⚠ Face recognizer not found at {face_rec_path}")
                self.face_recognizer = None

            # ================================================================
            # 2. GAZE TRACKING MODEL (PyTorch)
            # ================================================================
            print("\nLoading gaze tracking model...")

            gaze_model_path = models_dir / 'gaze' / 'best_model.pth'

            if gaze_model_path.exists():
                try:
                    # Import the gaze model architecture
                    # First, add the ai_engine directory to Python path if needed
                    ai_engine_dir = Path(settings.BASE_DIR) / 'ai_engine'
                    if str(ai_engine_dir) not in sys.path:
                        sys.path.insert(0, str(ai_engine_dir))
                    
                    # Try importing from different possible locations
                    try:
                        from gaze1 import MaxRegularizediTrackerModel
                        print("   ✓ Imported MaxRegularizediTrackerModel from gaze1")
                    except ImportError:
                        try:
                            from ai_engine.gaze1 import MaxRegularizediTrackerModel
                            print("   ✓ Imported MaxRegularizediTrackerModel from ai_engine.gaze1")
                        except ImportError:
                            # Inline fallback — EXACT copy of MaxRegularizediTrackerModel from gaze1.py
                            print("   ⚠ Could not import from gaze1, using inline fallback model")

                            class _StochasticDepth(torch.nn.Module):
                                def __init__(self, drop_prob=0.15):
                                    super().__init__()
                                    self.drop_prob = drop_prob
                                def forward(self, x):
                                    if not self.training:
                                        return x
                                    keep_prob = 1 - self.drop_prob
                                    shape = (x.shape[0],) + (1,) * (x.ndim - 1)
                                    t = keep_prob + torch.rand(shape, dtype=x.dtype, device=x.device)
                                    t.floor_()
                                    return x.div(keep_prob) * t

                            class MaxRegularizediTrackerModel(torch.nn.Module):
                                def __init__(self, dropout_rate=0.5, stochastic_depth=0.0):
                                    super().__init__()
                                    self.eye_extractor = torch.nn.Sequential(
                                        torch.nn.Conv2d(3, 64, 5, 1, 2), torch.nn.BatchNorm2d(64), torch.nn.ReLU(True), torch.nn.MaxPool2d(2,2), torch.nn.Dropout2d(0.2),
                                        torch.nn.Conv2d(64, 128, 3, 1, 1), torch.nn.BatchNorm2d(128), torch.nn.ReLU(True), torch.nn.MaxPool2d(2,2), torch.nn.Dropout2d(0.2),
                                        torch.nn.Conv2d(128, 256, 3, 1, 1), torch.nn.BatchNorm2d(256), torch.nn.ReLU(True), torch.nn.AdaptiveAvgPool2d((4,4)), torch.nn.Dropout2d(0.3),
                                    )
                                    self.face_extractor = torch.nn.Sequential(
                                        torch.nn.Conv2d(3, 64, 7, 1, 3), torch.nn.BatchNorm2d(64), torch.nn.ReLU(True), torch.nn.MaxPool2d(2,2), torch.nn.Dropout2d(0.2),
                                        torch.nn.Conv2d(64, 128, 5, 1, 2), torch.nn.BatchNorm2d(128), torch.nn.ReLU(True), torch.nn.MaxPool2d(2,2), torch.nn.Dropout2d(0.2),
                                        torch.nn.Conv2d(128, 256, 3, 1, 1), torch.nn.BatchNorm2d(256), torch.nn.ReLU(True),
                                        torch.nn.Conv2d(256, 512, 3, 1, 1), torch.nn.BatchNorm2d(512), torch.nn.ReLU(True), torch.nn.AdaptiveAvgPool2d((4,4)), torch.nn.Dropout2d(0.3),
                                    )
                                    self.eye_projection = torch.nn.Sequential(
                                        torch.nn.Linear(256*4*4, 256), torch.nn.BatchNorm1d(256), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                        torch.nn.Linear(256, 128), torch.nn.BatchNorm1d(128), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                    )
                                    self.face_projection = torch.nn.Sequential(
                                        torch.nn.Linear(512*4*4, 512), torch.nn.BatchNorm1d(512), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                        torch.nn.Linear(512, 256), torch.nn.BatchNorm1d(256), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                    )
                                    self.pose_encoder = torch.nn.Sequential(
                                        torch.nn.Linear(2, 32), torch.nn.BatchNorm1d(32), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                        torch.nn.Linear(32, 64), torch.nn.BatchNorm1d(64), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                    )
                                    self.gaze_head = torch.nn.Sequential(
                                        torch.nn.Linear(128*2+256+64, 256), torch.nn.BatchNorm1d(256), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                        torch.nn.Linear(256, 128), torch.nn.BatchNorm1d(128), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                        torch.nn.Linear(128, 64), torch.nn.BatchNorm1d(64), torch.nn.ReLU(True), torch.nn.Dropout(dropout_rate),
                                        torch.nn.Linear(64, 2),
                                    )
                                def forward(self, left_eye, right_eye, face, head_pose):
                                    lf = self.eye_projection(self.eye_extractor(left_eye).view(left_eye.size(0), -1))
                                    rf = self.eye_projection(self.eye_extractor(right_eye).view(right_eye.size(0), -1))
                                    ff = self.face_projection(self.face_extractor(face).view(face.size(0), -1))
                                    pf = self.pose_encoder(head_pose)
                                    return self.gaze_head(torch.cat([lf, rf, ff, pf], dim=1))

                    # Initialize model with correct parameters
                    self.gaze_model = MaxRegularizediTrackerModel(
                        dropout_rate=0.6, 
                        stochastic_depth=0.2
                    )

                    self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")

                    checkpoint = torch.load(
                        gaze_model_path,
                        map_location=self.device
                    )

                    # Handle different checkpoint formats
                    if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                        self.gaze_model.load_state_dict(checkpoint['model_state_dict'])
                    else:
                        self.gaze_model.load_state_dict(checkpoint)

                    # Set to evaluation mode (disable dropout, etc.)
                    self.gaze_model.to(self.device)

                    # Determine device (GPU if available) with memory optimization
                    if torch.cuda.is_available():
                        try:
                            # Clear GPU cache
                            torch.cuda.empty_cache()

                            self.device = torch.device('cuda:0')

                            print(f"   ✓ GPU configured with memory protection")
                        except Exception as gpu_error:
                            print(f"   ⚠️ GPU setup failed: {gpu_error}, using CPU")
                            self.device = torch.device('cpu')
                    else:
                        self.device = torch.device('cpu')

                    self.gaze_model.eval()
                    for p in self.gaze_model.parameters():
                        p.requires_grad = False

                    print(f"   ✓ Gaze model loaded on {self.device}")
                    print(f"   ✓ Model file: {gaze_model_path.name}")

                except Exception as e:
                    logger.error(f"   ✗ Failed to load gaze model: {e}")
                    import traceback
                    traceback.print_exc()
                    self.gaze_model = None
                    self.device = torch.device('cpu')
            else:
                logger.warning(f"   ⚠ Gaze model not found at {gaze_model_path}")
                self.gaze_model = None
                self.device = torch.device('cpu')

            # ================================================================
            # 3. MEMORY INFO
            # ================================================================
            if torch.cuda.is_available():
                print(f"\nGPU Memory:")
                print(f"   • Allocated: {torch.cuda.memory_allocated(0) / 1024 ** 2:.2f} MB")
                print(f"   • Cached: {torch.cuda.memory_reserved(0) / 1024 ** 2:.2f} MB")
            else:
                print(f"\nUsing CPU (no GPU detected)")

        except Exception as e:
            logger.error(f"Critical error loading models: {e}")
            import traceback
            traceback.print_exc()
            # Don't raise - allow server to start even if models fail

    # ========================================================================
    # GETTER METHODS - Use these in your views/API
    # ========================================================================

    def get_face_detector(self):
        """Returns pre-loaded dlib face detector"""
        return self.face_detector

    def get_shape_predictor(self):
        """Returns pre-loaded dlib shape predictor"""
        return self.shape_predictor

    def get_face_recognizer(self):
        """Returns pre-loaded dlib face recognizer"""
        return self.face_recognizer

    def get_gaze_model(self):
        """Returns pre-loaded PyTorch gaze model"""
        return self.gaze_model

    def get_device(self):
        """Returns PyTorch device (cuda/cpu)"""
        return self.device

    # ========================================================================
    # UTILITY METHODS
    # ========================================================================

    def is_ready(self):
        """Check if all critical models are loaded"""
        return all([
            self.face_detector is not None,
            self.shape_predictor is not None,
            self.face_recognizer is not None,
            # Gaze model is optional - don't fail if missing
        ])

    def get_model_info(self):
        """Get information about loaded models"""
        return {
            'face_detector': self.face_detector is not None,
            'shape_predictor': self.shape_predictor is not None,
            'face_recognizer': self.face_recognizer is not None,
            'gaze_model': self.gaze_model is not None,
            'device': str(self.device) if hasattr(self, 'device') else 'cpu',
            'cuda_available': torch.cuda.is_available(),
        }

    def cleanup(self):
        """Clean up GPU memory if needed"""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            print("GPU cache cleared")


# ============================================================================
# GLOBAL INSTANCE - Automatically created on first import
# ============================================================================

# This will be loaded when Django starts
try:
    model_manager = ModelManager()
except Exception as e:
    logger.error(f"Failed to initialize ModelManager: {e}")
    # Create a dummy instance so imports don't fail
    model_manager = None


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_models():
    """Quick access to all models"""
    return model_manager


def check_models_ready():
    """Check if models are ready for use"""
    if model_manager is None:
        return False
    return model_manager.is_ready()