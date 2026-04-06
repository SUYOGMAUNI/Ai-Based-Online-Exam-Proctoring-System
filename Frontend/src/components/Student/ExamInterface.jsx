/*
ExamInterface.jsx - FIXED with visible webcam display
File: src/components/Student/ExamInterface.jsx
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import DevToolsBlocker from '../Proctoring/DevToolsBlocker';
import TabLockMonitor from '../Proctoring/TabLockMonitor';
import FullscreenLock from '../Proctoring/FullscreenLock';
import useAIProctoring from '../../hooks/useAIProctoring';
import useAudioMonitoring from '../../hooks/useAudioMonitoring';


// ============================================================================
// SIMPLIFIED PERMISSION REQUEST MODAL
// ============================================================================
const PermissionRequestModal = ({ onPermissionGranted, onPermissionDenied }) => {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState(null);

  const requestPermissions = async () => {
    setIsRequesting(true);
    setError(null);
    
    try {
      console.log('🔐 [PERMISSION] Requesting camera and microphone access...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: true
      });
      
      console.log('✅ [PERMISSION] Permissions granted');
      onPermissionGranted();
      
    } catch (error) {
      console.error('❌ [PERMISSION] Failed to get permissions:', error);
      setError(error.message);
      
      if (error.name === 'NotAllowedError') {
        alert('Camera and microphone access is REQUIRED for this exam. Please allow access in your browser settings and refresh the page.');
      }
      
      onPermissionDenied();
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
          <h2 className="text-2xl font-bold mb-2">Camera & Microphone Required</h2>
          <p className="text-purple-100">This exam requires access to your camera and microphone</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-center text-6xl mb-4">
            <div className="flex gap-4">
              <span>📹</span>
              <span>🎤</span>
            </div>
          </div>
          
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              <strong className="text-purple-900">Why do we need access?</strong>
            </p>
            <ul className="mt-2 space-y-1 text-sm text-gray-600">
              <li className="flex items-start">
                <span className="text-purple-600 mr-2">•</span>
                <span>To verify your identity during the exam</span>
              </li>
              <li className="flex items-start">
                <span className="text-purple-600 mr-2">•</span>
                <span>To monitor the exam environment</span>
              </li>
              <li className="flex items-start">
                <span className="text-purple-600 mr-2">•</span>
                <span>To ensure academic integrity</span>
              </li>
              <li className="flex items-start">
                <span className="text-purple-600 mr-2">•</span>
                <span>To detect and prevent cheating</span>
              </li>
            </ul>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">Error: {error}</p>
            </div>
          )}
        </div>

        <div className="bg-gray-50 p-6 flex gap-4 justify-end border-t">
          <button
            onClick={onPermissionDenied}
            disabled={isRequesting}
            className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={requestPermissions}
            disabled={isRequesting}
            className="px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-indigo-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            {isRequesting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Requesting...</span>
              </>
            ) : (
              <>
                <span>🔓</span>
                <span>Allow Access</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// GAZE CALIBRATION SCREEN WITH CAMERA PREVIEW
// ============================================================================
const GazeCalibrationScreen = ({ onCalibrationComplete }) => {
  const [countdown, setCountdown] = useState(10);
  const [calibrationDone, setCalibrationDone] = useState(false);
  // Guard: onCalibrationComplete must only ever be called once.
  // Without this, React StrictMode double-invokes effects AND the parent's
  // state change can cause this component to remount, restarting the timer
  // and firing the callback a second time — which restarts the AI hook and
  // causes a frame burst at the CALIBRATION→EXAM boundary.
  const calledRef = useRef(false);

  useEffect(() => {
    console.log('👁️ [CALIBRATION] Starting calibration...');
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          console.log('✅ [CALIBRATION] Calibration complete!');
          setCalibrationDone(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Wrap the callback so it can only fire once regardless of remounts.
  const handleComplete = () => {
    if (calledRef.current) {
      console.log('⚠️ [CALIBRATION] onCalibrationComplete already called — ignoring duplicate');
      return;
    }
    calledRef.current = true;
    onCalibrationComplete();
  };

  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center z-50">

      {!calibrationDone ? (
        // DURING CALIBRATION (0-10 seconds)
        <div className="text-center max-w-2xl px-8">
          <div className="mb-8">
            <div className="text-6xl mb-4">👁️</div>
            <h2 className="text-3xl font-bold text-white mb-2">Gaze Calibration</h2>
            <p className="text-gray-400 mb-2">
              Please look directly at the CENTER of the screen
            </p>
            <p className="text-yellow-400 text-sm mb-4">
              ⚠️ Keep your eyes on the center RED dot - DO NOT follow other dots
            </p>
            <div className="text-5xl font-bold text-blue-400">{countdown}s</div>
          </div>

          {/* Calibration area */}
          <div className="relative w-full h-96 bg-gray-800 rounded-lg border-2 border-gray-700">
            {/* CENTER DOT */}
            <div
              className="absolute w-12 h-12 bg-red-500 rounded-full shadow-lg shadow-red-500/50 flex items-center justify-center"
              style={{
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
            </div>

            {/* Reference dots */}
            <div className="absolute w-4 h-4 bg-gray-500 rounded-full opacity-50" 
                 style={{ left: '10%', top: '10%', transform: 'translate(-50%, -50%)' }} />
            <div className="absolute w-4 h-4 bg-gray-500 rounded-full opacity-50" 
                 style={{ left: '90%', top: '10%', transform: 'translate(-50%, -50%)' }} />
            <div className="absolute w-4 h-4 bg-gray-500 rounded-full opacity-50" 
                 style={{ left: '10%', top: '90%', transform: 'translate(-50%, -50%)' }} />
            <div className="absolute w-4 h-4 bg-gray-500 rounded-full opacity-50" 
                 style={{ left: '90%', top: '90%', transform: 'translate(-50%, -50%)' }} />
          </div>

          <p className="text-sm text-gray-500 mt-4">
            Keep looking at the RED dot in the center for {countdown} seconds
          </p>
        </div>
      ) : (
        // AFTER CALIBRATION COMPLETE (manual start)
        <div className="text-center max-w-2xl px-8">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-3xl font-bold text-green-600 mb-4">
              Calibration Complete!
            </h2>
            <p className="text-gray-600 mb-6">
              Your eye tracking is now calibrated and ready for monitoring
            </p>

            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6 text-left">
              <h3 className="font-bold text-green-900 mb-3">What happens next:</h3>
              <ul className="space-y-2 text-sm text-green-800">
                <li className="flex items-start">
                  <span className="text-green-600 mr-2">✓</span>
                  <span>Face recognition will verify your identity</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-600 mr-2">✓</span>
                  <span>Gaze tracking will monitor where you look</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-600 mr-2">✓</span>
                  <span>Audio monitoring will detect any speech</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-600 mr-2">✓</span>
                  <span>Violations will be recorded automatically</span>
                </li>
              </ul>
            </div>

            <button
              onClick={handleComplete}
              className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold py-4 px-6 rounded-lg shadow-lg transform transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-green-300"
            >
              <span className="text-xl">🚀 Start Exam</span>
            </button>

            <p className="text-center text-xs text-gray-500 mt-4">
              Click the button when you're ready to begin
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// EXAM START MODAL
// ============================================================================
const ExamStartModal = ({ exam, onStartExam, onCancel }) => {
  const [isStarting, setIsStarting] = useState(false);

  const handleStartExam = async () => {
    setIsStarting(true);
    console.log('🚀 [START MODAL] User clicked Start Exam button');

    try {
      // Enter fullscreen
      const elem = document.documentElement;
      
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
        console.log('✅ [FULLSCREEN] Successfully entered fullscreen mode');
      } else if (elem.webkitRequestFullscreen) {
        await elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        await elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        await elem.msRequestFullscreen();
      }

      // Small delay to ensure fullscreen is active
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now call the parent's start exam function
      await onStartExam();
      console.log('✅ [START MODAL] onStartExam completed successfully');
    } catch (error) {
      console.error('❌ [START MODAL] Error in handleStartExam:', error);
      setIsStarting(false);
      
      // If fullscreen was denied, still try to start the exam
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
              <div className="text-sm text-gray-600 mb-1">Total Marks</div>
              <div className="text-2xl font-bold text-green-600">{exam.total_marks}</div>
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
                <span><strong>Fullscreen Mode:</strong> You must stay in fullscreen mode throughout the exam</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>Camera & Microphone:</strong> Your camera will record you during the exam</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>No Switching Tabs:</strong> Switching tabs or windows will be recorded as a violation</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>Single Person:</strong> Only you should be visible in the camera frame</span>
              </li>
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>No External Help:</strong> Do not talk or look away from the screen excessively</span>
              </li>
            </ul>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              <strong className="text-blue-900">🔒 Proctoring Enabled:</strong> This exam is monitored using AI-powered proctoring. 
              Your face, gaze, audio, and screen activity will be analyzed.
            </p>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              <strong className="text-purple-900">📹 Camera & Microphone Access:</strong> 
              After clicking "Start Exam", you'll be asked to allow camera and microphone access. 
              This is required for proctoring.
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

// ============================================================================
// MAIN EXAM INTERFACE COMPONENT
// ============================================================================
const ExamInterface = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  
  // State management
  const [phase, setPhase] = useState('LOADING');
  const [exam, setExam] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [trustScore, setTrustScore] = useState(100);
  const [violations, setViolations] = useState([]);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCalibrationCameraReady, setIsCalibrationCameraReady] = useState(false);
  const [videoStream, setVideoStream] = useState(null);
  
  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const timerRef = useRef(null);
  const ignoreFullscreenExitRef = useRef(false);
  
  // Configuration
  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  
  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  // ============================================================================
  // START CAMERA FUNCTION (FIXED)
  // ============================================================================
  const startCamera = async () => {
    console.log('📷 [CAMERA] Starting camera...');
    
    try {
      // Check if we already have camera access
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasCameraAccess = devices.some(device => device.kind === 'videoinput' && device.label);
      
      console.log('📷 [CAMERA] Has camera access:', hasCameraAccess);
      
      // Request camera access
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: true
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ [CAMERA] Camera stream obtained');
      
      // Store the stream
      setVideoStream(stream);

      // Wait one tick for React to render/attach the video element
      await new Promise(r => setTimeout(r, 0));
      
      if (videoRef.current) {
        // Clear any existing stream
        videoRef.current.srcObject = null;
        
        // Set the new stream
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        
        // Wait for video to load
        await new Promise((resolve) => {
          if (videoRef.current.readyState >= 1) {
            resolve();
          } else {
            videoRef.current.onloadedmetadata = () => {
              console.log('✅ [CAMERA] Video metadata loaded');
              resolve();
            };
          }
        });
        
        // Try to play
        try {
          await videoRef.current.play();
          console.log('✅ [CAMERA] Video playing successfully');
        } catch (playError) {
          console.warn('⚠️ [CAMERA] Auto-play prevented:', playError);
          // Set up a play button if needed
          videoRef.current.controls = false;
        }
        
        // Force the video to be visible
        videoRef.current.style.display = 'block';
        videoRef.current.style.visibility = 'visible';
        videoRef.current.style.opacity = '1';
        videoRef.current.style.transform = 'scaleX(-1)';
        videoRef.current.style.objectFit = 'cover';
        
        setCameraReady(true);
        
  	setIsCalibrationCameraReady(true);
        console.log('✅ [CAMERA] Camera setup complete');
        // Log video element status
        console.log('🔍 [CAMERA] Video element status:', {
          srcObject: videoRef.current.srcObject,
          readyState: videoRef.current.readyState,
          videoWidth: videoRef.current.videoWidth,
          videoHeight: videoRef.current.videoHeight,
          style: {
            display: videoRef.current.style.display,
            visibility: videoRef.current.style.visibility,
            opacity: videoRef.current.style.opacity
          }
        });
      }
      
    } catch (error) {
      console.error('❌ [CAMERA] Failed to start camera:', error);
      
      // Try with simpler constraints
      try {
        console.log('🔄 [CAMERA] Trying with simpler constraints...');
        const simpleStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        
        if (videoRef.current && simpleStream) {
          // Wait one tick for React to render/attach the video element
          await new Promise(r => setTimeout(r, 0));
          videoRef.current.srcObject = simpleStream;
          setVideoStream(simpleStream);
          videoRef.current.muted = true;
          
          setTimeout(() => {
            videoRef.current.play().catch(e => console.warn('Auto-play warning:', e));
          }, 100);
          
          setCameraReady(true);
          setIsCalibrationCameraReady(true);
          console.log('✅ [CAMERA] Camera started with simple constraints');
        }
      } catch (simpleError) {
        console.error('❌ [CAMERA] All camera attempts failed:', simpleError);
        alert('Camera access failed. Please make sure your camera is connected and refresh the page to try again.');
      }
    }
  };

  // ============================================================================
  // Permission Handling
  // ============================================================================
  const handlePermissionGranted = () => {
    console.log('✅ [PERMISSION] Permissions granted');
    
    // Start camera immediately after permission is granted
    if (exam.require_gaze_calibration) {
    setPhase('CALIBRATION');
} else {
    setPhase('EXAM');
    startTimer(exam.duration_minutes * 60);
}
startCamera();
  };

  const handlePermissionDenied = () => {
    console.log('❌ [PERMISSION] Permissions denied');
    setPhase('START_MODAL');
  };

  const calibrationCompletedRef = useRef(false);

  const handleCalibrationComplete = () => {
    if (calibrationCompletedRef.current) {
      console.warn('⚠️ [CALIBRATION] handleCalibrationComplete called again — ignoring duplicate');
      return;
    }
    calibrationCompletedRef.current = true;
    console.log('✅ [CALIBRATION] Calibration complete!');
    setCalibrationComplete(true);
    setIsCalibrationCameraReady(false);
    
    // Start the exam
    setPhase('EXAM');
    startTimer(timeRemaining || exam.duration_minutes * 60);
  };

  // ============================================================================
  // Initialization
  // ============================================================================
  useEffect(() => {
    console.log('🔄 [LIFECYCLE] Component mounted');
    loadExamDetails();
    return () => cleanup();
  }, [examId]);

  const loadExamDetails = async () => {
    try {
      console.log('📥 [LOAD] Loading exam details...');
      setPhase('LOADING');
      
      const examResponse = await api.get(`/exams/${examId}/`);
      console.log('✅ [API] Exam loaded:', examResponse.data);
      setExam(examResponse.data);
      
      if (examResponse.data.require_face_registration && !user.is_face_registered) {
        alert('You must register your face before taking this exam.');
        navigate('/student/face-registration');
        return;
      }
      
      console.log('✅ [LOAD] Showing start modal');
      setPhase('START_MODAL');
      
    } catch (error) {
      console.error('❌ [LOAD] Failed to load exam:', error);
      alert('Failed to load exam. Please try again.');
      navigate('/student/dashboard');
    }
  };

  // ============================================================================
  // EXAM START
  // ============================================================================
  const handleStartExam = async () => {
    try {
      console.log('🚀 [START] Starting exam...');
      
      const requestData = { exam_id: parseInt(examId) };
      const response = await api.post('/attempts/start_exam/', requestData);
      
      console.log('✅ [API] Exam attempt created:', response.data);
      setAttemptId(response.data.id);
      
      const examData = await api.get(`/exams/${examId}/`);
      
      if (examData.data.questions && examData.data.questions.length > 0) {
        setQuestions(examData.data.questions);
        setTimeRemaining(exam.duration_minutes * 60);
        
        console.log('🎮 [PHASE] Changing phase to PERMISSION_REQUEST');
        setPhase('PERMISSION_REQUEST');
        
      } else {
        throw new Error('No questions found for this exam');
      }
      
    } catch (error) {
      console.error('❌ [START] Failed to start exam:', error);
      
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }

      if (error.response?.status === 400) {
        navigate('/student/dashboard');
        return;
      }

      alert(error.response?.data?.error || 'Failed to start exam. Please try again.');
    }
  };

  // ============================================================================
  // Timer Management
  // ============================================================================
  const startTimer = (duration) => {
    console.log('⏱️ [TIMER] Starting timer for', duration, 'seconds');
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          handleAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const formatTime = (seconds) => {
    if (seconds === null) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ============================================================================
  // Answer Management
  // ============================================================================
  const handleAnswerChange = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  // ============================================================================
  // EXAM SUBMISSION
  // ============================================================================
  const handleSubmit = async () => {
    // ✅ Set flag BEFORE window.confirm — the dialog itself steals window focus
    //    and would fire a WINDOW_BLUR violation without this guard.
    isSubmittingRef.current = true;
    if (!window.confirm('Are you sure you want to submit your exam? You cannot change your answers after submission.')) {
      isSubmittingRef.current = false; // cancelled — re-enable monitoring
      return;
    }
    // Reset so submitExam's own guard doesn't block it
    isSubmittingRef.current = false;
    await submitExam();
  };

  const handleAutoSubmit = async () => {
    console.log('⏰ [SUBMIT] Time expired - auto submitting');
    await submitExam();
  };

  const isSubmittingRef = useRef(false);

  const submitExam = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      console.log('📤 [SUBMIT] Submitting exam...');
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      // Stop camera
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      setVideoStream(null);
      setCameraReady(false);

      const response = await api.post(`/attempts/${attemptId}/submit_exam/`, {
        answers: answers
      });

      console.log('✅ [API] Exam submitted:', response.data);

      // Mark next fullscreen exit as intentional so it isn't logged as a violation
      ignoreFullscreenExitRef.current = true;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      setPhase('SUBMITTED');

      if (response.data.trust_score !== undefined) {
        setTrustScore(prev => Math.min(prev, response.data.trust_score));
      }

      setTimeout(() => {
        navigate('/student/results');
      }, 3000);

    } catch (error) {
      isSubmittingRef.current = false;
      console.error('❌ [SUBMIT] Failed to submit exam:', error);
      alert(error.response?.data?.error || 'Failed to submit exam. Please try again.');
    }
  };

  // ============================================================================
  // Violation Handling
  // ============================================================================
  const handleViolation = (violation) => {
  if (isSubmittingRef.current) return;
  console.log('⚠️ [VIOLATION] Violation detected:', violation);
  setViolations(prev => [...prev, violation]);
  
  if (violation.trust_score !== undefined) {
    setTrustScore(prev => Math.min(prev, violation.trust_score));
    console.log(`[TRUST SCORE] Updated from backend: ${violation.trust_score}%`);
    return;
  }

  const violationWeights = {
    'FACE_MISMATCH': 15,
    'MULTIPLE_FACES': 20,
    'GAZE_DEVIATION': 3,
    'AUDIO_DETECTED': 8,
    'TAB_SWITCH': 2,
    'FULLSCREEN_EXIT': 2,
    'FACE_NOT_DETECTED': 5,
    'DEVTOOLS_OPEN': 10,
    'SCREENSHOT_ATTEMPT': 15,
    'COPY_BLOCKED': 2,
    'WINDOW_BLUR': 1,
    'RIGHT_CLICK_BLOCKED': 10,
    'F12_BLOCKED': 10,
    'INSPECT_BLOCKED': 10,
    'CONSOLE_BLOCKED': 10,
  };
  
  setTrustScore(prev => {
    const deduction = violationWeights[violation.type] || 5;
    const newScore = Math.max(0, prev - deduction);
    console.log(`[TRUST SCORE] ${prev}% → ${newScore}% (${violation.type}: -${deduction} points)`);
    return newScore;
  });
};

// 🔧 NEW: Fetch trust score from backend periodically
useEffect(() => {
  if (!attemptId) return;
  
  const fetchTrustScore = async () => {
    try {
      const API_BASE = 'http://localhost:8000/api';
      const token = localStorage.getItem('token');
      
      const response = await axios.get(
        `${API_BASE}/attempts/${attemptId}/`,
        { headers: { 'Authorization': `Token ${token}` } }
      );
      
      if (response.data.trust_score !== undefined) {
        setTrustScore(prev => Math.min(prev, response.data.trust_score));
      }
    } catch (error) {
      console.error('[TRUST SCORE] Failed to fetch:', error);
    }
  };
  
  // Fetch immediately
  fetchTrustScore();
  
  // Then fetch every 10 seconds
  const interval = setInterval(fetchTrustScore, 10000);
  
  return () => clearInterval(interval);
}, [attemptId]);

  // ============================================================================
  // AI Proctoring Hooks
  // ============================================================================

 // Video Proctoring
// Frontend sends at 3000ms. Backend MIN_FRAME_INTERVAL=2.5s so every frame lands.
// Sequential loop means frames never pile up — no 429s.
// onBaselineReady fires as soon as the backend locks its baseline (after 3 samples,
// ~9s), completing calibration immediately instead of waiting a fixed timer.
const { trustScore: aiTrustScore } = useAIProctoring({ 
  videoRef,
  canvasRef,
  attemptId,
  enabled: cameraReady && (phase === 'EXAM' || phase === 'CALIBRATION') && attemptId !== null,
  cameraReady: cameraReady,
  calibrationComplete: calibrationComplete,
  onViolation: handleViolation,
  onBaselineReady: handleCalibrationComplete,
  interval: 3000
});

  // Audio Monitoring
  useAudioMonitoring({
    attemptId,
    enabled: cameraReady && phase === 'EXAM' && attemptId !== null,
    onViolation: handleViolation,
    interval: 500
  });


// ============================================================================
// Debug render cycles (dev only — remove before production)
// ============================================================================
useEffect(() => {
  console.log('🔄 [RENDER] ExamInterface rendered', {
    phase,
    cameraReady,
    attemptId,
    violationsCount: violations.length,
    trustScore
  });
});

  // ============================================================================
  // Cleanup
  // ============================================================================
  const cleanup = () => {
    console.log('🧹 [CLEANUP] Cleaning up...');
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
    }

    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  };

  // ============================================================================
  // USE EFFECTS FOR CAMERA
  // ============================================================================
  // Start camera when entering exam phase
  useEffect(() => {
    if (phase === 'EXAM' && !cameraReady) {
      console.log('📷 [EFFECT] Exam phase detected, starting camera...');
      startCamera();
    }
  }, [phase]);

  // Debug camera status
  useEffect(() => {
    if (phase === 'EXAM' || phase === 'CALIBRATION') {
      console.log('🔍 [DEBUG] Camera status:', {
        phase,
        cameraReady,
        isCalibrationCameraReady,
        videoRef: videoRef.current,
        videoStream: !!videoStream,
        videoSrcObject: videoRef.current?.srcObject
      });
    }
  }, [phase, cameraReady, isCalibrationCameraReady]);

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Proctoring Components */}
      {exam?.enable_tab_monitoring && attemptId && calibrationComplete && (
        <TabLockMonitor
          examAttemptId={attemptId}
          enabled={phase === 'EXAM'}
          onViolation={handleViolation}
          strictMode={true}
          isSubmittingRef={isSubmittingRef}
        />
      )}

      {calibrationComplete && (
        <DevToolsBlocker
          examAttemptId={attemptId}
          enabled={phase === 'EXAM'}
          onViolation={handleViolation}
          showWarnings={true}
          blockScreenshots={true}
          strictMode={false}
        />
      )}

      {exam?.enable_fullscreen_mode && attemptId && calibrationComplete && (
        <FullscreenLock
          examAttemptId={attemptId}
          enabled={phase === 'EXAM'}
          onViolation={handleViolation}
          autoReenter={false}
          maxViolations={3}
          ignoreNextExitRef={ignoreFullscreenExitRef}
        />
      )}

      {/* WEBCAM VIDEO - Always render but conditionally position */}
      {(phase === 'CALIBRATION' || phase === 'EXAM') && (
        <div className={`fixed z-[99999] ${phase === 'CALIBRATION' ? 'bottom-6 right-6' : 'bottom-6 right-6'}`}>
          <div className={`bg-black p-2 rounded-xl border-4 ${phase === 'CALIBRATION' ? 'border-yellow-600' : 'border-red-600'} shadow-2xl`}>
            <div className="relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-56 h-40 object-cover rounded-lg bg-black"
                style={{
                  display: cameraReady ? 'block' : 'none',
                  visibility: cameraReady ? 'visible' : 'hidden',
                  opacity: cameraReady ? '1' : '0'
                }}
              />
              {cameraReady && (
                <>
                  <div className="absolute top-2 left-2 text-white text-xs px-3 py-1 rounded-full flex items-center gap-2"
                       style={{ backgroundColor: phase === 'CALIBRATION' ? '#d97706' : '#dc2626' }}>
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    <span className="font-bold">
                      {phase === 'CALIBRATION' ? 'CALIBRATING' : 'LIVE'}
                    </span>
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black bg-opacity-80 text-white text-xs px-2 py-1 rounded">
                    {phase === 'CALIBRATION' ? '📹 Calibration' : '📹 Proctoring'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Loading Phase */}
      {phase === 'LOADING' && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Loading exam...</p>
          </div>
        </div>
      )}

      {/* Start Modal Phase */}
      {phase === 'START_MODAL' && exam && (
        <ExamStartModal
          exam={exam}
          onStartExam={handleStartExam}
          onCancel={() => navigate('/student/dashboard')}
        />
      )}

      {/* Permission Request Phase */}
      {phase === 'PERMISSION_REQUEST' && (
        <PermissionRequestModal
          onPermissionGranted={handlePermissionGranted}
          onPermissionDenied={handlePermissionDenied}
        />
      )}
      
      {/* Calibration Phase */}
      {phase === 'CALIBRATION' && (
        <GazeCalibrationScreen
          onCalibrationComplete={handleCalibrationComplete}
        />
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
                    {trustScore}%
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
                    {[['A', 'option_a'], ['B', 'option_b'], ['C', 'option_c'], ['D', 'option_d']].map(([letter, opt]) => (
                      questions[currentQuestion][opt] && (
                        <label key={letter} className={`flex items-center p-4 rounded-lg cursor-pointer transition ${
                          answers[questions[currentQuestion].id] === letter
                            ? 'bg-blue-700 border-2 border-blue-500'
                            : 'bg-gray-700 hover:bg-gray-600 border-2 border-transparent'
                        }`}>
                          <input
                            type="radio"
                            name={`question_${currentQuestion}`}
                            value={letter}
                            checked={answers[questions[currentQuestion].id] === letter}
                            onChange={() => handleAnswerChange(questions[currentQuestion].id, letter)}
                            className="mr-3 w-5 h-5"
                          />
                          <span className="font-semibold mr-3 text-gray-300">{letter}.</span>
                          <span>{questions[currentQuestion][opt]}</span>
                        </label>
                      )
                    ))}
                  </div>
                )}
                
                {(questions[currentQuestion].question_type === 'SHORT_ANSWER' || 
                  questions[currentQuestion].question_type === 'SHORT') && (
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
                {trustScore}%
              </div>
            </div>
            <p className="text-sm text-gray-500">Redirecting to results...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamInterface;