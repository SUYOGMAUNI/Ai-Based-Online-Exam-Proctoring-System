/*
Student Face Registration Component with TopNavbar
File: src/components/Student/FaceRegistration.jsx

Features:
- Camera access and face capture
- Single manual photo capture (user clicks when ready)
- Preview before submission
- Upload to backend API
- Beautiful step-by-step UI

FIXED: Video display issues
*/

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNavbar from '../common/TopNavbar';

const FaceRegistration = () => {
  const [step, setStep] = useState('intro'); // intro, camera, preview, processing, success, error
  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const navigate = useNavigate();

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  // Handle video element when stream changes
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      
      // Wait for video metadata to load
      const handleLoadedMetadata = () => {
        setVideoReady(true);
        // Ensure video plays
        videoRef.current.play().catch(err => {
          console.error('Error playing video:', err);
        });
      };

      videoRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
      
      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        }
      };
    }
  }, [stream]);

  const startCamera = async () => {
    try {
      setError('');
      setVideoReady(false);
      
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });

      setStream(mediaStream);
      setStep('camera');
    } catch (err) {
      console.error('Camera error:', err);
      let errorMessage = 'Unable to access camera. ';
      
      if (err.name === 'NotAllowedError') {
        errorMessage += 'Please grant camera permissions and try again.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No camera device found.';
      } else if (err.name === 'NotReadableError') {
        errorMessage += 'Camera is already in use by another application.';
      } else {
        errorMessage += 'Please ensure you have granted camera permissions.';
      }
      
      setError(errorMessage);
      setStep('error');
    }
  };

  const captureImage = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      setError('Camera not ready. Please try again.');
      return;
    }

    if (!videoReady || video.readyState !== video.HAVE_ENOUGH_DATA) {
      setError('Video is still loading. Please wait a moment and try again.');
      return;
    }

    try {
      const context = canvas.getContext('2d');
      
      // Set canvas size to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw the video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert to blob
      canvas.toBlob((blob) => {
        if (!blob) {
          setError('Failed to capture image. Please try again.');
          return;
        }
        
        const imageUrl = URL.createObjectURL(blob);
        setCapturedImage({ blob, url: imageUrl });
        setStep('preview');
        
        // Stop camera after capture
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          setStream(null);
        }
        setVideoReady(false);
      }, 'image/jpeg', 0.95);
    } catch (err) {
      console.error('Capture error:', err);
      setError('Failed to capture image. Please try again.');
    }
  };

  const submitRegistration = async () => {
    if (!capturedImage) {
      setError('No image captured. Please try again.');
      return;
    }

    setLoading(true);
    setStep('processing');

    try {
      const formData = new FormData();
      
      // Add the single captured image with user identification
      const userId = user.id || user.username || 'unknown';
      const timestamp = Date.now();
      const filename = `face_${userId}_${timestamp}.jpg`;
      
      formData.append('face_image', capturedImage.blob, filename);

      const response = await fetch(`${API_BASE}/student/register-face/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${token}`
        },
        body: formData
      });

      if (response.ok) {
        setStep('success');
        // Update user data in localStorage
        const updatedUser = JSON.parse(localStorage.getItem('user') || '{}');
        updatedUser.is_face_registered = true;
        localStorage.setItem('user', JSON.stringify(updatedUser));
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to register face. Please try again.');
        setStep('error');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError('Network error. Please check your connection and try again.');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  const retake = () => {
    // Clean up previous captured image
    if (capturedImage && capturedImage.url) {
      URL.revokeObjectURL(capturedImage.url);
    }
    setCapturedImage(null);
    startCamera();
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setVideoReady(false);
  };

  const goToDashboard = () => {
    stopCamera();
    // Clean up any captured image URLs
    if (capturedImage && capturedImage.url) {
      URL.revokeObjectURL(capturedImage.url);
    }
    navigate('/student/dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Top Navigation Bar - only show in intro and error steps */}
      {(step === 'intro' || step === 'error') && (
        <TopNavbar 
          title="Face Registration"
          icon="📸"
          userRole="student"
          showBackButton={true}
          backPath="/student/dashboard"
          user={user}
        />
      )}

      <div className="flex items-center justify-center p-4 min-h-screen">
        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden">
          {/* Header - only show for steps other than intro */}
          {step !== 'intro' && (
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white">
              <h1 className="text-3xl font-bold mb-2">Face Registration</h1>
              <p className="text-blue-100">Secure your exam access with facial recognition</p>
            </div>
          )}

          <div className="p-8">
            {/* Intro Step */}
            {step === 'intro' && (
              <div className="text-center space-y-6">
                <div className="w-32 h-32 mx-auto bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center">
                  <span className="text-6xl">📸</span>
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Welcome to Face Registration</h2>
                  <p className="text-gray-600 mb-6">
                    We'll capture a photo of your face to enable secure proctoring during exams.
                  </p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left space-y-3">
                  <h3 className="font-semibold text-blue-900 mb-2">📋 Instructions:</h3>
                  <ul className="space-y-2 text-gray-700">
                    <li className="flex items-start">
                      <span className="text-blue-600 mr-2">•</span>
                      <span>Ensure you're in a well-lit area</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-blue-600 mr-2">•</span>
                      <span>Look directly at the camera</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-blue-600 mr-2">•</span>
                      <span>Remove any accessories covering your face</span>
                    </li>
                    <li className="flex items-start">
                      <span className="text-blue-600 mr-2">•</span>
                      <span>Click the capture button when you're ready</span>
                    </li>
                  </ul>
                </div>

                <button
                  onClick={startCamera}
                  className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transition transform hover:scale-105 shadow-lg"
                >
                  Start Camera
                </button>
              </div>
            )}

            {/* Camera Step */}
            {step === 'camera' && (
              <div className="space-y-6">
                <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }} // Mirror the video for better user experience
                  />

                  {/* Loading overlay when video is not ready */}
                  {!videoReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70">
                      <div className="text-center text-white">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                        <p>Loading camera...</p>
                      </div>
                    </div>
                  )}

                  {/* Face guide overlay - only show when video is ready */}
                  {videoReady && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-64 h-80 border-4 border-blue-500 rounded-full opacity-50"></div>
                    </div>
                  )}

                  {/* Instructions overlay */}
                  {videoReady && (
                    <div className="absolute top-4 left-0 right-0 flex justify-center">
                      <div className="bg-black bg-opacity-60 text-white px-4 py-2 rounded-lg">
                        <p className="text-sm">Position your face within the oval guide</p>
                      </div>
                    </div>
                  )}
                </div>

                <canvas ref={canvasRef} className="hidden" />

                <div className="text-center">
                  <p className="text-gray-600 mb-4">
                    When you're ready and properly positioned, click the capture button below
                  </p>

                  <div className="flex gap-4 justify-center">
                    <button
                      onClick={goToDashboard}
                      className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={captureImage}
                      disabled={!videoReady}
                      className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transition transform hover:scale-105 shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      <span className="text-2xl">📸</span>
                      <span>{videoReady ? 'Capture Photo' : 'Loading...'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Step */}
            {step === 'preview' && capturedImage && (
              <div className="text-center space-y-6">
                <div className="max-w-md mx-auto rounded-lg overflow-hidden border-4 border-blue-500 shadow-lg">
                  <img 
                    src={capturedImage.url} 
                    alt="Captured face" 
                    className="w-full h-auto"
                    style={{ transform: 'scaleX(-1)' }} // Mirror to match what user saw
                  />
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Review Your Photo</h2>
                  <p className="text-gray-600 mb-6">
                    Please verify that the photo is clear and shows your face properly
                  </p>
                </div>

                <div className="flex gap-4 justify-center">
                  <button
                    onClick={retake}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                  >
                    Retake Photo
                  </button>
                  <button
                    onClick={submitRegistration}
                    disabled={loading}
                    className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-semibold rounded-lg hover:from-green-700 hover:to-green-800 transition disabled:opacity-50"
                  >
                    {loading ? 'Registering...' : 'Submit Registration'}
                  </button>
                </div>
              </div>
            )}

            {/* Processing Step */}
            {step === 'processing' && (
              <div className="text-center space-y-6">
                <div className="w-32 h-32 mx-auto bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center animate-pulse">
                  <span className="text-6xl">⏳</span>
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Processing...</h2>
                  <p className="text-gray-600">
                    Please wait while we register your face
                  </p>
                </div>
              </div>
            )}

            {/* Success Step */}
            {step === 'success' && (
              <div className="text-center space-y-6">
                <div className="w-32 h-32 mx-auto bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center">
                  <span className="text-6xl">✅</span>
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Registration Successful!</h2>
                  <p className="text-gray-600 mb-6">
                    Your face has been registered successfully. You can now take proctored exams.
                  </p>
                </div>

                <button
                  onClick={goToDashboard}
                  className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transition"
                >
                  Go to Dashboard
                </button>
              </div>
            )}

            {/* Error Step */}
            {step === 'error' && (
              <div className="text-center space-y-6">
                <div className="w-32 h-32 mx-auto bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center">
                  <span className="text-6xl">❌</span>
                </div>

                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Registration Failed</h2>
                  <p className="text-red-600 mb-6">{error}</p>
                </div>

                <div className="flex gap-4 justify-center">
                  <button
                    onClick={goToDashboard}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                  >
                    Skip for Now
                  </button>
                  <button
                    onClick={() => {
                      setError('');
                      setStep('intro');
                    }}
                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transition"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FaceRegistration;