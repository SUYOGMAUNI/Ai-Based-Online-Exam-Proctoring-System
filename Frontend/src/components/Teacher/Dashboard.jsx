/*
Beautiful Teacher Dashboard - Exam Creation & Management
File: src/components/Teacher/Dashboard.jsx
*/

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const TeacherDashboard = () => {
  const [user, setUser] = useState(null);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState('exams'); // exams, review, stats

  const navigate = useNavigate();
  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  useEffect(() => {
    loadUserData();
    loadExams();
  }, []);

  const loadUserData = () => {
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    setUser(userData);
  };

  const loadExams = async () => {
    try {
      setLoading(true);
      const response = await api.get('/exams/');
      const examList = response.data.results || response.data;
      setExams(examList);

      // Auto-expire any published exams whose end_time has passed
      const now = new Date();

      // Auto-expire overdue exams
      const toExpire = examList.filter(e => {
        const endTime = e.end_time || e.end_datetime;
        return e.status === 'PUBLISHED' && endTime && new Date(endTime) < now;
      });

      // Auto-republish exams whose end_time was extended into the future
      const toRepublish = examList.filter(e => {
        const endTime = e.end_time || e.end_datetime;
        return e.status === 'COMPLETED' && endTime && new Date(endTime) > now;
      });

      const calls = [
        ...toExpire.map(e => api.post(`/exams/${e.id}/expire/`)),
        ...toRepublish.map(e => api.patch(`/exams/${e.id}/`, { status: 'PUBLISHED' })),
      ];

      if (calls.length > 0) {
        await Promise.allSettled(calls);
        const refreshed = await api.get('/exams/');
        setExams(refreshed.data.results || refreshed.data);
      }
    } catch (error) {
      console.error('Failed to load exams:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // Derive the real status client-side instantly, without waiting for backend.
  // Guards against both field name variants: end_time and end_datetime.
  const getEffectiveStatus = (exam) => {
    const endTime = exam.end_time || exam.end_datetime;
    const now = new Date();
    // PUBLISHED → COMPLETED when end time has passed
    if (exam.status === 'PUBLISHED' && endTime && new Date(endTime) < now) {
      return 'COMPLETED';
    }
    // COMPLETED → PUBLISHED when end time has been extended into the future
    if (exam.status === 'COMPLETED' && endTime && new Date(endTime) > now) {
      return 'PUBLISHED';
    }
    return exam.status;
  };

  const draftExams     = exams.filter(e => getEffectiveStatus(e) === 'DRAFT');
  const publishedExams = exams.filter(e => getEffectiveStatus(e) === 'PUBLISHED');
  const completedExams = exams.filter(e => getEffectiveStatus(e) === 'COMPLETED');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-2xl mr-3">👨‍🏫</span>
              <h1 className="text-xl font-bold text-gray-900">Teacher Dashboard</h1>
            </div>

            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/teacher/review')}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
              >
                Review Exams
              </button>

              <div className="text-right mr-4">
                <p className="text-sm font-medium text-gray-900">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-xs text-gray-500">Teacher</p>
              </div>
              
              <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-teal-500 rounded-full flex items-center justify-center text-white font-semibold">
                {user?.first_name?.[0]}{user?.last_name?.[0]}
              </div>

              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome, Prof. {user?.last_name}!
            </h2>
            <p className="text-gray-600">
              Manage your exams and review student attempts
            </p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-purple-700 transition transform hover:scale-105 shadow-lg flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create New Exam
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium">Total Exams</p>
                <p className="text-4xl font-bold mt-2">{exams.length}</p>
              </div>
              <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                <span className="text-3xl">📚</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-100 text-sm font-medium">Draft</p>
                <p className="text-4xl font-bold mt-2">{draftExams.length}</p>
              </div>
              <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                <span className="text-3xl">📝</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm font-medium">Published</p>
                <p className="text-4xl font-bold mt-2">{publishedExams.length}</p>
              </div>
              <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                <span className="text-3xl">✅</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm font-medium">Completed</p>
                <p className="text-4xl font-bold mt-2">{completedExams.length}</p>
              </div>
              <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                <span className="text-3xl">🏆</span>
              </div>
            </div>
          </div>
        </div>

        {/* Exam List */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-xl font-bold text-gray-900">Your Exams</h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : exams.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-6xl mb-4 block">📋</span>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No exams yet</h3>
              <p className="text-gray-600 mb-4">Create your first exam to get started</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
              >
                Create Exam
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Exam Title
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Questions
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Schedule
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {exams.map((exam) => (
                    <tr key={exam.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{exam.title}</div>
                        {exam.description && (
                          <div className="text-sm text-gray-500 mt-1 line-clamp-1">
                            {exam.description}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {exam.duration_minutes} min
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {exam.total_questions || 0}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {new Date(exam.start_time).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const status = getEffectiveStatus(exam);
                          return (
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              status === 'PUBLISHED'  ? 'bg-green-100 text-green-800' :
                              status === 'DRAFT'      ? 'bg-yellow-100 text-yellow-800' :
                              status === 'COMPLETED'  ? 'bg-gray-100 text-gray-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {status}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => navigate(`/teacher/exam/${exam.id}/edit`)}
                            className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                          >
                            Edit
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            onClick={() => navigate(`/teacher/exam/${exam.id}/results`)}
                            className="text-purple-600 hover:text-purple-800 font-medium text-sm"
                          >
                            Results
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create Exam Modal */}
      {showCreateModal && (
        <CreateExamModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            loadExams();
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
};

// Create Exam Modal Component
const CreateExamModal = ({ onClose, onSuccess }) => {
  const [step, setStep] = useState(1); // 1: Basic Info, 2: Questions, 3: Settings
  const [loading, setLoading] = useState(false);

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  const [examData, setExamData] = useState({
    title: '',
    description: '',
    duration_minutes: 60,
    total_marks: 100,
    passing_marks: 40,
    start_time: '',
    end_time: '',
    require_face_registration: true,
    require_gaze_calibration: true,
    enable_audio_monitoring: true,
    enable_tab_monitoring: true,
    enable_fullscreen_mode: true,
    trust_score_valid_threshold: 75,
    trust_score_review_threshold: 50,
  });

  const [questions, setQuestions] = useState([
    {
      question_number: 1,
      question_type: 'MCQ',
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_answer: '',
      marks: 1
    }
  ]);

  const handleSubmit = async () => {
    setLoading(true);

    try {
      // Create exam
      const examResponse = await axios.post(
        `${API_BASE}/exams/`,
        examData,
        { headers: { 'Authorization': `Token ${token}` }}
      );

      const examId = examResponse.data.id;

      // Create questions
      for (const question of questions) {
        await axios.post(
          `${API_BASE}/questions/`,
          { ...question, exam: examId },
          { headers: { 'Authorization': `Token ${token}` }}
        );
      }

      alert('Exam created successfully!');
      onSuccess();

    } catch (error) {
      console.error('Failed to create exam:', error);
      alert('Failed to create exam. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const addQuestion = () => {
    setQuestions([...questions, {
      question_number: questions.length + 1,
      question_type: 'MCQ',
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_answer: '',
      marks: 1
    }]);
  };

  const updateQuestion = (index, field, value) => {
    const updated = [...questions];
    updated[index][field] = value;
    setQuestions(updated);
  };

  const removeQuestion = (index) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full my-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white rounded-t-2xl">
          <h2 className="text-2xl font-bold">Create New Exam</h2>
          <p className="text-blue-100 mt-1">Step {step} of 3</p>
        </div>

        {/* Progress Bar */}
        <div className="h-2 bg-gray-200">
          <div 
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          ></div>
        </div>

        <div className="p-8 max-h-[calc(100vh-300px)] overflow-y-auto">
          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Exam Title *
                </label>
                <input
                  type="text"
                  value={examData.title}
                  onChange={(e) => setExamData({ ...examData, title: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Final Exam - Mathematics"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={examData.description}
                  onChange={(e) => setExamData({ ...examData, description: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows="3"
                  placeholder="Brief description of the exam"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Duration (minutes) *
                  </label>
                  <input
                    type="number"
                    value={examData.duration_minutes}
                    onChange={(e) => setExamData({ ...examData, duration_minutes: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="1"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Total Marks *
                  </label>
                  <input
                    type="number"
                    value={examData.total_marks}
                    onChange={(e) => setExamData({ ...examData, total_marks: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="1"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Time *
                  </label>
                  <input
                    type="datetime-local"
                    value={examData.start_time}
                    onChange={(e) => setExamData({ ...examData, start_time: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Time *
                  </label>
                  <input
                    type="datetime-local"
                    value={examData.end_time}
                    onChange={(e) => setExamData({ ...examData, end_time: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Questions */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-900">Add Questions</h3>
                <button
                  onClick={addQuestion}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Question
                </button>
              </div>

              {questions.map((q, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-4">
                  <div className="flex justify-between items-start">
                    <h4 className="font-semibold text-gray-900">Question {index + 1}</h4>
                    {questions.length > 1 && (
                      <button
                        onClick={() => removeQuestion(index)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Question Text *
                    </label>
                    <textarea
                      value={q.question_text}
                      onChange={(e) => updateQuestion(index, 'question_text', e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows="2"
                      placeholder="Enter your question"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {['a', 'b', 'c', 'd'].map(opt => (
                      <div key={opt}>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Option {opt.toUpperCase()}
                        </label>
                        <input
                          type="text"
                          value={q[`option_${opt}`]}
                          onChange={(e) => updateQuestion(index, `option_${opt}`, e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={`Option ${opt.toUpperCase()}`}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Correct Answer *
                      </label>
                      <input
                        type="text"
                        value={q.correct_answer}
                        onChange={(e) => updateQuestion(index, 'correct_answer', e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Enter correct option value"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Marks *
                      </label>
                      <input
                        type="number"
                        value={q.marks}
                        onChange={(e) => updateQuestion(index, 'marks', parseInt(e.target.value))}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        min="1"
                        required
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Proctoring Settings */}
          {step === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Proctoring Settings</h3>

              <div className="space-y-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={examData.require_face_registration}
                    onChange={(e) => setExamData({ ...examData, require_face_registration: e.target.checked })}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-700">Require Face Registration</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={examData.require_gaze_calibration}
                    onChange={(e) => setExamData({ ...examData, require_gaze_calibration: e.target.checked })}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-700">Require Gaze Calibration</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={examData.enable_audio_monitoring}
                    onChange={(e) => setExamData({ ...examData, enable_audio_monitoring: e.target.checked })}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-700">Enable Audio Monitoring</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={examData.enable_tab_monitoring}
                    onChange={(e) => setExamData({ ...examData, enable_tab_monitoring: e.target.checked })}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-700">Enable Tab/Window Monitoring</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={examData.enable_fullscreen_mode}
                    onChange={(e) => setExamData({ ...examData, enable_fullscreen_mode: e.target.checked })}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-700">Enforce Fullscreen Mode</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Trust Score - Valid Threshold
                  </label>
                  <input
                    type="number"
                    value={examData.trust_score_valid_threshold}
                    onChange={(e) => setExamData({ ...examData, trust_score_valid_threshold: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="0"
                    max="100"
                  />
                  <p className="text-xs text-gray-500 mt-1">Scores above this are auto-approved</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Trust Score - Review Threshold
                  </label>
                  <input
                    type="number"
                    value={examData.trust_score_review_threshold}
                    onChange={(e) => setExamData({ ...examData, trust_score_review_threshold: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="0"
                    max="100"
                  />
                  <p className="text-xs text-gray-500 mt-1">Scores between require manual review</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 flex justify-between">
          <button
            onClick={step === 1 ? onClose : () => setStep(step - 1)}
            className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-purple-700 transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Exam'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherDashboard;