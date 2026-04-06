/*
  Enhanced Exam Results Component — Fixed Version
  Fixes:
  - completedAttempts filter now includes NEEDS_REVIEW status
  - Flagged count stat counts both FLAGGED and NEEDS_REVIEW
  - Review button shows for both FLAGGED and NEEDS_REVIEW
  - selectedAttempt properly set before navigating to review
*/

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const ExamResults = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = useState([]);
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');
  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  useEffect(() => { loadExamAndResults(); }, [examId]);

  const loadExamAndResults = async () => {
    try {
      setLoading(true);
      const [examRes, resultsRes] = await Promise.all([
        api.get(`/exams/${examId}/`),
        api.get(`/exams/${examId}/results/`)
      ]);
      setExam(examRes.data);

      const attempts = resultsRes.data.results || resultsRes.data;
      const completed = attempts.filter(a =>
        ['SUBMITTED', 'FLAGGED', 'NEEDS_REVIEW', 'APPROVED', 'DISQUALIFIED', 'IN_PROGRESS'].includes(a.status)
      );
      setResults(completed);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };




  const getStatusBadge = (status, trustScore) => {
    // Anything that isn't cleanly approved gets shown as Flagged
    const effectivelyFlagged =
      status === 'FLAGGED' || status === 'NEEDS_REVIEW' ||
      status === 'IN_PROGRESS' || status === 'DISQUALIFIED' ||
      (trustScore != null && trustScore < 75);

    if (effectivelyFlagged && status !== 'APPROVED') {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-semibold text-white bg-orange-500">
          Flagged
        </span>
      );
    }
    const badges = {
      SUBMITTED: { bg: 'bg-blue-500',  text: 'Submitted' },
      APPROVED:  { bg: 'bg-green-500', text: 'Approved' },
    };
    const badge = badges[status] || { bg: 'bg-gray-500', text: status };
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${badge.bg}`}>
        {badge.text}
      </span>
    );
  };

  const getTrustScoreColor = (score) =>
    score >= 75 ? 'text-green-600 bg-green-50' :
    score >= 50 ? 'text-yellow-600 bg-yellow-50' :
                  'text-red-600 bg-red-50';

  const getTrustScoreBadge = (score) =>
    score >= 75 ? { icon: '✅', text: 'Excellent',       color: 'text-green-600' } :
    score >= 50 ? { icon: '⚠️', text: 'Warning',         color: 'text-yellow-600' } :
                  { icon: '🚨', text: 'Review Required',  color: 'text-red-600' };

  const isFlagged = (r) =>
    r.status === 'FLAGGED' || r.status === 'NEEDS_REVIEW' ||
    r.status === 'IN_PROGRESS' || r.status === 'DISQUALIFIED' ||
    r.trust_score < 75;

  const flaggedCount  = results.filter(isFlagged).length;
  const passedCount   = results.filter(r => r.status === 'APPROVED').length;

  const filteredResults = results.filter(r => {
    if (activeFilter === 'flagged') return isFlagged(r);
    if (activeFilter === 'passed')  return r.status === 'APPROVED';
    return true; // 'all'
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button
                onClick={() => navigate('/teacher/dashboard')}
                className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <span className="text-2xl mr-3">📊</span>
              <h1 className="text-xl font-bold text-gray-900">
                {exam ? `Results: ${exam.title}` : 'Exam Results'}
              </h1>
            </div>
            <div className="text-sm text-gray-600">
              {results.length} submission{results.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Exam info banner */}
        {exam && (
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-6 text-white mb-6 shadow-lg">
            <h2 className="text-2xl font-bold mb-2">{exam.title}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div>
                <p className="text-blue-100 text-sm">Total Marks</p>
                <p className="text-2xl font-bold">{exam.total_marks}</p>
              </div>
              <div>
                <p className="text-blue-100 text-sm">Duration</p>
                <p className="text-2xl font-bold">{exam.duration_minutes ?? exam.duration} min</p>
              </div>
              <div>
                <p className="text-blue-100 text-sm">Questions</p>
                <p className="text-2xl font-bold">{exam.questions?.length || 0}</p>
              </div>
              <div>
                <p className="text-blue-100 text-sm">Submissions</p>
                <p className="text-2xl font-bold">{results.length}</p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 bg-white rounded-xl shadow-md">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
              <p className="text-gray-600">Loading results...</p>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-md">
            <span className="text-6xl mb-4 block">📝</span>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Submissions Yet</h3>
            <p className="text-gray-600">No students have submitted this exam yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {/* Filter Tabs */}
            <div className="flex border-b border-gray-200">
              {[
                { key: 'all',     label: 'All',             count: results.length },
                { key: 'flagged', label: '🚩 Flagged',      count: flaggedCount },
                { key: 'passed',  label: '✅ Passed',        count: passedCount },
              ].map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={`px-6 py-3 text-sm font-medium border-b-2 transition ${
                    activeFilter === key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {label}
                  <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
                    {count}
                  </span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Student','Score','Trust Score','Status','Submitted','Actions'].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredResults.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        No results in this category.
                      </td>
                    </tr>
                  ) : filteredResults.map(result => {
                    const needsReview = isFlagged(result);
                    return (
                      <tr key={result.id} className={`hover:bg-gray-50 transition ${needsReview ? 'bg-orange-50' : ''}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold mr-3">
                              {result.student_name?.charAt(0) || 'S'}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {result.student_name || 'Unknown Student'}
                              </div>
                              <div className="text-sm text-gray-500">ID: {result.student}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-lg font-bold text-gray-900">
                            {result.obtained_marks} / {exam?.total_marks}
                          </div>
                          <div className="text-xs text-gray-500">
                            {exam?.total_marks
                              ? Math.round((result.obtained_marks / exam.total_marks) * 100)
                              : 0}%
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`inline-block px-3 py-2 rounded-lg ${getTrustScoreColor(result.trust_score)}`}>
                            <div className="text-2xl font-bold">{result.trust_score}%</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(result.status, result.trust_score)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(result.submitted_at || result.created_at).toLocaleString('en-US', {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => navigate(`/teacher/review?examId=${examId}&attemptId=${result.id}`)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-medium"
                          >
                            👁️ Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Summary stats */}
        {results.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl p-6 shadow-md">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Average Score</h3>
              <p className="text-3xl font-bold text-gray-900">
                {Math.round(results.reduce((s, r) => s + r.obtained_marks, 0) / results.length)}
                {' / '}{exam?.total_marks}
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-md">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Average Trust Score</h3>
              <p className="text-3xl font-bold text-gray-900">
                {Math.round(results.reduce((s, r) => s + r.trust_score, 0) / results.length)}%
              </p>
            </div>
            {/* FIX: count both FLAGGED and NEEDS_REVIEW */}
            <div className="bg-white rounded-xl p-6 shadow-md">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Flagged for Review</h3>
              <p className={`text-3xl font-bold ${flaggedCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {flaggedCount}
              </p>
              {flaggedCount > 0 && (
                <p className="text-xs text-gray-500 mt-1">Requires teacher review</p>
              )}
            </div>
            <div className="bg-white rounded-xl p-6 shadow-md">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Passed / Approved</h3>
              <p className={`text-3xl font-bold ${passedCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                {passedCount}
              </p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default ExamResults;