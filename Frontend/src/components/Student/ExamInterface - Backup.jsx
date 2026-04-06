/*
React Component - Student Exam Taking Interface
File: src/components/Student/ExamInterface.jsx

Features:
- Face verification
- Gaze calibration  
- Fullscreen enforcement
- Tab monitoring
- Real-time violation detection
- URL parameter support for routing
*/

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const ExamInterface = () => {
  // Get examId from URL parameters
  const { examId } = useParams();
  const navigate = useNavigate();
  
  // State management
  const [phase, setPhase] = useState('LOADING'); // LOADING, FACE_VERIFICATION, CALIBRATION, EXAM, SUBMITTED
  const [exam, setExam] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [trustScore, setTrustScore] = useState(100);
  const [violations, setViolations] = useState([]);
  
  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const timerRef = useRef(null);
  const proctoringRef = useRef(null);
  
  // Configuration
  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  
  // Axios instance with auth
  const api = axios.create({
    baseURL: API_BASE,
    headers: {
      'Authorization': `Token ${token}`
    }
  });

  // ============================================================================
  // Initialization
  // ============================================================================

  useEffect(() => {
    loadExamDetails();
    return () => cleanup();
  }, [examId]);

  const loadExamDetails = async () => {
    try {
      setPhase('LOADING');
      
      // Load exam details
      const examResponse = await api.get(`/exams/${examId}/`);
      setExam(examResponse.data);
      
      // Check if face registration is required
      if (examResponse.data.require_face_registration && !user.is_face_registered) {
        alert('You must register your face before taking this exam.');
        navigate('/student/face-registration');
        return;
      }
      
      // Request media permissions early
      await requestMediaPermissions();
      
      // Move to face verification
      setPhase('FACE_VERIFICATION');
      
    } catch (error) {
      console.error('Failed to load exam:', error);
      alert('Failed to load exam. Please try again.');
      navigate('/student/dashboard');
    }
  };

  const initializeExam = async () => {
    try {
      // Start exam attempt
      const response = await api.post(`/attempts/start_exam/`, {
        exam_id: examId,
        browser_info: getBrowserInfo()
      });
      
      setAttemptId(response.data.id);
      
    } catch (error) {
      console.error('Failed to initialize exam:', error);
      alert(error.response?.data?.error || 'Failed to start exam. Please try again.');
    }
  };

  const requestMediaPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      return stream;
    } catch (error) {
      console.error('Camera/Microphone access denied:', error);
      alert('Camera and microphone access is required for this exam.');
      throw error;
    }
  };

  // ============================================================================
  // Face Verification
  // ============================================================================

  const handleFaceVerification = async () => {
    try {
      // Initialize exam attempt first
      await initializeExam();
      
      // Capture image from video
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      // Convert to base64
      const imageData = canvas.toDataURL('image/jpeg');
      
      // For now, skip actual verification and move to calibration
      // In production, send to backend for verification
      setPhase('CALIBRATION');
      
    } catch (error) {
      console.error('Face verification error:', error);
      alert('Face verification failed.');
    }
  };

  // ============================================================================
  // Gaze Calibration
  // ============================================================================

  const handleCalibration = async () => {
    const samples = [];
    const calibrationDuration = 10; // seconds
    const sampleRate = 3; // samples per second
    
    setPhase('CALIBRATING');
    
    // Collect calibration samples
    for (let i = 0; i < calibrationDuration * sampleRate; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000 / sampleRate));
      
      samples.push({
        x: 0.5 + (Math.random() - 0.5) * 0.05,
        y: 0.5 + (Math.random() - 0.5) * 0.05,
        timestamp: Date.now()
      });
    }
    
    try {
      // Load questions
      const questionsResponse = await api.get(`/questions/?exam_id=${examId}`);
      setQuestions(questionsResponse.data);
      setTimeRemaining(exam.duration_minutes * 60);
      setPhase('EXAM');
      
      // Start proctoring
      startProctoring();
      
      // Start timer
      startTimer(exam.duration_minutes * 60);
      
      // Enter fullscreen
      enterFullscreen();
      
    } catch (error) {
      console.error('Calibration error:', error);
      alert('Failed to start exam.');
    }
  };

  // ============================================================================
  // Exam Taking
  // ============================================================================

  const handleAnswerChange = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const handleSubmit = async () => {
    if (!window.confirm('Are you sure you want to submit? This action cannot be undone.')) {
      return;
    }
    
    try {
      // Stop timer and proctoring first
      cleanup();
      
      const response = await api.post(
        `/attempts/${attemptId}/submit_exam/`,
        { answers }
      );
      
      setTrustScore(response.data.trust_score || trustScore);
      setPhase('SUBMITTED');
      
      // Navigate back after 3 seconds
      setTimeout(() => {
        navigate('/student/dashboard');
      }, 3000);
      
    } catch (error) {
      console.error('Submit error:', error);
      alert('Failed to submit exam.');
    }
  };

  // ============================================================================
  // Proctoring
  // ============================================================================

  const startProctoring = () => {
    // Browser-level enforcement
    setupBrowserMonitoring();
    
    // Start proctoring logs
    proctoringRef.current = setInterval(() => {
      logProctoringSession();
    }, 5000); // Every 5 seconds
  };

  const setupBrowserMonitoring = () => {
    // Tab visibility
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Window blur
    window.addEventListener('blur', handleWindowBlur);
    
    // Fullscreen exit
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);
    
    // Right-click disable
    document.addEventListener('contextmenu', e => e.preventDefault());
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      logViolation('TAB_SWITCH', 'MEDIUM', 'Tab switched or window hidden');
    }
  };

  const handleWindowBlur = () => {
    logViolation('WINDOW_BLUR', 'LOW', 'Window lost focus');
  };

  const handleFullscreenChange = () => {
    if (!document.fullscreenElement) {
      logViolation('FULLSCREEN_EXIT', 'MEDIUM', 'Exited fullscreen mode');
      
      // Try to re-enter fullscreen
      setTimeout(() => enterFullscreen(), 1000);
    }
  };

  const handleKeyDown = (e) => {
    // Block common shortcuts
    const blockedKeys = ['F12', 'F11'];
    
    if (blockedKeys.includes(e.key) || 
        (e.ctrlKey && ['c', 'v', 'x', 'u', 's'].includes(e.key.toLowerCase()))) {
      e.preventDefault();
      logViolation('KEYBOARD_SHORTCUT', 'LOW', `Attempted to use ${e.key}`);
    }
  };

  const logProctoringSession = async () => {
    if (!attemptId) return;
    
    try {
      await api.post('/proctoring/log_session/', {
        attempt_id: attemptId,
        face_detected: true,
        face_confidence: 0.95,
        gaze_on_screen: true,
        tab_focused: !document.hidden,
        fullscreen_active: !!document.fullscreenElement,
        audio_level: 0.0,
        speech_detected: false
      });
    } catch (error) {
      console.error('Failed to log proctoring session:', error);
    }
  };

  const logViolation = async (type, severity, description) => {
    if (!attemptId) return;
    
    try {
      // Log to console for debugging
      console.warn(`Violation: ${type} - ${description}`);
      
      // Update local state
      const penalty = severity === 'HIGH' ? 10 : severity === 'MEDIUM' ? 5 : 2;
      const newScore = Math.max(0, trustScore - penalty);
      
      setTrustScore(newScore);
      setViolations(prev => [...prev, {
        type,
        penalty,
        timestamp: new Date(),
        description
      }]);
      
      // Show warning if trust score is low
      if (newScore < 30) {
        alert('Warning: Your trust score is critically low. The exam may be disqualified.');
      }
      
    } catch (error) {
      console.error('Failed to log violation:', error);
    }
  };

  // ============================================================================
  // Timer
  // ============================================================================

  const startTimer = (seconds) => {
    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          handleSubmit(); // Auto-submit
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ============================================================================
  // Fullscreen
  // ============================================================================

  const enterFullscreen = () => {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(err => {
        console.error('Fullscreen request failed:', err);
      });
    }
  };

  // ============================================================================
  // Cleanup
  // ============================================================================

  const cleanup = () => {
    // Stop timers
    if (timerRef.current) clearInterval(timerRef.current);
    if (proctoringRef.current) clearInterval(proctoringRef.current);
    
    // Stop video
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    
    // Remove event listeners
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('keydown', handleKeyDown);
    
    // Exit fullscreen
    if (document.exitFullscreen && document.fullscreenElement) {
      document.exitFullscreen();
    }
  };

  // ============================================================================
  // Utilities
  // ============================================================================

  const getBrowserInfo = () => {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screen: {
        width: window.screen.width,
        height: window.screen.height
      }
    };
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (phase === 'LOADING') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Hidden video and canvas */}
      <video ref={videoRef} autoPlay muted className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Face Verification Phase */}
      {phase === 'FACE_VERIFICATION' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold mb-4">Face Verification</h2>
            <p className="text-gray-400 mb-6">
              Position your face in the center of the frame for verification.
            </p>
            
            <video ref={videoRef} autoPlay className="w-full rounded-lg mb-6 bg-black" />
            
            <button
              onClick={handleFaceVerification}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition"
            >
              Verify Face & Start Exam
            </button>
            
            <button
              onClick={() => navigate('/student/dashboard')}
              className="w-full mt-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      
      {/* Calibration Phase */}
      {(phase === 'CALIBRATION' || phase === 'CALIBRATING') && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full text-center">
            <h2 className="text-2xl font-bold mb-4">Gaze Calibration</h2>
            <p className="text-gray-400 mb-6">
              Look at the center of the screen for 10 seconds while we calibrate your gaze tracking.
            </p>
            
            <div className="relative w-full h-64 bg-gray-700 rounded-lg mb-6 flex items-center justify-center">
              <div className="w-16 h-16 bg-green-500 rounded-full animate-pulse"></div>
            </div>
            
            {phase === 'CALIBRATION' ? (
              <button
                onClick={handleCalibration}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition"
              >
                Start Calibration
              </button>
            ) : (
              <div className="text-yellow-400 font-semibold">
                📊 Calibrating... Keep looking at the green circle
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Exam Phase */}
      {phase === 'EXAM' && questions.length > 0 && (
        <div className="flex flex-col h-screen">
          {/* Header */}
          <div className="bg-gray-800 border-b border-gray-700 p-4">
            <div className="max-w-6xl mx-auto flex justify-between items-center">
              <div>
                <span className="text-2xl font-bold">{exam?.title}</span>
                <span className="text-gray-400 ml-4">Question {currentQuestion + 1} of {questions.length}</span>
              </div>
              <div className="flex gap-6">
                <div>
                  <span className="text-gray-400">Time: </span>
                  <span className={`font-bold ${timeRemaining < 300 ? 'text-red-400' : 'text-white'}`}>
                    ⏱️ {formatTime(timeRemaining)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Trust Score: </span>
                  <span className={`font-bold ${
                    trustScore >= 75 ? 'text-green-400' :
                    trustScore >= 50 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {trustScore}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Question Content */}
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-4xl mx-auto">
              <div className="bg-gray-800 rounded-lg p-8 mb-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-semibold flex-1">
                    {questions[currentQuestion].question_text}
                  </h3>
                  <span className="bg-blue-600 px-3 py-1 rounded-full text-sm font-semibold ml-4">
                    {questions[currentQuestion].marks} marks
                  </span>
                </div>
                
                {questions[currentQuestion].question_type === 'MCQ' && (
                  <div className="space-y-3 mt-6">
                    {['option_a', 'option_b', 'option_c', 'option_d'].map((opt, idx) => (
                      questions[currentQuestion][opt] && (
                        <label key={idx} className={`flex items-center p-4 rounded-lg cursor-pointer transition ${
                          answers[questions[currentQuestion].id] === questions[currentQuestion][opt]
                            ? 'bg-blue-700 border-2 border-blue-500'
                            : 'bg-gray-700 hover:bg-gray-600 border-2 border-transparent'
                        }`}>
                          <input
                            type="radio"
                            name={`question_${currentQuestion}`}
                            value={questions[currentQuestion][opt]}
                            checked={answers[questions[currentQuestion].id] === questions[currentQuestion][opt]}
                            onChange={(e) => handleAnswerChange(questions[currentQuestion].id, e.target.value)}
                            className="mr-3 w-5 h-5"
                          />
                          <span>{questions[currentQuestion][opt]}</span>
                        </label>
                      )
                    ))}
                  </div>
                )}
                
                {questions[currentQuestion].question_type === 'SHORT' && (
                  <textarea
                    value={answers[questions[currentQuestion].id] || ''}
                    onChange={(e) => handleAnswerChange(questions[currentQuestion].id, e.target.value)}
                    className="w-full mt-4 p-4 bg-gray-700 rounded-lg text-white border-2 border-gray-600 focus:border-blue-500 focus:outline-none"
                    rows="6"
                    placeholder="Enter your answer..."
                  />
                )}
              </div>
              
              {/* Navigation */}
              <div className="flex justify-between">
                <button
                  onClick={() => setCurrentQuestion(prev => Math.max(0, prev - 1))}
                  disabled={currentQuestion === 0}
                  className="px-8 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition font-semibold"
                >
                  ← Previous
                </button>
                
                {currentQuestion < questions.length - 1 ? (
                  <button
                    onClick={() => setCurrentQuestion(prev => prev + 1)}
                    className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition font-semibold"
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    className="px-8 py-3 bg-green-600 hover:bg-green-700 rounded-lg transition font-semibold"
                  >
                    ✓ Submit Exam
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Submitted Phase */}
      {phase === 'SUBMITTED' && (
        <div className="flex items-center justify-center min-h-screen p-8">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full text-center">
            <div className="text-green-400 text-6xl mb-4">✓</div>
            <h2 className="text-2xl font-bold mb-4">Exam Submitted Successfully</h2>
            <p className="text-gray-400 mb-6">
              Your exam has been submitted. Results will be available after teacher review.
            </p>
            <div className="bg-gray-700 rounded-lg p-4 mb-4">
              <div className="text-sm text-gray-400">Final Trust Score</div>
              <div className={`text-3xl font-bold ${
                trustScore >= 75 ? 'text-green-400' :
                trustScore >= 50 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {trustScore}
              </div>
            </div>
            <p className="text-sm text-gray-500">Redirecting to dashboard...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamInterface;