import random
import string
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from .models import OTPCode

def generate_otp():
    """Generates a secure 6-digit OTP code."""
    return ''.join(random.choices(string.digits, k=6))

def send_otp_email(email, code, purpose):
    """Generates and sends an OTP verification email to the user."""
    # Define email subject based on purpose
    if purpose == 'REGISTRATION':
        subject = 'Verify Your Nexonic Account'
        action_text = 'verify your new Nexonic account'
    else:
        subject = 'Reset Your Nexonic Password'
        action_text = 'reset your Nexonic account password'

    # Store OTP in DB
    # Deactivate existing unused codes for this email and purpose
    OTPCode.objects.filter(email=email, purpose=purpose, is_verified=False).delete()
    
    expires_at = timezone.now() + timedelta(minutes=15)
    otp_obj = OTPCode(email=email, code=code, purpose=purpose, expires_at=expires_at)
    otp_obj.save()

    # Context for template
    context = {
        'code': code,
        'action_text': action_text,
        'expiry_minutes': 15,
        'app_name': 'Nexonic'
    }

    # Generate HTML content
    html_message = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>{subject}</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #121212;
                color: #e0e0e0;
                margin: 0;
                padding: 40px 20px;
            }}
            .card {{
                max-width: 500px;
                margin: 0 auto;
                background-color: #181818;
                border-radius: 12px;
                padding: 32px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                border: 1px solid #282828;
                text-align: center;
            }}
            .brand {{
                font-size: 28px;
                font-weight: bold;
                color: #1db954;
                margin-bottom: 24px;
                letter-spacing: 1px;
            }}
            .title {{
                font-size: 20px;
                font-weight: 600;
                color: #ffffff;
                margin-bottom: 16px;
            }}
            .desc {{
                font-size: 14px;
                color: #b3b3b3;
                line-height: 1.6;
                margin-bottom: 32px;
            }}
            .otp-code {{
                display: inline-block;
                background-color: #282828;
                color: #1db954;
                font-size: 36px;
                font-weight: 700;
                padding: 12px 32px;
                border-radius: 8px;
                letter-spacing: 4px;
                margin-bottom: 32px;
                border: 1px solid #1db954;
            }}
            .footer {{
                font-size: 11px;
                color: #727272;
                margin-top: 32px;
                border-top: 1px solid #282828;
                padding-top: 16px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="brand">NEXONIC</div>
            <div class="title">{subject}</div>
            <p class="desc">Thank you for joining Nexonic. Please use the verification code below to {action_text}. This code will expire in {context['expiry_minutes']} minutes.</p>
            <div class="otp-code">{code}</div>
            <p class="desc">If you did not request this email, please ignore it.</p>
            <div class="footer">
                &copy; {timezone.now().year} Nexonic Team. All rights reserved.<br>
                nexonicteam@gmail.com
            </div>
        </div>
    </body>
    </html>
    """
    
    plain_message = f"Your Nexonic verification code is: {code}. It is valid for {context['expiry_minutes']} minutes."
    
    # Send email
    send_mail(
        subject=subject,
        message=plain_message,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        html_message=html_message,
        fail_silently=False
    )
