import cv2
import numpy as np
import logging
import base64
import time
import torch
import gc
from pathlib import Path
from collections import deque
from django.conf import settings

logger = logging.getLogger(__name__)

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)

# ── Calibration ───────────────────────────────────────────────────────────────
CALIBRATION_RATE              = 1.0
MIN_CALIBRATION_SAMPLES_CALIB = 3   # samples needed to lock calib baseline
LATE_BASELINE_SAMPLES         = 5   # samples if calib finished without baseline

# During monitoring we keep refining the baseline for up to this many frames
# as long as the student appears calm (yaw < BASELINE_REFINE_YAW_LIMIT).
# DISABLED (set to 0): In short exams with active head movement, the refinement
# frames can pull the baseline away from true forward-facing position, making
# the detector less sensitive.  The calibration phase with 5 good samples is
# sufficient.  Re-enable only for long, stable exams if drift is observed.
BASELINE_REFINE_FRAMES    = 0
BASELINE_REFINE_YAW_LIMIT = 15.0   # degrees — only refine when head is still

# Calibration sample validity gate — two separate limits by source.
# POSE source: tight because gaze is derived directly from yaw/pitch,
#   and now uses /90 mapping so off-centre calibration has more impact.
# MODEL source: relaxed because the neural model compensates for head rotation.
CALIB_POSE_YAW_LIMIT    = 18.0   # tightened from 20 — /90 mapping means a 15°
                                  # off-centre calibration shifts baseline by 0.167
CALIB_POSE_PITCH_LIMIT  = 18.0   # tightened from 20 for same reason
CALIB_MODEL_YAW_LIMIT   = 40.0
CALIB_MODEL_PITCH_LIMIT = 35.0

# ── Gaze thresholds ───────────────────────────────────────────────────────────
THRESHOLD             = 0.06   # Euclidean distance in gaze-coord space.
                               # Lowered from 0.07 → 0.05 to catch moderate
                               # gaze deviations (~9–10°) that were previously
                               # slipping below the threshold on pose-only frames.
                               # At baseline yaw=8°, a 10° additional deviation
                               # shifts x by (10/180)=0.056 > 0.05 → caught.
                               # Previously needed ~12.6° extra to trigger.

# Head pose hard limits — absolute degrees regardless of baseline.
# HEAD_POSE_YAW_LIMIT_POSE lowered from 25 → 15 for the pose-only path:
# pose-only yaw IS the gaze direction (no neural compensation), so even a
# 15° head turn from calibration baseline is a meaningful look-away signal.
# This catches the moderate side-looks (15–24°) that were previously missed
# entirely when the model fell back to pose-only mode.
HEAD_POSE_YAW_LIMIT   = 40    # degrees — absolute limit for model path
HEAD_POSE_YAW_LIMIT_POSE = 30 # degrees — 25 * 1.05 ≈ 26
HEAD_POSE_PITCH_LIMIT = 40    # degrees — 35 * 1.05 ≈ 37

# ── Violation timing ──────────────────────────────────────────────────────────
# PROBLEM (observed in frontend console logs, attempt 69):
#   Exam lasted only 75 seconds. Frontend sends at 3s intervals.
#   Backend MIN_FRAME_INTERVAL caused 429 drops, reducing actual throughput.
#   TEMPORAL_WINDOW=5 required 5 clean frames (15+ seconds) to confirm — almost
#   the whole exam.  Even TEMPORAL_WINDOW=3 was too slow given 429 drops between
#   frames breaking the streak.
#
# FIX:
#   TEMPORAL_WINDOW=2: any 2 consecutive processed frames both flagging a
#   violation triggers the confirmation.  At 3s intervals that is ~6 seconds
#   of sustained looking away — appropriate and not overly sensitive.
#   TEMPORAL_THRESHOLD=1.0: both frames must be flagged (no partial credit)
#   prevents a single noisy frame from contributing to a false positive.
#
#   VIOLATION_COOLDOWN=3s: was 5s.  At 3s frame intervals, 5s meant only
#   1 violation per ~2 frames.  3s = can fire on the very next processed frame.
VIOLATION_COOLDOWN    = 2      # seconds — lowered from 3s. At ~3s frame intervals,
                               # 3s cooldown meant at most 1 violation per 2 frames
                               # regardless of sustained deviation. 2s cooldown allows
                               # the very next frame (~3s later) to fire again if the
                               # student is still looking away.
WARN_LIMIT            = 10

TEMPORAL_WINDOW    = 1
TEMPORAL_THRESHOLD = 1.0   # single frame must be flagged to confirm

# ── Frame rate limits ─────────────────────────────────────────────────────────
# Frontend sends at 3s (sequential loop, both calibration and exam).
# Processing takes ~500ms per frame, so the full cycle is ~3500ms.
# Backend limit set to 2.5s to absorb network jitter while ensuring
# no 429s under normal conditions.
#
# TEMPORAL_WINDOW=1 rationale: at 3s frame intervals, a single flagged
# frame already represents 3s of sustained deviation. Real cheating lasts
# 5-30+ seconds so it will be caught on multiple frames. A brief glance
# (<500ms) is statistically unlikely to coincide with a 3s frame capture,
# so false positives are naturally filtered by the interval itself.
FACE_MATCH_INTERVAL             = 20   # every 20s — was 6s; ~1s face recog latency at 6s was eating
                                           # half the effective frame budget. At 20s the check runs
                                           # ~3x per typical exam, enough to catch impersonation while
                                           # freeing most frames from the latency hit so they complete
                                           # in ~500ms and the effective capture rate doubles.
MIN_FRAME_INTERVAL              = 2.5  # exam: frontend=3s, limit=2.5s (0.5s jitter budget)
MIN_FRAME_INTERVAL_CALIBRATION  = 2.5  # calib: frontend=3s, limit=2.5s (0.5s jitter budget)

# ── Face match threshold ──────────────────────────────────────────────────────
# PROBLEM (observed in logs):
#   FACE_MISMATCH fired at 15:10:09 when trust was at 71% and had been stable
#   all session (distance consistently ~0.40-0.47).  A single frame with head
#   turned far caused dlib landmark distortion → embedding shift → false mismatch.
#   The threshold 0.6 was too tight for angled faces.
#
# FIX:
#   Raise threshold to 0.65.  Distances in this session were 0.40-0.47 for a
#   genuine match — a real impersonator would be well above 0.65.
#   Also require 2 consecutive mismatches before raising a FACE_MISMATCH
#   violation (tracked via session.consecutive_face_mismatches).
FACE_MATCH_THRESHOLD         = 0.60   # was 0.6
FACE_MISMATCH_CONFIRM_COUNT  = 2      # require N consecutive mismatches to fire

# Source tags — we only average samples from the same source
_SRC_POSE  = 'pose'
_SRC_MODEL = 'model'


class _SessionState:
    __slots__ = (
        'phase',
        # calibration sample lists — kept separate per source
        'calib_samples_pose',           # list of [x, y, yaw, pitch]  (pose-only)
        'calib_samples_model',          # list of [x, y, yaw, pitch]  (neural model)
        'baseline',                     # np.array [bx, by, byaw, bpitch]  - locked baseline
        'baseline_source',              # _SRC_POSE or _SRC_MODEL
        'baseline_locked',              # bool — True once baseline is committed
        # in-exam baseline refinement
        'refine_samples',               # list of [x, y] collected during calm moments
        'refine_frames_done',           # how many refinement frames have been collected
        # violation tracking
        'violation_history',
        'last_violation_time',
        'warning_count',
        'consecutive_face_mismatches',  # consecutive mismatch frames before firing
        # misc
        'last_face_match_time',
        'last_frame_time',
    )

    def __init__(self):
        self.phase                       = 'calibrating'
        self.calib_samples_pose          = []
        self.calib_samples_model         = []
        self.baseline                    = None
        self.baseline_source             = None
        self.baseline_locked             = False
        self.refine_samples              = []
        self.refine_frames_done          = 0
        self.violation_history           = deque(maxlen=TEMPORAL_WINDOW)
        self.last_violation_time         = 0.0
        self.warning_count               = 0
        self.consecutive_face_mismatches = 0
        self.last_face_match_time        = 0.0
        self.last_frame_time             = 0.0


_sessions: dict = {}


def _get_session(attempt_id) -> _SessionState:
    if attempt_id not in _sessions:
        _sessions[attempt_id] = _SessionState()
        logger.info(f"[session] Created calibration session for attempt {attempt_id}")
    return _sessions[attempt_id]


def clear_session(attempt_id):
    _sessions.pop(attempt_id, None)


def _preprocess_image(bgr_uint8: np.ndarray) -> torch.Tensor:
    rgb   = cv2.cvtColor(bgr_uint8, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    normd = (rgb - MEAN) / STD
    return torch.from_numpy(normd).permute(2, 0, 1).unsqueeze(0)


# =============================================================================
# Pipeline
# =============================================================================

class ProctoringPipeline:

    def __init__(self, attempt_id, user_id=None):
        self.attempt_id = attempt_id
        self.user_id    = user_id
        self.registered_face_embedding = None

        try:
            from ai_engine.model_manager import model_manager
            self.model_manager = model_manager
            if not self.model_manager or not self.model_manager.is_ready():
                logger.error("Model manager not ready!")
                self.model_manager = None
        except Exception as e:
            logger.error(f"Failed to load model manager: {e}")
            self.model_manager = None

        try:
            from ai_engine.extractor_manager import get_unified_extractor
            self.extractor = get_unified_extractor()
            if not self.extractor:
                logger.error("Unified extractor not ready!")
        except Exception as e:
            logger.error(f"Failed to get unified extractor: {e}")
            self.extractor = None

        # Eager warm-up: pre-load the registered face embedding right now so
        # the first live frame does not pay the disk-read + dlib cold-start cost.
        if self.user_id and self.model_manager:
            try:
                self.registered_face_embedding = self._load_registered_face(self.user_id)
                if self.registered_face_embedding is not None:
                    logger.info(f"[WARMUP] Pre-loaded face embedding for user {self.user_id}")
                else:
                    logger.warning(f"[WARMUP] No registered face found for user {self.user_id}")
            except Exception as e:
                logger.warning(f"[WARMUP] Face pre-load failed (non-fatal): {e}")

    # -------------------------------------------------------------------------
    # Public entry point
    # -------------------------------------------------------------------------

    def analyze_frame(self, frame_base64: str, calibration_complete: bool = False) -> dict:
        violations = []
        analysis_results = {
            'face_detected':         False,
            'face_match':            False,
            'face_match_confidence': 0.0,
            'num_faces':             0,
            'gaze_on_screen':        False,
            'gaze_coords':           None,
            'gaze_confidence':       0.0,
            'head_pose_angles':      None,
            'head_pose_confidence':  0.0,
            'calibration_phase':     True,
            'violations':            [],
            'details':               {},
            'face_match_checked':    False,
        }

        # Decode frame
        try:
            if ',' in frame_base64:
                frame_base64 = frame_base64.split(',')[1]
            frame_bytes = base64.b64decode(frame_base64)
            frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
            frame       = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
            if frame is None:
                raise ValueError("imdecode returned None")
            logger.info(f"[FRAME] Decoded: shape={frame.shape}, dtype={frame.dtype}")
        except Exception as e:
            logger.error(f"Frame decode error: {e}")
            analysis_results['error'] = f'Invalid frame data: {e}'
            self._flush_gpu()
            return analysis_results

        if not self.model_manager or not self.extractor:
            logger.error("Pipeline not ready")
            analysis_results['error'] = 'Pipeline not initialized'
            self._flush_gpu()
            return analysis_results

        session = _get_session(self.attempt_id)

        # Phase transition
        if calibration_complete and session.phase == 'calibrating':
            if session.baseline is None:
                logger.info(
                    f"[CALIBRATION] Frontend signalled complete — baseline not yet "
                    f"established, will collect from first {LATE_BASELINE_SAMPLES} monitoring frames"
                )
            else:
                logger.info("[CALIBRATION] Frontend signalled complete — switching to monitoring immediately")
            session.phase = 'monitoring'
            session.last_frame_time = 0.0

        # Per-pipeline rate limit
        current_time    = time.time()
        time_since_last = current_time - session.last_frame_time
        interval        = (MIN_FRAME_INTERVAL_CALIBRATION
                           if session.phase == 'calibrating'
                           else MIN_FRAME_INTERVAL)
        if session.last_frame_time > 0 and time_since_last < interval:
            logger.warning(
                f"[RATE LIMIT] Frame dropped - too soon ({time_since_last:.2f}s < {interval}s)"
            )
            analysis_results['error']       = 'Rate limited'
            analysis_results['retry_after'] = interval - time_since_last
            return analysis_results
        session.last_frame_time = current_time

        # Set extractor phase
        if session.phase == 'calibrating':
            self.extractor.set_phase('calibration_pose', session_id=self.attempt_id)
        else:
            self.extractor.set_phase('monitoring', session_id=self.attempt_id)

        # Face detection
        num_faces = 0
        try:
            gray          = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            clahe         = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            gray_enhanced = clahe.apply(gray)
            faces         = self.model_manager.face_detector(gray_enhanced, 1)
            num_faces     = len(faces)

            analysis_results['num_faces']     = num_faces
            analysis_results['face_detected'] = (num_faces > 0)
            analysis_results['details']['detection_method'] = 'enhanced'

            logger.info(f"[FACE] Detected {num_faces} face(s)")

            if num_faces == 0:
                violations.append('FACE_NOT_DETECTED')
                logger.warning("[VIOLATION] FACE_NOT_DETECTED - No face found in frame")

            elif num_faces > 1:
                violations.append('MULTIPLE_FACES')
                logger.warning(f"[VIOLATION] MULTIPLE_FACES - Found {num_faces} faces")

            else:
                analysis_results['face_detected'] = True
                face_rect = faces[0]
                logger.info(
                    f"[FACE] Detected at: left={face_rect.left()}, top={face_rect.top()}, "
                    f"right={face_rect.right()}, bottom={face_rect.bottom()}"
                )

                should_check_face = (current_time - session.last_face_match_time) >= FACE_MATCH_INTERVAL
                if should_check_face:
                    logger.info(f"[FACE MATCH] Running face recognition check (interval: {FACE_MATCH_INTERVAL}s)...")
                    self._run_face_recognition(frame, gray_enhanced, face_rect, analysis_results, violations, session)
                    session.last_face_match_time    = current_time
                    analysis_results['face_match_checked'] = True
                    if analysis_results.get('face_match'):
                        logger.info(
                            f"[FACE MATCH] Face matched! "
                            f"Confidence: {analysis_results.get('face_match_confidence', 0):.2f}%"
                        )
                    else:
                        if 'FACE_MISMATCH' in violations:
                            logger.warning("[FACE MATCH] Face mismatch detected!")
                        elif analysis_results['details'].get('no_registered_face'):
                            logger.warning("[FACE MATCH] No registered face to compare")
                else:
                    next_check = FACE_MATCH_INTERVAL - (current_time - session.last_face_match_time)
                    analysis_results['face_match_checked'] = False
                    logger.debug(f"[FACE MATCH] Skipping check (next in {next_check:.1f}s)")

        except Exception as face_error:
            logger.error(f"[FACE] Detection error: {face_error}", exc_info=True)
            analysis_results['details']['face_detection_error'] = str(face_error)

        # Gaze inference
        gaze_result = self._run_gaze_inference(frame, session, analysis_results, violations)

        if gaze_result and gaze_result.get('coords'):
            analysis_results['gaze_coords']          = gaze_result['coords']
            analysis_results['gaze_confidence']      = gaze_result.get('confidence', 0.0)
            analysis_results['head_pose_angles']     = gaze_result.get('head_pose_angles')
            analysis_results['head_pose_confidence'] = gaze_result.get('head_pose_confidence', 0.0)

        # Calibration phase flag
        if session.phase == 'calibrating':
            analysis_results['calibration_phase'] = True
        else:
            analysis_results['calibration_phase'] = False
            analysis_results['details']['baseline'] = (
                session.baseline[:2].tolist() if session.baseline is not None else None
            )
            analysis_results['details']['baseline_source'] = session.baseline_source
            analysis_results['details']['warning_count']   = session.warning_count

        analysis_results['violations'] = violations

        # Signal frontend when the baseline is locked so it can complete
        # calibration immediately rather than waiting its own independent timer.
        analysis_results['baseline_ready'] = session.baseline_locked

        logger.info(
            f"[ANALYSIS COMPLETE] Attempt {self.attempt_id}: "
            f"faces={num_faces}, violations={len(violations)}, types={violations}"
        )

        return analysis_results

    # -------------------------------------------------------------------------
    # Gaze inference
    # -------------------------------------------------------------------------

    def _run_gaze_inference(self, frame, session, analysis_results, violations):

        try:
            detection = self.extractor.extract(frame)

            if not isinstance(detection, dict):
                # MediaPipe landmark extraction failed even though dlib found a face.
                # This almost always means the head is turned far enough sideways
                # (~60°+) that the facial mesh cannot be fitted — exactly the
                # cheating posture we need to catch.  Fire GAZE_DEVIATION immediately;
                # no temporal window needed since MediaPipe handles small angles fine.
                face_visible = analysis_results.get('face_detected', False)
                if face_visible and session.phase != 'calibrating' and session.baseline is not None:
                    logger.warning(
                        "[GAZE] MediaPipe landmark failure with face present — "
                        "head turned far sideways. Firing GAZE_DEVIATION."
                    )
                    violations.append('GAZE_DEVIATION')
                else:
                    logger.error(f"[GAZE] Unexpected extractor output type: {type(detection)}")
                return None

            head_pose_angles = detection.get('head_pose_angles', [0.0, 0.0, 0.0])
            conf             = float(detection.get('head_pose_confidence', 1.0))

            # ------------------------------------------------------------------
            # Correct head-pose angles
            # gaze1.py's _estimate_head_pose() Y-flips image_points before
            # solvePnP.  That flip shifts yaw by ~180 degrees and negates pitch
            # for a person looking straight ahead.  We undo it here.
            # ------------------------------------------------------------------
            if isinstance(head_pose_angles, (list, tuple, np.ndarray)) and len(head_pose_angles) >= 2:
                raw_yaw   = ((float(head_pose_angles[0]) + 180) % 360) - 180
                raw_pitch = ((float(head_pose_angles[1]) + 180) % 360) - 180

                # Undo ~180 deg offset: values near +-180 map back to near 0
                if abs(raw_yaw) > 90:
                    yaw = -(180 - abs(raw_yaw)) * np.sign(raw_yaw)
                else:
                    yaw = raw_yaw

                pitch = -raw_pitch   # Y-flip negates pitch
            else:
                yaw, pitch = 0.0, 0.0

            # ------------------------------------------------------------------
            # Try to run the PyTorch gaze model
            # ------------------------------------------------------------------
            gaze_model = getattr(self.model_manager, 'gaze_model', None)
            device     = getattr(self.model_manager, 'device', torch.device('cpu'))
            used_model = False

            if gaze_model is not None and detection.get('valid', True):
                try:
                    left_eye  = detection['left_eye']
                    right_eye = detection['right_eye']
                    face_crop = detection['face']
                    head_pose = detection['head_pose']   # normalised [yaw/45, pitch/30]

                    def _to_tensor(bgr_img):
                        rgb   = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
                        normd = (rgb - MEAN) / STD
                        return torch.from_numpy(normd).permute(2, 0, 1).unsqueeze(0).to(device)

                    left_t  = _to_tensor(left_eye)
                    right_t = _to_tensor(right_eye)
                    face_t  = _to_tensor(face_crop)
                    pose_t  = torch.from_numpy(head_pose).unsqueeze(0).to(device)

                    with torch.no_grad():
                        gaze_out = gaze_model(left_t, right_t, face_t, pose_t)

                    gp         = gaze_out.cpu().numpy()[0]
                    gaze_pitch = float(np.clip(gp[0], -1.0, 1.0))
                    gaze_yaw   = float(np.clip(gp[1], -1.0, 1.0))

                    # Convert model radian output to [0, 1] screen space so it
                    # shares a coordinate space with the pose-only baseline.
                    # The pose formula is:  x = 0.5 + yaw_deg / 180
                    # Model output is in radians, so: yaw_deg = yaw_rad * (180/π)
                    # Combined:             x = 0.5 + gaze_yaw_rad / π
                    # π ≈ 3.14159, so a ±1 rad output maps to ±0.318 around 0.5.
                    # This matches the pose fallback range at equivalent angles.
                    RAD_TO_SCREEN_X = np.pi          # divisor for yaw  (matches /180 * 180/π)
                    RAD_TO_SCREEN_Y = np.pi * 2 / 3  # divisor for pitch (matches /120 * 180/π)
                    x_raw      = float(np.clip(0.5 + gaze_yaw   / RAD_TO_SCREEN_X, 0.0, 1.0))
                    y_raw      = float(np.clip(0.5 + gaze_pitch / RAD_TO_SCREEN_Y, 0.0, 1.0))
                    used_model = True

                    logger.info(
                        f"[GAZE] Model output: pitch={gaze_pitch:.3f} rad, yaw={gaze_yaw:.3f} rad | "
                        f"screen=({x_raw:.3f},{y_raw:.3f}) | "
                        f"head yaw={yaw:.1f} deg, pitch={pitch:.1f} deg, conf={conf:.2f}"
                    )

                except Exception as model_err:
                    logger.warning(f"[GAZE] Model inference failed, falling back to pose-only: {model_err}")
                    gaze_model = None

            if not used_model:
                # Pose-only fallback: map corrected degrees to [0, 1] space.
                # Use /90 instead of /180 so the pose-only path is more sensitive:
                # a 10° deviation now shifts x by 10/90=0.111 vs 10/180=0.055,
                # ensuring even modest glances exceed the 0.05 distance threshold.
                # The ±90° range covers all physically plausible head rotations
                # for a seated exam taker; anything beyond that fires the hard limit.
                if detection.get('head_pose_angles') is not None:
                    x_raw = float(np.clip(0.5 + yaw   / 90.0, 0.0, 1.0))
                    y_raw = float(np.clip(0.5 + pitch / 60.0, 0.0, 1.0))
                else:
                    x_raw, y_raw = 0.5, 0.5
                logger.info(
                    f"[GAZE] Pose-only fallback: ({x_raw:.3f},{y_raw:.3f}) "
                    f"head yaw={yaw:.1f} deg, pitch={pitch:.1f} deg"
                )

            src = _SRC_MODEL if used_model else _SRC_POSE

            result = {
                'coords':               [x_raw, y_raw],
                'confidence':           conf,
                'head_pose_angles':     {'yaw': yaw, 'pitch': pitch},
                'head_pose_confidence': conf,
                'source':               src,
            }

            self._run_gaze_monitoring(
                x_raw, y_raw, yaw, pitch, conf, src,
                frame, session, analysis_results, violations
            )

            return result

        except Exception as e:
            logger.error(f"[GAZE] Inference error: {e}", exc_info=True)
            return None

    # -------------------------------------------------------------------------
    # Calibration helpers
    # -------------------------------------------------------------------------

    def _add_calibration_sample(self, session, x, y, yaw, pitch, src):
        """
        Add a sample to the correct source bucket and attempt to lock the
        baseline.

        Rules:
         1. Samples are stored in separate lists per source (pose vs model).
         2. When the model fires for the first time, ALL previously accumulated
            pose-only samples are discarded — this handles the case where
            multiple pose-only samples arrived before the model was ready.
            Any subsequent pose-only samples are also ignored.
         3. Once MIN_CALIBRATION_SAMPLES_CALIB samples from the same source
            accumulate, the baseline is locked from that source's samples.
        """
        # Gate: reject samples where the head is turned too far — these produce
        # a skewed baseline that causes violations when the student looks forward.
        yaw_limit   = CALIB_MODEL_YAW_LIMIT   if src == _SRC_MODEL else CALIB_POSE_YAW_LIMIT
        pitch_limit = CALIB_MODEL_PITCH_LIMIT if src == _SRC_MODEL else CALIB_POSE_PITCH_LIMIT
        if abs(yaw) > yaw_limit or abs(pitch) > pitch_limit:
            logger.warning(
                f"[calibration] Sample REJECTED — head too far from centre "
                f"(yaw={yaw:.1f} deg limit={yaw_limit}, pitch={pitch:.1f} deg limit={pitch_limit}). "
                f"Ask student to look straight at camera."
            )
            return

        if src == _SRC_MODEL:
            # Model source — discard any stale pose-only samples
            if session.calib_samples_pose:
                logger.info(
                    f"[calibration] Neural model became available — discarding "
                    f"{len(session.calib_samples_pose)} pose-only sample(s) "
                    f"to keep coordinate spaces consistent"
                )
                session.calib_samples_pose = []
            session.calib_samples_model.append([x, y, yaw, pitch])
            bucket = session.calib_samples_model

        else:  # _SRC_POSE
            # Only add pose sample if no model samples exist yet
            if session.calib_samples_model:
                logger.debug(
                    "[calibration] Ignoring pose-only sample "
                    "(model samples already present)"
                )
                return
            session.calib_samples_pose.append([x, y, yaw, pitch])
            bucket = session.calib_samples_pose

        n = len(bucket)
        logger.info(
            f"[calibration] sample #{n}/{MIN_CALIBRATION_SAMPLES_CALIB} "
            f"src={src}: ({x:.3f},{y:.3f}) yaw={yaw:.1f} deg pitch={pitch:.1f} deg"
        )

        if n >= MIN_CALIBRATION_SAMPLES_CALIB:
            arr                     = np.array(bucket)
            session.baseline        = arr.mean(axis=0)   # [bx, by, byaw, bpitch]
            session.baseline_source = src
            session.baseline_locked = True
            logger.info(
                f"[calibration] Baseline locked from {n} {src} samples: "
                f"({session.baseline[0]:.3f},{session.baseline[1]:.3f}) "
                f"yaw={session.baseline[2]:.1f} deg pitch={session.baseline[3]:.1f} deg"
            )

    def _try_refine_baseline(self, session, x, y, yaw):
        """
        During the first BASELINE_REFINE_FRAMES calm monitoring frames,
        update the baseline gaze coords with a rolling mean.

        'Calm' means head yaw is within BASELINE_REFINE_YAW_LIMIT degrees.
        Only the (bx, by) components are updated; yaw/pitch are unchanged.

        This corrects a drifted calibration baseline — for example when a
        mixed-source calibration produced an off-centre baseline — without
        requiring a full recalibration.
        """
        if session.refine_frames_done >= BASELINE_REFINE_FRAMES:
            return   # window exhausted

        if abs(yaw) > BASELINE_REFINE_YAW_LIMIT:
            logger.debug(
                f"[refine] Skipping — head not calm "
                f"(yaw={yaw:.1f} deg > {BASELINE_REFINE_YAW_LIMIT} deg limit)"
            )
            return

        session.refine_samples.append([x, y])
        session.refine_frames_done += 1
        n = session.refine_frames_done

        refined        = np.mean(session.refine_samples, axis=0)
        old_bx, old_by = session.baseline[0], session.baseline[1]
        session.baseline[0] = refined[0]
        session.baseline[1] = refined[1]

        logger.info(
            f"[refine] Frame {n}/{BASELINE_REFINE_FRAMES}: "
            f"baseline ({old_bx:.3f},{old_by:.3f}) -> "
            f"({session.baseline[0]:.3f},{session.baseline[1]:.3f})"
        )

        if n >= BASELINE_REFINE_FRAMES:
            logger.info(
                f"[refine] Baseline refinement complete: "
                f"({session.baseline[0]:.3f},{session.baseline[1]:.3f})"
            )

    # -------------------------------------------------------------------------
    # Gaze monitoring
    # -------------------------------------------------------------------------

    def _run_gaze_monitoring(self, x, y, yaw, pitch, confidence, src,
                              frame, session, analysis_results, violations):
        """
        Decide whether the current gaze reading is a violation.

        Source-aware calibration
        ------------------------
        Both pose and model outputs are now in unified [0,1] screen space
        before reaching this function (model converted in _run_gaze_inference).
        Calibration samples are still stored per-source (pose vs model) and
        never averaged across sources; when the model becomes available
        mid-calibration, pose-only samples are discarded and collection restarts.

        In-exam baseline refinement
        ---------------------------
        After the baseline is locked, the first BASELINE_REFINE_FRAMES calm
        monitoring frames (head yaw < BASELINE_REFINE_YAW_LIMIT) are used to
        further refine the baseline gaze coords.  This corrects any residual
        drift from a partially-mixed calibration without stopping the exam.
        """

        # Calibration phase: collect samples, no violations — BUT still check
        # absolute yaw hard limit. A student turning 45°+ during calibration
        # is clearly looking away; reject the sample AND fire a violation.
        if session.phase == 'calibrating':
            norm_yaw_calib = ((yaw + 180) % 360) - 180
            if abs(norm_yaw_calib) > HEAD_POSE_YAW_LIMIT:
                logger.warning(
                    f"[GAZE] Large turn during calibration (yaw={norm_yaw_calib:.1f} deg) — "
                    f"firing GAZE_DEVIATION even in calibration phase."
                )
                violations.append('GAZE_DEVIATION')
                # still try to add (will be rejected by sample gate, that's fine)
                self._add_calibration_sample(session, x, y, yaw, pitch, src)
            else:
                self._add_calibration_sample(session, x, y, yaw, pitch, src)
            return

        # Monitoring phase but baseline not ready yet (late baseline)
        if session.baseline is None:
            self._add_calibration_sample(session, x, y, yaw, pitch, src)
            n_model = len(session.calib_samples_model)
            n_pose  = len(session.calib_samples_pose)
            logger.info(
                f"[calibration] Late sample — model={n_model}, pose={n_pose}, "
                f"need {LATE_BASELINE_SAMPLES} from one source"
            )
            return

        # In-exam baseline refinement (first N calm frames, same source only)
        if (BASELINE_REFINE_FRAMES > 0
                and session.refine_frames_done < BASELINE_REFINE_FRAMES
                and src == session.baseline_source):
            self._try_refine_baseline(session, x, y, yaw)

        # Unpack baseline
        bx, by = float(session.baseline[0]), float(session.baseline[1])

        # Gaze coordinate distance from baseline
        distance = float(np.linalg.norm([x - bx, y - by]))

        # Angles already corrected — clamp to [-180, 180] as a safety net
        norm_yaw   = ((yaw   + 180) % 360) - 180
        norm_pitch = ((pitch + 180) % 360) - 180

        # Violation detection
        violation_type    = None
        violation_details = []

        # Priority 1: absolute head-pose (most reliable for looking away)
        # For pose-only frames, yaw IS the gaze direction — apply tighter limit.
        # For model frames, the neural net compensates for head rotation so we
        # use the looser limit (model at 25° would be a false positive).
        effective_yaw_limit = HEAD_POSE_YAW_LIMIT_POSE if src == _SRC_POSE else HEAD_POSE_YAW_LIMIT
        if abs(norm_yaw) > effective_yaw_limit:
            violation_type = 'GAZE_DEVIATION'
            violation_details.append(
                f'head_yaw={norm_yaw:.1f} deg (abs limit {effective_yaw_limit} deg, src={src})'
            )
        elif abs(norm_pitch) > HEAD_POSE_PITCH_LIMIT:
            violation_type = 'GAZE_DEVIATION'
            violation_details.append(
                f'head_pitch={norm_pitch:.1f} deg (abs limit {HEAD_POSE_PITCH_LIMIT} deg)'
            )

        # Priority 2: gaze distance from baseline
        if violation_type is None and distance > THRESHOLD:
            violation_type = 'GAZE_DEVIATION'
            violation_details.append(
                f'distance={distance:.3f} (threshold={THRESHOLD}), '
                f'baseline=({bx:.3f},{by:.3f})'
            )

        yaw_deviation   = abs(norm_yaw)
        pitch_deviation = abs(norm_pitch)

        # Temporal smoothing: majority vote over last N frames
        session.violation_history.append(violation_type is not None)

        confirmed = False
        if len(session.violation_history) >= TEMPORAL_WINDOW:
            recent   = sum(session.violation_history)
            required = int(TEMPORAL_WINDOW * TEMPORAL_THRESHOLD)
            if recent >= required:
                confirmed = True

        # Cooldown + commit
        now = time.time()
        if confirmed and violation_type and (now - session.last_violation_time) >= VIOLATION_COOLDOWN:
            violations.append(violation_type)
            session.last_violation_time = now
            session.warning_count      += 1

            analysis_results['gaze_on_screen'] = False
            analysis_results['details']['violation_type']         = violation_type
            analysis_results['details']['violation_number']       = session.warning_count
            analysis_results['details']['distance_from_baseline'] = round(distance, 4)
            analysis_results['details']['yaw_deviation']          = round(yaw_deviation, 2)
            analysis_results['details']['pitch_deviation']        = round(pitch_deviation, 2)

            if violation_details:
                analysis_results['details']['violation_reason'] = ', '.join(violation_details)

            # Save frame to disk
            if frame is not None:
                try:
                    import os
                    from datetime import datetime

                    save_dir  = os.path.join(settings.GAZE_CAPTURES_DIR, f'attempt_{self.attempt_id}')
                    os.makedirs(save_dir, exist_ok=True)

                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:19]
                    filename  = f'{timestamp}_GAZE_DEVIATION.jpg'
                    filepath  = os.path.join(save_dir, filename)

                    success = cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    if success:
                        logger.info(f'[SAVE] GAZE_DEVIATION frame saved: {filepath}')
                        analysis_results['details']['gaze_frame_saved'] = filepath
                    else:
                        logger.error('[SAVE] cv2.imwrite failed for GAZE_DEVIATION')

                except Exception as save_error:
                    logger.error(f'[SAVE] Failed to save gaze frame: {save_error}', exc_info=True)

            details_str = ', '.join(violation_details) if violation_details else 'general'
            logger.warning(
                f"[violation] CONFIRMED #{session.warning_count}: {violation_type} ({details_str}) "
                f"| gaze=({x:.3f},{y:.3f}) dist={distance:.3f} src={src} "
                f"yaw={yaw:.1f} deg (dev={yaw_deviation:.1f} deg) "
                f"pitch={pitch:.1f} deg (dev={pitch_deviation:.1f} deg)"
            )
        else:
            analysis_results['gaze_on_screen'] = True

    # -------------------------------------------------------------------------
    # Face recognition
    # -------------------------------------------------------------------------

    def _run_face_recognition(self, frame, gray, face_rect, analysis_results, violations, session):
        if not (self.model_manager.shape_predictor and self.model_manager.face_recognizer):
            logger.warning("[FACE RECOG] Shape predictor or face recognizer not available")
            return

        try:
            shape           = self.model_manager.shape_predictor(gray, face_rect)
            face_descriptor = self.model_manager.face_recognizer.compute_face_descriptor(frame, shape)
            current_emb     = np.array(face_descriptor)

            logger.info(f"[FACE RECOG] Computed embedding: shape={current_emb.shape}")

            # Embedding was pre-loaded in __init__; retry here only if that
            # failed (e.g. face was registered after the pipeline was created).
            if self.registered_face_embedding is None and self.user_id:
                self.registered_face_embedding = self._load_registered_face(self.user_id)
                if self.registered_face_embedding is not None:
                    logger.info(f"[FACE RECOG] Loaded registered embedding for user {self.user_id} (late)")
                else:
                    logger.warning(f"[FACE RECOG] No registered face found for user {self.user_id}")

            if self.registered_face_embedding is not None:
                dist       = float(np.linalg.norm(current_emb - self.registered_face_embedding))
                confidence = max(0.0, 100.0 * (1.0 - dist / 1.2))
                analysis_results['face_match_confidence'] = round(confidence, 2)

                logger.info(f"[FACE MATCH] Distance: {dist:.4f}, Confidence: {confidence:.2f}%")

                if dist > FACE_MATCH_THRESHOLD:
                    # Accumulate consecutive mismatches — a single angled frame
                    # can distort dlib landmarks and push distance above threshold.
                    # Only fire the violation once FACE_MISMATCH_CONFIRM_COUNT
                    # consecutive checks all exceed the threshold.
                    session.consecutive_face_mismatches += 1
                    analysis_results['face_match'] = False
                    analysis_results['details']['face_distance']              = round(dist, 4)
                    analysis_results['details']['face_match_threshold']       = FACE_MATCH_THRESHOLD
                    analysis_results['details']['consecutive_face_mismatches'] = session.consecutive_face_mismatches

                    if session.consecutive_face_mismatches >= FACE_MISMATCH_CONFIRM_COUNT:
                        violations.append('FACE_MISMATCH')
                        logger.warning(
                            f"[VIOLATION] FACE_MISMATCH confirmed after "
                            f"{session.consecutive_face_mismatches} consecutive checks — "
                            f"Distance {dist:.4f} > threshold {FACE_MATCH_THRESHOLD}"
                        )
                    else:
                        logger.warning(
                            f"[FACE MATCH] Mismatch #{session.consecutive_face_mismatches}/"
                            f"{FACE_MISMATCH_CONFIRM_COUNT} (not yet confirmed) — "
                            f"dist={dist:.4f}"
                        )
                else:
                    # Clear counter on any successful match
                    if session.consecutive_face_mismatches > 0:
                        logger.info(
                            f"[FACE MATCH] Match restored (dist={dist:.4f}) — "
                            f"resetting consecutive mismatch counter from "
                            f"{session.consecutive_face_mismatches}"
                        )
                    session.consecutive_face_mismatches = 0
                    analysis_results['face_match'] = True
                    analysis_results['details']['face_distance'] = round(dist, 4)
                    logger.info(f"[FACE MATCH] Face matched successfully (dist: {dist:.4f})")
            else:
                analysis_results['face_match'] = False
                analysis_results['details']['no_registered_face'] = True
                logger.warning("[FACE MATCH] Cannot verify - no registered face available")

        except Exception as e:
            logger.error(f"[FACE RECOG] Error during face recognition: {e}", exc_info=True)
            analysis_results['details']['face_recognition_error'] = str(e)

    def _load_registered_face(self, user_id):
        try:
            user_face_dir = Path(settings.MEDIA_ROOT) / 'face_registrations' / f'user_{user_id}'
            if not user_face_dir.exists():
                return None

            face_files = sorted(
                (f for f in user_face_dir.iterdir() if f.suffix in ('.jpg', '.png', '.jpeg')),
                key=lambda f: f.stat().st_mtime,
                reverse=True
            )
            if not face_files:
                return None

            frame = cv2.imread(str(face_files[0]))
            if frame is None:
                return None

            gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.model_manager.face_detector(gray, 1)
            if len(faces) == 0:
                return None

            shape           = self.model_manager.shape_predictor(gray, faces[0])
            face_descriptor = self.model_manager.face_recognizer.compute_face_descriptor(frame, shape)
            return np.array(face_descriptor)

        except Exception as e:
            logger.error(f"Error loading registered face: {e}", exc_info=True)
            return None

    # -------------------------------------------------------------------------
    # Audio
    # -------------------------------------------------------------------------

    def analyze_audio(self, audio_base64):
        try:
            from ai_engine.audio import detect_speech_simple

            if ',' in audio_base64:
                audio_base64 = audio_base64.split(',')[1]
            audio_bytes = base64.b64decode(audio_base64)
            result      = detect_speech_simple(audio_bytes)

            return {
                'speech_detected': result.get('speech_detected', False),
                'audio_level':     result.get('audio_level',     0.0),
                'confidence':      result.get('confidence',      0.0),
                'violation':       'AUDIO_DETECTED' if result.get('speech_detected') else None,
            }
        except ImportError:
            logger.warning("Audio module not available")
            return {
                'speech_detected': False,
                'audio_level':     0.0,
                'confidence':      0.0,
                'violation':       None,
                'error':           'Audio analysis not available',
            }
        except Exception as e:
            logger.error(f"Audio analysis error: {e}", exc_info=True)
            return {
                'speech_detected': False,
                'audio_level':     0.0,
                'confidence':      0.0,
                'violation':       None,
                'error':           str(e),
            }

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def cleanup(self):
        self._flush_gpu()
        logger.info(f"[CLEANUP] Pipeline cleanup for attempt {self.attempt_id}")

    @staticmethod
    def _flush_gpu():
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        gc.collect()


# =============================================================================
# Module-level helpers used by Django views
# =============================================================================

_pipeline_cache: dict = {}

# Per-attempt in-flight guard.
# PROBLEM: The first frame processing can take 3+ seconds (model cold-start).
# The frontend fires the next frame at 1.5s regardless of whether the previous
# response arrived.  This causes 3–4 concurrent requests for the same attempt,
# all of which hit the rate limiter or fight for the same pipeline object.
# The time-based rate limiter can't catch this because last_frame_time isn't
# updated until the request actually starts processing.
#
# FIX: Track which attempt IDs are currently being processed.  Any new request
# for an attempt that is already in-flight returns 429 immediately without
# touching the pipeline, preserving rate-limiter state for the real next frame.
_inflight: set = set()


def warmup_pipeline(attempt_id, user_id):
    """
    Call this immediately when an exam attempt is created (in the start_exam
    view), NOT on the first proctoring frame.

    This pre-initialises MediaPipe and pre-loads the registered face embedding
    so the first live frame arrives to a fully warm pipeline, eliminating the
    10-15 second cold-start delay that previously caused frames to be missed
    at the beginning of calibration.

    Usage in views.py — inside the start_exam action, after creating the attempt:

        from ai_engine.proctoring_pipeline import warmup_pipeline
        warmup_pipeline(attempt.id, request.user.id)
    """
    if attempt_id not in _pipeline_cache:
        _pipeline_cache[attempt_id] = ProctoringPipeline(attempt_id=attempt_id, user_id=user_id)
        logger.info(f"[CACHE] Pipeline warmed up for attempt {attempt_id}")
    return _pipeline_cache[attempt_id]


def analyze_proctoring_frame(attempt_id, user_id, frame_base64, calibration_complete=False):
    # In-flight guard — reject immediately if this attempt is already processing
    if attempt_id in _inflight:
        logger.warning(
            f"[IN-FLIGHT] Frame dropped for attempt {attempt_id} — "
            f"previous request still processing (frontend sent too fast)"
        )
        return {
            'error':       'Previous frame still processing',
            'retry_after': 1.0,
        }

    if attempt_id not in _pipeline_cache:
        # Fallback: create lazily if warmup was never called
        _pipeline_cache[attempt_id] = ProctoringPipeline(attempt_id=attempt_id, user_id=user_id)
        logger.info(f"[CACHE] Created pipeline for attempt {attempt_id} (lazy — warmup not called)")

    _inflight.add(attempt_id)
    try:
        pipeline = _pipeline_cache[attempt_id]
        return pipeline.analyze_frame(frame_base64, calibration_complete=calibration_complete)
    finally:
        _inflight.discard(attempt_id)


def cleanup_pipeline(attempt_id):
    _inflight.discard(attempt_id)   # clear guard in case cleanup races with a request
    if attempt_id in _pipeline_cache:
        pipeline = _pipeline_cache.pop(attempt_id)
        pipeline.cleanup()
        del pipeline
        ProctoringPipeline._flush_gpu()
        logger.info(f"[CACHE] Cleaned up pipeline for attempt {attempt_id}")


def analyze_proctoring_audio(attempt_id, audio_base64):
    if attempt_id not in _pipeline_cache:
        _pipeline_cache[attempt_id] = ProctoringPipeline(attempt_id=attempt_id)

    pipeline = _pipeline_cache[attempt_id]
    return pipeline.analyze_audio(audio_base64)