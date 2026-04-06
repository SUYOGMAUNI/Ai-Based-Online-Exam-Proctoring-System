/* 
SILENT AUDIO MONITORING - No Student Warnings
File: src/hooks/useAudioMonitoring.js

Records audio violations silently without interrupting the student.
No warnings, no modals, no visual indicators during exam.
*/

import { useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const useAudioMonitoring = ({ 
  attemptId, 
  enabled = true,
  onViolation = null,
  interval = 250,
  captureLength = 10000
}) => {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const isRecordingRef = useRef(false);
  const stopTimeoutRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const onViolationRef = useRef(onViolation);
  
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!enabled || !attemptId) {
      console.log('🎤 [AUDIO] Hook disabled', { enabled, attemptId });
      return;
    }

    console.log(`🎤 [AUDIO] Silent monitoring started for attempt: ${attemptId}`);

    const api = axios.create({
      baseURL: API_BASE,
      headers: { 
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const startAudioMonitoring = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        });

        streamRef.current = stream;
        console.log('✅ [AUDIO] Stream obtained (silent mode)');

        const audioTrack = stream.getAudioTracks()[0];
        const settings = audioTrack.getSettings();
        const sampleRate = settings.sampleRate || 48000;

        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate
        });

        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 2048;

        sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(stream);
        sourceNodeRef.current.connect(analyserRef.current);

        mediaRecorderRef.current = new MediaRecorder(stream, {
          mimeType: 'audio/webm'
        });

        mediaRecorderRef.current.ondataavailable = e => {
          if (e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };

        mediaRecorderRef.current.onstop = async () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
          recordedChunksRef.current = [];

          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const base64Audio = reader.result;
              console.log(`🔇 [AUDIO] Sending audio clip (${blob.size} bytes) - silent mode`);

              const response = await api.post('/proctoring/analyze-audio/', {
                attempt_id: attemptId,
                audio_data: base64Audio,
                timestamp: new Date().toISOString()
              });

              if (response.data.speech_detected && onViolationRef.current) {
                console.log('🔇 [AUDIO] Speech detected (not shown to student)');
                
                // 🔇 Pass violation silently - NO warnings to student
                onViolationRef.current({
                  type: 'AUDIO_DETECTED',
                  timestamp: new Date(),
                  details: response.data,
                  showWarning: false  // DO NOT show modal
                });
              }
            } catch (err) {
              console.error('❌ [AUDIO] Upload failed:', err.message);
            }
          };
          reader.readAsDataURL(blob);
        };

        const monitorNoise = () => {
          const analyser = analyserRef.current;
          if (!analyser || isRecordingRef.current) return;

          const data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(data);

          const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
          const THRESHOLD = 0.06;

          if (avg > THRESHOLD) {
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state === 'recording') return;

            console.log(`🎤 [AUDIO] Noise detected (${avg.toFixed(3)}) - recording (silent)`);

            isRecordingRef.current = true;
            recorder.start();

            stopTimeoutRef.current = setTimeout(() => {
              if (recorder.state === 'recording') {
                recorder.stop();
              }
              isRecordingRef.current = false;
              console.log('🛑 [AUDIO] Auto-stopped after 30s (silent)');
            }, captureLength);
          }
        };

        console.log(`⏰ [AUDIO] Silent monitoring active (${interval}ms)`);
        intervalRef.current = setInterval(monitorNoise, interval);

      } catch (error) {
        console.error('❌ [AUDIO] Initialization failed:', error);

        // 🔇 Even errors are silent - no user notification
        if (onViolationRef.current) {
          onViolationRef.current({
            type: 'AUDIO_ERROR',
            timestamp: new Date(),
            details: { error: error.message },
            showWarning: false  // DO NOT show modal
          });
        }
      }
    };

    startAudioMonitoring();

    return () => {
      console.log('🛑 [AUDIO] Cleaning up (silent mode)');

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }

      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.disconnect();
        } catch {}
        sourceNodeRef.current = null;
      }

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }

      audioContextRef.current = null;
      analyserRef.current = null;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [enabled, attemptId, interval, captureLength, token]);

  return null;
};

export default useAudioMonitoring;