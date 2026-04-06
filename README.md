# AI-Based Online Exam Proctoring System

A full-stack AI-powered online exam proctoring platform with real-time monitoring (face, gaze/head-pose, audio) and automated violation logging.

## Tech stack

- **Frontend**: React 18, Tailwind CSS
- **Backend**: Django, Django REST Framework
- **Auth**: DRF **TokenAuthentication** (login returns a token)
- **AI/ML**: OpenCV, MediaPipe, PyTorch (+ dlib used by face pipeline)
- **DB**: PostgreSQL (configured in `backend/config/settings.py`)

## Project structure

```
Project Export/
├── Frontend/
└── backend/
```

## Getting started

### Prerequisites

- Python 3.8+
- Node.js 16+
- PostgreSQL (running locally)
- Notes for Windows: `dlib` can be difficult to install; install it in a way that matches your Python version (wheel/conda/build).

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

## Environment variables (backend)

Create `backend/.env` (or update the existing one) to match your Postgres configuration:

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

## API overview

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

> Note: endpoints like `/api/exams/create/` and `/api/proctoring/violations/` are **not** defined in this codebase export.

---

## Author

**Suyog Mauni**

Full-stack developer & AI enthusiast passionate about building intelligent systems for real-world problems.

Website: `https://suyogmauni.com.np`

