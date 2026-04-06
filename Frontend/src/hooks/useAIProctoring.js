/*
  useAIProctoring.js — Fixed
  
  Problems fixed:
  
  1. BURST / 429s — The hook used setInterval which fires blindly every N ms
     regardless of whether the previous request finished.  If the first frame
     takes 3+ seconds (model cold-start), frames 2, 3, 4 all arrive at the
     backend while frame 1 is still processing, all getting 429'd.
     Fix: replaced setInterval with a sequential async loop using setTimeout
     after each request completes (success OR error).

  2. HOOK RESTART ON calibrationComplete FLIP — calibrationComplete was in
     the dependency array.  When the CALIBRATION→EXAM transition flips it from
     false → true, the effect tears down the old interval and starts a new one,
     causing another burst of frames.
     Fix: calibrationComplete is stored in a ref and read inside captureAndAnalyze,
     never as a reactive dep.

  3. HOOK RESTART ON interval CHANGE — interval prop changes from 1500 → 3000
     at the same CALIBRATION→EXAM boundary, triggering yet another restart.
     Fix: interval stored in a ref too, updated without causing effect re-run.

  4. UNNECESSARY RE-RENDERS — onViolation was already ref-stabilised; kept that.
     Token is already ref-stabilised; kept that.
*/

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const useAIProctoring = ({
  videoRef,
  canvasRef,
  attemptId,
  enabled = true,
  cameraReady = false,
  calibrationComplete = false,
  onViolation = null,
  onBaselineReady = null,
  interval = 3000,
  trustScoreThreshold = 40
}) => {
  const [lastTrustScore, setLastTrustScore] = useState(100);

  const tokenRef              = useRef(localStorage.getItem('token'));
  const onViolationRef        = useRef(onViolation);
  const onBaselineReadyRef    = useRef(onBaselineReady);
  const baselineReadyFired    = useRef(false);
  const calibrationCompleteRef = useRef(calibrationComplete);
  const intervalRef           = useRef(interval);
  const isCalibrating         = useRef(true);
  const hasShownCriticalWarning = useRef(false);

  onViolationRef.current        = onViolation;
  onBaselineReadyRef.current    = onBaselineReady;
  calibrationCompleteRef.current = calibrationComplete;
  intervalRef.current           = interval;

  const API_BASE = 'http://localhost:8000/api';

  // ── Main monitoring effect ────────────────────────────────────────────────
  // Deps: only the things that genuinely need to restart the loop.
  // calibrationComplete and interval are intentionally excluded — they are
  // tracked via refs above so the loop picks up the new values without
  // restarting the effect.
  useEffect(() => {
    console.log('🤖 [AI PROCTORING] Hook effect triggered:', {
      enabled,
      attemptId,
      cameraReady,
      videoRefExists: !!videoRef?.current,
    });

    if (!enabled) {
      console.log('🤖 [AI PROCTORING] Disabled - enabled flag is false');
      return;
    }
    if (!attemptId) {
      console.log('🤖 [AI PROCTORING] Disabled - no attemptId');
      return;
    }
    if (!videoRef?.current) {
      console.log('🤖 [AI PROCTORING] Disabled - no video reference');
      return;
    }
    if (!cameraReady) {
      console.log('🤖 [AI PROCTORING] Waiting for camera to be ready...');
      return;
    }

    const video = videoRef.current;
    if (video.readyState < 3 || video.videoWidth === 0) {
      console.log('🤖 [AI PROCTORING] Video element not ready yet:', {
        readyState: video.readyState,
        videoWidth: video.videoWidth,
      });
      return;
    }

    console.log(`🤖 [AI PROCTORING] ✅ Starting silent monitoring for attempt: ${attemptId}`);
    console.log(`🤖 [AI PROCTORING] Video status:`, {
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    });

    const api = axios.create({
      baseURL: API_BASE,
      headers: {
        'Authorization': `Token ${tokenRef.current}`,
        'Content-Type': 'application/json'
      }
    });

    // Cancelled flag — set to true in cleanup to stop the loop.
    let cancelled = false;

    // ── Sequential capture loop ───────────────────────────────────────────
    // Unlike setInterval, this waits for each request to resolve before
    // scheduling the next one.  This eliminates the 429 burst entirely: the
    // backend will never see two in-flight requests for the same attempt.
    const captureAndAnalyze = async () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (!video || video.readyState < 3 || video.videoWidth === 0) {
        console.log('🤖 [AI PROCTORING] Video not ready, skipping frame');
        // Still schedule the next attempt after the current interval.
        scheduleNext();
        return;
      }

      console.log('📸 [AI PROCTORING] Capturing frame...');

      let canvas = canvasRef?.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
      }
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

      const frameData = canvas.toDataURL('image/jpeg', 0.85);

      console.log('📤 [AI PROCTORING] Sending frame to backend...', {
        frameSize: frameData.length,
        attemptId,
      });

      try {
        const response = await api.post('/proctoring/analyze-frame/', {
          attempt_id: attemptId,
          frame: frameData,
          timestamp: new Date().toISOString(),
          calibration_complete: calibrationCompleteRef.current   // read ref, not dep
        });

        if (cancelled) return;

        console.log('✅ [AI PROCTORING] Frame analyzed:', response.data);

        const violations = response.data.violations || [];
        const trustScore = response.data.trust_score || 100;

        setLastTrustScore(trustScore);

        if (violations.length > 0) {
          console.log(
            `🔇 [SILENT] ${violations.length} violation(s) detected (not shown to student):`,
            violations
          );
        }

        // Critical trust-score warning (shown to student once)
        if (trustScore < trustScoreThreshold && !hasShownCriticalWarning.current) {
          console.warn(`⚠️ [TRUST SCORE] Critical: ${trustScore}% (threshold: ${trustScoreThreshold}%)`);
          hasShownCriticalWarning.current = true;
          onViolationRef.current?.({
            type: 'TRUST_SCORE_LOW',
            timestamp: new Date(),
            trust_score: trustScore,
            threshold: trustScoreThreshold,
            showWarning: true
          });
        }

        // Forward violations to parent silently
        violations.forEach(violationType => {
          onViolationRef.current?.({
            type: violationType,
            timestamp: new Date(),
            trust_score: trustScore,
            showWarning: false
          });
        });

        if (response.data.baseline_ready && !baselineReadyFired.current) {
          baselineReadyFired.current = true;
          console.log('✅ [AI] Backend baseline locked — triggering calibration complete');
          onBaselineReadyRef.current?.();
        }

        if (response.data.calibration_phase) {
          console.log('🎯 [AI] Calibration in progress...');
        } else if (isCalibrating.current) {
          isCalibrating.current = false;
          console.log('✅ [AI] Calibration complete — monitoring active');
        }

      } catch (error) {
        if (cancelled) return;
        console.error('❌ [AI] Frame analysis failed:', error.message);
        if (error.response) {
          console.error('❌ [AI] Server response:', error.response.data);
        }
      }

      // Schedule the next frame AFTER the request completes (sequential).
      scheduleNext();
    };

    let timeoutHandle = null;
    const scheduleNext = () => {
      if (cancelled) return;
      // intervalRef.current is always the latest interval value, even if the
      // prop changed from 1500 → 3000 mid-session without restarting the effect.
      timeoutHandle = setTimeout(captureAndAnalyze, intervalRef.current);
    };

    // Kick off immediately — first frame with no leading delay.
    isCalibrating.current = true;
    console.log(`⏰ [AI] Starting sequential monitoring (initial interval: ${intervalRef.current / 1000}s)`);
    captureAndAnalyze();

    return () => {
      console.log('🛑 [AI PROCTORING] Stopped');
      cancelled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

  // NOTE: calibrationComplete and interval are intentionally NOT in this array.
  // They are tracked via refs above. Adding them would restart the loop at the
  // CALIBRATION→EXAM boundary, causing the double-burst seen in the logs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attemptId, cameraReady, videoRef, canvasRef, trustScoreThreshold]);

  return { trustScore: lastTrustScore };
};

export default useAIProctoring;