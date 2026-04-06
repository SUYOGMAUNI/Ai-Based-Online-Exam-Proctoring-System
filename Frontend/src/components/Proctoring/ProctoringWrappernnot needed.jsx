import React from 'react';
import axios from 'axios';
import DevToolsBlocker from './DevToolsBlocker';
import TabLockMonitor from './TabLockMonitor';
import FullscreenLock from './FullscreenLock';

const ProctoringWrapper = ({ 
  examAttemptId, 
  enabled, 
  onViolation,
  config = {}
}) => {
  const {
    enableTabMonitoring = true,
    enableDevToolsBlocking = true,
    enableFullscreenLock = true,
  } = config;
  
  // 🔧 NEW: Trust score recalculation helper
  const recalculateTrustScore = async (violationType) => {
    try {
      const API_BASE = 'http://localhost:8000/api';
      const token = localStorage.getItem('token');
      
      console.log(`[TRUST SCORE] Recalculating after ${violationType}...`);
      
      const response = await axios.post(
        `${API_BASE}/proctoring/recalculate-trust-score/`,
        { attempt_id: examAttemptId },
        { headers: { 'Authorization': `Token ${token}` } }
      );
      
      console.log(`[TRUST SCORE] Updated: ${response.data.trust_score}%`);
      
      return response.data;
    } catch (error) {
      console.error('[TRUST SCORE] Recalculation failed:', error);
      return null;
    }
  };
  
  // 🔧 ENHANCED: Handle violations with trust score update
  const handleViolation = async (violation) => {
    console.log('Violation detected:', violation);
    
    // Call parent callback
    if (onViolation) {
      onViolation(violation);
    }
    
    // 🔧 NEW: Recalculate trust score for browser violations
    const browserViolations = [
      'TAB_SWITCH',
      'WINDOW_BLUR',
      'FULLSCREEN_EXIT',
      'RIGHT_CLICK_BLOCKED',
      'F12_BLOCKED',
      'INSPECT_BLOCKED',
      'CONSOLE_BLOCKED',
      'ELEMENT_PICKER_BLOCKED',
      'VIEW_SOURCE_BLOCKED',
      'SAVE_PAGE_BLOCKED',
      'PRINT_BLOCKED',
      'SCREENSHOT_ATTEMPT',
      'COPY_BLOCKED',
      'DEVTOOLS_OPEN'
    ];
    
    if (browserViolations.includes(violation.type)) {
      await recalculateTrustScore(violation.type);
    }
  };
  
  return (
    <>
      {enableTabMonitoring && (
        <TabLockMonitor
          examAttemptId={examAttemptId}
          enabled={enabled}
          onViolation={handleViolation}
        />
      )}
      
      {enableDevToolsBlocking && (
        <DevToolsBlocker
          examAttemptId={examAttemptId}
          enabled={enabled}
          onViolation={handleViolation}
        />
      )}
      
      {enableFullscreenLock && (
        <FullscreenLock
          examAttemptId={examAttemptId}
          enabled={enabled}
          onViolation={handleViolation}
        />
      )}
    </>
  );
};

export default ProctoringWrapper;