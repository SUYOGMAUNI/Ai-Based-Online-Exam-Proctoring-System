import os
import cv2
import numpy as np
import torch
import psycopg2
from datetime import datetime
import time
import logging
from collections import deque

# Import from Part 1
from gaze1 import (
    load_model,
    SimpleFaceExtractor,  # For calibration
    FullFaceExtractor,  # For tracking
    InferenceWorker,
    AsyncDBWriter
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION - ADJUSTED FOR ACTUAL MODEL OUTPUT RANGE
# ============================================================================

CALIBRATION_DUR = 10  # 10 seconds calibration
INFERENCE_FPS = 10  # 10 FPS for better responsiveness
THRESHOLD = 0.09  # RELAXED: 0.15 rad (~8.5°) deviation threshold
WARN_LIMIT = 10
VIOLATION_COOLDOWN = 5  # 5 seconds between violations

# Safe zone - RELATIVE to baseline (margin around center)
# Since model outputs are angular (radians), use smaller margins
SAFE_ZONE_MARGIN = {
    'x': 0.15,  # ±0.15 rad (~8.5°) left/right from baseline
    'y': 0.10  # ±0.10 rad (~5.7°) up/down from baseline
}

DB_CONN = {
    'host': 'localhost',
    'database': 'Proctoring',
    'user': 'postgres',
    'password': '526183'
}

CAPTURES_DIR = r"D:\GazeCaptures"
LOGS_DIR = r"D:\logs"
os.makedirs(CAPTURES_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)


# ============================================================================
# CALIBRATION MANAGER
# ============================================================================

class CalibrationManager:
    """Manages calibration - collects samples over 10 seconds"""

    def __init__(self, min_samples=30):
        self.gaze_samples = []
        self.min_samples = min_samples

    def add_sample(self, gaze_point):
        """Add a gaze sample"""
        if gaze_point is None:
            return

        self.gaze_samples.append(gaze_point)

        # Log progress every 5 samples
        if len(self.gaze_samples) % 5 == 0:
            logger.info(f"📊 Calibration: {len(self.gaze_samples)} samples collected")


# ============================================================================
# STRICT GAZE VALIDATOR - FIXED TO BE RELATIVE TO BASELINE
# ============================================================================

class StrictGazeValidator:
    """
    VALIDATOR FIXED:
    - Safe zone is now RELATIVE to baseline (dynamic based on calibration)
    - Better suited for angular gaze data (radians)
    """

    def __init__(self, baseline, config=None):
        self.baseline = np.array(baseline)
        self.config = config or {
            'distance_threshold': THRESHOLD,  # Angular distance in radians
            'eye_sensitivity': 1.0,  # Multiplier for threshold
            'head_pose_yaw_limit': 40,  # Degrees
            'head_pose_pitch_limit': 30,  # Degrees
            'safe_zone_margin': SAFE_ZONE_MARGIN,  # Relative margins
            'temporal_window': 3,
            'temporal_threshold': 0.66,  # 2 out of 3 frames
            'confidence_threshold': 0.3,
        }

        self.gaze_history = deque(maxlen=self.config['temporal_window'])
        self.violation_history = deque(maxlen=self.config['temporal_window'])
        self.consecutive_violations = 0

        # Calculate dynamic safe zone based on baseline
        margin = self.config['safe_zone_margin']
        self.safe_zone = {
            'x_min': self.baseline[0] - margin['x'],
            'x_max': self.baseline[0] + margin['x'],
            'y_min': self.baseline[1] - margin['y'],
            'y_max': self.baseline[1] + margin['y']
        }

        logger.info(f"🔒 Validator initialized with RELATIVE safe zone:")
        logger.info(f"   Baseline: ({self.baseline[0]:.3f}, {self.baseline[1]:.3f})")
        logger.info(f"   Safe zone X: [{self.safe_zone['x_min']:.3f}, {self.safe_zone['x_max']:.3f}]")
        logger.info(f"   Safe zone Y: [{self.safe_zone['y_min']:.3f}, {self.safe_zone['y_max']:.3f}]")
        logger.info(
            f"   Max deviation: {self.config['distance_threshold']:.3f} rad ({np.degrees(self.config['distance_threshold']):.1f}°)")

    def check_violation(self, gaze_point, head_pose_angles, head_pose_confidence):
        """
        Check for exam violations with proper head pose and gaze tracking.

        Args:
            gaze_point: (pitch, yaw) in radians from gaze model
            head_pose_angles: (yaw, pitch, roll) in degrees from PnP, or None
            head_pose_confidence: confidence score 0-1

        Returns:
            tuple: (confirmed_violation, violation_type, distance, confidence)
        """
        if gaze_point is None:
            return False, "no_gaze_data", 0.0, 0.0

        # Store gaze history for temporal filtering
        self.gaze_history.append(gaze_point)

        # Calculate angular distance from baseline (Euclidean distance in radians)
        gaze_vec = np.array(gaze_point)
        baseline_vec = np.array(self.baseline)
        distance = np.linalg.norm(gaze_vec - baseline_vec)

        # Extract head pose angles (handle None case)
        if head_pose_angles is not None and len(head_pose_angles) >= 2:
            # head_pose_angles format: [yaw, pitch, roll] in degrees
            yaw = float(head_pose_angles[0])
            pitch = float(head_pose_angles[1])

            # Normalize angles to [-180, 180] to handle wraparound (e.g., 170° vs -170°)
            yaw = ((yaw + 180) % 360) - 180 if yaw is not None else 0.0
            pitch = ((pitch + 180) % 360) - 180 if pitch is not None else 0.0
        else:
            yaw, pitch = 0.0, 0.0

        # Initialize violation flags
        eye_violation = False
        safe_zone_violation = False
        head_pose_violation = False
        violation_type = "none"

        # 🔥 PRIORITY 1: HEAD POSE CHECK (Most reliable for "looking away")
        # Check if head is turned too far left/right (yaw) or up/down (pitch)
        if abs(yaw) > self.config['head_pose_yaw_limit']:
            head_pose_violation = True
            violation_type = "extreme_head_yaw"
            logger.info(f"🤯 HEAD YAW VIOLATION: {yaw:.1f}° (limit: {self.config['head_pose_yaw_limit']}°)")

        elif abs(pitch) > self.config['head_pose_pitch_limit']:
            head_pose_violation = True
            violation_type = "extreme_head_pitch"
            logger.info(f"🤯 HEAD PITCH VIOLATION: {pitch:.1f}° (limit: {self.config['head_pose_pitch_limit']}°)")

        # 🔥 PRIORITY 2: GAZE DEVIATION (Eye movement away from baseline)
        # Check if gaze angular distance exceeds threshold
        if not head_pose_violation:
            if distance > self.config['distance_threshold']:
                eye_violation = True
                violation_type = "gaze_deviation"
                logger.info(f"👁️ GAZE DEVIATION: {distance:.3f} rad ({np.degrees(distance):.1f}°) "
                            f"> threshold {self.config['distance_threshold']:.3f} rad")

        # 🔥 PRIORITY 3: SAFE ZONE BOUNDARIES (Relative to baseline)
        # Check if gaze is outside the safe rectangle around baseline
        if not head_pose_violation and not eye_violation:
            in_safe_zone = (
                    self.safe_zone['x_min'] <= gaze_point[0] <= self.safe_zone['x_max'] and
                    self.safe_zone['y_min'] <= gaze_point[1] <= self.safe_zone['y_max']
            )

            if not in_safe_zone:
                safe_zone_violation = True
                violation_type = "outside_safe_zone"
                # Calculate which boundary was crossed for logging
                x_status = "OK" if self.safe_zone['x_min'] <= gaze_point[0] <= self.safe_zone['x_max'] else "OUT"
                y_status = "OK" if self.safe_zone['y_min'] <= gaze_point[1] <= self.safe_zone['y_max'] else "OUT"
                logger.info(f"⚠️ SAFE ZONE VIOLATION: ({gaze_point[0]:.3f}, {gaze_point[1]:.3f}) "
                            f"X:{x_status} Y:{y_status}")

        # Determine overall violation state
        violation = head_pose_violation or eye_violation or safe_zone_violation

        # Temporal filtering: Require sustained violation across multiple frames
        if violation:
            self.violation_history.append(True)
        else:
            self.violation_history.append(False)
            # Reset consecutive counter when we have clear frames
            if len(self.violation_history) >= self.config['temporal_window']:
                if sum(self.violation_history) == 0:  # All clear
                    self.consecutive_violations = 0

        # Check if violation is confirmed (sustained for enough frames)
        confirmed_violation = False
        if len(self.violation_history) >= self.config['temporal_window']:
            recent_violations = sum(self.violation_history)
            required_violations = int(self.config['temporal_window'] * self.config['temporal_threshold'])

            if recent_violations >= required_violations:
                self.consecutive_violations += 1
                if self.consecutive_violations == 1:  # Log only on first confirmation
                    confirmed_violation = True
                    logger.info(f"✅ VIOLATION CONFIRMED: {violation_type} "
                                f"({recent_violations}/{self.config['temporal_window']} frames, "
                                f"distance: {distance:.3f} rad)")

        # Calculate detection confidence score (0-1)
        # Weight: head pose confidence 30%, gaze deviation 40%, temporal consistency 30%
        gaze_deviation_ratio = min(1.0, distance / (self.config['distance_threshold'] * 2))
        temporal_consistency = min(1.0, len(self.violation_history) / self.config['temporal_window'])

        detection_confidence = (
                head_pose_confidence * 0.3 +
                gaze_deviation_ratio * 0.4 +
                temporal_consistency * 0.3
        )
        detection_confidence = min(1.0, max(0.0, detection_confidence))

        return confirmed_violation, violation_type, distance, detection_confidence

    def reset(self):
        """Reset violation history after handling a confirmed violation"""
        self.violation_history.clear()
        self.consecutive_violations = 0
        self.gaze_history.clear()


# ============================================================================
# MAIN PIPELINE
# ============================================================================

class FastGazePipeline:
    """Optimized pipeline with FIXED monitoring"""

    def __init__(self, candidate_id, session_id, model_path):
        self.cid = candidate_id
        self.sid = session_id
        self.warns = 0
        self.calibrated = False
        self.baseline = None

        # Logging
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.log_path = os.path.join(LOGS_DIR, f"gaze_{candidate_id}_{timestamp}.txt")
        self._log("=" * 70)
        self._log(f"EXAM SESSION START | Candidate: {candidate_id}")
        self._log(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self._log(f"Threshold: {THRESHOLD} rad ({np.degrees(THRESHOLD):.1f}°)")
        self._log("=" * 70 + "\n")

        # Device
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {self.device}")

        # Load model
        self.model = load_model(model_path, self.device)

        # Initialize extractors
        self.calibration_extractor = SimpleFaceExtractor()  # For calibration
        self.tracking_extractor = FullFaceExtractor()  # For tracking

        # Initialize worker with calibration extractor first
        self.inference_worker = InferenceWorker(self.model, self.device, self.calibration_extractor)

        # DB Writer - wrapped in try-except to handle no-DB scenario gracefully
        self.db_writer = None
        try:
            self.db_writer = AsyncDBWriter(DB_CONN)
            self.db_writer.start()
            logger.info("✅ Database writer started")
        except Exception as e:
            logger.warning(f"⚠️ Database not available (non-critical): {e}")
            self.db_writer = None

        self.validator = None

        # State
        self.current_gaze = None
        self.current_status = None
        self.current_pose = None
        self.current_confidence = None

        # Performance
        self.fps_queue = deque(maxlen=30)
        self.last_frame_time = time.time()
        self.last_violation_time = 0
        self.frame_count = 0

        # Initialize DB tables if available
        self._init_db()

        # Start inference worker
        self.inference_worker.start()
        logger.info("✅ Inference worker started")

    def _init_db(self):
        """Initialize database - non-critical if fails"""
        if not DB_CONN.get('host') or DB_CONN['host'] == 'localhost':
            # Try to connect, but don't crash if unavailable
            try:
                conn = psycopg2.connect(**DB_CONN)
                conn.close()
                logger.info("✅ Database connection verified")
            except Exception:
                logger.warning("⚠️ Database unavailable - continuing without logging to DB")
                return

    def _log(self, msg):
        """Write to log file"""
        try:
            with open(self.log_path, 'a', encoding='utf-8') as f:
                f.write(f"{datetime.now().strftime('%H:%M:%S.%f')[:12]} - {msg}\n")
        except:
            pass

    def _calibrate(self, cap):
        """10-second calibration - collects 30-40 samples"""
        logger.info(f"⏳ Starting {CALIBRATION_DUR}-second calibration...")
        logger.info("Please look straight at the screen center")

        calibration_manager = CalibrationManager(min_samples=30)
        start_time = time.time()
        last_sample_time = start_time
        samples_collected = 0

        while time.time() - start_time < CALIBRATION_DUR:
            ret, frame = cap.read()
            if not ret:
                continue

            current_time = time.time()

            # Process samples at ~4 Hz
            if current_time - last_sample_time >= 0.25:
                self.inference_worker.submit_frame(frame)

                result = self.inference_worker.get_result()
                if result:
                    gaze_point, status, pose, confidence = result

                    if gaze_point is not None:
                        calibration_manager.add_sample(gaze_point)
                        samples_collected += 1
                        last_sample_time = current_time

            # Show MIRRORED display
            display_frame = cv2.flip(frame, 1)
            elapsed = time.time() - start_time
            remaining = max(0, CALIBRATION_DUR - elapsed)

            # Draw calibration UI
            h, w = display_frame.shape[:2]
            cv2.putText(display_frame, "CALIBRATION",
                        (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
            cv2.putText(display_frame, f"Time: {remaining:.1f}s",
                        (50, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            cv2.putText(display_frame, f"Samples: {samples_collected}/30",
                        (50, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            cv2.putText(display_frame, "Look at screen center",
                        (50, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)

            # Draw target
            cv2.circle(display_frame, (w // 2, h // 2), 20, (0, 255, 0), 2)
            cv2.circle(display_frame, (w // 2, h // 2), 5, (0, 255, 0), -1)

            cv2.imshow('Calibration', display_frame)
            cv2.waitKey(1)

        cv2.destroyWindow('Calibration')

        # Calculate baseline
        if samples_collected >= 10:
            gazes = np.array(calibration_manager.gaze_samples)
            self.baseline = np.median(gazes, axis=0)
            self.calibrated = True

            # Switch to tracking extractor with pose estimation
            self.inference_worker.extractor = self.tracking_extractor

            # Initialize validator with RELATIVE safe zone
            self.validator = StrictGazeValidator(
                baseline=self.baseline,
                config={
                    'distance_threshold': THRESHOLD,
                    'eye_sensitivity': 1.0,  # Normalized to threshold
                    'head_pose_yaw_limit': 50,
                    'head_pose_pitch_limit': 40,
                    'safe_zone_margin': SAFE_ZONE_MARGIN,  # Use margins instead of absolute
                    'temporal_window': 3,
                    'temporal_threshold': 0.66,
                    'confidence_threshold': 0.3,
                }
            )

            logger.info(f"✅ Calibration SUCCESS: {samples_collected} samples")
            logger.info(f"   Baseline (center): ({self.baseline[0]:.3f}, {self.baseline[1]:.3f}) rad")
            logger.info(
                f"   Range X: [{self.baseline[0] - SAFE_ZONE_MARGIN['x']:.3f}, {self.baseline[0] + SAFE_ZONE_MARGIN['x']:.3f}]")
            logger.info(
                f"   Range Y: [{self.baseline[1] - SAFE_ZONE_MARGIN['y']:.3f}, {self.baseline[1] + SAFE_ZONE_MARGIN['y']:.3f}]")

            return True
        else:
            logger.error(f"❌ Calibration failed - only {samples_collected} samples")
            return False

    def run(self):
        """Main tracking loop"""
        try:
            cap = cv2.VideoCapture(0)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            cap.set(cv2.CAP_PROP_FPS, 30)

            if not cap.isOpened():
                logger.error("Cannot open camera")
                return

            logger.info("Camera opened successfully")

            if not self._calibrate(cap):
                logger.error("Calibration failed, exiting...")
                cap.release()
                return

            logger.info("\n" + "=" * 70)
            logger.info("🔒 MONITORING STARTED (Looking at center is now SAFE)")
            logger.info(
                f"Safe zone: ±{SAFE_ZONE_MARGIN['x']:.2f} rad horizontal, ±{SAFE_ZONE_MARGIN['y']:.2f} rad vertical")
            logger.info(f"Deviation limit: {THRESHOLD:.2f} rad ({np.degrees(THRESHOLD):.1f}°)")
            logger.info("=" * 70 + "\n")

            last_inference_submit = 0
            last_fps_log = time.time()
            last_gaze_log = time.time()

            while True:
                ret, frame = cap.read()
                if not ret:
                    continue

                self.frame_count += 1
                now = time.time()

                # Calculate FPS
                fps = 1.0 / (now - self.last_frame_time) if (now - self.last_frame_time) > 0 else 0
                self.fps_queue.append(fps)
                self.last_frame_time = now
                avg_fps = np.mean(self.fps_queue) if self.fps_queue else 0

                # Log FPS periodically
                if now - last_fps_log > 5:
                    logger.info(f"📊 FPS: {avg_fps:.1f} | Frames: {self.frame_count}")
                    last_fps_log = now

                # Submit for inference
                if now - last_inference_submit >= 1.0 / INFERENCE_FPS:
                    self.inference_worker.submit_frame(frame)
                    last_inference_submit = now

                # Get result
                result = self.inference_worker.get_result()
                if result:
                    gaze_point, status, pose, confidence = result

                    self.current_gaze = gaze_point
                    self.current_status = status
                    self.current_pose = pose
                    self.current_confidence = confidence

                    if status == 'NO_FACE':
                        if now - self.last_violation_time >= VIOLATION_COOLDOWN:
                            self._handle_violation(now, frame, None, 0.0, 'NO_FACE', None)

                    elif status == 'SUCCESS' and gaze_point:
                        # Log gaze periodically
                        if now - last_gaze_log > 3:
                            dist = np.linalg.norm(np.array(gaze_point) - self.baseline)
                            logger.info(
                                f"👁️ Gaze: ({gaze_point[0]:.3f}, {gaze_point[1]:.3f}) | Deviation: {dist:.3f} rad ({np.degrees(dist):.1f}°)")
                            last_gaze_log = now

                        # Check for violations
                        pose_angles = pose if pose is not None else [0, 0, 0]
                        pose_conf = confidence if confidence is not None else 0.0

                        is_violation, viol_type, distance, detection_confidence = self.validator.check_violation(
                            gaze_point=gaze_point,
                            head_pose_angles=pose_angles,
                            head_pose_confidence=pose_conf
                        )

                        if is_violation and viol_type != "none" and now - self.last_violation_time >= VIOLATION_COOLDOWN:
                            self._handle_violation(now, frame, gaze_point, distance, viol_type, pose_angles)
                            self.validator.reset()

                # Create display
                display_frame = cv2.flip(frame, 1)
                disp = self._create_display(display_frame, avg_fps)
                cv2.imshow('Gaze Tracker [Q=Quit, R=Reset]', disp)

                # Key handling
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    logger.info("Quit requested by user")
                    break
                elif key == ord('r'):
                    logger.info("Manual reset")
                    self.warns = 0
                    if self.validator:
                        self.validator.reset()
                    logger.info("Warnings reset to 0")

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
        except Exception as e:
            logger.error(f"Tracking error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            cap.release()
            self.calibration_extractor.cleanup()
            self.tracking_extractor.cleanup()
            self.inference_worker.stop()
            if self.db_writer:
                self.db_writer.stop()
            cv2.destroyAllWindows()

            self._log("\n" + "=" * 70)
            self._log(f"SESSION END | Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            self._log(f"Total Frames: {self.frame_count}")
            self._log(f"Total Warnings: {self.warns}")
            if self.baseline is not None:
                self._log(f"Baseline: ({self.baseline[0]:.3f}, {self.baseline[1]:.3f})")
            self._log("=" * 70)

            logger.info(f"\n{'=' * 70}")
            logger.info("SESSION COMPLETE")
            logger.info(f"{'=' * 70}")

    def _handle_violation(self, timestamp, frame, gaze_point, distance, viol_type, pose_angles):
        """Handle violation"""
        self.warns += 1
        self.last_violation_time = timestamp

        # Save capture
        filepath = None
        if frame is not None:
            filename = f"{self.cid}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')[:-3]}_{viol_type}.jpg"
            filepath = os.path.join(CAPTURES_DIR, filename)
            try:
                cv2.imwrite(filepath, frame)
                logger.info(f"📸 Saved: {filename}")
            except Exception as e:
                logger.error(f"Failed to save image: {e}")

        # Prepare message
        if gaze_point:
            x, y = gaze_point
            if self.validator:
                dist_deg = np.degrees(distance)
                threshold_deg = np.degrees(
                    self.validator.config['distance_threshold'] * self.validator.config['eye_sensitivity'])
                msg = (f"🚨 VIOLATION #{self.warns}: {viol_type.upper()}\n"
                       f"   Gaze: ({x:.3f}, {y:.3f}) rad\n"
                       f"   Deviation: {distance:.3f} rad ({dist_deg:.1f}°)\n"
                       f"   Threshold: {threshold_deg:.1f}°\n"
                       f"   Baseline: ({self.baseline[0]:.3f}, {self.baseline[1]:.3f})")
            else:
                msg = f"🚨 VIOLATION #{self.warns}: {viol_type.upper()}"
        else:
            msg = f"🚨 VIOLATION #{self.warns}: {viol_type.upper()}"

        self._log(msg)
        logger.warning(f"\n{msg}")

        # Console alert
        print(f"\n{'=' * 60}")
        print(f"🚨 ALERT: {viol_type.upper()}")
        print(f"   Warning #{self.warns}/{WARN_LIMIT}")
        if gaze_point:
            print(f"   Deviation: {np.degrees(distance):.1f}° from center")
        print(f"{'=' * 60}\n")

        # Database writes (optional)
        if self.db_writer:
            try:
                db_timestamp = datetime.utcnow()
                self.db_writer.submit_event(
                    self.cid, self.sid, db_timestamp, gaze_point, distance,
                    True, viol_type, filepath, self.warns, pose_angles
                )
                self.db_writer.submit_warning(
                    self.cid, self.sid, self.warns, db_timestamp, WARN_LIMIT
                )
            except Exception as e:
                logger.debug(f"DB write skipped: {e}")

    def _create_display(self, frame, avg_fps):
        """Create display with relative safe zone"""
        disp = frame.copy()
        h, w = disp.shape[:2]

        if self.baseline is not None and self.validator:
            # Draw relative safe zone (centered on baseline, shown as rectangle)
            # Map baseline to screen coordinates for visualization
            baseline_screen_x = int((1.0 - self.baseline[0]) * w)  # Mirror X
            baseline_screen_y = int(self.baseline[1] * h)

            # Safe zone margins in pixels (approximate)
            margin_x = int(SAFE_ZONE_MARGIN['x'] * w)
            margin_y = int(SAFE_ZONE_MARGIN['y'] * h)

            x1 = max(0, baseline_screen_x - margin_x)
            x2 = min(w, baseline_screen_x + margin_x)
            y1 = max(0, baseline_screen_y - margin_y)
            y2 = min(h, baseline_screen_y + margin_y)

            # Draw safe zone
            cv2.rectangle(disp, (x1, y1), (x2, y2), (0, 255, 0), 2)

            # Draw center point (baseline)
            cv2.circle(disp, (baseline_screen_x, baseline_screen_y), 5, (0, 255, 255), -1)
            cv2.circle(disp, (baseline_screen_x, baseline_screen_y), 20, (0, 255, 255), 2)

        # FPS
        fps_color = (0, 255, 0) if avg_fps > 20 else (0, 255, 255) if avg_fps > 10 else (0, 0, 255)
        cv2.putText(disp, f"FPS: {avg_fps:.1f}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, fps_color, 2)

        # Candidate ID
        cv2.putText(disp, f"ID: {self.cid}", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # Warnings
        warn_color = (0, 255, 0) if self.warns < WARN_LIMIT // 2 else (0, 255, 255) if self.warns < WARN_LIMIT else (0,
                                                                                                                     0,
                                                                                                                     255)
        cv2.putText(disp, f"Warnings: {self.warns}/{WARN_LIMIT}", (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, warn_color, 2)

        # Status and gaze
        if self.current_status == 'NO_FACE':
            cv2.putText(disp, "NO FACE DETECTED", (10, 120),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        elif self.current_status == 'SUCCESS' and self.current_gaze and self.baseline is not None:
            x, y = self.current_gaze

            # Calculate deviation
            dist = np.linalg.norm(np.array(self.current_gaze) - self.baseline)
            is_violation = dist > THRESHOLD

            # Color: Green if safe, Red if violation
            color = (0, 0, 255) if is_violation else (0, 255, 0)

            # Mirror gaze for display
            gaze_x = int((1.0 - x) * w)
            gaze_y = int(y * h)

            # Clamp to screen
            gaze_x = max(0, min(w, gaze_x))
            gaze_y = max(0, min(h, gaze_y))

            cv2.circle(disp, (gaze_x, gaze_y), 15, color, 2)
            cv2.circle(disp, (gaze_x, gaze_y), 5, color, -1)

            # Line from baseline to current gaze
            baseline_x = int((1.0 - self.baseline[0]) * w)
            baseline_y = int(self.baseline[1] * h)
            cv2.line(disp, (baseline_x, baseline_y), (gaze_x, gaze_y), color, 2)

            # Text
            cv2.putText(disp, f"Deviation: {np.degrees(dist):.1f}°", (10, 120),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        # Critical warning overlay
        if self.warns >= WARN_LIMIT:
            cv2.rectangle(disp, (0, 0), (w, h), (0, 0, 255), 10)
            cv2.putText(disp, "CRITICAL ALERT!", (w // 2 - 180, h // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 255), 4)

        return disp


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("\n" + "=" * 60)
    print("🎯 EYE TRACKING SYSTEM")
    print("=" * 60)
    print("\nNOTE: This system uses RELATIVE safe zones.")
    print("During calibration, look at the screen center.")
    print("During monitoring, looking at the center is SAFE.")
    print("Violations only trigger if you look >8.5° away from center.\n")

    cid = input("Candidate ID: ").strip()
    if not cid:
        cid = "test_candidate"
        print(f"Using default: {cid}")

    sid = input("Exam Session ID: ").strip()
    if not sid:
        sid = "test_session"
        print(f"Using default: {sid}")

    mpath = input("Model path [./max_regularized_checkpoints/best_max_regularized.pth]: ").strip()
    if not mpath:
        mpath = "./max_regularized_checkpoints/best_max_regularized.pth"

    if not os.path.exists(mpath):
        print(f"\n❌ Model not found: {mpath}")
        return

    print("\n" + "=" * 60)
    print(f"Threshold: {np.degrees(THRESHOLD):.1f}° deviation limit")
    print(f"Safe zone: ±{np.degrees(SAFE_ZONE_MARGIN['x']):.1f}° horizontal")
    print("=" * 60 + "\n")

    try:
        pipeline = FastGazePipeline(cid, sid, mpath)
        input("\nPress ENTER to start calibration (10 seconds)...")
        pipeline.run()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()