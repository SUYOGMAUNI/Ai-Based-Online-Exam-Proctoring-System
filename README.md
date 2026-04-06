## AI-Based Online Exam Proctoring System

![Python](https://img.shields.io/badge/Python-3.8+-blue?style=for-the-badge&logo=python)
![Django](https://img.shields.io/badge/Django-REST-green?style=for-the-badge&logo=django)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![PyTorch](https://img.shields.io/badge/PyTorch-AI-EE4C2C?style=for-the-badge&logo=pytorch)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Vision-FF6F00?style=for-the-badge&logo=google)
![TailwindCSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=for-the-badge&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-316192?style=for-the-badge&logo=postgresql)

A full-stack AI-powered online exam proctoring platform that supports real-time monitoring (face verification, gaze/head-pose tracking, and audio analysis) with automated violation logging and a teacher review dashboard.

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [AI pipelines](#ai-pipelines)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Author](#author)

---

## Overview

The **AI-Based Online Exam Proctoring System** replicates an in-person proctored exam in an online environment. It combines multiple AI models and browser-level security mechanisms to detect suspicious behavior, verify student identity, and generate detailed violation reports.

Teachers can create and manage exams, review AI-generated violation logs, and analyze student behavior during the exam. Students go through a face registration flow before the exam and are monitored throughout via webcam and microphone.

---

## Features

### Teacher side

- Create, edit, publish, and delete exams with custom questions
- Set exam duration and instructions
- View per-student violation reports with timestamps and evidence
- Review dashboard with AI-flagged incidents
- Recalculate trust scores per attempt
- Access exam results and scores

### Student side

- Secure login and face registration before the exam
- Real-time AI proctoring throughout the exam
- Fullscreen lock (exam can be auto-flagged if exited)
- Tab switch detection/blocking
- DevTools blocking to reduce console access
- Clean exam-taking interface

### AI monitoring

- **Face verification**: confirms student identity continuously
- **Gaze/head-pose tracking**: detects sustained looking away
- **Audio monitoring**: flags suspicious noise or multiple voices
- **Multi-face detection**: flags additional person(s) in frame
- Violations are timestamped, stored in PostgreSQL, and visible in the teacher dashboard

---

## AI pipelines

### 1) Face recognition pipeline

- **File**: `backend/ai_engine/new_face.py`
- **What it does**:
  - Registers a student's face encoding during pre-exam registration
  - Compares live webcam frames against the stored encoding during the exam
  - Flags if the registered student is not present or if an unknown face appears
  - Detects multi-person presence (more than one face in frame)
- **Models used**:
  - `ai_models/dlib/dlib_face_recognition_resnet_model_v1.dat`
  - `ai_models/dlib/shape_predictor_68_face_landmarks.dat`

### 2) Gaze & head-pose tracking pipeline

- **Files**: `backend/ai_engine/gaze1.py`, `backend/ai_engine/gaze2.py`
- **What it does**:
  - Uses MediaPipe facial landmarks for preprocessing and eye/face region extraction
  - Runs inference with a PyTorch model to classify gaze direction (left/right/up/center)
  - Flags sustained deviation as a violation
- **Model used**:
  - `ai_models/gaze/best_model.pth`

### 3) Audio monitoring pipeline

- **File**: `backend/ai_engine/audio.py`
- **What it does**:
  - Processes audio chunks submitted from the frontend
  - Analyzes ambient audio for suspicious noise levels
  - Detects the presence of multiple voices or conversation (implementation-dependent)
  - Stores captures as evidence under `media/audio_captures/`

### 4) Proctoring pipeline (orchestrator)

- **File**: `backend/ai_engine/proctoring_pipeline.py`
- **What it does**:
  - Receives video frames and audio chunks via API
  - Routes data to face/gaze/audio modules
  - Aggregates results and determines violation type/severity
  - Writes violation records to the database (e.g., via `db_utils.py`)
  - Manages model lifecycle through `model_manager.py`

### 5) Model manager

- **File**: `backend/ai_engine/model_manager.py`
- **What it does**:
  - Lazy loads models to reduce startup overhead
  - Caches models in memory for repeated inference
  - Initializes Dlib models for face recognition and landmark detection
  - Can fail gracefully if a model file is missing/corrupted (implementation-dependent)

### 6) Extractor manager

- **File**: `backend/ai_engine/extractor_manager.py`
- **What it does**:
  - Coordinates feature extraction across pipelines
  - Manages face encoding extraction for registration/live verification
  - Handles batching for efficient processing under load (implementation-dependent)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Tailwind CSS |
| Backend | Django, Django REST Framework |
| Authentication | DRF Token Authentication |
| AI / ML | Dlib, PyTorch, MediaPipe, OpenCV |
| Database | PostgreSQL |
| Media storage | Django media file handling |

---

## Project structure

```
Project Export/
├── Frontend/                # React + Tailwind
└── backend/                 # Django + DRF + AI engine
    ├── ai_engine/           # Face, gaze, audio pipelines + orchestrator
    ├── ai_models/           # Model files (dlib, gaze, etc.)
    ├── apps/                # Django apps (API, dashboards, exams, attempts, etc.)
    ├── config/              # Django project settings/urls/asgi/wsgi
    ├── media/               # Uploaded media + evidence (audio, frames, etc.)
    ├── manage.py
    └── requirements.txt
```

---

## Getting started

### Prerequisites

- Python 3.8+
- Node.js 16+ (18+ recommended)
- PostgreSQL running locally (or reachable remotely)
- On Windows, `dlib` can be difficult to install; ensure you install a build/wheel that matches your Python version and architecture.

### Backend

```bash
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

### Frontend

```bash
cd Frontend
npm install
npm start
```

---

## Environment variables

Create `backend/.env` (or update the existing one) to match your configuration:

```env
SECRET_KEY=change-me
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1

DB_NAME=exam_proctoring
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432

# Optional
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

---

## API reference

Base path is **`/api/`** (see `backend/apps/api/urls.py`).

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login/` | Login and receive auth token |
| POST | `/api/auth/register/` | Register user |
| POST | `/api/auth/logout/` | Logout (delete token) |
| GET | `/api/auth/me/` | Get current user |
| GET | `/api/dashboard/student/` | Student dashboard |
| GET | `/api/dashboard/teacher/` | Teacher dashboard |
| POST | `/api/student/register-face/` | Register student face image (stored for matching) |
| GET | `/api/student/check-face-registration/` | Check if face is registered |
| POST | `/api/proctoring/analyze-frame/` | Submit webcam frame for AI analysis |
| POST | `/api/proctoring/analyze-audio/` | Submit audio chunk for AI analysis |
| GET | `/api/proctoring/test/` | Health check |
| POST | `/api/proctoring/recalculate-trust-score/` | Recalculate trust score for an attempt |
| GET | `/api/exams/` | List exams (GET) / create exam (POST, teacher) |
| GET | `/api/exams/{exam_id}/` | Exam details |
| POST | `/api/exams/{exam_id}/publish/` | Publish exam (teacher) |
| GET | `/api/exams/{exam_id}/results/` | Exam results (teacher) |
| POST | `/api/attempts/start_exam/` | Create a new exam attempt (student) |
| POST | `/api/attempts/{attempt_id}/submit_exam/` | Submit attempt (student) |
| GET | `/api/violations/?attempt_id={attempt_id}` | List violations for an attempt |
| GET | `/api/attempts/{attempt_id}/violations-with-evidence/` | Violations + evidence (teacher) |

> Note: endpoints like `/api/exams/create/` and `/api/proctoring/violations/` may not be defined in this export; treat the table above as the source of truth for what exists.

---

## Author

**Suyog Mauni**

Full-stack developer & AI enthusiast passionate about building intelligent systems for real-world problems.

Website: <a href="https://suyogmauni.com.np" target="_blank" rel="noopener noreferrer">https://suyogmauni.com.np</a>

