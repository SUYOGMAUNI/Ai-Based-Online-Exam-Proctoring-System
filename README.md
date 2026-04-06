```markdown
# 🎓 AI-Based Online Exam Proctoring System

<div align="center">

![Python](https://img.shields.io/badge/Python-3.8+-blue?style=for-the-badge&logo=python)
![Django](https://img.shields.io/badge/Django-REST-green?style=for-the-badge&logo=django)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![PyTorch](https://img.shields.io/badge/PyTorch-AI-EE4C2C?style=for-the-badge&logo=pytorch)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Vision-FF6F00?style=for-the-badge&logo=google)
![TailwindCSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=for-the-badge&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-316192?style=for-the-badge&logo=postgresql)

A full-stack AI-powered online exam proctoring platform that ensures academic integrity through real-time facial recognition, gaze tracking, audio analysis, and behavioral monitoring — with automated violation logging and a teacher review dashboard.

</div>

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [AI Pipelines](#-ai-pipelines)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [Author](#-author)

---

## 🧠 Overview

The **AI-Based Online Exam Proctoring System** replicates the experience of an in-person proctored exam in an online environment. It combines multiple AI models and browser-level security mechanisms to detect cheating attempts, verify student identity, and generate detailed violation reports — all in real time.

Teachers can create and manage exams, review AI-generated violation logs, and analyze student behavior during the exam. Students go through a face registration process before the exam and are continuously monitored throughout via webcam and microphone.

---

## ✨ Features

### 👨‍🏫 Teacher Side
- Create, edit, publish, and delete exams with custom questions
- Set exam duration and instructions
- View per-student violation reports with timestamps and evidence
- Review dashboard with AI-flagged incidents
- Recalculate trust scores per attempt
- Access full exam results and scores

### 👨‍🎓 Student Side
- Secure login and face registration before the exam
- Real-time AI proctoring throughout the exam
- Fullscreen lock — exam auto-flags if exited
- Tab switch detection and blocking
- DevTools blocker to prevent console access
- Clean and intuitive exam interface

### 🤖 AI Monitoring
- **Face verification** — confirms student identity at exam start and continuously
- **Gaze / head-pose tracking** — detects when the student looks away from the screen
- **Audio monitoring** — detects background voices or suspicious noise
- **Multi-face detection** — flags if another person enters the frame
- All violations are timestamped, stored in PostgreSQL, and available for teacher review

---

## 🔬 AI Pipelines

### 1. 🧍 Face Recognition Pipeline
**File:** `backend/ai_engine/new_face.py`

Uses **Dlib's ResNet-based face recognition model** along with the **68-point facial landmark predictor** to:
- Register a student's face encoding during the pre-exam registration step
- Compare live webcam frames against the stored encoding throughout the exam
- Detect if the registered student is no longer present or if an unknown face appears
- Flag multi-person detection (more than one face in frame)

**Models used:**
- `ai_models/dlib/dlib_face_recognition_resnet_model_v1.dat` — generates 128-dimensional face encodings
- `ai_models/dlib/shape_predictor_68_face_landmarks.dat` — detects facial landmarks for alignment

---

### 2. 👁️ Gaze & Head-Pose Tracking Pipeline
**Files:** `backend/ai_engine/gaze1.py`, `backend/ai_engine/gaze2.py`

Uses **MediaPipe** for facial landmark extraction combined with a custom-trained **PyTorch gaze estimation model**:
- `gaze1.py` — handles frame preprocessing and eye/face region extraction using MediaPipe landmarks
- `gaze2.py` — runs inference on the extracted regions using the trained PyTorch model, classifies gaze direction (left, right, up, center), and flags sustained deviation as a violation

**Model used:**
- `ai_models/gaze/best_model.pth` — custom trained gaze estimation network

---

### 3. 🎙️ Audio Monitoring Pipeline
**File:** `backend/ai_engine/audio.py`

Processes audio chunks submitted from the frontend:
- Analyzes ambient audio for suspicious noise levels
- Detects the presence of multiple voices or conversation
- Saves audio captures as evidence to `media/audio_captures/`
- Flags audio violations with timestamps in the proctoring log

---

### 4. 🧩 Proctoring Pipeline (Orchestrator)
**File:** `backend/ai_engine/proctoring_pipeline.py`

The central coordinator that ties all AI modules together:
- Receives video frames and audio chunks from the frontend via the API
- Routes data to the appropriate AI module (face, gaze, audio)
- Aggregates results and determines violation type and severity
- Writes violation records to the database via `db_utils.py`
- Manages model lifecycle through `model_manager.py`

---

### 5. 🔧 Model Manager
**File:** `backend/ai_engine/model_manager.py`

Handles all AI model lifecycle management:
- Lazy loading — models are loaded on first use to avoid startup overhead
- In-memory caching for fast repeated inference
- Initializes Dlib models for face recognition and landmark detection
- Graceful fallback if a model file is missing or corrupted

---

### 6. 🗃️ Extractor Manager
**File:** `backend/ai_engine/extractor_manager.py`

Coordinates feature extraction across pipelines:
- Manages face encoding extraction for registration and live verification
- Handles frame batching for efficient processing under load
- Acts as the interface layer between raw webcam data and AI model inputs

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Tailwind CSS |
| Backend | Django, Django REST Framework |
| Authentication | DRF Token Authentication |
| AI / ML | Dlib, PyTorch, MediaPipe, OpenCV |
| Database | PostgreSQL |
| Media Storage | Django media file handling |

---

## 📁 Project Structure

```
Ai-Based-Online-Exam-Proctoring-System/
│
├── Frontend/                              # React.js frontend
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.js                         # Root component & routing
│       ├── index.js                       # Entry point
│       ├── index.css                      # Global styles
│       │
│       ├── components/
│       │   ├── Auth/
│       │   │   └── Login.jsx              # Login page
│       │   │
│       │   ├── Student/
│       │   │   ├── Dashboard.jsx          # Student home dashboard
│       │   │   ├── ExamInterface.jsx      # Live exam UI with proctoring
│       │   │   ├── ExamPage.jsx           # Exam entry and setup
│       │   │   ├── Examstartmodal.jsx     # Pre-exam confirmation modal
│       │   │   ├── FaceRegistration.jsx   # Face capture & registration
│       │   │   └── StudentResults.jsx     # Post-exam results view
│       │   │
│       │   ├── Teacher/
│       │   │   ├── Dashboard.jsx          # Teacher home dashboard
│       │   │   ├── EditExam.jsx           # Exam creation & editing
│       │   │   ├── ExamResults.jsx        # View student scores
│       │   │   └── ReviewDashboard.jsx    # AI violation review panel
│       │   │
│       │   ├── Proctoring/
│       │   │   ├── ExamProctoring.jsx     # Core proctoring component
│       │   │   ├── FullscreenLock.jsx     # Enforces fullscreen mode
│       │   │   ├── TabLockMonitor.jsx     # Detects tab switches
│       │   │   └── DevToolsBlocker.jsx    # Blocks browser DevTools
│       │   │
│       │   └── common/
│       │       ├── Navbar.jsx
│       │       ├── TopNavbar.jsx
│       │       ├── Loading.jsx
│       │       └── ProtectedRoute.jsx
│       │
│       ├── hooks/
│       │   ├── useAIProctoring.js         # Custom hook for AI proctoring logic
│       │   ├── useAudioMonitoring.js      # Custom hook for audio capture
│       │   └── useAuth.js                 # Authentication state hook
│       │
│       ├── services/
│       │   ├── api.js                     # Axios API client
│       │   └── auth.js                    # Auth service (login/logout/token)
│       │
│       └── utils/
│           └── constants.js               # App-wide constants
│
└── backend/                               # Django backend
    ├── ai_engine/                         # Core AI processing modules
    │   ├── proctoring_pipeline.py         # Main AI orchestrator
    │   ├── new_face.py                    # Face recognition logic
    │   ├── gaze1.py                       # Gaze preprocessing (MediaPipe)
    │   ├── gaze2.py                       # Gaze model inference (PyTorch)
    │   ├── audio.py                       # Audio monitoring
    │   ├── model_manager.py               # Model loading & caching
    │   ├── extractor_manager.py           # Feature extraction coordinator
    │   ├── db_utils.py                    # Database write helpers
    │   └── config.py                      # AI engine configuration
    │
    ├── ai_models/                         # Pretrained model files
    │   ├── dlib/
    │   │   ├── dlib_face_recognition_resnet_model_v1.dat
    │   │   └── shape_predictor_68_face_landmarks.dat
    │   └── gaze/
    │       └── best_model.pth             # Custom gaze estimation model
    │
    ├── apps/
    │   ├── users/                         # User model & token auth
    │   ├── exams/                         # Exam & question models
    │   └── proctoring/                    # Violation & session models
    │
    ├── config/                            # Django project config
    │   ├── settings.py
    │   ├── urls.py
    │   ├── asgi.py
    │   └── wsgi.py
    │
    ├── media/                             # Captured media storage
    │   ├── face_registrations/
    │   ├── face_captures/
    │   ├── audio_captures/
    │   ├── gaze_captures/
    │   └── logs/
    │
    ├── manage.py
    └── requirements.txt
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- Node.js 16+
- PostgreSQL (running locally)
- pip & npm

### ⚠️ Installing Dlib on Windows

Dlib requires CMake and a C++ build toolchain. Try:

```bash
pip install cmake
pip install dlib
```

If that fails, download a prebuilt wheel matching your Python version from [github.com/sachadee/Dlib](https://github.com/sachadee/Dlib) and install with:

```bash
pip install dlib-19.x.x-cpXX-cpXX-win_amd64.whl
```

---

### 1. Clone the Repository

```bash
git clone https://github.com/SUYOGMAUNI/Ai-Based-Online-Exam-Proctoring-System.git
cd Ai-Based-Online-Exam-Proctoring-System
```

### 2. Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

Copy the environment file and fill in your values:

```bash
cp .env.example .env
```

Run migrations and start the server:

```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

### 3. Frontend Setup

```bash
cd Frontend
npm install
npm start
```

---

## 🔐 Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

```env
SECRET_KEY=change-me
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1

DB_NAME=exam_proctoring
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432

CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### PostgreSQL Setup

```sql
CREATE DATABASE exam_proctoring;
CREATE USER postgres WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE exam_proctoring TO postgres;
```

---

## 📡 API Reference

Base path: **`/api/`** — see `backend/apps/api/urls.py` for full router definitions.

Authentication uses **DRF Token Authentication**. Include the token in all protected request headers:

```
Authorization: Token <your_token>
```

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login/` | Login and receive auth token |
| POST | `/api/auth/register/` | Register a new user |
| POST | `/api/auth/logout/` | Logout (deletes token) |
| GET | `/api/auth/me/` | Get current authenticated user |
| GET | `/api/dashboard/student/` | Student dashboard data |
| GET | `/api/dashboard/teacher/` | Teacher dashboard data |
| POST | `/api/student/register-face/` | Submit face image for recognition setup |
| GET | `/api/student/check-face-registration/` | Check if student face is registered |
| POST | `/api/proctoring/analyze-frame/` | Submit webcam frame for AI analysis |
| POST | `/api/proctoring/analyze-audio/` | Submit audio chunk for AI analysis |
| POST | `/api/proctoring/recalculate-trust-score/` | Recalculate trust score for an attempt |
| GET | `/api/proctoring/test/` | Proctoring service health check |
| GET | `/api/exams/` | List all exams |
| POST | `/api/exams/` | Create a new exam (teacher) |
| GET | `/api/exams/{exam_id}/` | Get exam details |
| POST | `/api/exams/{exam_id}/publish/` | Publish exam (teacher) |
| GET | `/api/exams/{exam_id}/results/` | Get exam results (teacher) |
| POST | `/api/attempts/start_exam/` | Start a new exam attempt (student) |
| POST | `/api/attempts/{attempt_id}/submit_exam/` | Submit exam attempt (student) |
| GET | `/api/violations/?attempt_id={id}` | List violations for an attempt |
| GET | `/api/attempts/{attempt_id}/violations-with-evidence/` | Violations with evidence (teacher) |

---

## 👨‍💻 Author

**Suyog Mauni**

Full-stack developer & AI enthusiast passionate about building intelligent systems for real-world problems.

🌐 [suyogmauni.com.np](https://suyogmauni.com.np)

---

<div align="center">

Built with dedication for fair and secure online education.

⭐ If you found this project useful, consider giving it a star!

</div>
```
