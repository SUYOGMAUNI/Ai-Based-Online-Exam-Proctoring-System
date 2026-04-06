import os
import io
import time
import wave
import numpy as np
import pyaudio
import psycopg2
from datetime import datetime
import threading
import queue
import logging
from django.conf import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# --- Audio and Detection Parameters ---
SAMPLE_RATE = 16000       # Hz
CHUNK_SIZE = 1024         # samples per frame
THRESHOLD = 0.05          # Amplitude threshold (adjust as needed)
TRIGGER_WINDOW = 0.5      # seconds above threshold to trigger capture
CAPTURE_DURATION = 30     # seconds to record after trigger

# Warning system parameters
WARNING_THRESHOLD = 3     # Number of warnings before escalation
COOLDOWN_PERIOD = 60      # Seconds before warnings can trigger again

# --- PostgreSQL connection params ---
from ai_engine.db_utils import get_db_connection_params

DB_CONN = get_db_connection_params()

LOCAL_AUDIO_DIR = settings.AUDIO_CAPTURES_DIR
LOGS_DIR = settings.LOGS_DIR


class AudioPipeline:
    """
    Enhanced Audio Pipeline with warning tracking and session management
    Matches your documentation's Parallel Audio Pipeline architecture
    """

    def __init__(self, candidate_id, exam_session_id=None):
        self.candidate_id = candidate_id
        self.exam_session_id = exam_session_id
        self.warning_count = 0
        self.is_monitoring = False
        self.last_trigger_time = None

        # Initialize text log file
        self.log_file_path = os.path.join(
            LOGS_DIR,
            f"audio_{candidate_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        )
        self._write_log("="*70)
        self._write_log("AUDIO PIPELINE - SESSION STARTED")
        self._write_log(f"Candidate ID: {candidate_id}")
        self._write_log(f"Exam Session ID: {exam_session_id}")
        self._write_log(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self._write_log("="*70 + "\n")

        # Audio processing
        self.audio = pyaudio.PyAudio()
        self.stream = None
        self.audio_queue = queue.Queue()

        # Initialize database
        self._initialize_database()

    def _initialize_database(self):
        """Create necessary database tables if they don't exist"""
        try:
            conn = psycopg2.connect(**DB_CONN)
            cur = conn.cursor()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS suspicious_audio_events (
                    id SERIAL PRIMARY KEY,
                    candidate_id VARCHAR(100) NOT NULL,
                    exam_session_id VARCHAR(100),
                    timestamp TIMESTAMP NOT NULL,
                    audio_data BYTEA,
                    audio_file_path TEXT,
                    amplitude_peak FLOAT,
                    duration_seconds INTEGER,
                    warning_number INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS audio_warnings (
                    id SERIAL PRIMARY KEY,
                    candidate_id VARCHAR(100) NOT NULL,
                    exam_session_id VARCHAR(100),
                    warning_count INTEGER,
                    last_warning_time TIMESTAMP,
                    status VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.commit()
            cur.close()
            conn.close()
            logger.info("Database tables initialized successfully")

        except Exception as e:
            logger.error(f"Error initializing database: {e}")

    def _write_log(self, message):
        """Write message to text log file"""
        try:
            with open(self.log_file_path, 'a', encoding='utf-8') as f:
                f.write(f"{message}\n")
        except Exception as e:
            logger.error(f"Error writing to log file: {e}")

    def get_amplitude(self, segment):
        """Calculate max normalized amplitude of audio chunk."""
        audio_np = segment.astype(np.float32) / np.iinfo(np.int16).max
        return np.max(np.abs(audio_np))

    def capture_segment(self, stream, duration):
        """Capture and return audio segment from stream for given duration."""
        frames = []
        num_chunks = int(SAMPLE_RATE / CHUNK_SIZE * duration)

        for _ in range(num_chunks):
            try:
                data = stream.read(CHUNK_SIZE, exception_on_overflow=False)
                frames.append(np.frombuffer(data, dtype=np.int16))
            except Exception as e:
                logger.warning(f"Error reading audio chunk: {e}")
                continue

        if frames:
            return np.concatenate(frames)
        return None

    def save_audio_locally(self, audio_np_segment, timestamp, amplitude_peak):
        """Save audio numpy segment as a WAV file."""
        filename = f"{self.candidate_id}_{timestamp.strftime('%Y%m%d_%H%M%S')}.wav"
        filepath = os.path.join(LOCAL_AUDIO_DIR, filename)

        try:
            with wave.open(filepath, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)  # 16-bit PCM
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(audio_np_segment.tobytes())

            logger.info(f"Saved audio locally: {filepath}")
            return filepath

        except Exception as e:
            logger.error(f"Error saving audio locally: {e}")
            return None

    def store_audio_in_db(self, audio_bytes, filepath, timestamp, amplitude_peak):
        """Store audio information in PostgreSQL database and log to file"""
        self.warning_count += 1
        log_message = f"[{timestamp.strftime('%Y-%m-%d %H:%M:%S')}] "
        log_message += f"SUSPICIOUS AUDIO DETECTED | WARNING #{self.warning_count}"
        log_message += f" | Peak Amplitude: {amplitude_peak:.4f}"
        log_message += f" | Duration: {CAPTURE_DURATION}s"
        if filepath:
            log_message += f" | Audio File: {filepath}"

        self._write_log(log_message)

        try:
            conn = psycopg2.connect(**DB_CONN)
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO suspicious_audio_events 
                (candidate_id, exam_session_id, timestamp, audio_data, audio_file_path, 
                 amplitude_peak, duration_seconds, warning_number)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                self.candidate_id,
                self.exam_session_id,
                timestamp,
                psycopg2.Binary(audio_bytes),
                filepath,
                float(amplitude_peak),
                CAPTURE_DURATION,
                self.warning_count
            ))

            event_id = cur.fetchone()[0]

            cur.execute("""
                INSERT INTO audio_warnings 
                (candidate_id, exam_session_id, warning_count, last_warning_time, status)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (candidate_id, exam_session_id) 
                DO UPDATE SET 
                    warning_count = audio_warnings.warning_count + 1,
                    last_warning_time = %s,
                    status = CASE 
                        WHEN audio_warnings.warning_count + 1 >= %s THEN 'CRITICAL'
                        ELSE 'ACTIVE'
                    END
            """, (
                self.candidate_id,
                self.exam_session_id,
                self.warning_count,
                timestamp,
                'ACTIVE',
                timestamp,
                WARNING_THRESHOLD
            ))

            conn.commit()
            cur.close()
            conn.close()

            logger.info(f"Stored audio event #{event_id} in database")
            return event_id

        except Exception as e:
            logger.error(f"Error storing audio in DB: {e}")
            return None

    def check_warning_threshold(self):
        """Check if warning threshold exceeded (N warnings)"""
        if self.warning_count >= WARNING_THRESHOLD:
            alert_msg = (
                f"⚠️ WARNING THRESHOLD EXCEEDED for {self.candidate_id}: "
                f"{self.warning_count} warnings!"
            )
            logger.critical(alert_msg)
            self._write_log("\n" + "!"*70)
            self._write_log(alert_msg)
            self._write_log("!"*70 + "\n")
            self.raise_critical_alert()
            return True
        return False

    def raise_critical_alert(self):
        """Raise critical alert when threshold exceeded"""
        try:
            conn = psycopg2.connect(**DB_CONN)
            cur = conn.cursor()

            cur.execute("""
                INSERT INTO critical_alerts 
                (candidate_id, exam_session_id, alert_type, alert_message, timestamp)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                self.candidate_id,
                self.exam_session_id,
                'AUDIO_VIOLATION',
                f'Multiple suspicious audio events detected: {self.warning_count} warnings',
                datetime.utcnow()
            ))

            conn.commit()
            cur.close()
            conn.close()

            logger.critical(f"Critical alert raised for {self.candidate_id}")

        except Exception as e:
            logger.error(f"Error raising critical alert: {e}")

    def is_cooldown_active(self):
        """Check if in cooldown period after last trigger"""
        if self.last_trigger_time is None:
            return False
        elapsed = (datetime.utcnow() - self.last_trigger_time).total_seconds()
        return elapsed < COOLDOWN_PERIOD

    def start_monitoring(self):
        """Start the audio monitoring pipeline"""
        try:
            self.stream = self.audio.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=SAMPLE_RATE,
                input=True,
                frames_per_buffer=CHUNK_SIZE
            )

            self.is_monitoring = True
            logger.info(f"Audio monitoring started for candidate: {self.candidate_id}")
            self._monitoring_loop()

        except Exception as e:
            logger.error(f"Error starting audio monitoring: {e}")
            self.is_monitoring = False

    def _monitoring_loop(self):
        """Main monitoring loop"""
        trigger_counter = 0
        sustained_trig_needed = int(SAMPLE_RATE / CHUNK_SIZE * TRIGGER_WINDOW)
        peak_amplitude = 0

        try:
            while self.is_monitoring:
                data = self.stream.read(CHUNK_SIZE, exception_on_overflow=False)
                segment = np.frombuffer(data, dtype=np.int16)
                amplitude = self.get_amplitude(segment)

                if amplitude > THRESHOLD:
                    trigger_counter += 1
                    peak_amplitude = max(peak_amplitude, amplitude)
                    logger.debug(
                        f"Trigger +1 ({trigger_counter}/{sustained_trig_needed}), "
                        f"amplitude={amplitude:.3f}"
                    )
                else:
                    if trigger_counter > 0:
                        logger.debug(f"Trigger reset (was {trigger_counter})")
                    trigger_counter = 0
                    peak_amplitude = 0

                if trigger_counter >= sustained_trig_needed:
                    if self.is_cooldown_active():
                        logger.info("Cooldown active, skipping capture")
                        trigger_counter = 0
                        continue

                    logger.warning("** Suspicious audio detected! Capturing segment... **")
                    captured_segment = self.capture_segment(self.stream, CAPTURE_DURATION)

                    if captured_segment is not None:
                        audio_bytes = captured_segment.tobytes()
                        timestamp = datetime.utcnow()

                        filepath = self.save_audio_locally(captured_segment, timestamp, peak_amplitude)
                        self.store_audio_in_db(audio_bytes, filepath, timestamp, peak_amplitude)

                        logger.warning(
                            f"Audio segment captured at {timestamp} "
                            f"(Warning #{self.warning_count})"
                        )

                        self.last_trigger_time = timestamp
                        self.check_warning_threshold()

                    trigger_counter = 0
                    peak_amplitude = 0

                time.sleep(CHUNK_SIZE / SAMPLE_RATE)

        except KeyboardInterrupt:
            logger.info("Audio monitoring stopped by user")
        except Exception as e:
            logger.error(f"Error in monitoring loop: {e}")
        finally:
            self.stop_monitoring()

    def stop_monitoring(self):
        """Stop the audio monitoring pipeline"""
        self.is_monitoring = False

        if self.stream:
            self.stream.stop_stream()
            self.stream.close()

        self.audio.terminate()

        self._write_log("\n" + "="*70)
        self._write_log("AUDIO PIPELINE - SESSION ENDED")
        self._write_log(f"Ended at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self._write_log(f"Total Warnings: {self.warning_count}")
        self._write_log("="*70)

        logger.info(f"Audio monitoring stopped for candidate: {self.candidate_id}")
        logger.info(f"Session log saved to: {self.log_file_path}")

    def get_session_summary(self):
        """Get summary of audio events for this session"""
        try:
            conn = psycopg2.connect(**DB_CONN)
            cur = conn.cursor()

            cur.execute("""
                SELECT 
                    COUNT(*) as total_events,
                    MAX(amplitude_peak) as max_amplitude,
                    MIN(timestamp) as first_event,
                    MAX(timestamp) as last_event
                FROM suspicious_audio_events
                WHERE candidate_id = %s AND exam_session_id = %s
            """, (self.candidate_id, self.exam_session_id))

            result = cur.fetchone()
            cur.close()
            conn.close()

            return {
                'total_events': result[0] or 0,
                'max_amplitude': result[1],
                'first_event': result[2],
                'last_event': result[3],
                'warning_count': self.warning_count
            }

        except Exception as e:
            logger.error(f"Error getting session summary: {e}")
            return None


# =============================================================================
# Integration with Main Proctoring System
# =============================================================================

class IntegratedProctoringSystem:
    """
    Integrated system combining Audio, Webcam, and Face Match pipelines
    """

    def __init__(self, candidate_id, exam_session_id):
        self.candidate_id = candidate_id
        self.exam_session_id = exam_session_id

        self.audio_pipeline = AudioPipeline(candidate_id, exam_session_id)
        self.monitoring_threads = []

    def start_proctoring(self):
        """Start all monitoring pipelines in parallel"""
        logger.info(f"Starting proctoring for candidate: {self.candidate_id}")

        audio_thread = threading.Thread(
            target=self.audio_pipeline.start_monitoring,
            daemon=True
        )
        audio_thread.start()
        self.monitoring_threads.append(audio_thread)

        logger.info("All monitoring pipelines started")

    def stop_proctoring(self):
        """Stop all monitoring pipelines"""
        logger.info("Stopping all pipelines...")
        self.audio_pipeline.stop_monitoring()
        for thread in self.monitoring_threads:
            thread.join(timeout=5)
        logger.info("All pipelines stopped")

    def generate_final_report(self):
        """Generate comprehensive proctoring report"""
        audio_summary = self.audio_pipeline.get_session_summary()
        return {
            'candidate_id': self.candidate_id,
            'exam_session_id': self.exam_session_id,
            'audio_violations': audio_summary,
            'timestamp': datetime.utcnow().isoformat()
        }


# =============================================================================
# WebM Audio Decoding Helper
# =============================================================================

def _decode_webm_to_pcm(audio_bytes: bytes):
    try:
        import soundfile as sf
        audio_array, sr = sf.read(io.BytesIO(audio_bytes), dtype='int16', always_2d=False)
        logger.debug(f"[AUDIO DECODE] soundfile: shape={audio_array.shape}, sr={sr}")
        return audio_array, sr
    except Exception as sf_err:
        logger.debug(f"[AUDIO DECODE] soundfile failed: {sf_err}")

    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_file(io.BytesIO(audio_bytes), format="webm")
        seg = seg.set_channels(1).set_sample_width(2)   # mono, 16-bit
        audio_array = np.array(seg.get_array_of_samples(), dtype=np.int16)
        sr = seg.frame_rate
        logger.debug(f"[AUDIO DECODE] pydub: samples={len(audio_array)}, sr={sr}")
        return audio_array, sr
    except Exception as pd_err:
        logger.debug(f"[AUDIO DECODE] pydub failed: {pd_err}")

    if len(audio_bytes) % 2 != 0:
        audio_bytes = audio_bytes[:-1]
        logger.debug("[AUDIO DECODE] Stripped 1 odd byte before raw int16 cast")

    if len(audio_bytes) == 0:
        raise RuntimeError("Audio bytes empty after stripping")

    audio_array = np.frombuffer(audio_bytes, dtype=np.int16).copy()
    logger.debug(f"[AUDIO DECODE] raw PCM fallback: samples={len(audio_array)}")
    return audio_array, SAMPLE_RATE


def detect_speech_simple(audio_bytes: bytes) -> dict:
    """
    Detect speech in a single audio chunk sent from the browser.

    The browser's MediaRecorder produces WebM/Opus, NOT raw PCM.
    We decode it properly before analysis.

    Args:
        audio_bytes: Raw bytes decoded from the base64 payload.
                     Expected container: audio/webm (MediaRecorder default).

    Returns:
        {
            'speech_detected': bool,
            'audio_level':     float  (0.0 – 1.0 RMS),
            'confidence':      float  (0 – 100),
            'threshold_used':  float,
        }
    """
    try:
        try:
            audio_array, sample_rate = _decode_webm_to_pcm(audio_bytes)
        except Exception as decode_err:
            logger.error(f"[AUDIO] Could not decode audio: {decode_err}")
            return {
                'speech_detected': False,
                'audio_level': 0.0,
                'confidence': 0.0,
                'threshold_used': THRESHOLD,
                'error': f'Decode failed: {decode_err}',
            }

        if len(audio_array) == 0:
            logger.warning("[AUDIO] Empty audio array after decode")
            return {
                'speech_detected': False,
                'audio_level': 0.0,
                'confidence': 0.0,
                'threshold_used': THRESHOLD,
            }

        # ── Flatten to 1-D if decode gave us stereo ──────────────────────────
        if audio_array.ndim > 1:
            audio_array = audio_array[:, 0]

        # ── RMS amplitude (normalised to 0-1) ────────────────────────────────
        audio_float = audio_array.astype(np.float32) / 32768.0
        audio_level = float(np.sqrt(np.mean(audio_float ** 2)))

        speech_detected = audio_level > THRESHOLD

        # Linear confidence: threshold → 50 %, 2× threshold → 100 %
        confidence = min(100.0, (audio_level / THRESHOLD) * 50.0) if speech_detected else 0.0

        logger.debug(
            f"[AUDIO] level={audio_level:.4f}, threshold={THRESHOLD}, "
            f"detected={speech_detected}, confidence={confidence:.1f}%"
        )

        return {
            'speech_detected': speech_detected,
            'audio_level': audio_level,
            'confidence': float(confidence),
            'threshold_used': THRESHOLD,
        }

    except Exception as e:
        logger.error(f"[AUDIO] detect_speech_simple error: {e}", exc_info=True)
        return {
            'speech_detected': False,
            'audio_level': 0.0,
            'confidence': 0.0,
            'threshold_used': THRESHOLD,
            'error': str(e),
        }


# =============================================================================
# Usage Examples
# =============================================================================

def main():
    """Example usage of enhanced audio pipeline"""
    print("="*60)
    print("Example 1: Standalone Audio Pipeline")
    print("="*60)

    pipeline = AudioPipeline(
        candidate_id="candidate_123",
        exam_session_id="exam_2025_01"
    )

    try:
        pipeline.start_monitoring()
    except KeyboardInterrupt:
        pipeline.stop_monitoring()

    summary = pipeline.get_session_summary()
    print("\nSession Summary:")
    print(f"  Total Events: {summary['total_events']}")
    print(f"  Max Amplitude: {summary['max_amplitude']}")
    print(f"  Warning Count: {summary['warning_count']}")

    print("\n" + "="*60)
    print("Example 2: Integrated Proctoring System")
    print("="*60)

    system = IntegratedProctoringSystem(
        candidate_id="candidate_456",
        exam_session_id="exam_2025_02"
    )

    try:
        system.start_proctoring()
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        system.stop_proctoring()
        report = system.generate_final_report()
        print("\nFinal Report:")
        print(report)


if __name__ == "__main__":
    main()