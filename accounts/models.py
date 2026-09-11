from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    bio = models.TextField(blank=True, max_length=500)
    # Join date is captured via user.date_joined

    def __str__(self):
        return f"{self.user.username}'s Profile"

class OTPCode(models.Model):
    PURPOSE_CHOICES = (
        ('REGISTRATION', 'Registration'),
        ('PASSWORD_RESET', 'Password Reset'),
    )
    email = models.EmailField()
    code = models.CharField(max_length=6)
    purpose = models.CharField(max_length=20, choices=PURPOSE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_verified = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        if not self.expires_at:
            # Set default expiry of 15 minutes
            self.expires_at = timezone.now() + timedelta(minutes=15)
        super().save(*args, **kwargs)

    @property
    def has_expired(self):
        return timezone.now() > self.expires_at

    def __str__(self):
        return f"OTP {self.code} for {self.email} ({self.purpose})"
