from django.test import TestCase
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from .models import OTPCode, Profile
from .utils import generate_otp

class AccountsTestCases(TestCase):
    def setUp(self):
        self.email = "testuser@example.com"
        self.username = "testuser"
        self.password = "securepassword123"

    def test_otp_generation(self):
        otp = generate_otp()
        self.assertEqual(len(otp), 6)
        self.assertTrue(otp.isdigit())

    def test_otp_model_expiration(self):
        # Create OTP
        otp_obj = OTPCode.objects.create(
            email=self.email,
            code="123456",
            purpose="REGISTRATION"
        )
        self.assertFalse(otp_obj.has_expired)
        
        # Manually expire OTP
        otp_obj.expires_at = timezone.now() - timedelta(minutes=1)
        otp_obj.save()
        self.assertTrue(otp_obj.has_expired)

    def test_inactive_user_registration(self):
        user = User.objects.create_user(
            username=self.username,
            email=self.email,
            password=self.password
        )
        user.is_active = False
        user.save()
        
        # Verify user starts inactive
        self.assertFalse(user.is_active)
        
        # Verify profile is created upon activation manually
        user.is_active = True
        user.save()
        profile, created = Profile.objects.get_or_create(user=user)
        self.assertTrue(user.is_active)
        self.assertEqual(profile.user, user)
