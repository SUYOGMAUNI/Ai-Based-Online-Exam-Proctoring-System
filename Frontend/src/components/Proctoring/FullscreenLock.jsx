/*
Fullscreen Lock Component - FIXED VERSION
File: src/components/Proctoring/FullscreenLock.jsx

This component enforces fullscreen mode during exams.
It detects when students exit fullscreen and logs violations.

FIXED: No automatic fullscreen request - must be triggered by user gesture
*/

import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const FullscreenLock = ({ 
  examAttemptId,
  enabled = true,
  onViolation = null,
  autoReenter = false, // Changed to false - don't auto re-enter, show prompt instead
  maxViolations = 3, // Maximum violations before action
  ignoreNextExitRef = null // Optional ref to ignore next fullscreen-exit violation
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [violationCount, setViolationCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [showExitPrompt, setShowExitPrompt] = useState(false);

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  // Log violation to backend
  const logViolation = async () => {
    try {
      await api.post('/proctoring/log_session/', {
        attempt_id: examAttemptId,
        fullscreen_active: false,
        violation_type: 'FULLSCREEN_EXIT',
        timestamp: new Date().toISOString()
      });

      const newCount = violationCount + 1;
      setViolationCount(newCount);

      if (onViolation) {
        onViolation({
          type: 'FULLSCREEN_EXIT',
          count: newCount,
          timestamp: new Date()
        });
      }

      // Show warning if threshold reached
      if (newCount >= maxViolations) {
        setShowExitPrompt(true);
      }
    } catch (error) {
      console.error('Failed to log fullscreen violation:', error);
    }
  };

  // Enter fullscreen - must be called from user gesture
  const enterFullscreen = useCallback(async () => {
    try {
      const elem = document.documentElement;
      
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) { // Safari
        await elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) { // Firefox
        await elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) { // IE11
        await elem.msRequestFullscreen();
      }
      
      setShowWarning(false);
    } catch (error) {
      console.error('Fullscreen request failed:', error);
      // User denied or browser doesn't support - keep warning visible
    }
  }, []);

  // Exit fullscreen
  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  };

  // Check if currently in fullscreen
  const checkFullscreen = () => {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
  };

  // Handle fullscreen change
  useEffect(() => {
    if (!enabled) return;

    const handleFullscreenChange = () => {
      const isNowFullscreen = checkFullscreen();
      setIsFullscreen(isNowFullscreen);

      if (!isNowFullscreen) {
        // If parent has marked the next exit as intentional, skip logging
        if (ignoreNextExitRef && ignoreNextExitRef.current) {
          ignoreNextExitRef.current = false;
          console.log('ℹ️ Fullscreen exit ignored (intentional)');
          return;
        }

        // User exited fullscreen
        console.warn('🚨 Fullscreen exit detected!');
        logViolation();
        setShowWarning(true);
      } else {
        console.log('✅ Fullscreen active');
        setShowWarning(false);
      }
    };

    // Listen to fullscreen change events (different browsers)
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    // IMPORTANT: Don't enter fullscreen automatically here
    // It must be triggered by user gesture (button click)
    
    // Check if already in fullscreen on mount
    setIsFullscreen(checkFullscreen());

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, [enabled, examAttemptId, ignoreNextExitRef]);

  // Prevent ESC key (exits fullscreen) - WARNING: This may not work in all browsers
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        // We can't actually prevent ESC from exiting fullscreen in most browsers
        // But we can show a warning
        console.warn('⚠️ ESC key pressed - fullscreen will exit');
        // The fullscreenchange event will handle the rest
      }

      // Prevent F11 (fullscreen toggle)
      if (e.key === 'F11') {
        e.preventDefault();
        console.warn('🚫 F11 key blocked');
        return false;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled]);

  // Warning Modal - shown when user exits fullscreen
  const WarningModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-red-600 mb-2">
            Fullscreen Required!
          </h2>
          <p className="text-gray-700 mb-4">
            You exited fullscreen mode. This violation has been recorded.
          </p>
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
            <p className="text-sm text-red-800">
              <strong>Violations:</strong> {violationCount} / {maxViolations}
            </p>
            <p className="text-xs text-red-700 mt-2">
              Click below to return to fullscreen mode and continue your exam.
            </p>
          </div>
          <button
            onClick={enterFullscreen}
            className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            Return to Fullscreen
          </button>
        </div>
      </div>
    </div>
  );

  // Exit Prompt (when max violations reached)
  const ExitPrompt = () => (
    <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-8">
        <div className="text-center">
          <div className="text-6xl mb-4">⛔</div>
          <h2 className="text-3xl font-bold text-red-600 mb-4">
            Maximum Violations Reached
          </h2>
          <p className="text-gray-700 mb-6 text-lg">
            You have exceeded the maximum number of fullscreen violations ({maxViolations}).
          </p>
          <div className="bg-red-50 border-2 border-red-500 rounded-lg p-6 mb-6">
            <p className="text-red-800 font-semibold mb-2">
              Your exam may be flagged for review.
            </p>
            <p className="text-sm text-red-700">
              Please contact your instructor if you believe this is an error.
            </p>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => {
                enterFullscreen();
                setShowExitPrompt(false);
              }}
              className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              Continue Exam in Fullscreen
            </button>
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to exit the exam? This will submit your current answers.')) {
                  // Navigate away or submit exam
                  window.location.href = '/student/dashboard';
                }
              }}
              className="w-full px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition"
            >
              Exit Exam
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Fullscreen status indicator
  const StatusIndicator = () => (
    <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2 z-50 ${
      isFullscreen ? 'bg-green-500' : 'bg-red-500'
    } text-white`}>
      <div className={`w-3 h-3 rounded-full ${
        isFullscreen ? 'bg-green-200' : 'bg-red-200 animate-ping'
      }`}></div>
      <span className="text-sm font-medium">
        {isFullscreen ? '🔒 Fullscreen Active' : '⚠️ Fullscreen Required'}
      </span>
    </div>
  );

  return (
    <>
      {showWarning && <WarningModal />}
      {showExitPrompt && <ExitPrompt />}
      {enabled && <StatusIndicator />}
    </>
  );
};

export default FullscreenLock;