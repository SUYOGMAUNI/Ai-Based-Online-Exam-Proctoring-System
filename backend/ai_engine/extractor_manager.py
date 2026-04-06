

import cv2
import numpy as np
import logging
import threading
import mediapipe as mp
from collections import deque
from scipy.spatial.transform import Rotation

logger = logging.getLogger(__name__)


class UnifiedFaceExtractor:
    """
    Single MediaPipe instance that handles both calibration and monitoring phases.
    EXACT match to original SimpleFaceExtractor + FullFaceExtractor behavior.
    """
    
    def __init__(self):
        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            static_image_mode=False
        )
        
        self.model_points = np.array([
            (0.0, 0.0, 0.0),
            (0.0, -330.0, -65.0),
            (-225.0, 170.0, -135.0),
            (225.0, 170.0, -135.0),
            (-150.0, -150.0, -125.0),
            (150.0, -150.0, -125.0)
        ], dtype=np.float64)
        
        self.pose_history = deque(maxlen=3)  # was 5 — shorter window so sudden head turns aren't dampened across too many prior frames
        self._session_id = None  # track current session to reset pose_history between attempts
        self.current_phase = 'calibration'
        logger.info("UnifiedFaceExtractor initialized (supports both calibration and monitoring)")

    def set_phase(self, phase, session_id=None):
        """Switch between 'calibration', 'calibration_pose', and 'monitoring' phases.
        Pass session_id (e.g. attempt_id) to reset pose_history when a new session starts,
        preventing stale poses from a previous student bleeding into the current session.
        """
        if phase in ['calibration', 'calibration_pose', 'monitoring']:
            if session_id is not None and session_id != self._session_id:
                self._session_id = session_id
                self.pose_history.clear()
                logger.info(f"[pose_history] Reset for new session: {session_id}")
            self.current_phase = phase
            logger.debug(f"Phase switched to: {phase}")

    def extract(self, frame):
        """
        Extract face landmarks, eyes, and head pose from frame.

        CALIBRATION MODE (matches SimpleFaceExtractor):
        - Returns pose=[0,0] (dummy, no PnP computation)
        - Eye size: 60x36
        - Face size: 60x60
        - Always valid=True

        CALIBRATION_POSE MODE:
        - Real PnP pose estimation (same as monitoring)
        - Eye size: 60x36 (small, for calibration)
        - Face size: 60x60 (small, for calibration)
        - Used when pipeline is in 'calibrating' to build a real head pose baseline

        MONITORING MODE (matches FullFaceExtractor):
        - Full PnP pose estimation with validation
        - Eye size: 224x224
        - Face size: 224x224
        - Pose normalization: yaw/45, pitch/30, clipped to [-2, 2]
        - Validation: |yaw| < 75, |pitch| < 60, confidence > 0.3
        """
        try:
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(rgb)

            if not results.multi_face_landmarks:
                return None

            landmarks = results.multi_face_landmarks[0].landmark
            landmarks_pixel = np.array([
                [lm.x * w, lm.y * h, lm.z] for lm in landmarks
            ], dtype=np.float32)

            if self.current_phase == 'calibration':
                return self._extract_calibration(frame, landmarks_pixel)
            elif self.current_phase == 'calibration_pose':
                return self._extract_calibration_pose(frame, landmarks, landmarks_pixel, w, h)
            else:
                return self._extract_monitoring(frame, landmarks, landmarks_pixel, w, h)

        except Exception as e:
            logger.debug(f"Extraction error: {e}")
            return None

    def _extract_calibration(self, frame, landmarks_pixel):
        """
        CALIBRATION MODE - matches SimpleFaceExtractor exactly
        Eye: 60x36, Face: 60x60, pose=[0,0]
        """
        left_eye = self._extract_eye_simple(frame, landmarks_pixel, left=True)
        right_eye = self._extract_eye_simple(frame, landmarks_pixel, left=False)
        face_crop = self._extract_face_simple(frame, landmarks_pixel)

        if left_eye is None or right_eye is None or face_crop is None:
            return None

        return {
            'left_eye': left_eye,
            'right_eye': right_eye,
            'face': face_crop,
            'head_pose': np.array([0.0, 0.0], dtype=np.float32),
            'head_pose_angles': [0.0, 0.0, 0.0],
            'head_pose_confidence': 1.0,
            'valid': True
        }

    def _extract_calibration_pose(self, frame, landmarks, landmarks_pixel, w, h):
        """
        CALIBRATION_POSE MODE - real PnP pose estimation, small crops (60x36 / 60x60)
        Used during pipeline calibrating phase to build a real head pose baseline.
        """
        left_eye = self._extract_eye_simple(frame, landmarks_pixel, left=True)
        right_eye = self._extract_eye_simple(frame, landmarks_pixel, left=False)
        face_crop = self._extract_face_simple(frame, landmarks_pixel)

        if left_eye is None or right_eye is None or face_crop is None:
            return None

        pose_result = self._estimate_pose(landmarks, w, h)
        if pose_result[0] is None:
            return None
        # calibration_pose: smoothed angles are fine for baseline building
        pose_angles, confidence = pose_result[0], pose_result[1]
        yaw, pitch, roll = pose_angles

        normalized_yaw   = np.clip(yaw   / 45.0, -2.0, 2.0)
        normalized_pitch = np.clip(pitch / 30.0, -2.0, 2.0)
        normalized_pose  = np.array([normalized_yaw, normalized_pitch], dtype=np.float32)

        is_valid = abs(yaw) <= 75 and abs(pitch) <= 60 and confidence >= 0.3

        return {
            'left_eye':             left_eye,
            'right_eye':            right_eye,
            'face':                 face_crop,
            'head_pose':            normalized_pose,
            'head_pose_angles':     pose_angles,
            'head_pose_confidence': confidence,
            'valid':                is_valid
        }

    def _extract_monitoring(self, frame, landmarks, landmarks_pixel, w, h):
        """
        MONITORING MODE - matches FullFaceExtractor exactly
        Eye: 224x224, Face: 224x224, full pose estimation
        """
        left_eye = self._extract_eye_full(frame, landmarks_pixel, left=True)
        right_eye = self._extract_eye_full(frame, landmarks_pixel, left=False)

        if left_eye is None or right_eye is None:
            return None

        xs = landmarks_pixel[:, 0]
        ys = landmarks_pixel[:, 1]

        x_min = max(0, int(np.min(xs) - 40))
        x_max = min(w, int(np.max(xs) + 40))
        y_min = max(0, int(np.min(ys) - 40))
        y_max = min(h, int(np.max(ys) + 40))

        if x_max <= x_min or y_max <= y_min:
            return None

        face_crop = frame[y_min:y_max, x_min:x_max]
        if face_crop.size == 0:
            return None

        face = cv2.resize(face_crop, (224, 224), interpolation=cv2.INTER_LINEAR)

        pose_result = self._estimate_pose(landmarks, w, h)
        if pose_result[0] is None:
            return None
        smoothed_angles, confidence, raw_angles = pose_result

        # smoothed_angles fed to gaze model (noise reduction)
        # raw_angles fed to head_pose_angles so the pipeline's absolute yaw limit
        # fires immediately on a sudden turn without smoothing lag dampening it.
        yaw, pitch, roll = smoothed_angles
        raw_yaw, raw_pitch, raw_roll = raw_angles

        normalized_yaw = np.clip(yaw / 45.0, -2.0, 2.0)
        normalized_pitch = np.clip(pitch / 30.0, -2.0, 2.0)
        normalized_pose = np.array([normalized_yaw, normalized_pitch], dtype=np.float32)

        is_valid = True
        if abs(yaw) > 85:       # only invalidate extreme turns (model can't track beyond ~85°)
            is_valid = False
        elif abs(pitch) > 70:   # loosen from 60 → 70 degrees
            is_valid = False
        elif confidence < 0.2:  # loosen from 0.3 → 0.2 (noisy webcam frames)
            is_valid = False

        return {
            'left_eye': left_eye,
            'right_eye': right_eye,
            'face': face,
            'head_pose': normalized_pose,
            # raw_angles: absolute head-pose check in pipeline uses this directly,
            # bypassing smoothing so a 65-deg turn fires on the first captured frame.
            'head_pose_angles': raw_angles,
            'head_pose_confidence': confidence,
            'valid': is_valid
        }

    def _extract_eye_simple(self, frame, landmarks, left=True):
        """Simple eye extraction for CALIBRATION - 60x36"""
        try:
            if left:
                indices = [33, 133, 160, 144, 159, 145]
            else:
                indices = [362, 263, 387, 373, 386, 374]

            eye_points = landmarks[indices][:, :2]
            x_min, y_min = eye_points.min(axis=0).astype(int)
            x_max, y_max = eye_points.max(axis=0).astype(int)

            padding = 10
            x_min = max(0, x_min - padding)
            y_min = max(0, y_min - padding)
            x_max = min(frame.shape[1], x_max + padding)
            y_max = min(frame.shape[0], y_max + padding)

            eye_crop = frame[y_min:y_max, x_min:x_max]

            if eye_crop.size == 0:
                return None

            return cv2.resize(eye_crop, (60, 36), interpolation=cv2.INTER_AREA)
        except Exception as e:
            logger.debug(f"Eye extraction error: {e}")
            return None

    def _extract_face_simple(self, frame, landmarks):
        """Simple face extraction for CALIBRATION - 60x60"""
        try:
            face_oval = landmarks[[10, 338, 297, 332, 284, 251, 389, 356, 454, 323,
                                  361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
                                  176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
                                  162, 21, 54, 103, 67, 109]]

            face_points = face_oval[:, :2]
            x_min, y_min = face_points.min(axis=0).astype(int)
            x_max, y_max = face_points.max(axis=0).astype(int)

            padding = 20
            x_min = max(0, x_min - padding)
            y_min = max(0, y_min - padding)
            x_max = min(frame.shape[1], x_max + padding)
            y_max = min(frame.shape[0], y_max + padding)

            face_crop = frame[y_min:y_max, x_min:x_max]

            if face_crop.size == 0:
                return None

            return cv2.resize(face_crop, (60, 60), interpolation=cv2.INTER_AREA)
        except Exception as e:
            logger.debug(f"Face extraction error: {e}")
            return None

    def _extract_eye_full(self, frame, landmarks_pixel, left=True):
        """Full eye extraction for MONITORING - 224x224"""
        h, w = frame.shape[:2]

        if left:
            indices = [33, 133, 157, 158, 159, 160, 161, 173, 246]
        else:
            indices = [362, 382, 381, 380, 374, 373, 390, 249, 466]

        points = landmarks_pixel[indices, :2].astype(np.int32)
        x_min, y_min = np.min(points, axis=0)
        x_max, y_max = np.max(points, axis=0)

        padding = 20
        x_min = max(0, x_min - padding)
        x_max = min(w, x_max + padding)
        y_min = max(0, y_min - padding)
        y_max = min(h, y_max + padding)

        if x_max <= x_min or y_max <= y_min:
            return None

        eye_crop = frame[y_min:y_max, x_min:x_max]
        if eye_crop.size == 0:
            return None

        if len(eye_crop.shape) == 2:
            eye_crop = cv2.cvtColor(eye_crop, cv2.COLOR_GRAY2BGR)
        elif eye_crop.shape[2] == 4:
            eye_crop = cv2.cvtColor(eye_crop, cv2.COLOR_RGBA2BGR)

        eye_crop = cv2.resize(eye_crop, (224, 224), interpolation=cv2.INTER_LINEAR)
        return eye_crop

    def _estimate_pose(self, landmarks, frame_width, frame_height):
        """Estimate head pose - EXACT match to FullFaceExtractor"""
        try:
            image_points = np.array([
                (landmarks[1].x * frame_width, landmarks[1].y * frame_height),
                (landmarks[152].x * frame_width, landmarks[152].y * frame_height),
                (landmarks[33].x * frame_width, landmarks[33].y * frame_height),
                (landmarks[263].x * frame_width, landmarks[263].y * frame_height),
                (landmarks[61].x * frame_width, landmarks[61].y * frame_height),
                (landmarks[291].x * frame_width, landmarks[291].y * frame_height),
            ], dtype=np.float64)

            # Focal length: assume ~70° horizontal FOV (typical webcam).
            # f = (frame_width / 2) / tan(FOV/2) ≈ frame_width * 0.75
            # Using frame_width directly (=640) overestimates focal length which
            # makes small head rotations appear larger than they are, causing
            # valid=False and falling back to pose-only mode.
            focal_length = frame_width * 0.75
            camera_matrix = np.array([
                [focal_length, 0, frame_width / 2],
                [0, focal_length, frame_height / 2],
                [0, 0, 1]
            ], dtype=np.float64)

            dist_coeffs = np.zeros((4, 1))

            success, rotation_vector, translation_vector = cv2.solvePnP(
                self.model_points,
                image_points,
                camera_matrix,
                dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE
            )

            if not success:
                return None, 0.0, None

            rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
            r = Rotation.from_matrix(rotation_matrix)
            angles = r.as_euler('yxz', degrees=True)

            yaw, pitch, roll = angles[0], angles[1], angles[2]

            projected_points, _ = cv2.projectPoints(
                self.model_points,
                rotation_vector,
                translation_vector,
                camera_matrix,
                dist_coeffs
            )

            reprojection_error = np.mean(np.linalg.norm(
                image_points - projected_points.reshape(-1, 2), axis=1
            ))
            confidence = max(0.0, 1.0 - (reprojection_error / 100.0))

            pose = np.array([yaw, pitch, roll])
            self.pose_history.append(pose)

            # Smooth with exponential weights to reduce per-frame jitter.
            # maxlen=3 keeps the window tight so a sustained head turn crosses
            # the 45-deg limit within 1-2 frames rather than 3-4.
            # Sharper weighting (linspace -2->0) gives the current frame ~73%
            # of the result (vs ~50% with -1->0), so sudden turns register fast.
            if len(self.pose_history) >= 2:
                weights = np.exp(np.linspace(-2, 0, len(self.pose_history)))
                weights /= weights.sum()
                smoothed_pose = np.average(self.pose_history, axis=0, weights=weights)
            else:
                smoothed_pose = pose

            # Return both: smoothed for gaze distance check (noise reduction),
            # raw for the absolute head-pose hard-limit (no smoothing lag).
            return smoothed_pose, confidence, pose

        except Exception as e:
            logger.debug(f"Pose estimation error: {e}")
            return None, 0.0, None
    
    def cleanup(self):
        """Clean up MediaPipe resources"""
        self.face_mesh.close()
        logger.info("UnifiedFaceExtractor cleaned up")


_unified_extractor = None
_unified_extractor_lock = threading.Lock()


def get_unified_extractor():
    """
    Get or create the singleton UnifiedFaceExtractor instance.
    Thread-safe: only one MediaPipe FaceMesh is ever created.
    
    Returns:
        UnifiedFaceExtractor instance, or None if creation failed.
    """
    global _unified_extractor

    if _unified_extractor is not None:
        return _unified_extractor

    with _unified_extractor_lock:
        if _unified_extractor is not None:
            return _unified_extractor
        try:
            logger.info("🔵 Creating UnifiedFaceExtractor singleton...")
            _unified_extractor = UnifiedFaceExtractor()
            logger.info("✅ UnifiedFaceExtractor singleton created successfully")
        except Exception as e:
            logger.error(f"❌ Failed to create UnifiedFaceExtractor: {e}", exc_info=True)
            return None

    return _unified_extractor


def get_simple_extractor():
    """
    DEPRECATED: Returns unified extractor set to calibration phase.
    For backward compatibility only. Use get_unified_extractor() instead.
    """
    logger.warning("get_simple_extractor() is deprecated. Use get_unified_extractor() instead.")
    extractor = get_unified_extractor()
    if extractor:
        extractor.set_phase('calibration')
    return extractor


def get_full_extractor():
    """
    DEPRECATED: Returns unified extractor set to monitoring phase.
    For backward compatibility only. Use get_unified_extractor() instead.
    """
    logger.warning("get_full_extractor() is deprecated. Use get_unified_extractor() instead.")
    extractor = get_unified_extractor()
    if extractor:
        extractor.set_phase('monitoring')
    return extractor


def reset_extractors():
    """
    Reset the unified extractor (use with caution — mainly for testing).
    Properly cleans up MediaPipe resources before resetting.
    """
    global _unified_extractor

    logger.warning("⚠️ Resetting unified extractor...")

    with _unified_extractor_lock:
        if _unified_extractor is not None:
            try:
                _unified_extractor.cleanup()
            except Exception as e:
                logger.error(f"Error cleaning up UnifiedFaceExtractor: {e}")
            _unified_extractor = None

    logger.info("✅ Unified extractor reset")


def get_extractor_status():
    """
    Get status of singleton extractor (useful for health-check endpoints).

    Returns:
        dict: Status of the extractor.
    """
    return {
        'unified_extractor_initialized': _unified_extractor is not None,
        'current_phase': _unified_extractor.current_phase if _unified_extractor else None,
    }