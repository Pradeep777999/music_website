from django.urls import path
from . import views

urlpatterns = [
    path('create/', views.create_playlist, name='create_playlist'),
    path('<int:playlist_id>/', views.playlist_detail, name='playlist_detail'),
    path('<int:playlist_id>/delete/', views.delete_playlist, name='delete_playlist'),
    
    # AJAX APIs
    path('api/add-song/', views.add_song_to_playlist, name='add_song_to_playlist'),
    path('api/remove-song/', views.remove_song_from_playlist, name='remove_song_from_playlist'),
    path('api/my-playlists/', views.get_my_playlists, name='get_my_playlists'),
    path('api/create-named/', views.create_named_playlist_api, name='create_named_playlist_api'),
]
