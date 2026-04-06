/*
Fixed Student Results Page with TopNavbar
File: src/components/Student/StudentResults.jsx

Shows student's exam attempts with results and trust scores
- Handles paginated and non-paginated API responses
- Provides fallback values for missing fields
- Shows proper error states
*/

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TopNavbar from '../common/TopNavbar';

const StudentResults = () => {
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  useEffect(() => {
    loadResults();
  }, []);

  const loadResults = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await api.get('/attempts/');
      
      // Handle both paginated and non-paginated responses
      let attemptsList = response.data.results || response.data;
      
      // Ensure it's an array
      attemptsList = Array.isArray(attemptsList) ? attemptsList : [];
      
      // Normalize the data with defaults
      const normalizedAttempts = attemptsList.map(attempt => ({
        id: attempt.id || Math.random(),
        exam_title: attempt.exam?.title || attempt.exam_title || 'Untitled Exam',
        obtained_marks: attempt.obtained_marks || 0,
        total_marks: attempt.total_marks || attempt.exam?.total_marks || attempt.exam_total_marks || 0,
        trust_score: attempt.trust_score || 0,
        status: attempt.status || 'SUBMITTED',
        result_status: attempt.result_status || 'PENDING',
        submitted_at: attempt.submitted_at || new Date().toISOString(),
        started_at: attempt.started_at || new Date().toISOString(),
        duration_minutes: attempt.duration_minutes || attempt.exam?.duration_minutes || 60,
        violation_count: attempt.violation_count || 0,
        face_verified: attempt.face_verified !== undefined ? attempt.face_verified : false,
        gaze_calibrated: attempt.gaze_calibrated !== undefined ? attempt.gaze_calibrated : false,
        teacher_comments: attempt.teacher_comments || null,
        ...attempt // Keep any other fields
      }));
      
      setAttempts(normalizedAttempts);
    } catch (error) {
      console.error('Failed to load results:', error);
      
      // Check if it's a 404 (endpoint doesn't exist yet)
      if (error.response?.status === 404) {
        setError('The results endpoint is not yet available. Check back soon!');
      } else if (error.response?.status === 401) {
        setError('Your session has expired. Please login again.');
        navigate('/');
      } else {
        setError(error.message || 'Failed to load exam results');
      }
      
      setAttempts([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const colors = {
      'SUBMITTED': 'bg-blue-100 text-blue-800',
      'UNDER_REVIEW': 'bg-yellow-100 text-yellow-800',
      'APPROVED': 'bg-green-100 text-green-800',
      'PASSED': 'bg-green-100 text-green-800',
      'FAILED': 'bg-red-100 text-red-800',
      'DISQUALIFIED': 'bg-red-100 text-red-800'
    };
    
    const badgeClasses = colors[status] || 'bg-gray-100 text-gray-800';
    
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badgeClasses}`}>
        {status}
      </span>
    );
  };

  const getTrustScoreColor = (score) => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getResultIcon = (status) => {
    if (status === 'APPROVED' || status === 'PASSED') return '✅';
    if (status === 'FAILED') return '❌';
    if (status === 'UNDER_REVIEW' || status === 'SUBMITTED') return '⏳';
    if (status === 'DISQUALIFIED') return '🚫';
    return '📋';
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'N/A';
    }
  };

  const calculatePercentage = (obtained, total) => {
    if (!total || total === 0) return 0;
    return Math.round((obtained / total) * 100);
  };

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <TopNavbar 
          title="Exam Results"
          icon="📊"
          userRole="student"
          showBackButton={true}
          backPath="/student/dashboard"
          user={user}
        />
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading your exam results...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation Bar */}
      <TopNavbar 
        title="Exam Results"
        icon="📊"
        userRole="student"
        showBackButton={true}
        backPath="/student/dashboard"
        user={user}
      />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error State */}
        {error && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* No Results State */}
        {!error && attempts.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl shadow-md">
            <span className="text-6xl mb-4 block">📝</span>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Results Yet</h3>
            <p className="text-gray-600 mb-6">
              You haven't completed any exams yet. Start taking exams to see your results here.
            </p>
            <button
              onClick={() => navigate('/student/dashboard')}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              View Available Exams
            </button>
          </div>
        )}

        {/* Results List */}
        {!error && attempts.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">
                Your Exam Results ({attempts.length})
              </h2>
            </div>

            <div className="space-y-4">
              {attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-200 hover:shadow-lg transition-all"
                >
                  <div className="p-6 flex items-start">
                    {/* Icon */}
                    <div className="flex-shrink-0 text-4xl mr-4">
                      {getResultIcon(attempt.status)}
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-gray-900 mb-1">
                            {attempt.exam_title}
                          </h3>
                          <p className="text-sm text-gray-500">
                            Submitted on {formatDate(attempt.submitted_at)}
                          </p>
                        </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        {/* Score */}
                        <div className="bg-blue-50 rounded-lg p-4">
                          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Score</p>
                          <p className="text-2xl font-bold text-blue-600 mt-2">
                            {attempt.obtained_marks}/{attempt.total_marks}
                          </p>
                        </div>

                        {/* Percentage */}
                        <div className="bg-purple-50 rounded-lg p-4">
                          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Percentage</p>
                          <p className="text-2xl font-bold text-purple-600 mt-2">
                            {calculatePercentage(attempt.obtained_marks, attempt.total_marks)}%
                          </p>
                        </div>

                        {/* Trust Score */}
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Trust Score</p>
                          <p className={`text-2xl font-bold mt-2 ${getTrustScoreColor(attempt.trust_score)}`}>
                            {attempt.trust_score}
                          </p>
                        </div>

                        {/* Status */}
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">Status</p>
                          {getStatusBadge(attempt.status)}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentResults;