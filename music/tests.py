from django.test import TestCase
from django.contrib.auth.models import User
from .models import LikedSong, LikedAlbum, SavedArtist, RecentlyPlayed
from .services import SpotifyService

class MusicTestCases(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="testplayer", password="testpassword")
        self.spotify_service = SpotifyService()

    def test_liked_song_creation(self):
        liked = LikedSong.objects.create(
            user=self.user,
            spotify_track_id="test_track_id",
            track_name="Test Song",
            artist_name="Test Artist",
            album_name="Test Album",
            duration_ms=180000,
            preview_url="http://example.com/preview.mp3"
        )
        self.assertEqual(self.user.liked_songs.count(), 1)
        self.assertEqual(liked.track_name, "Test Song")

    def test_liked_album_creation(self):
        album = LikedAlbum.objects.create(
            user=self.user,
            spotify_album_id="test_album_id",
            album_name="Test Album",
            artist_name="Test Artist"
        )
        self.assertEqual(self.user.liked_albums.count(), 1)

    def test_recently_played_tracking(self):
        recent = RecentlyPlayed.objects.create(
            user=self.user,
            spotify_track_id="test_track_id",
            track_name="Test Song",
            artist_name="Test Artist"
        )
        self.assertEqual(self.user.recently_played.count(), 1)

    def test_spotify_service_fallback(self):
        # Even if unconfigured, the service should return mock data
        self.spotify_service.client_id = ""
        self.spotify_service.client_secret = ""
        
        featured = self.spotify_service.get_featured_playlists()
        self.assertIsNotNone(featured)
        self.assertTrue(len(featured.get('playlists', {}).get('items', [])) > 0)
        
        search_res = self.spotify_service.search("Summer")
        self.assertIsNotNone(search_res)
        self.assertTrue(len(search_res.get('tracks', {}).get('items', [])) > 0)

    def test_spotify_service_get_playlist_fallback(self):
        # Call get_playlist with fallback_name parameter
        playlist = self.spotify_service.get_playlist("mock_playlist_1", fallback_name="Test Fallback Playlist")
        self.assertIsNotNone(playlist)
        self.assertEqual(playlist.get("name"), "Today's Top Nexonic Hits")

    def test_ringtone_maker_view_requires_login(self):
        # Unauthenticated users should be redirected to login
        response = self.client.get('/ringtone-maker/')
        self.assertEqual(response.status_code, 302)
        self.assertTrue('/login/' in response.url)

    def test_ringtone_maker_view_authenticated(self):
        # Authenticated users should view the ringtone maker page successfully
        self.client.login(username="testplayer", password="testpassword")
        response = self.client.get('/ringtone-maker/')
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'music/ringtone_maker.html')

    def test_custom_song_creation(self):
        from .models import CustomSong
        song = CustomSong.objects.create(
            user=self.user,
            title="My Test Composition",
            sequence_data='{"gridState": {}}',
            bpm=120
        )
        self.assertEqual(self.user.custom_songs.count(), 1)
        self.assertEqual(song.title, "My Test Composition")

    def test_music_maker_view_unauthenticated(self):
        response = self.client.get('/music-maker/')
        self.assertEqual(response.status_code, 302)

    def test_music_maker_view_authenticated(self):
        self.client.login(username="testplayer", password="testpassword")
        response = self.client.get('/music-maker/')
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'music/music_maker.html')

    def test_save_custom_song_api(self):
        self.client.login(username="testplayer", password="testpassword")
        # Test creation
        response = self.client.post(
            '/api/save-custom-song/',
            data='{"title": "AJAX Song", "bpm": 130, "sequence_data": {"test": true}}',
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        song_id = data['song_id']
        
        # Test update
        response = self.client.post(
            '/api/save-custom-song/',
            data=f'{{"song_id": {song_id}, "title": "Updated AJAX Song", "bpm": 140, "sequence_data": {{"test": false}}}}',
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['title'], "Updated AJAX Song")
        self.assertEqual(data['bpm'], 140)

    def test_delete_custom_song_api(self):
        from .models import CustomSong
        self.client.login(username="testplayer", password="testpassword")
        song = CustomSong.objects.create(
            user=self.user,
            title="To Delete",
            sequence_data='{"grid": []}',
            bpm=120
        )
        response = self.client.post(f'/api/delete-custom-song/{song.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
        self.assertEqual(CustomSong.objects.filter(id=song.id).count(), 0)

    def test_load_custom_song_api(self):
        from .models import CustomSong
        self.client.login(username="testplayer", password="testpassword")
        song = CustomSong.objects.create(
            user=self.user,
            title="To Load",
            sequence_data='{"grid": [1,2,3]}',
            bpm=125
        )
        response = self.client.get(f'/api/load-custom-song/{song.id}/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['bpm'], 125)
        self.assertEqual(data['sequence_data']['grid'], [1,2,3])



