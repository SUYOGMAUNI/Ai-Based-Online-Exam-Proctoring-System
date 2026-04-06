/*
SILENT PROCTORING - ExamPage.jsx
File: src/pages/Student/ExamPage.jsx

Student Experience:
- No AI violation warnings during exam (silent monitoring)
- Only browser security warnings (DevTools, tab switch, fullscreen)
- Optional subtle trust score indicator
- Post-exam warning if trust score is low
*/

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

// Proctoring components
import FullscreenLock from '../components/Proctoring/FullscreenLock';
import TabLockMonitor from '../components/Proctoring/TabLockMonitor';
import DevToolsBlocker from '../components/Proctoring/DevToolsBlocker';
import useAIProctoring from '../hooks/useAIProctoring';
import useAudioMonitoring from '../hooks/useAudioMonitoring';

// Exam start modal (handles fullscreen on user click)
const ExamStartModal = ({ exam, onStartExam, onCancel }) => {
  const [isStarting, setIsStarting] = useState(false);

  const handleStartExam = async () => {
    setIsStarting(true);

    try {
      const elem = document.documentElement;
      
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        await elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        await elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        await elem.msRequestFullscreen();
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      await onStartExam();
    } catch (error) {
      console.error('Error starting exam:', error);
      setIsStarting(false);
      await onStartExam();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <h2 className="text-3xl font-bold mb-2">{exam.title}</h2>
          <p className="text-blue-100">Please read the instructions carefully before starting</p>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Duration</div>
              <div className="text-2xl font-bold text-blue-600">{exam.duration_minutes} min</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Questions</div>
              <div className="text-2xl font-bold text-green-600">{exam.questions?.length || 'N/A'}</div>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h3 className="font-bold text-yellow-900 mb-3 flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              Important Exam Rules
            </h3>
            <ul className="space-y-2 text-gray-700">
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>Focus on your exam:</strong> AI monitoring is active but won't disturb you</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>Stay in fullscreen:</strong> Exiting fullscreen will pause your exam</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>No tab switching:</strong> Switching tabs will be flagged</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>No developer tools:</strong> Browser developer tools are disabled</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>Review after submission:</strong> You'll be notified if any issues were detected</span>
              </li>
            </ul>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              <strong className="text-blue-900">🔒 Silent Monitoring:</strong> AI proctoring runs in the background 
              and won't interrupt your exam. Focus on your answers!
            </p>
          </div>
        </div>

        <div className="bg-gray-50 p-6 flex gap-4 justify-end border-t">
          <button
            onClick={onCancel}
            disabled={isStarting}
            className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleStartExam}
            disabled={isStarting}
            className="px-8 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-semibold rounded-lg hover:from-green-700 hover:to-green-800 transition disabled:opacity-50 flex items-center gap-2"
          >
            {isStarting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Starting...</span>
              </>
            ) : (
              <>
                <span>🚀</span>
                <span>Start Exam</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// 🆕 Trust Score Warning Modal (only shown if critical)
const TrustScoreWarningModal = ({ trustScore, onContinue }) => (
  <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] p-4">
    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
      <div className="text-center">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-2xl font-bold text-orange-600 mb-2">
          Monitoring Alert
        </h2>
        <p className="text-gray-700 mb-4">
          Our proctoring system has detected some irregularities. Your current monitoring score is {trustScore}%.
        </p>
        <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mb-4">
          <p className="text-sm text-orange-800">
            Please ensure you:
          </p>
          <ul className="text-xs text-orange-700 mt-2 space-y-1 text-left ml-4">
            <li>• Face the camera directly</li>
            <li>• Keep your eyes on the screen</li>
            <li>• Stay alone in the room</li>
            <li>• Avoid excessive movement</li>
          </ul>
        </div>
        <button
          onClick={onContinue}
          className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
        >
          Continue Exam
        </button>
      </div>
    </div>
  </div>
);

// 🆕 Post-Exam Warning (shown after submission if flagged)
const PostExamWarningModal = ({ trustScore, violationCount, onClose }) => (
  <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[9999] p-4">
    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-8">
      <div className="text-center">
        <div className="text-6xl mb-4">🚨</div>
        <h2 className="text-3xl font-bold text-red-600 mb-4">
          Exam Flagged for Review
        </h2>
        <p className="text-gray-700 mb-4">
          Your exam has been submitted, but our proctoring system detected {violationCount} potential issue(s).
        </p>
        <div className="bg-red-50 border-2 border-red-500 rounded-lg p-6 mb-6">
          <p className="text-red-800 font-semibold mb-2">
            Final Monitoring Score: {trustScore}%
          </p>
          <p className="text-sm text-red-700">
            Your instructor will review the proctoring data. If you believe this is an error, 
            please contact them to explain the situation.
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-700">
            <strong className="text-blue-900">What happens next?</strong><br/>
            Your answers have been submitted and will be graded normally. 
            Your instructor may contact you if they need clarification about the flagged activity.
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
        >
          Return to Dashboard
        </button>
      </div>
    </div>
  </div>
);

// Main Exam Page Component
const ExamPage = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  // State
  const [exam, setExam] = useState(null);
  const [examAttemptId, setExamAttemptId] = useState(null);
  const [showStartModal, setShowStartModal] = useState(true);
  const [examStarted, setExamStarted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(0);
  
  const [alreadyAttempted, setAlreadyAttempted] = useState(false);

  useEffect(() => {
    if (alreadyAttempted) {
      navigate('/student/dashboard');
    }
  }, [alreadyAttempted]);

  // 🔇 Silent violation tracking (no UI updates)
  const [violations, setViolations] = useState([]);
  
  // 🚨 Trust score tracking
  const [showTrustScoreWarning, setShowTrustScoreWarning] = useState(false);
  const [showPostExamWarning, setShowPostExamWarning] = useState(false);
  const [finalTrustScore, setFinalTrustScore] = useState(100);

  // Video refs for AI proctoring
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [cameraStream, setCameraStream] = useState(null);

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  // Load exam data
  useEffect(() => {
    const loadExam = async () => {
      try {
        const response = await api.get(`/exams/${examId}/`);
        setExam(response.data);
        if (response.data.already_attempted) {
          setAlreadyAttempted(true);
          setLoading(false);
          return;
        }
        setTimeRemaining(response.data.duration_minutes * 60);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load exam:', error);
        alert('Failed to load exam');
        navigate('/student/dashboard');
      }
    };

    loadExam();
  }, [examId]);

  // Initialize camera
  useEffect(() => {
    if (!examStarted) return;

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            facingMode: 'user'
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setCameraStream(stream);
        }
      } catch (error) {
        console.error('Camera access error:', error);
      }
    };

    initCamera();

    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [examStarted]);

  // Handle exam start
  const handleStartExam = async () => {
    try {
      const response = await api.post('/exam-attempts/', {
        exam: examId
      });
      
      setExamAttemptId(response.data.id);
      setShowStartModal(false);
      setExamStarted(true);
      
      console.log('Exam started with attempt ID:', response.data.id);
    } catch (error) {
      console.error('Failed to start exam:', error);
      const status = error.response?.status;
      if (status === 400) {
        setShowStartModal(false);
        setAlreadyAttempted(true);
      } else {
        alert('Failed to start exam. Please try again.');
      }
    }
  };

  // 🔇 Handle violations silently (no modals, just tracking)
  const handleViolation = (violation) => {
    console.log('Violation detected (silent):', violation);
    
    // 🚨 ONLY show warning for critical trust score
    if (violation.type === 'TRUST_SCORE_LOW' && violation.showWarning) {
      setShowTrustScoreWarning(true);
      setFinalTrustScore(violation.trust_score);
    }
    
    // Track violations silently (for post-exam review)
    setViolations(prev => [...prev, violation]);
  };

  // Timer countdown
  useEffect(() => {
    if (!examStarted || timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          handleSubmitExam(true); // Auto-submit when time expires
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [examStarted, timeRemaining]);

  // Submit exam
  const handleSubmitExam = async (autoSubmit = false) => {
    if (!autoSubmit && !window.confirm('Are you sure you want to submit your exam?')) {
      return;
    }

    try {
      const response = await api.post(`/exam-attempts/${examAttemptId}/submit/`, {
        answers: answers
      });

      // 🚨 Check final trust score
      const finalScore = response.data.trust_score || 100;
      setFinalTrustScore(finalScore);

      // Show post-exam warning if flagged
      if (finalScore < 60) {
        setShowPostExamWarning(true);
      } else {
        alert('Exam submitted successfully!');
        navigate('/student/dashboard');
      }
    } catch (error) {
      console.error('Failed to submit exam:', error);
      alert('Failed to submit exam. Please try again.');
    }
  };

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (alreadyAttempted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
          <div className="text-6xl mb-4">📋</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Already Attempted</h2>
          <p className="text-gray-600 mb-6">You have already attempted this exam. Each exam can only be taken once.</p>
          <p className="text-sm text-gray-400 mb-4">Redirecting to dashboard...</p>
          <button
            onClick={() => navigate('/student/dashboard')}
            className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading exam...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Show start modal before exam begins */}
      {showStartModal && exam && (
        <ExamStartModal
          exam={exam}
          onStartExam={handleStartExam}
          onCancel={() => navigate('/student/dashboard')}
        />
      )}

      {/* 🚨 Trust Score Warning (only if critical) */}
      {showTrustScoreWarning && (
        <TrustScoreWarningModal
          trustScore={finalTrustScore}
          onContinue={() => setShowTrustScoreWarning(false)}
        />
      )}

      {/* 🚨 Post-Exam Warning (shown after submission if flagged) */}
      {showPostExamWarning && (
        <PostExamWarningModal
          trustScore={finalTrustScore}
          violationCount={violations.length}
          onClose={() => navigate('/student/dashboard')}
        />
      )}

      {/* Proctoring Components - only active when exam is started */}
      {examStarted && examAttemptId && (
        <>
          {/* 🔇 SILENT AI Proctoring - no student warnings */}
          <useAIProctoring
            videoRef={videoRef}
            canvasRef={canvasRef}
            attemptId={examAttemptId}
            enabled={true}
            onViolation={handleViolation}
            interval={3000}
            trustScoreThreshold={60}  // Only warn if below 40%
          />

          {/* 🔇 SILENT Audio Monitoring - no student warnings */}
          <useAudioMonitoring
            attemptId={examAttemptId}
            enabled={true}
            onViolation={handleViolation}
          />
          
          {/* ⚠️ Browser Security Warnings (these DO show to student) */}
          <FullscreenLock
            examAttemptId={examAttemptId}
            enabled={true}
            onViolation={handleViolation}
            autoReenter={false}
            maxViolations={3}
          />
          
          <TabLockMonitor
            examAttemptId={examAttemptId}
            enabled={true}
            onViolation={handleViolation}
            strictMode={true}
          />
          
          <DevToolsBlocker
            examAttemptId={examAttemptId}
            enabled={true}
            onViolation={handleViolation}
            showWarnings={true}
            blockScreenshots={true}
            strictMode={true}
          />
        </>
      )}

      {/* Hidden camera feed */}
      {examStarted && (
        <div style={{ display: 'none' }}>
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={canvasRef} />
        </div>
      )}

      {/* Exam Content - only show when exam has started */}
      {examStarted && exam && (
        <div className="container mx-auto px-4 py-8">
          {/* Exam Header */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{exam.title}</h1>
                <p className="text-gray-600">
                  Question {currentQuestionIndex + 1} of {exam.questions?.length || 0}
                </p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-blue-600">
                  {formatTime(timeRemaining)}
                </div>
                <p className="text-sm text-gray-600">Time Remaining</p>
              </div>
            </div>
          </div>

          {/* Question Display */}
          <div className="bg-white rounded-lg shadow-lg p-8">
            <p className="text-lg mb-4">
              Question content goes here...
            </p>

            {/* Navigation Buttons */}
            <div className="flex justify-between mt-8">
              <button
                onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
                disabled={currentQuestionIndex === 0}
                className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 disabled:opacity-50"
              >
                Previous
              </button>
              
              {currentQuestionIndex === (exam.questions?.length || 0) - 1 ? (
                <button
                  onClick={() => handleSubmitExam(false)}
                  className="px-8 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Submit Exam
                </button>
              ) : (
                <button
                  onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamPage;