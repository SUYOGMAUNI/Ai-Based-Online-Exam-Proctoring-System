"""
WSGI config for exam proctoring project.
File: backend/config/wsgi.py

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/4.2/howto/deployment/wsgi/
"""

import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# ============================================================================
# PRELOAD AI MODELS AT STARTUP
# ============================================================================
# This ensures all AI models are loaded ONCE when server starts,
# not on every exam request. Dramatically improves performance!

print(" DJANGO SERVER STARTING")

# Force import and initialization of model manager
# This will load all AI models (face detection, gaze tracking, audio)
try:
    from ai_engine.model_manager import model_manager

    # Verify models loaded successfully
    if model_manager.is_ready():
        print("\n AI models pre-loaded successfully!")
        print("   Server is ready to handle proctored exams.\n")
    else:
        print("\n⚠️  Warning: Some AI models failed to load.")
        print("   Check logs above for details.\n")

except Exception as e:
    print(f"\n❌ CRITICAL ERROR: Failed to load AI models!")
    print(f"   Error: {e}")
    print("   Server will start but AI features may not work.\n")

# ============================================================================
# Create WSGI application
# ============================================================================
application = get_wsgi_application()

print(" Django WSGI application ready!\n")