from django.db import models
from django.contrib.auth.models import User

class LikedSong(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='liked_songs')
    spotify_track_id = models.CharField(max_length=100)
    track_name = models.CharField(max_length=255)
    artist_name = models.CharField(max_length=255)
    album_name = models.CharField(max_length=255)
    album_image = models.URLField(max_length=500, blank=True, null=True)
    duration_ms = models.IntegerField(default=0)
    preview_url = models.URLField(max_length=500, blank=True, null=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-added_at']
        unique_together = ('user', 'spotify_track_id')

    def __str__(self):
        return f"{self.user.username} liked {self.track_name} by {self.artist_name}"

class LikedAlbum(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='liked_albums')
    spotify_album_id = models.CharField(max_length=100)
    album_name = models.CharField(max_length=255)
    artist_name = models.CharField(max_length=255)
    album_image = models.URLField(max_length=500, blank=True, null=True)
    release_date = models.CharField(max_length=50, blank=True, null=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-added_at']
        unique_together = ('user', 'spotify_album_id')

    def __str__(self):
        return f"{self.user.username} liked album {self.album_name}"

class SavedArtist(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_artists')
    spotify_artist_id = models.CharField(max_length=100)
    artist_name = models.CharField(max_length=255)
    artist_image = models.URLField(max_length=500, blank=True, null=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-added_at']
        unique_together = ('user', 'spotify_artist_id')

    def __str__(self):
        return f"{self.user.username} saved artist {self.artist_name}"

class RecentlyPlayed(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='recently_played')
    spotify_track_id = models.CharField(max_length=100)
    track_name = models.CharField(max_length=255)
    artist_name = models.CharField(max_length=255)
    album_name = models.CharField(max_length=255)
    album_image = models.URLField(max_length=500, blank=True, null=True)
    duration_ms = models.IntegerField(default=0)
    preview_url = models.URLField(max_length=500, blank=True, null=True)
    played_at = models.DateTimeField(auto_now=True) # Automatically updates the timestamp when played again

    class Meta:
        ordering = ['-played_at']

    def __str__(self):
        return f"{self.user.username} played {self.track_name} at {self.played_at}"

class SavedShow(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_shows')
    spotify_show_id = models.CharField(max_length=100)
    show_name = models.CharField(max_length=255)
    publisher = models.CharField(max_length=255)
    show_image = models.URLField(max_length=500, blank=True, null=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-added_at']
        unique_together = ('user', 'spotify_show_id')

    def __str__(self):
        return f"{self.user.username} saved show {self.show_name}"


class CustomSong(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='custom_songs')
    title = models.CharField(max_length=255)
    sequence_data = models.TextField()  # JSON representation of sequencer grid steps, envelope settings, BPM, etc.
    bpm = models.IntegerField(default=120)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.user.username} - {self.title}"


