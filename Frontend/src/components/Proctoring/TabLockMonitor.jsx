/*
Tab Lock Monitor Component
File: src/components/Proctoring/TabLockMonitor.jsx

FIXES:
- Window blur no longer fires violations after exam submission (enabled=false)
- Stale closure bug fixed: useRef tracks enabled state so handlers always
  see the current value, not the value captured at registration time
- Debounced blur violation is cancelled immediately on focus restore, AND
  also cancelled if enabled flips to false mid-timeout
- isSubmittingRef: blur/focus events during the submit flow are suppressed,
  since clicking the submit button/dialog briefly steals window focus
*/

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const TabLockMonitor = ({
  examAttemptId,
  enabled = true,
  onViolation = null,
  strictMode = true,
  // ✅ Pass a ref from the parent that is set to `true` just before
  //    submitting and back to `false` after. This suppresses the blur
  //    that fires when the submit confirm dialog steals focus.
  //    Usage in parent:
  //      const isSubmittingRef = useRef(false);
  //      // before submit:  isSubmittingRef.current = true;
  //      // after submit:   isSubmittingRef.current = false;
  //      <TabLockMonitor isSubmittingRef={isSubmittingRef} ... />
  isSubmittingRef = null,
}) => {
  const [isTabActive, setIsTabActive] = useState(true);
  const [violationCount, setViolationCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);

  const violationTimeoutRef = useRef(null);
  // Internal fallback ref in case parent doesn't provide one
  const internalSubmittingRef = useRef(false);
  const submittingRef = isSubmittingRef ?? internalSubmittingRef;

  // Mirror `enabled` in a ref so event handlers always read the
  // current value, not the stale value captured when they were registered.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;

    // If the exam is disabled/submitted while a blur timeout is
    // pending, cancel it immediately so no ghost violation fires.
    if (!enabled && violationTimeoutRef.current) {
      clearTimeout(violationTimeoutRef.current);
      violationTimeoutRef.current = null;
    }
  }, [enabled]);

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  const api = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: `Token ${token}` }
  });

  const logViolation = async (violationType, details = {}) => {
    // Guard using the ref so the live value is checked at call time,
    // not the value captured when the effect ran.
    if (!enabledRef.current) return;
    // ✅ Suppress violations that fire during the submit flow
    if (submittingRef.current) {
      console.log(`ℹ️ [TabLock] Violation suppressed during submission: ${violationType}`);
      return;
    }

    try {
      await api.post('/proctoring/log_session/', {
        attempt_id: examAttemptId,
        tab_focused: false,
        violation_type: violationType,
        timestamp: new Date().toISOString(),
        ...details
      });

      setViolationCount(prev => {
        const next = prev + 1;
        if (onViolation) {
          onViolation({ type: violationType, count: next, timestamp: new Date() });
        }
        return next;
      });
    } catch (error) {
      console.error('Failed to log violation:', error);
    }
  };

  // Handle visibility change (tab switch)
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (!enabledRef.current) return; // guard for stale handler

      const isVisible = document.visibilityState === 'visible';
      setIsTabActive(isVisible);

      if (!isVisible) {
        console.warn('🚨 Tab switch detected!');
        logViolation('TAB_SWITCH', { switched_at: new Date().toISOString() });
        if (strictMode) setShowWarning(true);
      } else {
        console.log('✅ Tab became active again');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, examAttemptId, strictMode]);

  // Handle window blur (focus lost)
  useEffect(() => {
    if (!enabled) return;

    const handleBlur = () => {
      if (!enabledRef.current) return; // guard for stale handler

      console.warn('⚠️ Window lost focus');
      setIsTabActive(false);

      if (violationTimeoutRef.current) {
        clearTimeout(violationTimeoutRef.current);
      }

      violationTimeoutRef.current = setTimeout(() => {
        // Double-check both flags inside the timeout — this catches the race
        // where blur fires just as the exam submits or during submit dialog.
        if (!enabledRef.current) {
          console.log('ℹ️ Blur timeout fired after exam ended — ignored');
          return;
        }
        if (submittingRef.current) {
          console.log('ℹ️ Blur timeout fired during submission — ignored');
          return;
        }
        logViolation('WINDOW_BLUR', { blur_at: new Date().toISOString() });
      }, 1000);
    };

    const handleFocus = () => {
      console.log('✅ Window gained focus');
      setIsTabActive(true);

      if (violationTimeoutRef.current) {
        clearTimeout(violationTimeoutRef.current);
        violationTimeoutRef.current = null;
      }
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      if (violationTimeoutRef.current) {
        clearTimeout(violationTimeoutRef.current);
      }
    };
  }, [enabled, examAttemptId]);

  // Prevent common shortcuts that could switch tabs
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      if (!enabledRef.current) return;

      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        console.warn('🚫 Tab switching shortcut blocked');
        return false;
      }
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        console.warn('🚫 Window switching shortcut blocked');
        return false;
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        console.warn('🚫 Close tab shortcut blocked');
        return false;
      }
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        console.warn('🚫 New window shortcut blocked');
        return false;
      }
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
        e.preventDefault();
        console.warn('🚫 Page refresh blocked');
        return false;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);

  // Prevent context menu (right-click)
  useEffect(() => {
    if (!enabled) return;

    const handleContextMenu = (e) => {
      if (!enabledRef.current) return;
      e.preventDefault();
      console.warn('🚫 Context menu blocked');
      return false;
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [enabled]);

  // Warning Modal
  const WarningModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6 animate-shake">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-600 mb-2">Tab Switch Detected!</h2>
          <p className="text-gray-700 mb-4">
            You switched away from the exam tab. This violation has been recorded.
          </p>
          <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-4">
            <p className="text-sm text-yellow-800">
              <strong>Total Violations:</strong> {violationCount}
            </p>
            <p className="text-xs text-yellow-700 mt-2">
              Excessive violations may result in exam disqualification.
            </p>
          </div>
          <button
            onClick={() => setShowWarning(false)}
            className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            Return to Exam
          </button>
        </div>
      </div>
    </div>
  );

  return <>{showWarning && <WarningModal />}</>;
};

export default TabLockMonitor;

/*
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-10px); }
  20%, 40%, 60%, 80% { transform: translateX(10px); }
}
.animate-shake { animation: shake 0.5s; }
*/