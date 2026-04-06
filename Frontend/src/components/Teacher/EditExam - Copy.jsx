/*
Edit Exam Component with Full Question Management
File: src/components/Teacher/EditExam.jsx
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
  const [activeTab, setActiveTab] = useState('details'); // 'details' or 'questions'

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
      // Load questions if they're included in the response
      if (response.data.questions) {
        setQuestions(response.data.questions);
      } else {
        // If questions aren't included, fetch them separately
        loadQuestions();
      }
    } catch (error) {
      console.error('Failed to load exam:', error);
      alert('Failed to load exam');
    } finally {
      setLoading(false);
    }
  };

  const loadQuestions = async () => {
    try {
      const response = await api.get(`/exams/${examId}/questions/`);
      setQuestions(response.data);
    } catch (error) {
      console.error('Failed to load questions:', error);
    }
  };

  const handleSaveExam = async () => {
    try {
      setSaving(true);
      await api.put(`/exams/${examId}/`, exam);
      alert('Exam details updated successfully!');
    } catch (error) {
      console.error('Failed to update exam:', error);
      alert('Failed to update exam details');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveQuestions = async () => {
    try {
      setSaving(true);
      
      // Save each question
      for (const question of questions) {
        if (question.id) {
          // Update existing question
          await api.put(`/questions/${question.id}/`, question);
        } else {
          // Create new question
          await api.post(`/questions/`, {
            ...question,
            exam: examId
          });
        }
      }
      
      alert('Questions saved successfully!');
      loadExam(); // Reload to get updated data
    } catch (error) {
      console.error('Failed to save questions:', error);
      alert('Failed to save questions');
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
  };

  const handleRemoveQuestion = async (index) => {
    const question = questions[index];
    
    if (question.id) {
      // If question exists in database, delete it
      if (!window.confirm('Are you sure you want to delete this question?')) {
        return;
      }
      
      try {
        await api.delete(`/questions/${question.id}/`);
        alert('Question deleted successfully');
      } catch (error) {
        console.error('Failed to delete question:', error);
        alert('Failed to delete question');
        return;
      }
    }
    
    // Remove from local state
    const newQuestions = questions.filter((_, i) => i !== index);
    // Renumber questions
    const renumberedQuestions = newQuestions.map((q, i) => ({
      ...q,
      question_number: i + 1
    }));
    setQuestions(renumberedQuestions);
  };

  const handleQuestionChange = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index][field] = value;
    setQuestions(newQuestions);
  };

  const handleMoveQuestion = (index, direction) => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === questions.length - 1)
    ) {
      return;
    }

    const newQuestions = [...questions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    // Swap questions
    [newQuestions[index], newQuestions[targetIndex]] = 
    [newQuestions[targetIndex], newQuestions[index]];
    
    // Renumber
    newQuestions.forEach((q, i) => {
      q.question_number = i + 1;
    });
    
    setQuestions(newQuestions);
  };

  const handleDeleteExam = async () => {
    if (!window.confirm('Are you sure you want to delete this exam? This cannot be undone.')) {
      return;
    }

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
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
      {/* Top Navigation Bar */}
      <TopNavbar 
        title="Edit Exam"
        icon="📝"
        userRole="teacher"
        showBackButton={true}
        backPath="/teacher/dashboard"
      />

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="mb-6 border-b border-gray-200">
          <div className="flex space-x-8">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'details'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📋 Exam Details
            </button>
            <button
              onClick={() => setActiveTab('questions')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === 'questions'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              ❓ Questions ({questions.length})
            </button>
          </div>
        </div>

        {/* Exam Details Tab */}
        {activeTab === 'details' && (
          <div className="bg-white rounded-xl shadow-md p-8">
            <div className="space-y-6">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Exam Title
                </label>
                <input
                  type="text"
                  value={exam.title}
                  onChange={(e) => setExam({ ...exam, title: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={exam.description || ''}
                  onChange={(e) => setExam({ ...exam, description: e.target.value })}
                  rows="3"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Duration and Marks */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    value={exam.duration_minutes}
                    onChange={(e) => setExam({ ...exam, duration_minutes: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Total Marks
                  </label>
                  <input
                    type="number"
                    value={exam.total_marks}
                    onChange={(e) => setExam({ ...exam, total_marks: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Passing Marks */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Passing Marks
                </label>
                <input
                  type="number"
                  value={exam.passing_marks || 0}
                  onChange={(e) => setExam({ ...exam, passing_marks: parseInt(e.target.value) })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Start and End Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Time
                  </label>
                  <input
                    type="datetime-local"
                    value={exam.start_time ? exam.start_time.slice(0, 16) : ''}
                    onChange={(e) => setExam({ ...exam, start_time: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Time
                  </label>
                  <input
                    type="datetime-local"
                    value={exam.end_time ? exam.end_time.slice(0, 16) : ''}
                    onChange={(e) => setExam({ ...exam, end_time: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
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
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Proctoring Settings</h3>
                <div className="space-y-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={exam.require_face_registration || false}
                      onChange={(e) => setExam({ ...exam, require_face_registration: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Require Face Registration</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={exam.require_gaze_calibration || false}
                      onChange={(e) => setExam({ ...exam, require_gaze_calibration: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Require Gaze Calibration</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={exam.enable_audio_monitoring || false}
                      onChange={(e) => setExam({ ...exam, enable_audio_monitoring: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Enable Audio Monitoring</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={exam.enable_tab_monitoring || false}
                      onChange={(e) => setExam({ ...exam, enable_tab_monitoring: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Enable Tab Monitoring</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={exam.enable_fullscreen_mode || false}
                      onChange={(e) => setExam({ ...exam, enable_fullscreen_mode: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Enable Fullscreen Mode</span>
                  </label>
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
          <div className="space-y-6">
            {/* Add Question Button */}
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                Manage Questions ({questions.length})
              </h2>
              <button
                onClick={handleAddQuestion}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2"
              >
                <span className="text-xl">+</span>
                Add Question
              </button>
            </div>

            {/* Questions List */}
            {questions.length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-12 text-center">
                <p className="text-gray-500 text-lg mb-4">No questions added yet</p>
                <button
                  onClick={handleAddQuestion}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Add Your First Question
                </button>
              </div>
            ) : (
              questions.map((question, index) => (
                <div key={index} className="bg-white rounded-xl shadow-md p-6">
                  {/* Question Header */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-gray-900">
                        Q{question.question_number}
                      </span>
                      <select
                        value={question.question_type}
                        onChange={(e) => handleQuestionChange(index, 'question_type', e.target.value)}
                        className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="MCQ">Multiple Choice</option>
                        <option value="TRUE_FALSE">True/False</option>
                        <option value="SHORT_ANSWER">Short Answer</option>
                      </select>
                      <input
                        type="number"
                        value={question.marks}
                        onChange={(e) => handleQuestionChange(index, 'marks', parseInt(e.target.value))}
                        className="w-20 px-3 py-1 border border-gray-300 rounded-lg text-sm"
                        placeholder="Marks"
                      />
                      <span className="text-sm text-gray-500">marks</span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleMoveQuestion(index, 'up')}
                        disabled={index === 0}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move Up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMoveQuestion(index, 'down')}
                        disabled={index === questions.length - 1}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move Down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => handleRemoveQuestion(index)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete Question"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Question Text */}
                  <div className="mb-4">
                    <textarea
                      value={question.question_text}
                      onChange={(e) => handleQuestionChange(index, 'question_text', e.target.value)}
                      placeholder="Enter question text..."
                      rows="2"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  {/* Options (for MCQ) */}
                  {question.question_type === 'MCQ' && (
                    <div className="space-y-3">
                      {['A', 'B', 'C', 'D'].map((option) => (
                        <div key={option} className="flex items-center gap-3">
                          <input
                            type="radio"
                            name={`correct-${index}`}
                            checked={question.correct_answer === option}
                            onChange={() => handleQuestionChange(index, 'correct_answer', option)}
                            className="h-4 w-4 text-green-600 focus:ring-green-500"
                          />
                          <span className="font-semibold text-gray-700 w-6">{option}.</span>
                          <input
                            type="text"
                            value={question[`option_${option.toLowerCase()}`]}
                            onChange={(e) => handleQuestionChange(index, `option_${option.toLowerCase()}`, e.target.value)}
                            placeholder={`Option ${option}`}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                        </div>
                      ))}
                      <p className="text-sm text-gray-500 mt-2">
                        ✓ Select the correct answer by clicking the radio button
                      </p>
                    </div>
                  )}

                  {/* True/False Options */}
                  {question.question_type === 'TRUE_FALSE' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name={`correct-${index}`}
                          checked={question.correct_answer === 'A'}
                          onChange={() => handleQuestionChange(index, 'correct_answer', 'A')}
                          className="h-4 w-4 text-green-600 focus:ring-green-500"
                        />
                        <span className="font-semibold text-gray-700">True</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name={`correct-${index}`}
                          checked={question.correct_answer === 'B'}
                          onChange={() => handleQuestionChange(index, 'correct_answer', 'B')}
                          className="h-4 w-4 text-green-600 focus:ring-green-500"
                        />
                        <span className="font-semibold text-gray-700">False</span>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Save Questions Button */}
            {questions.length > 0 && (
              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => navigate('/teacher/dashboard')}
                  className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveQuestions}
                  disabled={saving}
                  className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save All Questions'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EditExam;