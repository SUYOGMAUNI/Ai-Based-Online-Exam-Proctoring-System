/*
Edit Exam Component - FIXED
Fixes applied:
  1. loadQuestions now receives examId as a parameter — prevents stale closure from
     pulling questions that belong to a different exam.
  2. Extra client-side filter: only keep questions whose .exam matches the current examId.
  3. handleQuestionChange uses .map() + spread to create a new object, so React
     reliably re-renders radio buttons and inputs (was mutating in place before).
  4. radio button `name` uses question.id (or a stable new-item key) instead of just
     the array index, so buttons across different questions never share a name group.
*/

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import TopNavbar from '../common/TopNavbar';

const EditExam = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [error, setError] = useState(null);

  const API_BASE = 'http://localhost:8000/api';
  const token = localStorage.getItem('token');

  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Authorization': `Token ${token}` }
  });

  useEffect(() => {
    loadExam();
  }, [examId]);

  const loadExam = async () => {
    try {
      const response = await api.get(`/exams/${examId}/`);
      setExam(response.data);
      // FIX 1: pass examId explicitly so the function never relies on a stale closure
      await loadQuestions(examId);
    } catch (error) {
      console.error('Failed to load exam:', error);
      setError('Failed to load exam');
      alert('Failed to load exam');
    } finally {
      setLoading(false);
    }
  };

  // FIX 1: accept id as a parameter instead of closing over the state variable
  const loadQuestions = async (id) => {
    try {
      const response = await api.get(`/questions/?exam=${id}`);
      const questionsData = response.data.results || response.data;
      // FIX 2: extra safety filter — only keep questions that actually belong to this exam
      const filtered = questionsData.filter(q => String(q.exam) === String(id));
      const sorted = filtered.sort((a, b) => a.question_number - b.question_number);
      setQuestions(sorted);
    } catch (error) {
      console.error('Failed to load questions:', error);
      if (error.response?.status !== 404) {
        setError('Failed to load questions');
      }
    }
  };

  const handleSaveExam = async () => {
    try {
      setSaving(true);
      setError(null);
      await api.put(`/exams/${examId}/`, exam);
      alert('Exam details updated successfully!');
    } catch (error) {
      console.error('Failed to update exam:', error);
      setError('Failed to update exam details');
      alert('Failed to update exam details');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveQuestions = async () => {
    try {
      setSaving(true);
      setError(null);

      for (const question of questions) {
        const questionData = {
          exam: examId,
          question_number: question.question_number,
          question_type: question.question_type,
          question_text: question.question_text,
          marks: question.marks,
        };

        if (question.question_type === 'MCQ') {
          questionData.option_a = question.option_a || '';
          questionData.option_b = question.option_b || '';
          questionData.option_c = question.option_c || '';
          questionData.option_d = question.option_d || '';
          // Store the letter (A/B/C/D) — backend uses this to look up the correct option text for grading
          questionData.correct_answer = question.correct_answer;
        } else if (question.question_type === 'TRUE_FALSE') {
          // FIX: store "True"/"False" text instead of "A"/"B"
          questionData.correct_answer = question.correct_answer === 'A' ? 'True' : 'False';
          questionData.option_a = 'True';
          questionData.option_b = 'False';
          questionData.option_c = '';
          questionData.option_d = '';
        } else if (question.question_type === 'SHORT_ANSWER') {
          // FIX: preserve the teacher's typed correct answer instead of wiping it
          questionData.correct_answer = question.correct_answer || '';
          questionData.option_a = '';
          questionData.option_b = '';
          questionData.option_c = '';
          questionData.option_d = '';
        }

        if (question.id) {
          await api.put(`/questions/${question.id}/`, questionData);
        } else {
          const response = await api.post(`/questions/`, questionData);
          question.id = response.data.id;
        }
      }

      alert('All questions saved successfully!');
      await loadExam();
    } catch (error) {
      console.error('Failed to save questions:', error);
      setError(error.response?.data?.detail || 'Failed to save questions');
      alert(`Failed to save questions: ${error.response?.data?.detail || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = () => {
    const newQuestion = {
      question_number: questions.length + 1,
      question_type: 'MCQ',
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_answer: 'A',
      marks: 1,
      exam: examId
    };
    setQuestions([...questions, newQuestion]);
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 100);
  };

  const handleRemoveQuestion = async (index) => {
    const question = questions[index];

    if (question.id) {
      if (!window.confirm('Are you sure you want to delete this question?')) return;
      try {
        await api.delete(`/questions/${question.id}/`);
        alert('Question deleted successfully');
      } catch (error) {
        console.error('Failed to delete question:', error);
        alert('Failed to delete question');
        return;
      }
    }

    const newQuestions = questions.filter((_, i) => i !== index);
    const renumbered = newQuestions.map((q, i) => ({ ...q, question_number: i + 1 }));
    setQuestions(renumbered);
  };

  // FIX 3: use .map() + object spread so React detects the state change and re-renders
  const handleQuestionChange = (index, field, value) => {
    setQuestions(questions.map((q, i) =>
      i === index ? { ...q, [field]: value } : q
    ));
  };

  const handleMoveQuestion = (index, direction) => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === questions.length - 1)
    ) return;

    const newQuestions = [...questions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newQuestions[index], newQuestions[targetIndex]] = [newQuestions[targetIndex], newQuestions[index]];
    newQuestions.forEach((q, i) => { q.question_number = i + 1; });
    setQuestions(newQuestions);
  };

  const handleDeleteExam = async () => {
    if (!window.confirm('Are you sure you want to delete this exam? This cannot be undone.')) return;
    try {
      await api.delete(`/exams/${examId}/`);
      alert('Exam deleted successfully');
      navigate('/teacher/dashboard');
    } catch (error) {
      console.error('Failed to delete exam:', error);
      alert('Failed to delete exam');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!exam) {
    return (
      <>
        <TopNavbar
          title="Edit Exam"
          icon="📝"
          userRole="teacher"
          showBackButton={true}
          backPath="/teacher/dashboard"
        />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Exam Not Found</h2>
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNavbar
        title="Edit Exam"
        icon="📝"
        userRole="teacher"
        showBackButton={true}
        backPath="/teacher/dashboard"
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <span className="text-red-600 mr-2">⚠️</span>
              <p className="text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-t-xl shadow-md border-b">
          <div className="flex">
            {[['details', '📋 Exam Details'], ['questions', `❓ Questions (${questions.length})`]].map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-6 py-4 text-center font-semibold transition ${
                  activeTab === tab
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Details Tab */}
        {activeTab === 'details' && (
          <div className="bg-white rounded-b-xl shadow-md p-8">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Exam Title *</label>
                <input
                  type="text"
                  value={exam.title}
                  onChange={(e) => setExam({ ...exam, title: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Midterm Exam - Computer Science"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Course Code *</label>
                <input
                  type="text"
                  value={exam.course_code}
                  onChange={(e) => setExam({ ...exam, course_code: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., CS101"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={exam.description || ''}
                  onChange={(e) => setExam({ ...exam, description: e.target.value })}
                  rows="3"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Brief description of the exam"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Duration (minutes) *</label>
                  <input
                    type="number"
                    value={exam.duration}
                    onChange={(e) => setExam({ ...exam, duration: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Total Marks *</label>
                  <input
                    type="number"
                    value={exam.total_marks}
                    onChange={(e) => setExam({ ...exam, total_marks: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date & Time *</label>
                  <input
                    type="datetime-local"
                    value={exam.start_time?.slice(0, 16)}
			onChange={(e) => setExam({ ...exam, start_time: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date & Time *</label>
                  <input
                    type="datetime-local"
                    value={exam.end_time?.slice(0, 16)}
		    onChange={(e) => setExam({ ...exam, end_time: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={exam.status}
                  onChange={(e) => setExam({ ...exam, status: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>

              {/* Proctoring Settings */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Proctoring Settings</h3>
                <div className="space-y-3">
                  {[
                    ['require_face_registration', 'Require Face Registration'],
                    ['require_gaze_calibration', 'Require Gaze Calibration'],
                    ['enable_audio_monitoring', 'Enable Audio Monitoring'],
                    ['enable_tab_monitoring', 'Enable Tab/Window Monitoring'],
                    ['enable_fullscreen_mode', 'Enable Fullscreen Mode'],
                  ].map(([field, label]) => (
                    <label key={field} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={exam[field] || false}
                        onChange={(e) => setExam({ ...exam, [field]: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-between pt-6 border-t">
                <button
                  onClick={handleDeleteExam}
                  className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition"
                >
                  Delete Exam
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => navigate('/teacher/dashboard')}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveExam}
                    disabled={saving}
                    className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Questions Tab */}
        {activeTab === 'questions' && (
          <div className="bg-white rounded-b-xl shadow-md p-8">
            <div className="space-y-6">
              <div className="flex justify-between items-center pb-4 border-b">
                <h2 className="text-xl font-bold text-gray-900">
                  Manage Questions ({questions.length})
                </h2>
                <button
                  onClick={handleAddQuestion}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                >
                  <span className="text-xl">+</span>
                  Add Question
                </button>
              </div>

              {questions.length === 0 ? (
                <div className="bg-gray-50 rounded-xl p-12 text-center">
                  <span className="text-6xl mb-4 block">📝</span>
                  <p className="text-gray-500 text-lg mb-6">No questions added yet</p>
                  <button
                    onClick={handleAddQuestion}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition inline-flex items-center gap-2"
                  >
                    <span className="text-xl">+</span>
                    Add Your First Question
                  </button>
                </div>
              ) : (
                <>
                  {questions.map((question, index) => (
                    // FIX 4: use a stable key so React doesn't confuse cards across renders
                    <div key={question.id ?? `new-${index}`} className="bg-gray-50 rounded-xl shadow-sm p-6 border border-gray-200 hover:border-blue-300 transition">
                      {/* Question Header */}
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-lg font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                            Q{question.question_number}
                          </span>
                          <select
                            value={question.question_type}
                            onChange={(e) => handleQuestionChange(index, 'question_type', e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="MCQ">Multiple Choice</option>
                            <option value="TRUE_FALSE">True/False</option>
                            <option value="SHORT_ANSWER">Short Answer</option>
                          </select>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={question.marks}
                              onChange={(e) => handleQuestionChange(index, 'marks', parseInt(e.target.value))}
                              className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                              placeholder="Marks"
                              min="1"
                            />
                            <span className="text-sm text-gray-600 font-medium">marks</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleMoveQuestion(index, 'up')}
                            disabled={index === 0}
                            className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition"
                            title="Move Up"
                          >↑</button>
                          <button
                            onClick={() => handleMoveQuestion(index, 'down')}
                            disabled={index === questions.length - 1}
                            className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition"
                            title="Move Down"
                          >↓</button>
                          <button
                            onClick={() => handleRemoveQuestion(index)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="Delete Question"
                          >🗑️</button>
                        </div>
                      </div>

                      {/* Question Text */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Question Text *</label>
                        <textarea
                          value={question.question_text}
                          onChange={(e) => handleQuestionChange(index, 'question_text', e.target.value)}
                          placeholder="Enter your question here..."
                          rows="3"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        />
                      </div>

                      {/* MCQ Options */}
                      {question.question_type === 'MCQ' && (
                        <div className="space-y-3">
                          {/* Option text inputs */}
                          <label className="block text-sm font-medium text-gray-700 mb-2">Answer Options</label>
                          {['A', 'B', 'C', 'D'].map((option) => (
                            <div key={option} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-gray-200">
                              <span className="font-semibold text-gray-700 w-8 text-center">{option}</span>
                              <input
                                type="text"
                                value={question[`option_${option.toLowerCase()}`] || ''}
                                onChange={(e) => handleQuestionChange(index, `option_${option.toLowerCase()}`, e.target.value)}
                                placeholder={`Option ${option}`}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                            </div>
                          ))}

                          {/* Correct answer selector */}
                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Correct Answer</label>
                            <div className="flex gap-3">
                              {['A', 'B', 'C', 'D'].map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => handleQuestionChange(index, 'correct_answer', option)}
                                  className={`w-12 h-12 rounded-lg border-2 font-bold text-sm transition ${
                                    question.correct_answer === option
                                      ? 'bg-green-500 border-green-500 text-white shadow-md'
                                      : 'bg-white border-gray-300 text-gray-600 hover:border-green-400 hover:text-green-600'
                                  }`}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                            {question.correct_answer && (
                              <p className="text-sm text-green-600 mt-2">
                                ✓ Correct answer: <strong>{question.correct_answer}</strong>
                                {question[`option_${question.correct_answer.toLowerCase()}`]
                                  ? ` — "${question[`option_${question.correct_answer.toLowerCase()}`]}"`
                                  : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* True/False Options */}
                      {question.question_type === 'TRUE_FALSE' && (
                        <div className="space-y-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Correct Answer</label>
                          <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-3">
                            {[['A', 'True'], ['B', 'False']].map(([val, label]) => (
                              <div key={val} className="flex items-center gap-3">
                                <input
                                  type="radio"
                                  name={`correct-${question.id ?? `new-${index}`}`}
                                  checked={question.correct_answer === val}
                                  onChange={() => handleQuestionChange(index, 'correct_answer', val)}
                                  className="h-5 w-5 text-green-600 focus:ring-green-500 cursor-pointer"
                                />
                                <span className="font-semibold text-gray-700 text-lg">{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Short Answer */}
                      {question.question_type === 'SHORT_ANSWER' && (
                        <div className="space-y-3">
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-800">
                              ℹ️ Enter the expected correct answer below for auto-grading, or leave blank to grade manually.
                            </p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Correct Answer (optional)
                            </label>
                            <input
                              type="text"
                              value={question.correct_answer || ''}
                              onChange={(e) => handleQuestionChange(index, 'correct_answer', e.target.value)}
                              placeholder="Enter expected answer for auto-grading..."
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="flex justify-center pt-4">
                    <button
                      onClick={handleAddQuestion}
                      className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                    >
                      <span className="text-xl">+</span>
                      Add Another Question
                    </button>
                  </div>
                </>
              )}

              {questions.length > 0 && (
                <div className="flex justify-end gap-3 pt-6 border-t">
                  <button
                    onClick={() => navigate('/teacher/dashboard')}
                    className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveQuestions}
                    disabled={saving}
                    className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50 shadow-md"
                  >
                    {saving ? 'Saving Questions...' : 'Save All Questions'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditExam;