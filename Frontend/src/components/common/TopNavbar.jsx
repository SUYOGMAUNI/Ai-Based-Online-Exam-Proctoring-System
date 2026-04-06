/*
Reusable Top Navigation Bar Component
File: src/components/common/TopNavbar.jsx

Features:
- Supports both student and teacher roles
- Displays user information
- Navigation buttons
- Logout functionality
- Customizable title and actions
*/

import React from 'react';
import { useNavigate } from 'react-router-dom';

const TopNavbar = ({ 
  title = "AI Proctoring System", 
  icon = "🎓",
  userRole = "student", // "student" or "teacher"
  showBackButton = false,
  backPath = null,
  additionalButtons = [],
  user = null
}) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/');
  };

  const getDefaultPath = () => {
    return userRole === 'teacher' ? '/teacher/dashboard' : '/student/dashboard';
  };

  const getUserFromStorage = () => {
    if (user) return user;
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  };

  const currentUser = getUserFromStorage();

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left side - Logo/Title */}
          <div className="flex items-center">
            {showBackButton && (
              <button
                onClick={() => navigate(backPath || getDefaultPath())}
                className="mr-4 px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
              >
                ← Back
              </button>
            )}
            <span className="text-2xl mr-3">{icon}</span>
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          </div>

          {/* Right side - Navigation buttons and user info */}
          <div className="flex items-center space-x-4">
            {/* Additional custom buttons */}
            {additionalButtons.map((button, index) => (
              <button
                key={index}
                onClick={button.onClick}
                className={button.className || "px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"}
              >
                {button.icon && <span className="mr-2">{button.icon}</span>}
                {button.label}
              </button>
            ))}

            {/* User info */}
            {currentUser && currentUser.username && (
              <>
                <div className="text-right mr-4 hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">
                    {currentUser.first_name} {currentUser.last_name}
                  </p>
                  <p className="text-xs text-gray-500">{currentUser.username}</p>
                </div>
                
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                  {currentUser.first_name?.[0]}{currentUser.last_name?.[0]}
                </div>
              </>
            )}

            {/* Logout button */}
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
  );
};

export default TopNavbar;