/*
Exam Start Modal Component
Shows exam instructions and enters fullscreen when user clicks "Start Exam"
This ensures fullscreen is triggered by a user gesture
*/

import React, { useState } from 'react';

const ExamStartModal = ({ exam, onStartExam, onCancel }) => {
  const [isStarting, setIsStarting] = useState(false);

  const handleStartExam = async () => {
    setIsStarting(true);

    try {
      // First, enter fullscreen (this MUST happen before navigating or any async operations)
      const element = document.documentElement;
      
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
      } else if (element.mozRequestFullScreen) {
        await element.mozRequestFullScreen();
      } else if (element.msRequestFullscreen) {
        await element.msRequestFullscreen();
      }

      // Small delay to ensure fullscreen is active
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now call the parent's start exam function
      await onStartExam();
    } catch (error) {
      console.error('Error starting exam:', error);
      setIsStarting(false);
      
      // If fullscreen was denied, still try to start the exam
      // The FullscreenLock component will show a warning
      await onStartExam();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <h2 className="text-3xl font-bold mb-2">{exam.title}</h2>
          <p className="text-blue-100">Please read the instructions carefully before starting</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Exam Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Duration</div>
              <div className="text-2xl font-bold text-blue-600">{exam.duration_minutes} min</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Questions</div>
              <div className="text-2xl font-bold text-green-600">{exam.total_questions || 'N/A'}</div>
            </div>
          </div>

          {/* Instructions */}
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
              <li className="flex items-start">
                <span className="text-yellow-600 mr-2">•</span>
                <span><strong>Timer:</strong> The exam will auto-submit when time expires</span>
              </li>
            </ul>
          </div>

          {/* Proctoring Notice */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              <strong className="text-blue-900">🔒 Proctoring Enabled:</strong> This exam is monitored using AI-powered proctoring. 
              Your face, gaze, audio, and screen activity will be analyzed. Suspicious behavior will be flagged for review.
            </p>
          </div>

          {/* Fullscreen Notice */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              <strong className="text-purple-900">📺 Fullscreen Mode:</strong> When you click "Start Exam", 
              your browser will enter fullscreen mode. You can press <kbd className="px-2 py-1 bg-gray-200 rounded text-xs font-mono">ESC</kbd> to 
              exit fullscreen, but this will be recorded as a violation.
            </p>
          </div>

          {/* Exam Description */}
          {exam.description && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Exam Description:</h3>
              <p className="text-gray-600">{exam.description}</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
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

export default ExamStartModal;w