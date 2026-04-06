import cv2
import numpy as np
import torch
import torch.nn as nn
import psycopg2
from datetime import datetime
import time
import logging
import mediapipe as mp
import queue
from threading import Thread, Lock
from collections import deque
from scipy.spatial.transform import Rotation

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============================================================================
# MODEL ARCHITECTURE - MATCHING THE CHECKPOINT
# ============================================================================

class StochasticDepth(nn.Module):
    def __init__(self, drop_prob=0.15):
        super().__init__()
        self.drop_prob = drop_prob

    def forward(self, x):
        if not self.training:
            return x
        keep_prob = 1 - self.drop_prob
        shape = (x.shape[0],) + (1,) * (x.ndim - 1)
        random_tensor = keep_prob + torch.rand(shape, dtype=x.dtype, device=x.device)
        random_tensor.floor_()
        return x.div(keep_prob) * random_tensor


class MaxRegularizediTrackerModel(nn.Module):
    """Model that matches the checkpoint structure exactly"""

    def __init__(self, dropout_rate=0.5, stochastic_depth=0.0):
        super().__init__()

        self.dropout_rate = dropout_rate
        self.stochastic_depth = stochastic_depth

        # Eye feature extractor - EXACT structure from checkpoint (with Dropout2d)
        self.eye_extractor = nn.Sequential(
            nn.Conv2d(3, 64, kernel_size=5, stride=1, padding=2),  # index 0
            nn.BatchNorm2d(64),  # index 1
            nn.ReLU(inplace=True),  # index 2
            nn.MaxPool2d(2, 2),  # index 3
            nn.Dropout2d(0.2),  # index 4

            nn.Conv2d(64, 128, kernel_size=3, stride=1, padding=1),  # index 5
            nn.BatchNorm2d(128),  # index 6
            nn.ReLU(inplace=True),  # index 7
            nn.MaxPool2d(2, 2),  # index 8
            nn.Dropout2d(0.2),  # index 9

            nn.Conv2d(128, 256, kernel_size=3, stride=1, padding=1),  # index 10
            nn.BatchNorm2d(256),  # index 11
            nn.ReLU(inplace=True),  # index 12
            nn.AdaptiveAvgPool2d((4, 4)),  # index 13
            nn.Dropout2d(0.3)  # index 14
        )

        # Face feature extractor - EXACT structure from checkpoint (with Dropout2d)
        self.face_extractor = nn.Sequential(
            nn.Conv2d(3, 64, kernel_size=7, stride=1, padding=3),  # index 0
            nn.BatchNorm2d(64),  # index 1
            nn.ReLU(inplace=True),  # index 2
            nn.MaxPool2d(2, 2),  # index 3
            nn.Dropout2d(0.2),  # index 4

            nn.Conv2d(64, 128, kernel_size=5, stride=1, padding=2),  # index 5
            nn.BatchNorm2d(128),  # index 6
            nn.ReLU(inplace=True),  # index 7
            nn.MaxPool2d(2, 2),  # index 8
            nn.Dropout2d(0.2),  # index 9

            nn.Conv2d(128, 256, kernel_size=3, stride=1, padding=1),  # index 10
            nn.BatchNorm2d(256),  # index 11
            nn.ReLU(inplace=True),  # index 12
            nn.Conv2d(256, 512, kernel_size=3, stride=1, padding=1),  # index 13
            nn.BatchNorm2d(512),  # index 14
            nn.ReLU(inplace=True),  # index 15
            nn.AdaptiveAvgPool2d((4, 4)),  # index 16
            nn.Dropout2d(0.3)  # index 17
        )

        # Eye feature projection - matches checkpoint
        eye_features = 256 * 4 * 4  # 4096
        self.eye_projection = nn.Sequential(
            nn.Linear(eye_features, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate),
            nn.Linear(256, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate)
        )

        # Face feature projection - matches checkpoint
        face_features = 512 * 4 * 4  # 8192
        self.face_projection = nn.Sequential(
            nn.Linear(face_features, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate),
            nn.Linear(512, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate)
        )

        # Head pose encoder - matches checkpoint
        self.pose_encoder = nn.Sequential(
            nn.Linear(2, 32),
            nn.BatchNorm1d(32),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate),
            nn.Linear(32, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate)
        )

        # Gaze estimation head - matches checkpoint
        # 128 (left_eye) + 128 (right_eye) + 256 (face) + 64 (head_pose) = 576
        total_features = 128 * 2 + 256 + 64
        self.gaze_head = nn.Sequential(
            nn.Linear(total_features, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate),

            nn.Linear(256, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate),

            nn.Linear(128, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_rate),

            nn.Linear(64, 2)  # [pitch, yaw] in radians
        )

    def forward(self, left_eye, right_eye, face, head_pose):
        """
        Forward pass

        Args:
            left_eye: [batch, 3, H, W]
            right_eye: [batch, 3, H, W]
            face: [batch, 3, H, W]
            head_pose: [batch, 2] - pitch, yaw

        Returns:
            gaze: [batch, 2] - pitch, yaw predictions
        """
        # Extract eye features (shared eye_extractor)
        left_features = self.eye_extractor(left_eye)
        right_features = self.eye_extractor(right_eye)

        # Project eye features separately
        left_proj = self.eye_projection(left_features.view(left_features.size(0), -1))
        right_proj = self.eye_projection(right_features.view(right_features.size(0), -1))

        # Extract and project face features
        face_features = self.face_extractor(face)
        face_proj = self.face_projection(face_features.view(face_features.size(0), -1))

        # Encode head pose
        pose_proj = self.pose_encoder(head_pose)

        # Combine all features
        combined = torch.cat([left_proj, right_proj, face_proj, pose_proj], dim=1)

        # Predict gaze
        gaze = self.gaze_head(combined)

        return gaze


def load_model(path, device):
    """Load trained model with proper error handling"""
    model = MaxRegularizediTrackerModel(dropout_rate=0.6, stochastic_depth=0.2).to(device)

    try:
        # First try: Load with weights_only=False to handle numpy scalars
        logger.info(f"Loading model from {path}...")
        checkpoint = torch.load(path, map_location=device, weights_only=False)

        # Handle different checkpoint formats
        if 'model_state_dict' in checkpoint:
            state_dict = checkpoint['model_state_dict']
            logger.info("Found 'model_state_dict' in checkpoint")
        elif 'state_dict' in checkpoint:
            state_dict = checkpoint['state_dict']
            logger.info("Found 'state_dict' in checkpoint")
        else:
            state_dict = checkpoint
            logger.info("Using checkpoint directly as state_dict")

        # Load the state dict
        missing_keys, unexpected_keys = model.load_state_dict(state_dict, strict=False)

        if missing_keys:
            logger.warning(f"Missing keys: {missing_keys[:5]}...")  # Show first 5
        if unexpected_keys:
            logger.warning(f"Unexpected keys: {unexpected_keys[:5]}...")  # Show first 5

        model.eval()
        logger.info(f"✅ Model loaded successfully from {path}")
        return model

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise ValueError(f"Cannot load model from {path}: {str(e)}")


# ============================================================================
# PREPROCESSING CONSTANTS
# ============================================================================
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)


# ============================================================================
# SIMPLE EYE EXTRACTOR (No Pose Estimation - For Calibration)
# ============================================================================

class SimpleFaceExtractor:
    """Extracts face and eyes without pose estimation - for calibration only"""

    def __init__(self):
        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.3,
            min_tracking_confidence=0.3,
            static_image_mode=False
        )
        logger.info("✅ SimpleFaceExtractor initialized for calibration")

    def extract(self, frame):
        """Extract face and eyes without pose estimation"""
        try:
            h, w = frame.shape[:2]

            # Convert to RGB
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(rgb)

            if not results.multi_face_landmarks:
                return None

            landmarks = results.multi_face_landmarks[0].landmark

            # Convert to pixel coordinates
            landmarks_pixel = np.array([
                [lm.x * w, lm.y * h, lm.z] for lm in landmarks
            ], dtype=np.float32)

            # Extract eyes using simple bounding boxes
            left_eye = self._extract_eye(frame, landmarks_pixel, left=True)
            right_eye = self._extract_eye(frame, landmarks_pixel, left=False)

            if left_eye is None or right_eye is None:
                return None

            # Extract face region
            face = self._extract_face(frame, landmarks_pixel)
            if face is None:
                return None

            # For calibration, use default pose (looking straight)
            head_pose = np.array([0.0, 0.0], dtype=np.float32)

            return {
                'left_eye': left_eye,
                'right_eye': right_eye,
                'face': face,
                'head_pose': head_pose,
                'head_pose_angles': None,
                'head_pose_confidence': 1.0,
                'valid': True
            }

        except Exception as e:
            logger.debug(f"SimpleFaceExtractor error: {e}")
            return None

    def _extract_eye(self, frame, landmarks, left=True):
        """Extract eye region"""
        try:
            # Eye landmark indices
            if left:
                indices = [33, 133, 160, 159, 158, 157, 173]
            else:
                indices = [362, 263, 387, 386, 385, 384, 398]

            eye_pts = landmarks[indices, :2]

            # Get bounding box
            x_min, y_min = eye_pts.min(axis=0).astype(int)
            x_max, y_max = eye_pts.max(axis=0).astype(int)

            # Add margin
            margin_x = int((x_max - x_min) * 0.25)
            margin_y = int((y_max - y_min) * 0.25)

            x_min = max(0, x_min - margin_x)
            y_min = max(0, y_min - margin_y)
            x_max = min(frame.shape[1], x_max + margin_x)
            y_max = min(frame.shape[0], y_max + margin_y)

            # Extract and resize
            eye = frame[y_min:y_max, x_min:x_max]
            if eye.size == 0:
                return None

            eye = cv2.resize(eye, (60, 36))
            return eye

        except Exception as e:
            logger.debug(f"Eye extraction error: {e}")
            return None

    def _extract_face(self, frame, landmarks):
        """Extract face region"""
        try:
            face_pts = landmarks[:, :2]

            x_min, y_min = face_pts.min(axis=0).astype(int)
            x_max, y_max = face_pts.max(axis=0).astype(int)

            margin = int((x_max - x_min) * 0.1)

            x_min = max(0, x_min - margin)
            y_min = max(0, y_min - margin)
            x_max = min(frame.shape[1], x_max + margin)
            y_max = min(frame.shape[0], y_max + margin)

            face = frame[y_min:y_max, x_min:x_max]
            if face.size == 0:
                return None

            face = cv2.resize(face, (64, 64))
            return face

        except Exception as e:
            logger.debug(f"Face extraction error: {e}")
            return None

    def cleanup(self):
        self.face_mesh.close()


# ============================================================================
# FULL FACE EXTRACTOR (With Pose Estimation - For Tracking)
# ============================================================================

class FullFaceExtractor:
    """Extracts face, eyes, and head pose - for gaze tracking"""

    def __init__(self):
        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            static_image_mode=False
        )
        self.pose_history = deque(maxlen=5)
        logger.info("✅ FullFaceExtractor initialized for tracking")

    def extract(self, frame):
        """Extract face, eyes, and estimate head pose"""
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

            # Extract eyes and face
            left_eye = self._extract_eye(frame, landmarks_pixel, left=True)
            right_eye = self._extract_eye(frame, landmarks_pixel, left=False)
            face = self._extract_face(frame, landmarks_pixel)

            if left_eye is None or right_eye is None or face is None:
                return None

            # Estimate head pose
            head_pose_angles, confidence = self._estimate_head_pose(landmarks_pixel, w, h)

            if head_pose_angles is None:
                return {
                    'left_eye': left_eye,
                    'right_eye': right_eye,
                    'face': face,
                    'head_pose': np.array([0.0, 0.0], dtype=np.float32),
                    'head_pose_angles': None,
                    'head_pose_confidence': 0.0,
                    'valid': False
                }

            # Convert to 2D for model input (yaw, pitch)
            yaw, pitch, roll = head_pose_angles
            head_pose_2d = np.array([yaw / 90.0, pitch / 90.0], dtype=np.float32)

            return {
                'left_eye': left_eye,
                'right_eye': right_eye,
                'face': face,
                'head_pose': head_pose_2d,
                'head_pose_angles': head_pose_angles,
                'head_pose_confidence': confidence,
                'valid': True
            }

        except Exception as e:
            logger.debug(f"FullFaceExtractor error: {e}")
            return None

    def _extract_eye(self, frame, landmarks, left=True):
        """Extract eye region"""
        try:
            if left:
                indices = [33, 133, 160, 159, 158, 157, 173]
            else:
                indices = [362, 263, 387, 386, 385, 384, 398]

            eye_pts = landmarks[indices, :2]

            x_min, y_min = eye_pts.min(axis=0).astype(int)
            x_max, y_max = eye_pts.max(axis=0).astype(int)

            margin_x = int((x_max - x_min) * 0.25)
            margin_y = int((y_max - y_min) * 0.25)

            x_min = max(0, x_min - margin_x)
            y_min = max(0, y_min - margin_y)
            x_max = min(frame.shape[1], x_max + margin_x)
            y_max = min(frame.shape[0], y_max + margin_y)

            eye = frame[y_min:y_max, x_min:x_max]
            if eye.size == 0:
                return None

            eye = cv2.resize(eye, (60, 36))
            return eye

        except Exception as e:
            logger.debug(f"Eye extraction error: {e}")
            return None

    def _extract_face(self, frame, landmarks):
        """Extract face region"""
        try:
            face_pts = landmarks[:, :2]

            x_min, y_min = face_pts.min(axis=0).astype(int)
            x_max, y_max = face_pts.max(axis=0).astype(int)

            margin = int((x_max - x_min) * 0.1)

            x_min = max(0, x_min - margin)
            y_min = max(0, y_min - margin)
            x_max = min(frame.shape[1], x_max + margin)
            y_max = min(frame.shape[0], y_max + margin)

            face = frame[y_min:y_max, x_min:x_max]
            if face.size == 0:
                return None

            face = cv2.resize(face, (64, 64))
            return face

        except Exception as e:
            logger.debug(f"Face extraction error: {e}")
            return None

    def _estimate_head_pose(self, landmarks_3d, img_width, img_height):
        """Estimate head pose using PnP"""
        try:
            # 3D model points (generic face model) - Y is UP in this model
            model_points = np.array([
                (0.0, 0.0, 0.0),  # Nose tip
                (0.0, -63.6, -12.5),  # Chin (negative Y is DOWN in 3D)
                (-43.3, 32.7, -26.0),  # Left eye left corner (positive Y is UP)
                (43.3, 32.7, -26.0),  # Right eye right corner
                (-28.9, -28.9, -24.1),  # Left mouth corner
                (28.9, -28.9, -24.1)  # Right mouth corner
            ], dtype=np.float32)

            # Convert MediaPipe coordinates (Y down) to match 3D model (Y up)
            # MediaPipe: (0,0) top-left, Y increases downward
            # 3D Model: Y increases upward
            image_points = np.array([
                [landmarks_3d[1, 0], img_height - landmarks_3d[1, 1]],  # Nose
                [landmarks_3d[152, 0], img_height - landmarks_3d[152, 1]],  # Chin
                [landmarks_3d[33, 0], img_height - landmarks_3d[33, 1]],  # Left eye
                [landmarks_3d[263, 0], img_height - landmarks_3d[263, 1]],  # Right eye
                [landmarks_3d[61, 0], img_height - landmarks_3d[61, 1]],  # Left mouth
                [landmarks_3d[291, 0], img_height - landmarks_3d[291, 1]]  # Right mouth
            ], dtype=np.float32)

            # Camera matrix
            focal_length = img_width
            center = (img_width / 2, img_height / 2)
            camera_matrix = np.array([
                [focal_length, 0, center[0]],
                [0, focal_length, center[1]],
                [0, 0, 1]
            ], dtype=np.float32)

            dist_coeffs = np.zeros((4, 1))

            # Solve PnP
            success, rotation_vec, translation_vec = cv2.solvePnP(
                model_points, image_points, camera_matrix, dist_coeffs,
                flags=cv2.SOLVEPNP_ITERATIVE
            )

            if not success:
                return None, 0.0

            # Convert to Euler angles
            rotation_mat, _ = cv2.Rodrigues(rotation_vec)
            r = Rotation.from_matrix(rotation_mat)
            euler_angles = r.as_euler('xyz', degrees=True)

            # euler_angles: [pitch, yaw, roll]
            pitch = euler_angles[0]
            yaw = euler_angles[1]
            roll = euler_angles[2]

            # Normalize angles to [-180, 180] range
            if pitch > 180:
                pitch -= 360
            elif pitch < -180:
                pitch += 360

            # Calculate reprojection error for confidence
            projected_points, _ = cv2.projectPoints(
                model_points, rotation_vec, translation_vec,
                camera_matrix, dist_coeffs
            )

            error = np.mean(np.linalg.norm(
                image_points - projected_points.squeeze(), axis=1
            ))
            confidence = max(0.0, min(1.0, 1.0 - error / 50.0))

            # Smooth pose with moving average
            pose = np.array([yaw, pitch, roll])
            self.pose_history.append(pose)

            if len(self.pose_history) >= 3:
                weights = np.exp(np.linspace(-1, 0, len(self.pose_history)))
                weights /= weights.sum()
                smoothed_pose = np.average(self.pose_history, axis=0, weights=weights)
            else:
                smoothed_pose = pose

            return smoothed_pose, confidence

        except Exception as e:
            logger.debug(f"Pose estimation error: {e}")
            return None, 0.0

    def cleanup(self):
        self.face_mesh.close()


# ============================================================================
# INFERENCE WORKER
# ============================================================================

class InferenceWorker(Thread):
    def __init__(self, model, device, extractor):
        super().__init__(daemon=True)
        self.model = model
        self.device = device
        self.extractor = extractor
        self.frame_queue = queue.Queue(maxsize=2)
        self.result_lock = Lock()
        self.latest_result = None
        self.running = True
        self.processing_times = deque(maxlen=100)

    def run(self):
        """Main inference loop"""
        logger.info("InferenceWorker started")

        while self.running:
            try:
                # Get frame
                try:
                    frame = self.frame_queue.get(timeout=0.05)
                except queue.Empty:
                    continue

                start_time = time.time()

                # Extract features
                detection = self.extractor.extract(frame)

                if detection is None:
                    result = (None, 'NO_FACE', None, 0.0)
                elif not detection.get('valid', True):
                    result = (
                        None,
                        'INVALID_POSE',
                        detection.get('head_pose_angles', None),
                        detection.get('head_pose_confidence', 0.0)
                    )
                else:
                    try:
                        # Preprocess images
                        left = (cv2.cvtColor(detection['left_eye'], cv2.COLOR_BGR2RGB).astype(
                            np.float32) / 255 - MEAN) / STD
                        right = (cv2.cvtColor(detection['right_eye'], cv2.COLOR_BGR2RGB).astype(
                            np.float32) / 255 - MEAN) / STD
                        face = (cv2.cvtColor(detection['face'], cv2.COLOR_BGR2RGB).astype(
                            np.float32) / 255 - MEAN) / STD

                        # Convert to tensors
                        left_t = torch.from_numpy(left).permute(2, 0, 1).unsqueeze(0).to(self.device)
                        right_t = torch.from_numpy(right).permute(2, 0, 1).unsqueeze(0).to(self.device)
                        face_t = torch.from_numpy(face).permute(2, 0, 1).unsqueeze(0).to(self.device)
                        pose_t = torch.from_numpy(detection['head_pose']).unsqueeze(0).to(self.device)

                        # Model inference
                        with torch.no_grad():
                            gaze = self.model(left_t, right_t, face_t, pose_t)

                        # Output is gaze coordinates in [0, 1] range
                        # Model outputs [pitch, yaw] in radians (can be negative)
                        gp = gaze.cpu().numpy()[0]

                        # Don't clip to [0,1] - preserve sign for direction!
                        # Just ensure values are reasonable (within [-1, 1] radians = ±57°)
                        pitch = float(np.clip(gp[0], -1.0, 1.0))
                        yaw = float(np.clip(gp[1], -1.0, 1.0))

                        result = (
                            (pitch, yaw),
                            'SUCCESS',
                            detection['head_pose_angles'],
                            detection['head_pose_confidence']
                        )

                    except Exception as e:
                        logger.error(f"Preprocessing/inference error: {e}")
                        result = (None, 'PREPROC_ERR', None, 0.0)

                # Track processing time
                processing_time = time.time() - start_time
                self.processing_times.append(processing_time)

                # Update result
                with self.result_lock:
                    self.latest_result = result

            except Exception as e:
                logger.error(f"Inference worker error: {e}")

        logger.info("InferenceWorker stopped")

    def submit_frame(self, frame):
        """Submit frame for inference"""
        try:
            self.frame_queue.put_nowait(frame.copy())
        except queue.Full:
            pass

    def get_result(self):
        """Get latest inference result"""
        with self.result_lock:
            return self.latest_result

    def stop(self):
        """Stop worker thread"""
        self.running = False


# ============================================================================
# DATABASE WRITER
# ============================================================================

class AsyncDBWriter(Thread):
    def __init__(self, db_conn):
        super().__init__(daemon=True)
        self.db_conn = db_conn
        self.write_queue = queue.Queue()
        self.running = True

    def run(self):
        """Main write loop"""
        while self.running:
            try:
                task = self.write_queue.get(timeout=0.5)
                if task is None:
                    continue

                task_type, data = task

                if task_type == 'event':
                    self._write_event(*data)
                elif task_type == 'warning':
                    self._write_warning(*data)

            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"DB write error: {e}")

    def _write_event(self, cid, sid, ts, gp, dist, viol, st, img, warn_num, pose):
        """Write gaze tracking event"""
        try:
            conn = psycopg2.connect(**self.db_conn)
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO gaze_tracking_events 
                (candidate_id, exam_session_id, timestamp, gaze_x, gaze_y, baseline_distance,
                 is_off_screen, no_face_detected, multiple_faces, captured_image_path, 
                 warning_number, head_pose_yaw, head_pose_pitch)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                cid, sid, ts,
                gp[0] if gp else None,
                gp[1] if gp else None,
                dist,
                viol,
                st == 'NO_FACE',
                st == 'MULTIPLE_FACES',
                img,
                warn_num,
                pose[0] if pose else None,
                pose[1] if pose else None
            ))

            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Event write error: {e}")

    def _write_warning(self, cid, sid, warns, ts, warn_limit):
        """Write warning record"""
        try:
            conn = psycopg2.connect(**self.db_conn)
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO gaze_warnings 
                (candidate_id, exam_session_id, warning_count, last_warning_time, status)
                VALUES (%s,%s,%s,%s,%s) 
                ON CONFLICT (candidate_id, exam_session_id) DO UPDATE
                SET warning_count = gaze_warnings.warning_count + 1,
                    last_warning_time = %s,
                    status = CASE WHEN gaze_warnings.warning_count + 1 >= %s 
                             THEN 'CRITICAL' ELSE 'ACTIVE' END
            """, (cid, sid, warns, ts, 'ACTIVE', ts, warn_limit))

            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Warning write error: {e}")

    def submit_event(self, cid, sid, ts, gp, dist, viol, st, img, warn_num, pose):
        """Queue event write"""
        self.write_queue.put(('event', (cid, sid, ts, gp, dist, viol, st, img, warn_num, pose)))

    def submit_warning(self, cid, sid, warns, ts, warn_limit):
        """Queue warning write"""
        self.write_queue.put(('warning', (cid, sid, warns, ts, warn_limit)))

    def stop(self):
        """Stop writer thread"""
        self.running = False