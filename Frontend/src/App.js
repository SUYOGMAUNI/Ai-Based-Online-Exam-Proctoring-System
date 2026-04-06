import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AuthPage from './components/Auth/Login';
import StudentDashboard from './components/Student/Dashboard';
import StudentResults from './components/Student/StudentResults';
import ExamInterface from './components/Student/ExamInterface';
import TeacherDashboard from './components/Teacher/Dashboard';
import ReviewDashboard from './components/Teacher/ReviewDashboard';
import EditExam from './components/Teacher/EditExam';
import ExamResults from './components/Teacher/ExamResults';  // ← ADD THIS LINE
import FaceRegistration from './components/Student/FaceRegistration';

// Protected Route Component
const ProtectedRoute = ({ children, allowedUserTypes }) => {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (allowedUserTypes && !allowedUserTypes.includes(user.user_type)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<AuthPage />} />
        <Route path="/login" element={<AuthPage />} />

        {/* Student Routes */}
        <Route
          path="/student/dashboard"
          element={
            <ProtectedRoute allowedUserTypes={['STUDENT']}>
              <StudentDashboard />
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/student/face-registration"
          element={
            <ProtectedRoute allowedUserTypes={['STUDENT']}>
              <FaceRegistration />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/results"
          element={
            <ProtectedRoute allowedUserTypes={['STUDENT']}>
              <StudentResults />
            </ProtectedRoute>
          }
        />

        <Route
          path="/exam/:examId"
          element={
            <ProtectedRoute allowedUserTypes={['STUDENT']}>
              <ExamInterface />
            </ProtectedRoute>
          }
        />

        {/* Teacher Routes */}
        <Route
          path="/teacher/dashboard"
          element={
            <ProtectedRoute allowedUserTypes={['TEACHER']}>
              <TeacherDashboard />
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/teacher/review"
          element={
            <ProtectedRoute allowedUserTypes={['TEACHER']}>
              <ReviewDashboard />
            </ProtectedRoute>
          }
        />

        {/* REPLACE THE EDIT ROUTE WITH THIS: */}
        <Route
          path="/teacher/exam/:examId/edit"
          element={
            <ProtectedRoute allowedUserTypes={['TEACHER']}>
              <EditExam />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/exam/:examId/results"
          element={
            <ProtectedRoute allowedUserTypes={['TEACHER']}>
              <ExamResults />
            </ProtectedRoute>
          }
        />

        {/* Catch all - redirect to login */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;