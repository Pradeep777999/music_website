from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, Http404
from django.views.decorators.http import require_POST
from django.utils import timezone
from django.db.models import Q
import json
from .services import SpotifyService
from .models import LikedSong, LikedAlbum, SavedArtist, RecentlyPlayed, SavedShow, CustomSong

# Initialize service
spotify_service = SpotifyService()


def get_user_spotify_token(request):
    """Retrieve a valid Spotify user OAuth access token, refreshing if necessary."""
    import time
    import base64
    import os
    import requests
    
    token_info = request.session.get('spotify_token_info')
    if not token_info:
        return None
        
    # Check if token is close to expiration (within 60 seconds)
    if token_info.get('expires_at', 0) - time.time() < 60:
        client_id = os.getenv('SPOTIFY_CLIENT_ID', '').strip()
        client_secret = os.getenv('SPOTIFY_CLIENT_SECRET', '').strip()
        token_url = "https://accounts.spotify.com/api/token"
        
        auth_string = f"{client_id}:{client_secret}"
        auth_bytes = auth_string.encode('utf-8')
        auth_base64 = str(base64.b64encode(auth_bytes), 'utf-8')
        
        headers = {
            "Authorization": f"Basic {auth_base64}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {
            "grant_type": "refresh_token",
            "refresh_token": token_info.get('refresh_token')
        }
        
        try:
            response = requests.post(token_url, headers=headers, data=data, timeout=10)
            if response.status_code == 200:
                res_data = response.json()
                token_info['access_token'] = res_data.get('access_token')
                if res_data.get('refresh_token'):
                    token_info['refresh_token'] = res_data.get('refresh_token')
                token_info['expires_at'] = int(time.time()) + int(res_data.get('expires_in', 3600))
                request.session['spotify_token_info'] = token_info
            else:
                return None
        except Exception:
            return None
            
    return token_info.get('access_token')

def home_view(request):
    if not request.user.is_authenticated:
        return render(request, 'music/landing.html')
        
    user_token = get_user_spotify_token(request)
    featured = spotify_service.get_featured_playlists(limit=6, auth_token=user_token)
    new_releases = spotify_service.get_new_releases(limit=6, auth_token=user_token)
    categories = spotify_service.get_categories(limit=6, auth_token=user_token)
    
    # User's recently played from DB
    db_recent = RecentlyPlayed.objects.filter(user=request.user).order_by('-played_at')[:10]
    
    # Recommendations based on user's liked tracks or generic seeds
    liked_songs = LikedSong.objects.filter(user=request.user)[:5]
    seed_tracks = None
    if liked_songs.exists():
        seed_tracks = ",".join([s.spotify_track_id for s in liked_songs])[:100] # Spotify allows up to 5 seeds total
    
    recs = spotify_service.get_recommendations(seed_tracks=seed_tracks, limit=6, auth_token=user_token)

    # Continue Listening - get the latest recently played track
    continue_listening = db_recent.first() if db_recent.exists() else None

    # Get trending artists (using mock list or extracting from new releases)
    popular_artists = []
    if not spotify_service.is_configured:
        popular_artists = spotify_service._get_mock_artists()
    else:
        # Fallback: Extract from new releases or query recommendations
        releases = new_releases.get('albums', {}).get('items', []) if new_releases else []
        seen = set()
        artist_ids_to_fetch = []
        for album in releases:
            for artist in album.get('artists', []):
                if artist['id'] not in seen:
                    seen.add(artist['id'])
                    artist_ids_to_fetch.append(artist['id'])
            if len(seen) >= 6:
                break
        
        if artist_ids_to_fetch:
            artists_res = spotify_service.get_artists(artist_ids_to_fetch[:6], auth_token=user_token)
            popular_artists = artists_res.get('artists', [])

    # Build context
    context = {
        'featured_playlists': featured.get('playlists', {}).get('items', []) if featured else [],
        'trending_albums': new_releases.get('albums', {}).get('items', []) if new_releases else [],
        'categories': categories.get('categories', {}).get('items', []) if categories else [],
        'recommended_music': recs.get('tracks', []) if recs else [],
        'recently_played': db_recent,
        'continue_listening': continue_listening,
        'popular_artists': popular_artists[:6],
    }
    return render(request, 'music/home.html', context)

@login_required
def search_view(request):
    query = request.GET.get('q', '').strip()
    user_token = get_user_spotify_token(request)
    
    # Check if request is AJAX (wants JSON results)
    if request.headers.get('x-requested-with') == 'XMLHttpRequest' or request.GET.get('format') == 'json':
        if not query:
            return JsonResponse({'success': False, 'message': 'No query provided'})
        
        results = spotify_service.search(query, types="track,album,artist,playlist,show,episode", limit=5, auth_token=user_token)
        if not results:
            return JsonResponse({'success': True, 'results': {}})
            
        # Format track items to check if user liked them
        tracks_items = (results.get('tracks') or {}).get('items', [])
        liked_track_ids = set(
            LikedSong.objects.filter(user=request.user, spotify_track_id__in=[t['id'] for t in tracks_items])
            .values_list('spotify_track_id', flat=True)
        )
        
        for track in tracks_items:
            track['is_liked'] = track['id'] in liked_track_ids
            # Ensure duration formatting helper can use it easily
            track['duration_str'] = format_duration(track.get('duration_ms', 0))

        # Check liked albums
        album_items = (results.get('albums') or {}).get('items', [])
        liked_album_ids = set(
            LikedAlbum.objects.filter(user=request.user, spotify_album_id__in=[a['id'] for a in album_items])
            .values_list('spotify_album_id', flat=True)
        )
        for album in album_items:
            album['is_liked'] = album['id'] in liked_album_ids

        # Check saved artists
        artist_items = (results.get('artists') or {}).get('items', [])
        saved_artist_ids = set(
            SavedArtist.objects.filter(user=request.user, spotify_artist_id__in=[art['id'] for art in artist_items])
            .values_list('spotify_artist_id', flat=True)
        )
        for artist in artist_items:
            artist['is_saved'] = artist['id'] in saved_artist_ids

        # Resolve RSS preview URLs for searched episodes so they stream original audio instead of fallbacks
        episodes_items = (results.get('episodes') or {}).get('items', [])
        if episodes_items:
            show_episodes_map = {}
            for ep in episodes_items:
                if ep and ep.get("show"):
                    s_id = ep["show"].get("id")
                    s_name = ep["show"].get("name")
                    if s_id and s_name:
                        if s_id not in show_episodes_map:
                            show_episodes_map[s_id] = {
                                "name": s_name,
                                "episodes": []
                            }
                        show_episodes_map[s_id]["episodes"].append(ep)
            
            for s_id, show_info in show_episodes_map.items():
                spotify_service.resolve_podcast_rss_previews(s_id, show_info["name"], show_info["episodes"])

        return JsonResponse({
            'success': True,
            'tracks': tracks_items,
            'albums': album_items,
            'artists': artist_items,
            'playlists': (results.get('playlists') or {}).get('items', []),
            'shows': (results.get('shows') or {}).get('items', []),
            'episodes': episodes_items,
        })


    # Render category browse view
    categories_res = spotify_service.get_categories(limit=30, auth_token=user_token)
    categories = categories_res.get('categories', {}).get('items', []) if categories_res else []
    
    return render(request, 'music/search.html', {'categories': categories})

@login_required
def category_playlists_view(request, category_id):
    user_token = get_user_spotify_token(request)
    playlists_res = spotify_service.get_category_playlists(category_id, limit=20, auth_token=user_token)
    playlists = playlists_res.get('playlists', {}).get('items', []) if playlists_res else []
    
    # Get category name
    # We can fetch categories and search for this one, or just capitalize the ID
    category_name = category_id.replace('-', ' ').title()
    
    context = {
        'category_name': category_name,
        'playlists': playlists
    }
    return render(request, 'music/category_playlists.html', context)

@login_required
def album_detail_view(request, album_id):
    user_token = get_user_spotify_token(request)
    
    fallback_name = request.GET.get('name')
    fallback_artist = request.GET.get('artist')
    fallback_image = request.GET.get('image')
    
    if not fallback_name or not fallback_artist:
        liked_album = LikedAlbum.objects.filter(spotify_album_id=album_id).first()
        if liked_album:
            fallback_name = fallback_name or liked_album.album_name
            fallback_artist = fallback_artist or liked_album.artist_name
            fallback_image = fallback_image or liked_album.album_image

    album = spotify_service.get_album(
        album_id, 
        auth_token=user_token,
        fallback_name=fallback_name,
        fallback_artist=fallback_artist,
        fallback_image=fallback_image
    )
    if not album:
        raise Http404("Album not found")
        
    # Check if album is liked by user
    is_liked = LikedAlbum.objects.filter(user=request.user, spotify_album_id=album_id).exists()
    
    # Get tracks
    tracks = album.get('tracks', {}).get('items', [])
    
    # Check which tracks are liked
    liked_track_ids = set(
        LikedSong.objects.filter(user=request.user, spotify_track_id__in=[t['id'] for t in tracks])
        .values_list('spotify_track_id', flat=True)
    )
    
    for t in tracks:
        t['is_liked'] = t['id'] in liked_track_ids
        t['duration_str'] = format_duration(t.get('duration_ms', 0))
        
    context = {
        'album': album,
        'is_liked': is_liked,
        'tracks': tracks,
    }
    return render(request, 'music/album_detail.html', context)

@login_required
def artist_detail_view(request, artist_id):
    user_token = get_user_spotify_token(request)
    fallback_name = request.GET.get('name')
    artist = spotify_service.get_artist(artist_id, auth_token=user_token, fallback_name=fallback_name)
    if not artist:
        raise Http404("Artist not found")
        
    top_tracks_res = spotify_service.get_artist_top_tracks(artist_id, auth_token=user_token)
    top_tracks = top_tracks_res.get('tracks', []) if top_tracks_res else []
    
    related_res = spotify_service.get_artist_related_artists(artist_id, auth_token=user_token)
    related_artists = related_res.get('artists', []) if related_res else []
    
    # Check if saved
    is_saved = SavedArtist.objects.filter(user=request.user, spotify_artist_id=artist_id).exists()
    
    # Check liked tracks
    liked_track_ids = set(
        LikedSong.objects.filter(user=request.user, spotify_track_id__in=[t['id'] for t in top_tracks])
        .values_list('spotify_track_id', flat=True)
    )
    
    for t in top_tracks:
        t['is_liked'] = t['id'] in liked_track_ids
        t['duration_str'] = format_duration(t.get('duration_ms', 0))
        
    # Get artist albums by searching or querying recommendations
    # Simple search for albums by this artist name
    albums_res = spotify_service.search(artist['name'], types="album", limit=6, auth_token=user_token)
    albums = albums_res.get('albums', {}).get('items', []) if albums_res else []
    
    context = {
        'artist': artist,
        'top_tracks': top_tracks,
        'related_artists': related_artists,
        'albums': albums,
        'is_saved': is_saved
    }
    return render(request, 'music/artist_detail.html', context)

@login_required
def spotify_playlist_detail_view(request, playlist_id):
    user_token = get_user_spotify_token(request)
    fallback_name = request.GET.get('name')
    playlist = spotify_service.get_playlist(playlist_id, auth_token=user_token, fallback_name=fallback_name)
    if not playlist:
        raise Http404("Playlist not found")
        
    # Items from Spotify playlists contain track nested inside item
    items = playlist.get('tracks', {}).get('items', [])
    tracks = []
    
    # Flatten structure
    for item in items:
        if item.get('track'):
            tracks.append(item['track'])
            
    # Check liked tracks
    liked_track_ids = set(
        LikedSong.objects.filter(user=request.user, spotify_track_id__in=[t['id'] for t in tracks])
        .values_list('spotify_track_id', flat=True)
    )
    
    for t in tracks:
        t['is_liked'] = t['id'] in liked_track_ids
        t['duration_str'] = format_duration(t.get('duration_ms', 0))
        
    context = {
        'playlist': playlist,
        'tracks': tracks,
        'is_spotify_playlist': True,
    }
    return render(request, 'music/playlist_detail.html', context)

@login_required
def library_view(request):
    liked_songs = LikedSong.objects.filter(user=request.user)
    liked_albums = LikedAlbum.objects.filter(user=request.user)
    saved_artists = SavedArtist.objects.filter(user=request.user)
    recently_played = RecentlyPlayed.objects.filter(user=request.user).order_by('-played_at')[:30]
    custom_songs = CustomSong.objects.filter(user=request.user).order_by('-updated_at')
    
    # Format durations
    for track in liked_songs:
        track.duration_str = format_duration(track.duration_ms)
    for track in recently_played:
        track.duration_str = format_duration(track.duration_ms)

    context = {
        'liked_songs': liked_songs,
        'liked_albums': liked_albums,
        'saved_artists': saved_artists,
        'saved_shows': SavedShow.objects.filter(user=request.user),
        'recently_played': recently_played,
        'user_playlists': request.user.playlists.all(),
        'custom_songs': custom_songs
    }
    return render(request, 'music/library.html', context)



@login_required
def settings_view(request):
    token_info = request.session.get('spotify_token_info')
    is_connected = token_info is not None
    context = {
        'is_connected': is_connected,
        'spotify_auth_url': '/auth/spotify/login/'
    }
    return render(request, 'music/settings.html', context)

# --- JSON API ENDPOINTS ---

@login_required
@require_POST
def toggle_like_song(request):
    try:
        data = json.loads(request.body)
        track_id = data.get('track_id')
        
        if not track_id:
            return JsonResponse({'success': False, 'error': 'Missing track_id'}, status=400)
            
        liked_song = LikedSong.objects.filter(user=request.user, spotify_track_id=track_id).first()
        
        if liked_song:
            liked_song.delete()
            return JsonResponse({'success': True, 'liked': False})
        else:
            LikedSong.objects.create(
                user=request.user,
                spotify_track_id=track_id,
                track_name=data.get('track_name', 'Unknown'),
                artist_name=data.get('artist_name', 'Unknown Artist'),
                album_name=data.get('album_name', 'Unknown Album'),
                album_image=data.get('album_image', ''),
                duration_ms=int(data.get('duration_ms', 0)),
                preview_url=data.get('preview_url', '')
            )
            return JsonResponse({'success': True, 'liked': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@login_required
@require_POST
def toggle_like_album(request):
    try:
        data = json.loads(request.body)
        album_id = data.get('album_id')
        
        if not album_id:
            return JsonResponse({'success': False, 'error': 'Missing album_id'}, status=400)
            
        liked_album = LikedAlbum.objects.filter(user=request.user, spotify_album_id=album_id).first()
        
        if liked_album:
            liked_album.delete()
            return JsonResponse({'success': True, 'liked': False})
        else:
            LikedAlbum.objects.create(
                user=request.user,
                spotify_album_id=album_id,
                album_name=data.get('album_name', 'Unknown'),
                artist_name=data.get('artist_name', 'Unknown Artist'),
                album_image=data.get('album_image', ''),
                release_date=data.get('release_date', '')
            )
            return JsonResponse({'success': True, 'liked': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@login_required
@require_POST
def toggle_save_artist(request):
    try:
        data = json.loads(request.body)
        artist_id = data.get('artist_id')
        
        if not artist_id:
            return JsonResponse({'success': False, 'error': 'Missing artist_id'}, status=400)
            
        saved_artist = SavedArtist.objects.filter(user=request.user, spotify_artist_id=artist_id).first()
        
        if saved_artist:
            saved_artist.delete()
            return JsonResponse({'success': True, 'saved': False})
        else:
            SavedArtist.objects.create(
                user=request.user,
                spotify_artist_id=artist_id,
                artist_name=data.get('artist_name', 'Unknown'),
                artist_image=data.get('artist_image', '')
            )
            return JsonResponse({'success': True, 'saved': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@login_required
@require_POST
def log_recently_played(request):
    try:
        data = json.loads(request.body)
        track_id = data.get('track_id')
        
        if not track_id:
            return JsonResponse({'success': False, 'error': 'Missing track_id'}, status=400)
            
        # Create or update recently played entry
        recent, created = RecentlyPlayed.objects.get_or_create(
            user=request.user,
            spotify_track_id=track_id,
            defaults={
                'track_name': data.get('track_name', 'Unknown'),
                'artist_name': data.get('artist_name', 'Unknown Artist'),
                'album_name': data.get('album_name', 'Unknown Album'),
                'album_image': data.get('album_image', ''),
                'duration_ms': int(data.get('duration_ms', 0)),
                'preview_url': data.get('preview_url', '')
            }
        )
        
        if not created:
            recent.played_at = timezone.now()
            recent.save()
            
        # Keep only the last 30 recently played songs to prevent db growth
        # Keep only the last 30 recently played songs to prevent db growth
        all_recent = RecentlyPlayed.objects.filter(user=request.user)
        if all_recent.count() > 30:
            ids_to_keep = all_recent.values_list('id', flat=True)[:30]
            RecentlyPlayed.objects.filter(user=request.user).exclude(id__in=ids_to_keep).delete()
            
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@login_required
def get_track_preview(request):
    track_id = request.GET.get('track_id')
    name = request.GET.get('name')
    artist = request.GET.get('artist')
    
    if not track_id or not name or not artist:
        return JsonResponse({'success': False, 'error': 'Missing parameters'}, status=400)
        
    preview_url = spotify_service._resolve_itunes_preview(name, artist, track_id)
    if preview_url:
        LikedSong.objects.filter(spotify_track_id=track_id).filter(Q(preview_url__isnull=True) | Q(preview_url='')).update(preview_url=preview_url)
        RecentlyPlayed.objects.filter(spotify_track_id=track_id).filter(Q(preview_url__isnull=True) | Q(preview_url='')).update(preview_url=preview_url)
        
        try:
            from playlists.models import PlaylistSong
            PlaylistSong.objects.filter(spotify_track_id=track_id).filter(Q(preview_url__isnull=True) | Q(preview_url='')).update(preview_url=preview_url)
        except Exception as e:
            pass
            
        return JsonResponse({'success': True, 'preview_url': preview_url})
        
    return JsonResponse({'success': False, 'error': 'Preview not found'})

@login_required
def spotify_login(request):
    import urllib.parse
    import os
    client_id = os.getenv('SPOTIFY_CLIENT_ID', '').strip()
    redirect_uri = os.getenv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:8000/auth/spotify/callback/').strip()
    scopes = 'streaming user-read-playback-state user-modify-playback-state user-read-currently-playing'
    
    params = {
        'client_id': client_id,
        'response_type': 'code',
        'redirect_uri': redirect_uri,
        'scope': scopes,
        'show_dialog': 'true'
    }
    auth_url = f"https://accounts.spotify.com/authorize?{urllib.parse.urlencode(params)}"
    return redirect(auth_url)

@login_required
def spotify_callback(request):
    import time
    import base64
    import os
    import requests
    from django.contrib import messages
    
    code = request.GET.get('code')
    error = request.GET.get('error')
    
    if error or not code:
        messages.error(request, f"Spotify authorization failed: {error or 'No code returned'}")
        return redirect('settings')
        
    client_id = os.getenv('SPOTIFY_CLIENT_ID', '').strip()
    client_secret = os.getenv('SPOTIFY_CLIENT_SECRET', '').strip()
    redirect_uri = os.getenv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:8000/auth/spotify/callback/').strip()
    
    token_url = "https://accounts.spotify.com/api/token"
    auth_string = f"{client_id}:{client_secret}"
    auth_bytes = auth_string.encode('utf-8')
    auth_base64 = str(base64.b64encode(auth_bytes), 'utf-8')
    
    headers = {
        "Authorization": f"Basic {auth_base64}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri
    }
    
    try:
        response = requests.post(token_url, headers=headers, data=data, timeout=10)
        if response.status_code == 200:
            res_data = response.json()
            token_info = {
                'access_token': res_data.get('access_token'),
                'refresh_token': res_data.get('refresh_token'),
                'expires_at': int(time.time()) + int(res_data.get('expires_in', 3600))
            }
            request.session['spotify_token_info'] = token_info
            messages.success(request, "Successfully connected to Spotify Developer account!")
        else:
            messages.error(request, f"Failed to retrieve Spotify access token: {response.text}")
    except Exception as e:
        messages.error(request, f"Error authenticating with Spotify: {str(e)}")
        
    return redirect('settings')

@login_required
def spotify_logout_view(request):
    from django.contrib import messages
    if 'spotify_token_info' in request.session:
        del request.session['spotify_token_info']
    messages.success(request, "Disconnected from Spotify account.")
    return redirect('settings')

@login_required
def get_spotify_token(request):
    token = get_user_spotify_token(request)
    if not token:
        return JsonResponse({'success': False, 'error': 'Not connected to Spotify or token refresh failed'}, status=401)
    return JsonResponse({'success': True, 'access_token': token})

@login_required
def ringtone_maker_view(request):
    track_id = request.GET.get('track_id', '')
    preview_url = request.GET.get('preview_url', '')
    title = request.GET.get('title', '')
    artist = request.GET.get('artist', '')
    album = request.GET.get('album', '')
    image = request.GET.get('image', '')
    
    context = {
        'preloaded_track_id': track_id,
        'preloaded_preview_url': preview_url,
        'preloaded_title': title,
        'preloaded_artist': artist,
        'preloaded_album': album,
        'preloaded_image': image,
    }
    return render(request, 'music/ringtone_maker.html', context)


@login_required
def podcasts_view(request):
    user_token = get_user_spotify_token(request)
    
    # Search for popular podcasts dynamically to ensure we get accessible shows in the user's market
    shows_res = spotify_service.search("podcast", types="show", limit=12, auth_token=user_token)
    featured_shows = []
    if shows_res and "shows" in shows_res:
        featured_shows = [s for s in shows_res["shows"].get("items", []) if s is not None]
        
    # Fallback to mock shows if search fails or returns empty
    if not featured_shows:
        featured_shows = spotify_service._get_mock_shows()
    
    saved_shows = SavedShow.objects.filter(user=request.user)
    
    context = {
        "featured_shows": featured_shows,
        "saved_shows": saved_shows,
    }
    return render(request, 'music/podcasts.html', context)

@login_required
def podcast_detail_view(request, show_id):
    user_token = get_user_spotify_token(request)
    
    show = spotify_service.get_show(show_id, auth_token=user_token)
    if not show:
        raise Http404("Podcast show not found")
        
    episodes_res = spotify_service.get_show_episodes(show_id, auth_token=user_token)
    episodes = []
    if episodes_res and "items" in episodes_res:
        episodes = episodes_res.get("items", [])
    elif show and "episodes" in show and "items" in show["episodes"]:
        episodes = show["episodes"].get("items", [])
    
    # Resolve the original full-length MP3 URLs from the podcast's public RSS feed
    episodes = spotify_service.resolve_podcast_rss_previews(show_id, show.get('name'), episodes)
    
    # Format durations and dates
    for ep in episodes:
        if ep:
            ep['duration_str'] = format_duration(ep.get('duration_ms', 0))

    
    is_saved = SavedShow.objects.filter(user=request.user, spotify_show_id=show_id).exists()
    
    context = {
        "show": show,
        "episodes": episodes,
        "is_saved": is_saved,
    }
    return render(request, 'music/podcast_detail.html', context)


@login_required
@require_POST
def toggle_save_show(request):
    try:
        data = json.loads(request.body)
        show_id = data.get('show_id')
        
        if not show_id:
            return JsonResponse({'success': False, 'error': 'Missing show_id'}, status=400)
            
        saved_show = SavedShow.objects.filter(user=request.user, spotify_show_id=show_id).first()
        
        if saved_show:
            saved_show.delete()
            return JsonResponse({'success': True, 'saved': False})
        else:
            SavedShow.objects.create(
                user=request.user,
                spotify_show_id=show_id,
                show_name=data.get('show_name', 'Unknown Podcast'),
                publisher=data.get('publisher', 'Unknown Publisher'),
                show_image=data.get('show_image', '')
            )
            return JsonResponse({'success': True, 'saved': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

# --- UTILITIES ---


def format_duration(ms):
    """Helper to convert ms into MM:SS string."""
    if not ms:
        return "0:00"
    seconds = int((ms / 1000) % 60)
    minutes = int((ms / (1000 * 60)) % 60)
    return f"{minutes}:{seconds:02d}"


@login_required
def music_maker_view(request):
    song_id = request.GET.get('song_id')
    preloaded_song = None
    if song_id:
        preloaded_song = get_object_or_404(CustomSong, id=song_id, user=request.user)
    
    custom_songs = CustomSong.objects.filter(user=request.user).order_by('-updated_at')
    
    context = {
        'preloaded_song': preloaded_song,
        'custom_songs': custom_songs,
    }
    return render(request, 'music/music_maker.html', context)


@login_required
@require_POST
def save_custom_song(request):
    try:
        data = json.loads(request.body)
        song_id = data.get('song_id')
        title = data.get('title', 'Untitled Beat').strip() or 'Untitled Beat'
        sequence_data = data.get('sequence_data')
        bpm = int(data.get('bpm', 120))
        
        if not sequence_data:
            return JsonResponse({'success': False, 'error': 'Missing sequence data'}, status=400)
            
        # Standardize formatting of sequence data
        sequence_json = json.dumps(sequence_data)
        
        if song_id:
            song = get_object_or_404(CustomSong, id=song_id, user=request.user)
            song.title = title
            song.sequence_data = sequence_json
            song.bpm = bpm
            song.save()
        else:
            song = CustomSong.objects.create(
                user=request.user,
                title=title,
                sequence_data=sequence_json,
                bpm=bpm
            )
            
        return JsonResponse({
            'success': True,
            'song_id': song.id,
            'title': song.title,
            'bpm': song.bpm,
            'updated_at': song.updated_at.strftime('%Y-%m-%d %H:%M')
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_POST
def delete_custom_song(request, song_id):
    try:
        song = get_object_or_404(CustomSong, id=song_id, user=request.user)
        song.delete()
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
def load_custom_song(request, song_id):
    try:
        song = get_object_or_404(CustomSong, id=song_id, user=request.user)
        try:
            seq_data = json.loads(song.sequence_data)
        except Exception:
            seq_data = song.sequence_data
            
        return JsonResponse({
            'success': True,
            'song_id': song.id,
            'title': song.title,
            'bpm': song.bpm,
            'sequence_data': seq_data
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

