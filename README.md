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
