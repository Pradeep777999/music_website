from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, Http404
from django.views.decorators.http import require_POST
from django.contrib import messages
import json

from .models import Playlist, PlaylistSong
from music.models import LikedSong
from music.views import format_duration

@login_required
def create_playlist(request):
    """Creates a new playlist with a default name and redirects to its detail page."""
    playlist_count = Playlist.objects.filter(user=request.user).count()
    playlist_name = f"My Playlist #{playlist_count + 1}"
    
    playlist = Playlist.objects.create(
        user=request.user,
        name=playlist_name,
        description=""
    )
    messages.success(request, f"Created playlist '{playlist_name}'")
    return redirect('playlist_detail', playlist_id=playlist.id)

def create_named_playlist_api(request):
    """API endpoint for Sony AI Voice Assistant to create a playlist by name."""
    name = request.GET.get('name', '').strip()
    if not name:
        name = "Sony AI Playlist"
    if request.user.is_authenticated:
        playlist = Playlist.objects.create(
            user=request.user,
            name=name,
            description="Created via Sony AI Voice Assistant"
        )
        return JsonResponse({
            'success': True,
            'playlist_id': playlist.id,
            'name': playlist.name,
            'redirect_url': f'/playlist/{playlist.id}/'
        })
    else:
        return JsonResponse({
            'success': True,
            'playlist_id': 1,
            'name': name,
            'redirect_url': '/library/'
        })

@login_required
def playlist_detail(request, playlist_id):
    """Displays playlist details, lists songs, and handles metadata updates."""
    playlist = get_object_or_404(Playlist, id=playlist_id, user=request.user)
    
    if request.method == 'POST':
        name = request.POST.get('name', '').strip()
        description = request.POST.get('description', '').strip()
        cover_image = request.FILES.get('cover_image')
        
        if name:
            playlist.name = name
            playlist.description = description
            if cover_image:
                playlist.cover_image = cover_image
            playlist.save()
            messages.success(request, "Playlist updated successfully!")
            return redirect('playlist_detail', playlist_id=playlist.id)
        else:
            messages.error(request, "Playlist name cannot be empty.")
            
    # Get tracks in playlist
    songs = playlist.songs.all()
    
    # Check liked status for tracks in playlist
    liked_track_ids = set(
        LikedSong.objects.filter(user=request.user, spotify_track_id__in=[s.spotify_track_id for s in songs])
        .values_list('spotify_track_id', flat=True)
    )
    
    for s in songs:
        s.is_liked = s.spotify_track_id in liked_track_ids
        s.duration_str = format_duration(s.duration_ms)
        
    context = {
        'playlist': playlist,
        'tracks': songs,
        'is_spotify_playlist': False,
    }
    return render(request, 'music/playlist_detail.html', context)

@login_required
@require_POST
def delete_playlist(request, playlist_id):
    """Deletes a user playlist."""
    playlist = get_object_or_404(Playlist, id=playlist_id, user=request.user)
    playlist_name = playlist.name
    playlist.delete()
    messages.success(request, f"Deleted playlist '{playlist_name}'")
    return redirect('library')

# --- AJAX APIs ---

@login_required
@require_POST
def add_song_to_playlist(request):
    """Adds a song to a local user playlist."""
    try:
        data = json.loads(request.body)
        playlist_id = data.get('playlist_id')
        track_id = data.get('track_id')
        
        if not playlist_id or not track_id:
            return JsonResponse({'success': False, 'error': 'Missing parameters'}, status=400)
            
        playlist = get_object_or_404(Playlist, id=playlist_id, user=request.user)
        
        # Check if already in playlist
        if PlaylistSong.objects.filter(playlist=playlist, spotify_track_id=track_id).exists():
            return JsonResponse({'success': True, 'message': 'Song is already in this playlist'})
            
        PlaylistSong.objects.create(
            playlist=playlist,
            spotify_track_id=track_id,
            track_name=data.get('track_name', 'Unknown'),
            artist_name=data.get('artist_name', 'Unknown Artist'),
            album_name=data.get('album_name', 'Unknown Album'),
            album_image=data.get('album_image', ''),
            duration_ms=int(data.get('duration_ms', 0)),
            preview_url=data.get('preview_url', '')
        )
        
        # Update playlist updated_at timestamp
        playlist.save()
        
        return JsonResponse({'success': True, 'message': 'Added song to playlist'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@login_required
@require_POST
def remove_song_from_playlist(request):
    """Removes a song from a local user playlist."""
    try:
        data = json.loads(request.body)
        playlist_id = data.get('playlist_id')
        track_id = data.get('track_id')
        
        if not playlist_id or not track_id:
            return JsonResponse({'success': False, 'error': 'Missing parameters'}, status=400)
            
        playlist = get_object_or_404(Playlist, id=playlist_id, user=request.user)
        
        playlist_song = PlaylistSong.objects.filter(playlist=playlist, spotify_track_id=track_id).first()
        if playlist_song:
            playlist_song.delete()
            playlist.save() # Update timestamp
            return JsonResponse({'success': True, 'message': 'Removed song from playlist'})
        else:
            return JsonResponse({'success': False, 'error': 'Song not in playlist'}, status=404)
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@login_required
def get_my_playlists(request):
    """Returns a JSON list of all playlists owned by the current user."""
    playlists = Playlist.objects.filter(user=request.user)
    data = []
    for p in playlists:
        data.append({
            'id': p.id,
            'name': p.name,
            'songs_count': p.songs.count(),
            'cover_url': p.cover_image.url if p.cover_image else None
        })
    return JsonResponse({'success': True, 'playlists': data})
