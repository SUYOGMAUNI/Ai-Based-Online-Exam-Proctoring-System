// File: src/components/Proctoring/ExamProctoring.jsx
import React, { useRef, useState, useEffect } from 'react';
import axios from 'axios';

const ExamProctoring = ({ 
  attemptId, 
  onViolation,
  enabled = true 
}) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [violations, setViolations] = useState([]);
  const [trustScore, setTrustScore] = useState(100);
  const [aiActive, setAiActive] = useState(false);
  
  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');
  
  // Initialize camera
  useEffect(() => {
    if (!enabled || !attemptId) {
      return;
    }
    
    const initCamera = async () => {
      try {
        console.log('📹 [ExamProctoring] Initializing camera...');
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
          },
          audio: false
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          
          // Wait for video to load
          await new Promise(resolve => {
            if (videoRef.current.readyState >= 1) {
              resolve();
            } else {
              videoRef.current.onloadedmetadata = resolve;
            }
          });
          
          setCameraReady(true);
          console.log('✅ [ExamProctoring] Camera ready');
        }
      } catch (error) {
        console.error('❌ [ExamProctoring] Camera error:', error);
      }
    };
    
    initCamera();
    
    return () => {
      // Cleanup
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, [enabled, attemptId]);
  
  // Handle AI proctoring logic
  useEffect(() => {
    if (!enabled || !attemptId || !cameraReady) {
      return;
    }
    
    console.log('🤖 [ExamProctoring] Starting AI proctoring...');
    setAiActive(true);
    
    const interval = setInterval(async () => {
      try {
        // Capture frame from video
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        if (!video || video.readyState !== 4) {
          return;
        }
        
        // Set canvas size
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw frame
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to base64
        const frameData = canvas.toDataURL('image/jpeg', 0.8);
        
        // Send to backend
        const response = await axios.post(
          `${API_BASE}/proctoring/analyze-frame/`,
          {
            attempt_id: attemptId,
            frame: frameData,
            timestamp: new Date().toISOString()
          },
          {
            headers: { 'Authorization': `Token ${token}` }
          }
        );
        
        console.log('✅ [ExamProctoring] AI analysis:', response.data);
        
        // Handle violations
        if (response.data.violations && response.data.violations.length > 0) {
          response.data.violations.forEach(violationType => {
            const violation = {
              type: violationType,
              timestamp: new Date(),
              details: response.data
            };
            
            setViolations(prev => [...prev.slice(-4), violation]);
            
            if (onViolation) {
              onViolation(violation);
            }
            
            // Update trust score
            setTrustScore(prev => Math.max(0, prev - 5));
          });
        }
        
      } catch (error) {
        console.error('❌ [ExamProctoring] AI analysis failed:', error);
      }
    }, 5000); // Every 3 seconds
    
    return () => {
      clearInterval(interval);
      setAiActive(false);
    };
  }, [enabled, attemptId, cameraReady, onViolation]);
  
  if (!enabled) {
    return null;
  }
  
  return (
    <div className="exam-proctoring">
      {/* Camera Preview */}
      <div className="camera-preview">
        <div className="camera-header">
          <h3 className="text-sm font-semibold text-gray-700">AI Proctoring</h3>
          <div className="status-indicator">
            <div className={`w-2 h-2 rounded-full ${aiActive ? 'bg-green-500' : 'bg-gray-400'}`}></div>
            <span className="text-xs text-gray-600 ml-1">
              {aiActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        
        <div className="video-container">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-auto rounded border border-gray-300"
            style={{
              transform: 'scaleX(-1)',
              display: cameraReady ? 'block' : 'none'
            }}
          />
          
          {!cameraReady && (
            <div className="camera-placeholder">
              <div className="text-gray-500">Camera initializing...</div>
            </div>
          )}
        </div>
        
        {/* Trust Score */}
        <div className="trust-score-display mt-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-600">Trust Score:</span>
            <span className={`font-bold ${
              trustScore >= 80 ? 'text-green-600' :
              trustScore >= 60 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {trustScore}%
            </span>
          </div>
          <div className="trust-score-bar mt-1">
            <div 
              className={`h-1 rounded-full ${
                trustScore >= 80 ? 'bg-green-500' :
                trustScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${trustScore}%` }}
            ></div>
          </div>
        </div>
        
        {/* Violations */}
        {violations.length > 0 && (
          <div className="violations-list mt-3">
            <div className="text-xs text-gray-600 mb-1">Recent Violations:</div>
            {violations.slice(-3).map((violation, index) => (
              <div key={index} className="violation-item text-xs text-red-600 bg-red-50 p-1 rounded mb-1">
                {violation.type} - {new Date(violation.timestamp).toLocaleTimeString()}
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export default ExamProctoring;