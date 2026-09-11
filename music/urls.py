from django.urls import path
from . import views

urlpatterns = [
    path('', views.home_view, name='home'),
    path('search/', views.search_view, name='search'),
    path('category/<str:category_id>/', views.category_playlists_view, name='category_playlists'),
    path('album/<str:album_id>/', views.album_detail_view, name='album_detail'),
    path('artist/<str:artist_id>/', views.artist_detail_view, name='artist_detail'),
    path('spotify-playlist/<str:playlist_id>/', views.spotify_playlist_detail_view, name='spotify_playlist_detail'),
    path('library/', views.library_view, name='library'),
    path('settings/', views.settings_view, name='settings'),
    path('ringtone-maker/', views.ringtone_maker_view, name='ringtone_maker'),
    path('podcasts/', views.podcasts_view, name='podcasts'),
    path('podcast/<str:show_id>/', views.podcast_detail_view, name='podcast_detail'),
    
    # Toggle Likes APIs
    path('api/like-song/', views.toggle_like_song, name='toggle_like_song'),
    path('api/like-album/', views.toggle_like_album, name='toggle_like_album'),
    path('api/save-artist/', views.toggle_save_artist, name='toggle_save_artist'),
    path('api/save-show/', views.toggle_save_show, name='toggle_save_show'),

    path('api/recently-played/', views.log_recently_played, name='log_recently_played'),
    path('api/get-preview/', views.get_track_preview, name='get_track_preview'),
    
    # Spotify OAuth
    path('auth/spotify/login/', views.spotify_login, name='spotify_login'),
    path('auth/spotify/callback/', views.spotify_callback, name='spotify_callback'),
    path('auth/spotify/logout/', views.spotify_logout_view, name='spotify_logout'),
    path('api/spotify/token/', views.get_spotify_token, name='get_spotify_token'),
    
    # Music Maker
    path('music-maker/', views.music_maker_view, name='music_maker'),
    path('api/save-custom-song/', views.save_custom_song, name='save_custom_song'),
    path('api/delete-custom-song/<int:song_id>/', views.delete_custom_song, name='delete_custom_song'),
    path('api/load-custom-song/<int:song_id>/', views.load_custom_song, name='load_custom_song'),
]

