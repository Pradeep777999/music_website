# Nexonic - Premium Spotify Web Player Clone

Nexonic is a fully featured, responsive Spotify clone built with Django on the backend and HTML5/CSS3/Vanilla JavaScript on the frontend. It links with the official Spotify Web API to browse, search, and preview music, while utilizing a local SQLite database with Django's ORM to manage user profiles, playlists, likes, and listen history.

---

## Key Features

- **Authentication System**: Independent local account registration, login, profile dashboards, password modification, and forgot password.
- **OTP Email Activations**: 6-digit OTP codes sent via Gmail SMTP for registration verification and password reset validation.
- **Spotify API Integration**: Caching and refreshing of Developer token credentials, searching tracks/albums/artists/playlists/shows/episodes, and fetching detail profiles.
- **Bottom Fixed Audio Player**: Global queue manager, timeline progress scrubbing, volume adjustment, shuffling, repeating, and seamless synchronization with local database.
- **User Playlists**: Fully editable custom playlists (renaming, custom descriptions, cover uploads) with AJAX-powered add/remove track methods.
- **Local Libraries**: Save tracks, albums, follow artists, and review listening history locally.
- **Settings Dashboard**: Dark mode default toggle, blur styling toggle, and notifications/language/privacy placeholders.
- **Premium CSS System**: Elegant dark theme using modern variables, rounded cards, transition lift effects, and glassmorphism.

---

## Installation & Setup

### 1. Clone the repository and navigate to the project directory
Ensure you have Python 3.10+ installed.
```bash
cd "c:/Angelio APP"
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Setup your environment files
Create a `.env` file at the root of the project. You can copy the structure from `.env.example`:
```bash
cp .env.example .env
```

Open `.env` and configure the following parameters:

- `SECRET_KEY`: A secure random secret key for your Django application.
- `EMAIL_HOST_USER`: Your Gmail address (e.g., `yourname@gmail.com`).
- `EMAIL_HOST_PASSWORD`: Your Gmail **App Password** (Required for SMTP mailing. See instructions below).
- `SPOTIFY_CLIENT_ID`: Your Spotify Developer Client ID.
- `SPOTIFY_CLIENT_SECRET`: Your Spotify Developer Client Secret.

*Note: If `EMAIL_HOST_PASSWORD` or the Spotify credentials are left blank, Nexonic operates in an out-of-the-box **Demo Mode** using fallback console emails and sample playable tracks.*

---

## Spotify Developer App Configuration

To connect with the official Spotify API:

1. Visit the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Log in with your Spotify account and click **Create App**.
3. Name your application (e.g., `Nexonic`) and add a brief description.
4. Set the **Redirect URI** to: `http://127.0.0.1:8000/auth/spotify/callback/`
5. Save your settings to obtain your **Client ID** and **Client Secret**.
6. Copy these keys into your local `.env` file.

---

## Gmail App Password Setup

To enable the OTP verification system using Gmail:

1. Go to your [Google Account settings](https://myaccount.google.com/).
2. Navigate to the **Security** tab.
3. Under "How you sign in to Google", ensure **2-Step Verification** is turned ON.
4. Search for or select **App passwords** (usually at the bottom of the 2-step verification settings).
5. Generate an app password for your mail agent and copy the 16-character code.
6. Insert this passcode into your `.env` file under `EMAIL_HOST_PASSWORD`.

---

## Database Migrations & Superuser

Initialize your local SQLite database and create an admin account:

```bash
# Generate migrations
python manage.py makemigrations accounts music playlists

# Apply migrations
python manage.py migrate

# Create a developer superuser (Alternative: enter details interactively)
python manage.py createsuperuser
```

---

## Run the Application

Start the local development server:

```bash
python manage.py runserver
```

Open your browser and navigate to: `http://127.0.0.1:8000`

---

## Troubleshooting

- **"Preview not available"**: Spotify restricts playback using third-party APIs to 30-second previews. Certain tracks do not contain a public `preview_url` from Spotify. When encountered, Nexonic skips or disables playback for that track.
- **Emails are showing in the Console**: If `EMAIL_HOST_PASSWORD` is blank, Django defaults to the console email backend. Check your terminal output to view the 6-digit OTP codes for local testing.
- **Database Locked Error**: Ensure the local development server is not executing redundant threads and that no other operations are locking the `db.sqlite3` file.
