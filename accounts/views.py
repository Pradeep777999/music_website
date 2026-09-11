from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordChangeForm
from django.contrib import messages
from django.utils import timezone
from django.db import transaction

from .models import Profile, OTPCode
from .forms import RegisterForm, LoginForm, OTPVerifyForm, ForgotPasswordForm, ResetPasswordForm, ProfileForm
from .utils import generate_otp, send_otp_email

def register_view(request):
    if request.user.is_authenticated:
        return redirect('home')
        
    if request.method == 'POST':
        form = RegisterForm(request.POST)
        if form.is_valid():
            with transaction.atomic():
                username = form.cleaned_data.get('username')
                email = form.cleaned_data.get('email')
                password = form.cleaned_data.get('password')
                
                # Create inactive user
                user = User.objects.create_user(username=username, email=email, password=password)
                user.is_active = False
                user.save()
                
                # Generate and send OTP
                otp_code = generate_otp()
                try:
                    send_otp_email(email, otp_code, 'REGISTRATION')
                    request.session['verification_email'] = email
                    request.session['verification_purpose'] = 'REGISTRATION'
                    messages.success(request, f"An activation code has been sent to {email}.")
                    return redirect('verify_otp')
                except Exception as e:
                    # Clean up or log error
                    messages.error(request, "Failed to send verification email. Please check your email configuration.")
                    user.delete()
    else:
        form = RegisterForm()
    return render(request, 'accounts/register.html', {'form': form})

def verify_otp_view(request):
    email = request.session.get('verification_email')
    purpose = request.session.get('verification_purpose')
    
    if not email or not purpose:
        messages.error(request, "No verification session found.")
        return redirect('register')
        
    if request.method == 'POST':
        form = OTPVerifyForm(request.POST)
        if form.is_valid():
            code = form.cleaned_data.get('otp')
            
            # Find a matching, active, unexpired OTP
            otp = OTPCode.objects.filter(
                email=email,
                code=code,
                purpose=purpose,
                is_verified=False,
                expires_at__gt=timezone.now()
            ).first()
            
            if otp:
                otp.is_verified = True
                otp.save()
                
                if purpose == 'REGISTRATION':
                    # Activate user
                    user = User.objects.filter(email=email).first()
                    if user:
                        user.is_active = True
                        user.save()
                        
                        # Ensure profile exists
                        Profile.objects.get_or_create(user=user)
                        
                        # Log user in
                        login(request, user)
                        messages.success(request, "Your account has been successfully verified!")
                        
                        # Clean session
                        del request.session['verification_email']
                        del request.session['verification_purpose']
                        return redirect('home')
                    else:
                        messages.error(request, "User not found.")
                elif purpose == 'PASSWORD_RESET':
                    request.session['otp_verified_for_reset'] = True
                    return redirect('reset_password')
            else:
                messages.error(request, "Invalid or expired verification code.")
    else:
        form = OTPVerifyForm()
        
    return render(request, 'accounts/verify_otp.html', {
        'form': form,
        'email': email,
        'purpose': purpose
    })

def login_view(request):
    if request.user.is_authenticated:
        return redirect('home')
        
    if request.method == 'POST':
        form = LoginForm(request.POST)
        if form.is_valid():
            username_or_email = form.cleaned_data.get('username')
            password = form.cleaned_data.get('password')
            
            # Allow login using email or username
            user = None
            if '@' in username_or_email:
                user_obj = User.objects.filter(email=username_or_email).first()
                if user_obj:
                    user = authenticate(request, username=user_obj.username, password=password)
            else:
                user = authenticate(request, username=username_or_email, password=password)
                
            if user is not None:
                if user.is_active:
                    login(request, user)
                    messages.success(request, f"Welcome back, {user.username}!")
                    return redirect('home')
                else:
                    # Inactive user: Send fresh OTP
                    otp_code = generate_otp()
                    try:
                        send_otp_email(user.email, otp_code, 'REGISTRATION')
                        request.session['verification_email'] = user.email
                        request.session['verification_purpose'] = 'REGISTRATION'
                        messages.warning(request, "Please verify your email address to complete registration.")
                        return redirect('verify_otp')
                    except Exception as e:
                        messages.error(request, "Could not send verification email. Try again later.")
            else:
                messages.error(request, "Invalid username/email or password.")
    else:
        form = LoginForm()
    return render(request, 'accounts/login.html', {'form': form})

def logout_view(request):
    logout(request)
    messages.success(request, "You have logged out successfully.")
    return redirect('login')

def forgot_password_view(request):
    if request.user.is_authenticated:
        return redirect('home')
        
    if request.method == 'POST':
        form = ForgotPasswordForm(request.POST)
        if form.is_valid():
            email = form.cleaned_data.get('email')
            otp_code = generate_otp()
            try:
                send_otp_email(email, otp_code, 'PASSWORD_RESET')
                request.session['verification_email'] = email
                request.session['verification_purpose'] = 'PASSWORD_RESET'
                messages.success(request, f"A password reset code has been sent to {email}.")
                return redirect('verify_otp')
            except Exception as e:
                messages.error(request, "Error sending reset email. Please try again.")
    else:
        form = ForgotPasswordForm()
    return render(request, 'accounts/forgot_password.html', {'form': form})

def reset_password_view(request):
    email = request.session.get('verification_email')
    verified = request.session.get('otp_verified_for_reset')
    
    if not email or not verified:
        messages.error(request, "Access unauthorized.")
        return redirect('forgot_password')
        
    if request.method == 'POST':
        form = ResetPasswordForm(request.POST)
        if form.is_valid():
            password = form.cleaned_data.get('password')
            user = User.objects.filter(email=email).first()
            if user:
                user.set_password(password)
                user.save()
                
                # Cleanup session variables
                del request.session['verification_email']
                del request.session['verification_purpose']
                del request.session['otp_verified_for_reset']
                
                messages.success(request, "Your password has been reset successfully. Please log in.")
                return redirect('login')
            else:
                messages.error(request, "User not found.")
    else:
        form = ResetPasswordForm()
    return render(request, 'accounts/reset_password.html', {'form': form})

@login_required
def profile_view(request):
    # Ensure profile exists
    profile, created = Profile.objects.get_or_create(user=request.user)
    
    if request.method == 'POST':
        form = ProfileForm(request.POST, request.FILES, instance=profile, user=request.user)
        if form.is_valid():
            # Update user fields
            request.user.username = form.cleaned_data.get('username')
            request.user.email = form.cleaned_data.get('email')
            request.user.save()
            
            # Save profile fields
            form.save()
            messages.success(request, "Your profile has been updated successfully!")
            return redirect('profile')
    else:
        form = ProfileForm(instance=profile, user=request.user)
        
    # Profile stats
    liked_songs_count = request.user.liked_songs.count()
    playlists_count = request.user.playlists.count()
    recently_played = request.user.recently_played.order_by('-played_at')[:5]
    
    context = {
        'form': form,
        'profile': profile,
        'liked_songs_count': liked_songs_count,
        'playlists_count': playlists_count,
        'recently_played': recently_played,
    }
    return render(request, 'accounts/profile.html', context)

@login_required
def change_password_view(request):
    if request.method == 'POST':
        form = PasswordChangeForm(request.user, request.POST)
        if form.is_valid():
            user = form.save()
            update_session_auth_hash(request, user)  # Keep user logged in
            messages.success(request, 'Your password was successfully updated!')
            return redirect('profile')
        else:
            messages.error(request, 'Please correct the error below.')
    else:
        form = PasswordChangeForm(request.user)
    return render(request, 'accounts/change_password.html', {'form': form})
