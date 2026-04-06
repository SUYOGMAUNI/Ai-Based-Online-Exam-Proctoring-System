/*
DevTools Blocker Component - FIXED VERSION
File: src/components/Proctoring/DevToolsBlocker.jsx

FIXES:
- Removed faulty DevTools detection that caused false positives
- Fixed screen blur issue
- Improved keyboard blocking
- Better violation tracking
*/

import { useEffect, useState } from 'react';
import axios from 'axios';

const DevToolsBlocker = ({ 
  examAttemptId,
  enabled = true,
  onViolation = null,
  showWarnings = true,
  blockScreenshots = true,
  strictMode = false // Set to false by default to avoid false positives
}) => {
  const [violationCount, setViolationCount] = useState(0);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [lastViolationType, setLastViolationType] = useState('');

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  // Log violation to backend
  const logViolation = async (violationType, details = {}) => {
    try {
      await api.post('/proctoring/log_session/', {
        attempt_id: examAttemptId,
        violation_type: violationType,
        timestamp: new Date().toISOString(),
        tab_focused: true,
        fullscreen_active: document.fullscreenElement !== null,
        ...details
      });

      const newCount = violationCount + 1;
      setViolationCount(newCount);

      if (onViolation) {
        onViolation({
          type: violationType,
          count: newCount,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Failed to log DevTools violation:', error);
    }
  };

  // Show temporary blocked message
  const showBlockedMessage = (message) => {
    const toast = document.createElement('div');
    toast.className = 'devtools-blocked-toast';
    toast.textContent = `🚫 ${message}`;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ef4444;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      animation: slideIn 0.3s ease-out;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  };

  // Block right-click (context menu)
  useEffect(() => {
    if (!enabled) return;

    const handleContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      console.warn('🚫 Right-click blocked');
      logViolation('RIGHT_CLICK_BLOCKED');
      showBlockedMessage('Right-click is disabled during exam');
      
      if (showWarnings) {
        setLastViolationType('Right-Click');
        setShowWarningModal(true);
        setTimeout(() => setShowWarningModal(false), 2000);
      }
      
      return false;
    };

    document.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [enabled, examAttemptId, showWarnings]);

  // Block keyboard shortcuts
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      // F12 - DevTools
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🚫 F12 (DevTools) blocked');
        logViolation('F12_BLOCKED');
        showBlockedMessage('F12 is disabled during exam');
        return false;
      }

      // Ctrl+Shift+I - Inspect Element
      if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🚫 Ctrl+Shift+I (Inspect) blocked');
        logViolation('INSPECT_BLOCKED');
        showBlockedMessage('Inspect Element is disabled');
        return false;
      }

      // Ctrl+Shift+J - Console
      if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j')) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🚫 Ctrl+Shift+J (Console) blocked');
        logViolation('CONSOLE_BLOCKED');
        showBlockedMessage('Console is disabled');
        return false;
      }

      // Ctrl+Shift+C - Element Picker
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🚫 Ctrl+Shift+C (Element Picker) blocked');
        logViolation('ELEMENT_PICKER_BLOCKED');
        showBlockedMessage('Element Picker is disabled');
        return false;
      }

      // Ctrl+U - View Source
      if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🚫 Ctrl+U (View Source) blocked');
        logViolation('VIEW_SOURCE_BLOCKED');
        showBlockedMessage('View Source is disabled');
        return false;
      }

      // Ctrl+S - Save Page
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🚫 Ctrl+S (Save Page) blocked');
        logViolation('SAVE_PAGE_BLOCKED');
        showBlockedMessage('Save Page is disabled');
        return false;
      }

      // Ctrl+P - Print
      if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🚫 Ctrl+P (Print) blocked');
        logViolation('PRINT_BLOCKED');
        showBlockedMessage('Print is disabled');
        return false;
      }

      // Print Screen
      if (blockScreenshots && (e.key === 'PrintScreen' || e.keyCode === 44)) {
        e.preventDefault();
        console.warn('🚫 Print Screen detected');
        logViolation('SCREENSHOT_ATTEMPT');
        showBlockedMessage('Screenshots are not allowed');
        
        // Clear clipboard
        if (navigator.clipboard) {
          navigator.clipboard.writeText('').catch(() => {});
        }
        
        return false;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, examAttemptId, blockScreenshots]);

  // Disable text selection and copy
  useEffect(() => {
    if (!enabled) return;

    const disableSelection = (e) => {
      e.preventDefault();
      return false;
    };

    document.addEventListener('selectstart', disableSelection);
    document.addEventListener('dragstart', disableSelection);

    const disableCopy = (e) => {
      e.preventDefault();
      console.warn('🚫 Copy blocked');
      logViolation('COPY_BLOCKED');
      showBlockedMessage('Copy is disabled during exam');
      return false;
    };

    document.addEventListener('copy', disableCopy);
    document.addEventListener('cut', disableCopy);

    return () => {
      document.removeEventListener('selectstart', disableSelection);
      document.removeEventListener('dragstart', disableSelection);
      document.removeEventListener('copy', disableCopy);
      document.removeEventListener('cut', disableCopy);
    };
  }, [enabled, examAttemptId]);

  // Warning Modal
  const WarningModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10000] pointer-events-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-8 text-center">
        <div className="text-6xl mb-4">🚨</div>
        <h2 className="text-3xl font-bold text-red-600 mb-4">
          Action Blocked!
        </h2>
        <p className="text-gray-700 mb-4 text-lg">
          {lastViolationType} is not allowed during the exam.
        </p>
        <div className="bg-red-50 border-2 border-red-500 rounded-lg p-4 mb-6">
          <p className="text-red-800 font-semibold mb-2">
            ⚠️ This violation has been recorded
          </p>
          <p className="text-sm text-red-700">
            Total violations: {violationCount}
          </p>
        </div>
        <button
          onClick={() => setShowWarningModal(false)}
          className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
        >
          Continue Exam
        </button>
      </div>
    </div>
  );

  return (
    <>
      {showWarningModal && <WarningModal />}
      
      {/* Add CSS animations */}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
};

export default DevToolsBlocker;