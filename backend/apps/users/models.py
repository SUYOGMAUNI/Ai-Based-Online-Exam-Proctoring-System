"""
Update: backend/apps/users/models.py

Add face registration field to User model
"""

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Custom user model with role-based access"""

    USER_TYPE_CHOICES = [
        ('STUDENT', 'Student'),
        ('TEACHER', 'Teacher'),
        ('ADMIN', 'Admin'),
    ]

    user_type = models.CharField(
        max_length=10,
        choices=USER_TYPE_CHOICES,
        default='STUDENT'
    )

    # Face registration status
    is_face_registered = models.BooleanField(default=False)

    # Optional: Additional fields
    phone = models.CharField(max_length=15, blank=True, null=True)
    profile_image = models.ImageField(upload_to='profiles/', blank=True, null=True)

    class Meta:
        db_table = 'users'

    def __str__(self):
        return f"{self.username} ({self.user_type})"

    @property
    def is_student(self):
        return self.user_type == 'STUDENT'

    @property
    def is_teacher(self):
        return self.user_type == 'TEACHER'

    @property
    def is_admin_user(self):
        return self.user_type == 'ADMIN' or self.is_superuser
