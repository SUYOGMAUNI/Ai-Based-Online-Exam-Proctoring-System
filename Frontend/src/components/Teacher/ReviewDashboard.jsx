/*
  Teacher Review Dashboard — Fixed Version
  Fixes applied:
  1. Flagged filter now catches status === 'FLAGGED' || 'NEEDS_REVIEW' (not just trust_score heuristic)
  2. ESC key + clicking backdrop closes evidence modal
  3. Logs show full date+time, violation icon, and message detail
  4. violations fallback fixed — no longer references stale attemptDetail before it's set
  5. started_at / start_time field normalised via helper
  6. Review decision buttons also shown for FLAGGED and NEEDS_REVIEW statuses
  7. Evidence modal supports both screenshot + audio on same violation
*/

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import TopNavbar from '../common/TopNavbar';

const ReviewDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [attemptDetail, setAttemptDetail] = useState(null);
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('FLAGGED');

  const [evidenceModal, setEvidenceModal] = useState({
    isOpen: false,
    type: null,      // 'image' | 'audio' | 'both'
    url: null,
    audioUrl: null,
    violation: null
  });

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');
  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  // ESC key closes evidence modal
  const closeEvidenceModal = useCallback(() => {
    setEvidenceModal({ isOpen: false, type: null, url: null, audioUrl: null, violation: null });
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeEvidenceModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeEvidenceModal]);

  useEffect(() => { loadExams(); }, []);

  // Auto-select exam (and optionally a specific attempt) when navigated from Results page
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const preExam    = params.get('examId');
    const preAttempt = params.get('attemptId');
    if (preExam && exams.length > 0) {
      loadAttempts(preExam).then(() => {
        if (preAttempt) loadAttemptDetail(preAttempt);
      });
    }
  }, [exams, location.search]);

  const loadExams = async () => {
    try {
      const res = await api.get('/exams/');
      setExams(res.data.results || res.data);
    } catch (err) {
      console.error('Failed to load exams:', err);
    }
  };

  const loadAttempts = async (examId) => {
    try {
      setLoading(true);
      const res = await api.get(`/exams/${examId}/results/`);
      setAttempts(res.data);
      setSelectedExam(examId);
      setSelectedAttempt(null);
      setAttemptDetail(null);
      setViolations([]);
    } catch (err) {
      console.error('Failed to load attempts:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAttemptDetail = async (attemptId) => {
    try {
      setLoading(true);
      // Load detail and violations in parallel so fallback works correctly
      const [detailRes, violRes] = await Promise.allSettled([
        api.get(`/teacher/attempt/${attemptId}/review/`),
        api.get(`/attempts/${attemptId}/violations-with-evidence/`)
      ]);

      let detail = null;
      if (detailRes.status === 'fulfilled') {
        detail = detailRes.value.data;
        setAttemptDetail(detail);
      }

      if (violRes.status === 'fulfilled') {
        setViolations(violRes.value.data);
      } else {
        // Fallback: use violations embedded in the detail response
        setViolations(detail?.violations || []);
      }

      setSelectedAttempt(attemptId);
    } catch (err) {
      console.error('Failed to load attempt detail:', err);
    } finally {
      setLoading(false);
    }
  };

  const openEvidenceModal = (violation) => {
    const imgUrl  = violation.screenshot_url  || violation.screenshot  ||
                    violation.image_url       || violation.evidence_url ||
                    violation.evidence_image  || violation.frame_url    || null;
    const audUrl  = violation.audio_clip_url  || violation.audio_clip  ||
                    violation.audio_url       || null;
    const type = imgUrl && audUrl ? 'both' : imgUrl ? 'image' : audUrl ? 'audio' : 'none';
    setEvidenceModal({ isOpen: true, type, url: imgUrl, audioUrl: audUrl, violation });
  };

  const handleApprove = async (attemptId) => {
    if (!window.confirm('Approve this exam attempt?')) return;
    try {
      await api.post(`/teacher/attempt/${attemptId}/approve/`, {});
      alert('Exam approved successfully');
      loadAttempts(selectedExam);
      loadAttemptDetail(attemptId);
    } catch (err) {
      alert('Failed to approve exam');
    }
  };

  const handleReject = async (attemptId) => {
    const reason = window.prompt('Enter reason for rejection:');
    if (!reason) return;
    try {
      await api.post(`/teacher/attempt/${attemptId}/reject/`, { comments: reason });
      alert('Exam rejected / disqualified');
      loadAttempts(selectedExam);
      loadAttemptDetail(attemptId);
    } catch (err) {
      alert('Failed to reject exam');
    }
  };

  const isFlagged = (a) =>
    a.status === 'FLAGGED' || a.status === 'NEEDS_REVIEW' ||
    a.status === 'IN_PROGRESS' || a.status === 'DISQUALIFIED' ||
    a.trust_score < 75;

  const filteredAttempts = attempts.filter(a => {
    if (filter === 'FLAGGED') return isFlagged(a);
    if (filter === 'PASSED')  return a.status === 'APPROVED';
    return true; // 'ALL'
  });

  const flaggedCount = attempts.filter(isFlagged).length;
  const passedCount  = attempts.filter(a => a.status === 'APPROVED').length;

  // Normalise start_time vs started_at from different API serialisers
  const getStartTime = (attempt) => attempt?.start_time || attempt?.started_at || null;

  const getStatusBadge = (status, trustScore) => {
    if (status === 'APPROVED') {
      return <span className="px-3 py-1 rounded-full text-xs font-semibold text-white bg-green-500">Approved</span>;
    }
    if (status === 'SUBMITTED' && (trustScore == null || trustScore >= 75)) {
      return <span className="px-3 py-1 rounded-full text-xs font-semibold text-white bg-blue-500">Submitted</span>;
    }
    // Everything else — FLAGGED, NEEDS_REVIEW, IN_PROGRESS, DISQUALIFIED, or low trust — shows as Flagged
    return <span className="px-3 py-1 rounded-full text-xs font-semibold text-white bg-orange-500">Flagged</span>;
  };

  const getTrustScoreBadge = (score) => {
    const [color, label] =
      score < 50  ? ['text-red-400',    'INVALID']      :
      score < 75  ? ['text-yellow-400', 'NEEDS REVIEW']  :
                    ['text-green-400',  'VALID'];
    return (
      <div className="text-center">
        <div className={`text-4xl font-bold ${color}`}>{score}</div>
        <div className="text-sm text-gray-400">{label}</div>
      </div>
    );
  };

  const getViolationIcon = (type) => ({
    FACE_MISMATCH:     '👤',
    MULTIPLE_FACES:    '👥',
    GAZE_DEVIATION:    '👀',
    GAZE_AWAY:         '👀',
    AUDIO_DETECTED:    '🔊',
    TAB_SWITCH:        '🔄',
    FULLSCREEN_EXIT:   '📱',
    FACE_NOT_DETECTED: '❌',
    NO_FACE_LONG:      '❌',
  }[type] || '⚠️');

  const getLogBadgeClass = (t) =>
    t === 'VIOLATION' ? 'bg-red-100 text-red-800' :
    t === 'WARNING'   ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800';

  const reviewableStatuses = ['SUBMITTED', 'FLAGGED', 'NEEDS_REVIEW', 'IN_PROGRESS', 'DISQUALIFIED'];

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNavbar
        title="Exam Review Dashboard"
        icon="🔍"
        userRole="teacher"
        additionalButtons={[{
          icon: '📊', label: 'Dashboard',
          onClick: () => navigate('/teacher/dashboard')
        }]}
      />

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-12 gap-6">

          {/* Exam list sidebar */}
          <div className="col-span-3">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold text-lg mb-4">Your Exams</h2>
              <div className="space-y-2">
                {exams.map(exam => (
                  <button
                    key={exam.id}
                    onClick={() => loadAttempts(exam.id)}
                    className={`w-full text-left p-3 rounded-lg transition border-2 ${
                      selectedExam === exam.id
                        ? 'bg-blue-100 border-blue-500'
                        : 'hover:bg-gray-100 border-transparent'
                    }`}
                  >
                    <div className="font-medium">{exam.title}</div>
                    <div className="text-sm text-gray-500">
                      {new Date(exam.start_time).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="col-span-9">

            {!selectedExam ? (
              <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400 text-lg">
                Select an exam to view student attempts
              </div>

            ) : loading ? (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
                <p className="text-gray-500">Loading...</p>
              </div>

            ) : !selectedAttempt ? (
              /* Attempts table */
              <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b flex justify-between items-center flex-wrap gap-3">
                  <h3 className="text-xl font-bold">Student Attempts</h3>
                  <div className="flex gap-2">
                    {[
                      { key: 'FLAGGED', label: `🚩 Flagged`, count: flaggedCount,        cls: 'bg-orange-500' },
                      { key: 'PASSED',  label: `✅ Passed`,  count: passedCount,          cls: 'bg-green-500'  },
                      { key: 'ALL',     label: `All`,        count: attempts.length,      cls: 'bg-blue-500'   },
                    ].map(({ key, label, count, cls }) => (
                      <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`px-4 py-2 rounded-lg font-medium transition flex items-center gap-2 ${
                          filter === key ? `${cls} text-white` : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {label}
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          filter === key ? 'bg-white bg-opacity-30 text-white' : 'bg-gray-200 text-gray-600'
                        }`}>{count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Student','Score','Trust Score','Status','Submitted','Action'].map(h => (
                          <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredAttempts.map(a => (
                        <tr key={a.id} className={`hover:bg-gray-50 ${isFlagged(a) ? 'bg-orange-50' : ''}`}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-gray-900">{a.student_name}</div>
                            <div className="text-sm text-gray-500">{a.student_username}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-lg font-bold text-blue-600">{a.obtained_marks}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`text-2xl font-bold ${
                              a.trust_score >= 75 ? 'text-green-500' :
                              a.trust_score >= 50 ? 'text-yellow-500' : 'text-red-500'
                            }`}>{a.trust_score}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(a.status, a.trust_score)}</td>
                          <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                            {a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => loadAttemptDetail(a.id)}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Review →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredAttempts.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                    {filter === 'FLAGGED'
                        ? '✅ No flagged attempts — all students look clean'
                        : filter === 'PASSED'
                        ? 'No approved attempts yet'
                        : 'No attempts found'}
                    </div>
                  )}
                </div>
              </div>

            ) : attemptDetail ? (
              /* Attempt detail view */
              <div className="space-y-6">
                <button
                  onClick={() => { setSelectedAttempt(null); setAttemptDetail(null); setViolations([]); }}
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  ← Back to Attempts
                </button>

                {/* Student info + trust score */}
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-2 bg-white rounded-lg shadow p-6">
                    <h3 className="text-xl font-bold mb-4">Student Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-500">Name</div>
                        <div className="font-medium">{attemptDetail.attempt.student_name}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Username</div>
                        <div className="font-medium">{attemptDetail.attempt.student_username}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Started</div>
                        <div className="font-medium">
                          {getStartTime(attemptDetail.attempt)
                            ? new Date(getStartTime(attemptDetail.attempt)).toLocaleString()
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Duration</div>
                        <div className="font-medium">
                          {attemptDetail.attempt.duration_seconds != null
                            ? `${Math.floor(attemptDetail.attempt.duration_seconds / 60)}m ${attemptDetail.attempt.duration_seconds % 60}s`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Obtained Marks</div>
                        <div className="text-2xl font-bold text-blue-600">{attemptDetail.attempt.obtained_marks}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Status</div>
                        {getStatusBadge(attemptDetail.attempt.status, attemptDetail.attempt.trust_score)}
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="text-lg font-bold mb-4 text-center">Trust Score</h3>
                    {getTrustScoreBadge(attemptDetail.attempt.trust_score)}
                    <div className="mt-4 text-sm text-gray-500 text-center">
                      {attemptDetail.attempt.result_status}
                    </div>
                  </div>
                </div>

                {/* Violations */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-xl font-bold mb-1">Violations with Evidence</h3>
                  <p className="text-sm text-gray-500 mb-4">Click any violation to view captured evidence</p>

                  {/* Summary tiles */}
                  {attemptDetail.attempt.violation_summary &&
                    Object.keys(attemptDetail.attempt.violation_summary).length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-6">
                      {Object.entries(attemptDetail.attempt.violation_summary).map(([type, count]) => (
                        <div key={type} className="bg-red-50 rounded-lg p-3 text-center">
                          <div className="text-2xl">{getViolationIcon(type)}</div>
                          <div className="text-2xl font-bold text-red-600">{count}</div>
                          <div className="text-xs text-gray-600 leading-tight">{type.replace(/_/g, ' ')}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Violation list */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {violations.map(v => {
                      const hasImg   = !!(v.screenshot_url || v.screenshot || v.image_url || v.evidence_url || v.evidence_image || v.frame_url);
                      const hasAudio = !!(v.audio_clip_url || v.audio_clip || v.audio_url);
                      const hasEvidence = hasImg || hasAudio;
                      const violationLabel = v.violation_type_display || v.violation_type?.replace(/_/g, ' ') || 'Unknown Violation';
                      return (
                        <div
                          key={v.id}
                          onClick={() => openEvidenceModal(v)}
                          title="Click to view details"
                          className="border-l-4 border-red-500 bg-red-50 p-4 rounded transition cursor-pointer hover:bg-red-100 hover:shadow"
                        >
                          <div className="flex justify-between items-start gap-3">
                            <div className="flex items-start gap-3 flex-1">
                              <span className="text-2xl mt-0.5">{getViolationIcon(v.violation_type)}</span>
                              <div>
                                <div className="font-semibold text-red-900">{violationLabel}</div>
                                <div className="text-sm text-gray-600 mt-0.5">
                                  {v.description || violationLabel}
                                </div>
                                <div className="mt-1 flex gap-2 text-xs">
                                  {hasImg   && <span className="text-blue-600">📷 Screenshot</span>}
                                  {hasAudio && <span className="text-blue-600">🔊 Audio clip</span>}
                                  {hasEvidence
                                    ? <span className="text-gray-400">— click to view</span>
                                    : <span className="text-gray-400">No media captured — click for details</span>
                                  }
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-medium text-gray-700">
                                {new Date(v.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit', minute: '2-digit', second: '2-digit'
                                })}
                              </div>
                              <div className="text-xs text-gray-400">
                                {new Date(v.timestamp).toLocaleDateString()}
                              </div>
                              <div className="text-sm font-semibold text-red-600 mt-1">
                                −{v.penalty ?? 5} pts
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {violations.length === 0 && (
                      <div className="text-center text-gray-500 py-8">No violations recorded</div>
                    )}
                  </div>
                </div>

                {/* Proctoring event log */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-xl font-bold mb-4">Proctoring Event Log</h3>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {(attemptDetail.logs || []).length === 0 ? (
                      <div className="text-center text-gray-400 py-6">No log entries</div>
                    ) : (
                      attemptDetail.logs.map(log => (
                        <div
                          key={log.id}
                          className="flex items-start gap-3 text-sm p-2.5 rounded hover:bg-gray-50 border border-transparent hover:border-gray-200"
                        >
                          {/* Event type badge */}
                          <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-semibold ${getLogBadgeClass(log.log_type)}`}>
                            {log.log_type}
                          </span>

                          {/* Full timestamp */}
                          <span className="shrink-0 text-gray-400 text-xs mt-0.5 w-40">
                            {new Date(log.timestamp).toLocaleString([], {
                              month: 'short', day: 'numeric',
                              hour: '2-digit', minute: '2-digit', second: '2-digit'
                            })}
                          </span>

                          {/* Message */}
                          <span className="flex-1 text-gray-700">{log.message}</span>

                          {/* Violation icon if the log has a linked type */}
                          {log.violation_type && (
                            <span className="shrink-0 text-lg" title={log.violation_type}>
                              {getViolationIcon(log.violation_type)}
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Review decision */}
                {reviewableStatuses.includes(attemptDetail.attempt.status) ? (
                  <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="text-xl font-bold mb-4">Review Decision</h3>
                    <div className="flex gap-4">
                      <button
                        onClick={() => handleApprove(attemptDetail.attempt.id)}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition"
                      >
                        ✓ Approve Exam
                      </button>
                      <button
                        onClick={() => handleReject(attemptDetail.attempt.id)}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition"
                      >
                        ✗ Reject / Disqualify
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-100 rounded-lg p-6 text-center">
                    <div className="text-lg font-semibold text-gray-700">Already Reviewed</div>
                    {attemptDetail.attempt.teacher_comments && (
                      <div className="mt-3 text-gray-600">
                        <div className="text-sm text-gray-500">Comments:</div>
                        <div className="italic">"{attemptDetail.attempt.teacher_comments}"</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Evidence modal */}
      {evidenceModal.isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeEvidenceModal(); }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">

            {/* Modal header */}
            <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-xl font-bold text-white">Violation Evidence</h3>
                <p className="text-red-100 text-sm">
                  {evidenceModal.violation?.violation_type_display ||
                   evidenceModal.violation?.violation_type?.replace(/_/g, ' ')}
                  {' · '}
                  {new Date(evidenceModal.violation?.timestamp).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-red-200 text-xs hidden sm:block">ESC to close</span>
                <button
                  onClick={closeEvidenceModal}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition"
                  aria-label="Close evidence modal"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal body — screenshot and/or audio */}
            <div className="p-6 flex flex-col gap-6 overflow-y-auto bg-gray-100 flex-1">
              {evidenceModal.url && (
                <div className="flex items-center justify-center">
                  <img
                    src={evidenceModal.url}
                    alt="Violation screenshot"
                    className="max-w-full max-h-[50vh] object-contain rounded-lg shadow-lg"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.alt = 'Screenshot not available';
                    }}
                  />
                </div>
              )}
              {evidenceModal.audioUrl && (
                <div className="bg-white p-6 rounded-lg shadow">
                  <div className="text-center mb-4">
                    <span className="text-5xl">🔊</span>
                    <p className="font-semibold mt-2 text-gray-700">Audio Recording</p>
                  </div>
                  <audio controls preload="none" className="w-full" src={evidenceModal.audioUrl}>
                    Your browser does not support the audio element.
                  </audio>
                </div>
              )}
              {!evidenceModal.url && !evidenceModal.audioUrl && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <span className="text-6xl mb-4">📋</span>
                  <p className="text-gray-600 font-semibold text-lg">No media evidence captured</p>
                  <p className="text-gray-400 text-sm mt-1">This violation was detected but no screenshot or audio was saved.</p>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t border-gray-200 px-6 py-4 bg-white shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Type:</span>
                  <span className="ml-2 font-semibold">
                    {evidenceModal.violation?.violation_type_display ||
                     evidenceModal.violation?.violation_type?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Severity:</span>
                  <span className="ml-2 font-semibold">{evidenceModal.violation?.severity || '—'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Time:</span>
                  <span className="ml-2 font-semibold">
                    {new Date(evidenceModal.violation?.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Penalty:</span>
                  <span className="ml-2 font-semibold text-red-600">
                    −{evidenceModal.violation?.penalty ?? 5} points
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewDashboard;