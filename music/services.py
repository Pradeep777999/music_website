import os
import base64
import requests
import logging
import concurrent.futures
from django.core.cache import cache

logger = logging.getLogger(__name__)

class SpotifyService:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(SpotifyService, cls).__new__(cls, *args, **kwargs)
        return cls._instance

    def __init__(self):
        # Prevent re-initialization
        if hasattr(self, 'initialized'):
            return
        self.client_id = os.getenv('SPOTIFY_CLIENT_ID', '').strip()
        self.client_secret = os.getenv('SPOTIFY_CLIENT_SECRET', '').strip()
        self.token_url = "https://accounts.spotify.com/api/token"
        self.api_base_url = "https://api.spotify.com/v1"
        self.initialized = True

    @property
    def is_configured(self):
        return bool(self.client_id and self.client_secret)

    def _resolve_itunes_preview(self, track_name, artist_name, track_id):
        if not track_id:
            return ""
        cache_key = f"itunes_preview_{track_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            # Clean up names to avoid query formatting issues with features or acoustic versions
            clean_track = track_name.split(' - ')[0].split(' (')[0].strip()
            clean_artist = artist_name.split(',')[0].strip()
            
            term = f"{clean_artist} {clean_track}"
            url = "https://itunes.apple.com/search"
            response = requests.get(url, params={"term": term, "media": "music", "limit": 5}, timeout=4)
            if response.status_code == 200:
                data = response.json()
                results = data.get("results", [])
                
                # Check for a precise match first
                for res in results:
                    res_track = res.get("trackName", "").lower()
                    if clean_track.lower() in res_track or res_track in clean_track.lower():
                        preview = res.get("previewUrl")
                        if preview:
                            cache.set(cache_key, preview, 86400 * 7) # Cache for 7 days
                            return preview
                            
                # Fallback to the first result's preview if available
                if results and results[0].get("previewUrl"):
                    preview = results[0].get("previewUrl")
                    cache.set(cache_key, preview, 86400 * 7)
                    return preview

            # Cache empty string for 1 day so we don't keep querying
            cache.set(cache_key, "", 86400 * 1)
            return ""
        except Exception as e:
            logger.warning(f"Error fetching preview from iTunes for {track_name}: {e}")
            return ""

    def _resolve_tracks_previews(self, tracks):
        if not tracks:
            return tracks
        
        tracks_to_resolve = []
        for track in tracks:
            if not track:
                continue
            track_id = track.get("id", "")
            if not track_id or track_id.startswith("mock_"):
                continue
            if not track.get("preview_url"):
                tracks_to_resolve.append(track)
                
        if not tracks_to_resolve:
            return tracks

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(tracks_to_resolve), 15)) as executor:
            future_to_track = {}
            for t in tracks_to_resolve:
                track_name = t.get("name", "")
                artists = t.get("artists", [])
                artist_name = artists[0].get("name", "") if artists else ""
                track_id = t.get("id", "")
                
                future = executor.submit(self._resolve_itunes_preview, track_name, artist_name, track_id)
                future_to_track[future] = t
                
            for future in concurrent.futures.as_completed(future_to_track):
                t = future_to_track[future]
                try:
                    preview_url = future.result()
                    if preview_url:
                        t["preview_url"] = preview_url
                except Exception as e:
                    logger.warning(f"Failed to resolve preview for track: {e}")
                    
        return tracks

    def get_access_token(self):
        if not self.is_configured:
            return None

        # Check cache first
        token = cache.get('spotify_access_token')
        if token:
            return token

        # If not cached, request a new token
        try:
            auth_string = f"{self.client_id}:{self.client_secret}"
            auth_bytes = auth_string.encode('utf-8')
            auth_base64 = str(base64.b64encode(auth_bytes), 'utf-8')

            headers = {
                "Authorization": f"Basic {auth_base64}",
                "Content-Type": "application/x-www-form-urlencoded"
            }
            data = {"grant_type": "client_credentials"}
            
            response = requests.post(self.token_url, headers=headers, data=data, timeout=10)
            if response.status_code == 200:
                response_data = response.json()
                access_token = response_data.get("access_token")
                expires_in = response_data.get("expires_in", 3600)
                
                # Cache token, subtracting a buffer of 60 seconds
                cache.set('spotify_access_token', access_token, expires_in - 60)
                return access_token
            else:
                logger.error(f"Spotify token request failed: {response.status_code} {response.text}")
                return None
        except Exception as e:
            logger.exception("Error fetching Spotify access token")
            return None

    def _get_headers(self):
        token = self.get_access_token()
        if not token:
            return {}
        return {"Authorization": f"Bearer {token}"}

    def _get(self, endpoint, params=None, auth_token=None):
        if not self.is_configured and not auth_token:
            return None
        
        if auth_token:
            headers = {"Authorization": f"Bearer {auth_token}"}
        else:
            headers = self._get_headers()
            
        if not headers:
            return None

        url = f"{self.api_base_url}/{endpoint.lstrip('/')}"
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            if response.status_code == 401 and not auth_token:
                # Token might have expired, clear cache and retry once
                cache.delete('spotify_access_token')
                headers = self._get_headers()
                if headers:
                    response = requests.get(url, headers=headers, params=params, timeout=10)
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Spotify API GET {endpoint} failed: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            logger.exception(f"Exception requesting Spotify API GET {endpoint}")
            return None

    # --- SPOTIFY API ENDPOINTS ---

    def _search_itunes_fallback(self, query, types="track,album,artist,playlist", limit=20):
        try:
            clean_query = query.replace('artist:', '').replace('genre:', '').replace('track:', '').replace('album:', '').replace('tag:', '').replace('"', '').strip()
            url = "https://itunes.apple.com/search"
            response = requests.get(url, params={"term": clean_query, "media": "music", "limit": limit * 2}, timeout=5)
            
            tracks = []
            albums_map = {}
            artists_map = {}
            
            if response.status_code == 200:
                results = response.json().get("results", [])
                for item in results:
                    wrapper_type = item.get("wrapperType")
                    kind = item.get("kind")
                    
                    if wrapper_type == "track" and kind == "song":
                        track_id = f"itunes_{item.get('trackId')}"
                        artist_id = f"itunes_art_{item.get('artistId')}"
                        album_id = f"itunes_alb_{item.get('collectionId')}"
                        
                        track_obj = {
                            "id": track_id,
                            "name": item.get("trackName"),
                            "artists": [{"id": artist_id, "name": item.get("artistName")}],
                            "album": {
                                "id": album_id,
                                "name": item.get("collectionName"),
                                "images": [{"url": item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")}] if item.get("artworkUrl100") else [],
                                "release_date": item.get("releaseDate", "2024-01-01")[:10]
                            },
                            "preview_url": item.get("previewUrl", ""),
                            "duration_ms": item.get("trackTimeMillis", 180000),
                            "explicit": item.get("trackExplicitness") == "explicit",
                            "popularity": 50,
                            "uri": f"spotify:track:{track_id}"
                        }
                        tracks.append(track_obj)
                        
                        cache.set(f"spotify_track_{track_id}", track_obj, 86400 * 7)
                        
                        if album_id not in albums_map:
                            albums_map[album_id] = {
                                "id": album_id,
                                "name": item.get("collectionName"),
                                "album_type": "album",
                                "images": [{"url": item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")}] if item.get("artworkUrl100") else [],
                                "artists": [{"id": artist_id, "name": item.get("artistName")}],
                                "release_date": item.get("releaseDate", "2024-01-01")[:10]
                            }
                            cache.set(f"spotify_album_simple_{album_id}", {
                                "name": item.get("collectionName"),
                                "artist": item.get("artistName"),
                                "image": item.get("artworkUrl100", "").replace("100x100bb", "600x600bb") if item.get("artworkUrl100") else ""
                            }, 86400 * 7)
                        
                        if artist_id not in artists_map:
                            artists_map[artist_id] = {
                                "id": artist_id,
                                "name": item.get("artistName"),
                                "images": [{"url": item.get("artworkUrl100", "").replace("100x100bb", "300x300bb")}] if item.get("artworkUrl100") else [],
                                "genres": [item.get("primaryGenreName")] if item.get("primaryGenreName") else [],
                                "popularity": 60,
                                "followers": {"total": 100000}
                            }
                            cache.set(f"spotify_artist_{artist_id}", artists_map[artist_id], 86400 * 7)

            playlists = [
                {
                    "id": f"itunes_playlist_{query}",
                    "name": f"Best of {query.title()}",
                    "description": f"Curated playlist featuring tracks related to {query}.",
                    "images": [{"url": "https://picsum.photos/id/1025/300/300"}],
                    "owner": {"display_name": "Nexonic"},
                    "tracks": {"total": len(tracks)}
                }
            ] if len(tracks) > 0 else []

            result = {}
            if "track" in types:
                result["tracks"] = {"items": tracks[:limit]}
            if "album" in types:
                result["albums"] = {"items": list(albums_map.values())[:limit]}
            if "artist" in types:
                result["artists"] = {"items": list(artists_map.values())[:limit]}
            if "playlist" in types:
                result["playlists"] = {"items": playlists}
            
            return result
        except Exception as e:
            logger.warning(f"iTunes fallback search failed for {query}: {e}")
            return self._get_mock_search(query, types)

    def search(self, query, types="track,album,artist,playlist", limit=20, offset=0, auth_token=None):
        if not self.is_configured and not auth_token:
            itunes_res = self._search_itunes_fallback(query, types, limit)
            if itunes_res and any(itunes_res.values()):
                return itunes_res
            return self._get_mock_search(query, types)
            
        if not auth_token:
            # Client Credentials flow only supports a maximum limit of 10 for search queries
            limit = min(limit, 10)

        params = {
            "q": query,
            "type": types,
            "limit": limit,
            "offset": offset
        }
        res = self._get("search", params, auth_token=auth_token)
        if not res:
            itunes_res = self._search_itunes_fallback(query, types, limit)
            if itunes_res and any(itunes_res.values()):
                return itunes_res
            return self._get_mock_search(query, types)
            
        for key in ["tracks", "albums", "artists", "playlists", "shows", "episodes"]:
            if key in res and res[key] and "items" in res[key] and res[key]["items"]:
                res[key]["items"] = [item for item in res[key]["items"] if item is not None]
                
        if "tracks" in res and "items" in res["tracks"]:
            res["tracks"]["items"] = self._resolve_tracks_previews(res["tracks"]["items"])
            # Cache individual tracks returned by search
            for track in res["tracks"]["items"]:
                if track and track.get("id") and not str(track.get("id")).startswith("mock_"):
                    cache.set(f"spotify_track_{track['id']}", track, 86400)
                    
        if "artists" in res and "items" in res["artists"]:
            # Cache individual artists returned by search
            for artist in res["artists"]["items"]:
                if artist and artist.get("id") and not str(artist.get("id")).startswith("mock_"):
                    cache.set(f"spotify_artist_{artist['id']}", artist, 86400)
            
        if "albums" in res and "items" in res["albums"]:
            # Cache simplified album metadata
            for album in res["albums"]["items"]:
                if album and album.get("id") and not str(album.get("id")).startswith("mock_"):
                    cache.set(f"spotify_album_simple_{album['id']}", {
                        "name": album.get("name"),
                        "artist": album.get("artists", [{}])[0].get("name") if album.get("artists") else "Unknown Artist",
                        "image": album.get("images", [{}])[0].get("url") if album.get("images") else ""
                    }, 86400)

        return res

    def get_featured_playlists(self, limit=12, auth_token=None):
        if not self.is_configured and not auth_token:
            return {"playlists": {"items": self._get_mock_playlists()}}
        params = {"limit": limit}
        res = self._get("browse/featured-playlists", params, auth_token=auth_token)
        if not res:
            # Fallback: Search for popular playlists instead of failing
            fallback_res = self.search("Top Hits", types="playlist", limit=limit, auth_token=auth_token)
            if fallback_res and "playlists" in fallback_res and fallback_res["playlists"].get("items"):
                return fallback_res
            return {"playlists": {"items": self._get_mock_playlists()}}
        return res

    def get_new_releases(self, limit=12, auth_token=None):
        if not self.is_configured and not auth_token:
            return {"albums": {"items": self._get_mock_albums()}}
        params = {"limit": limit}
        res = self._get("browse/new-releases", params, auth_token=auth_token)
        if not res:
            # Fallback: Search for newly popular albums instead of failing
            fallback_res = self.search("tag:new", types="album", limit=limit, auth_token=auth_token)
            if not (fallback_res and "albums" in fallback_res and fallback_res["albums"].get("items")):
                fallback_res = self.search("hits", types="album", limit=limit, auth_token=auth_token)
            if fallback_res and "albums" in fallback_res and fallback_res["albums"].get("items"):
                return fallback_res
            return {"albums": {"items": self._get_mock_albums()}}
            
        # Cache simplified album metadata
        if res and "albums" in res and "items" in res["albums"]:
            for album in res["albums"]["items"]:
                if album and album.get("id") and not str(album.get("id")).startswith("mock_"):
                    cache.set(f"spotify_album_simple_{album['id']}", {
                        "name": album.get("name"),
                        "artist": album.get("artists", [{}])[0].get("name") if album.get("artists") else "Unknown Artist",
                        "image": album.get("images", [{}])[0].get("url") if album.get("images") else ""
                    }, 86400)
                    
        return res

    def get_categories(self, limit=20, auth_token=None):
        if not self.is_configured and not auth_token:
            return {"categories": {"items": self._get_mock_categories()}}
        params = {"limit": limit}
        res = self._get("browse/categories", params, auth_token=auth_token)
        if not res:
            return {"categories": {"items": self._get_mock_categories()}}
        return res

    def get_category_playlists(self, category_id, limit=12, auth_token=None):
        if not self.is_configured and not auth_token:
            return {"playlists": {"items": self._get_mock_playlists()}}
        params = {"limit": limit}
        res = self._get(f"browse/categories/{category_id}/playlists", params, auth_token=auth_token)
        if not res:
            # Fallback: Search for playlists matching the category name
            query = category_id.replace('-', ' ')
            fallback_res = self.search(query, types="playlist", limit=limit, auth_token=auth_token)
            if fallback_res and "playlists" in fallback_res and fallback_res["playlists"].get("items"):
                return fallback_res
            return {"playlists": {"items": self._get_mock_playlists()}}
        return res

    def get_show(self, show_id, market="US", auth_token=None):
        if (not self.is_configured and not auth_token) or show_id.startswith("mock_"):
            return self._get_mock_show(show_id)
        params = {"market": market}
        res = self._get(f"shows/{show_id}", params, auth_token=auth_token)
        if not res:
            return self._get_mock_show(show_id)
        return res

    def get_show_episodes(self, show_id, limit=50, offset=0, market="US", auth_token=None):
        if (not self.is_configured and not auth_token) or show_id.startswith("mock_"):
            return self._get_mock_show_episodes(show_id)
        params = {"limit": limit, "offset": offset, "market": market}
        res = self._get(f"shows/{show_id}/episodes", params, auth_token=auth_token)
        if not res:
            return self._get_mock_show_episodes(show_id)
        return res

    def resolve_podcast_rss_previews(self, show_id, show_name, spotify_episodes):
        if not show_name:
            return spotify_episodes

        cache_key = f"podcast_rss_map_{show_id}"
        rss_map = cache.get(cache_key)

        if rss_map is None:
            rss_map = {}
            try:
                # 1. Search iTunes for the show RSS feed
                search_url = "https://itunes.apple.com/search"
                params = {"term": show_name, "media": "podcast", "limit": 1}
                response = requests.get(search_url, params=params, timeout=5)
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results and results[0].get("feedUrl"):
                        feed_url = results[0]["feedUrl"]
                        # 2. Fetch and parse feed XML
                        feed_res = requests.get(feed_url, timeout=6)
                        if feed_res.status_code == 200:
                            import xml.etree.ElementTree as ET
                            root = ET.fromstring(feed_res.content)
                            channel = root.find("channel")
                            if channel is not None:
                                for item in channel.findall("item"):
                                    t_node = item.find("title")
                                    enc_node = item.find("enclosure")
                                    if t_node is not None and enc_node is not None:
                                        raw_t = t_node.text or ""
                                        clean_t = "".join(c for c in raw_t.lower() if c.isalnum())
                                        if clean_t:
                                            rss_map[clean_t] = enc_node.get("url")
            except Exception as e:
                logger.warning(f"Failed to resolve RSS feed for podcast {show_name}: {e}")
            
            cache_duration = 86400 if rss_map else 3600
            cache.set(cache_key, rss_map, cache_duration)

        if not rss_map:
            return spotify_episodes

        for ep in spotify_episodes:
            if not ep:
                continue
            ep_name = ep.get("name", "")
            clean_spotify_t = "".join(c for c in ep_name.lower() if c.isalnum())
            
            # Try exact match
            audio_url = rss_map.get(clean_spotify_t)
            if not audio_url:
                # Try substring match
                for rss_clean_t, url in rss_map.items():
                    if len(rss_clean_t) > 10 and (rss_clean_t in clean_spotify_t or clean_spotify_t in rss_clean_t):
                        audio_url = url
                        break
            
            if audio_url:
                ep["audio_preview_url"] = audio_url

        return spotify_episodes

    def get_multiple_shows(self, show_ids, market="US", auth_token=None):

        if not self.is_configured and not auth_token:
            return {"shows": self._get_mock_shows()}
        real_ids = [sid for sid in show_ids if not sid.startswith("mock_")]
        if not real_ids:
            return {"shows": self._get_mock_shows()}
        params = {"ids": ",".join(real_ids), "market": market}
        res = self._get("shows", params, auth_token=auth_token)
        if not res or not res.get("shows"):
            return {"shows": self._get_mock_shows()}
        return res

    def _get_mock_shows(self):
        return [
            {
                "id": "mock_show_1",
                "name": "The Daily Talk",
                "publisher": "Nexonic Radio",
                "description": "Your daily feed of technology news, culture analysis, and science discussions.",
                "images": [{"url": "https://picsum.photos/id/1025/400/400"}],
                "total_episodes": 120
            },
            {
                "id": "mock_show_2",
                "name": "Mindset & Neuro-Science",
                "publisher": "Dr. Andrew Hub",
                "description": "Exploring neurobiology, human focus, performance optimization, and daily bio-hacks.",
                "images": [{"url": "https://picsum.photos/id/342/400/400"}],
                "total_episodes": 45
            },
            {
                "id": "mock_show_3",
                "name": "Lex Fridman Insights",
                "publisher": "Lex Fridman",
                "description": "Conversations about science, technology, history, philosophy, and the nature of intelligence.",
                "images": [{"url": "https://picsum.photos/id/1062/400/400"}],
                "total_episodes": 82
            },
            {
                "id": "mock_show_4",
                "name": "Indie Makers & SaaS",
                "publisher": "Creator FM",
                "description": "Real stories of bootstrap founders building software products and scaling to millions in MRR.",
                "images": [{"url": "https://picsum.photos/id/1080/400/400"}],
                "total_episodes": 29
            }
        ]

    def _get_mock_show(self, show_id):
        shows = self._get_mock_shows()
        for s in shows:
            if s["id"] == show_id:
                return s
        return shows[0]

    def _get_mock_show_episodes(self, show_id):
        if show_id == "mock_show_2":
            return {
                "items": [
                    {
                        "id": "mock_episode_3",
                        "name": "How to Focus Under Pressure",
                        "description": "Dr. Hub discusses neurochemical factors that control focus and attention, and shares actionable scientific breathing/visual techniques to optimize mental focus in high-stress scenarios.",
                        "duration_ms": 1800000,
                        "audio_preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
                        "release_date": "2026-07-07",
                        "images": [{"url": "https://picsum.photos/id/342/400/400"}]
                    },
                    {
                        "id": "mock_episode_4",
                        "name": "Mastering Sleep Cycles",
                        "description": "Optimize your circadian rhythm and sleep architecture. Learn how sunlight exposure, temperature, and specific evening protocols can drastically improve sleep quality and daily cognitive recovery.",
                        "duration_ms": 1400000,
                        "audio_preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
                        "release_date": "2026-07-06",
                        "images": [{"url": "https://picsum.photos/id/342/400/400"}]
                    }
                ]
            }
        return {
            "items": [
                {
                    "id": "mock_episode_1",
                    "name": "Future of Artificial Intelligence",
                    "description": "An analysis of the current landscape of large language models, agentic workflows, autonomous code generation tools, and how they will shape software engineering in the next decade.",
                    "duration_ms": 1200000,
                    "audio_preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                    "release_date": "2026-07-09",
                    "images": [{"url": "https://picsum.photos/id/1025/400/400"}]
                },
                {
                    "id": "mock_episode_2",
                    "name": "The Rise of Agentic Coding",
                    "description": "In this episode, we dive into how AI coding agents represent a fundamental shift in programming, moving from code completions to complete task orchestration and autonomous repository edits.",
                    "duration_ms": 1500000,
                    "audio_preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
                    "release_date": "2026-07-08",
                    "images": [{"url": "https://picsum.photos/id/1025/400/400"}]
                }
            ]
        }

    def _get_album_from_itunes(self, album_id, album_name, artist_name, album_image=None):

        if not album_name or not artist_name:
            return None
        try:
            term = f"{artist_name} {album_name}"
            url = "https://itunes.apple.com/search"
            response = requests.get(url, params={"term": term, "entity": "album", "limit": 3}, timeout=5)
            collection_id = None
            album_url = album_image
            release_date = "2024-01-01"
            
            if response.status_code == 200:
                results = response.json().get("results", [])
                for r in results:
                    r_album = r.get("collectionName", "").lower()
                    r_artist = r.get("artistName", "").lower()
                    if album_name.lower() in r_album or r_album in album_name.lower():
                        collection_id = r.get("collectionId")
                        album_url = r.get("artworkUrl100", "").replace("100x100bb", "600x600bb") or album_url
                        release_date = r.get("releaseDate", "")[:10] if r.get("releaseDate") else release_date
                        break
                        
                if not collection_id and results:
                    collection_id = results[0].get("collectionId")
                    album_url = results[0].get("artworkUrl100", "").replace("100x100bb", "600x600bb") or album_url
                    release_date = results[0].get("releaseDate", "")[:10] if results[0].get("releaseDate") else release_date

            tracks = []
            if collection_id:
                lookup_url = "https://itunes.apple.com/lookup"
                response_tracks = requests.get(lookup_url, params={"id": collection_id, "entity": "song"}, timeout=5)
                if response_tracks.status_code == 200:
                    results = response_tracks.json().get("results", [])
                    track_index = 1
                    for r in results:
                        if r.get("wrapperType") == "track":
                            tracks.append({
                                "id": f"itunes_track_{r.get('trackId')}",
                                "name": r.get("trackName"),
                                "duration_ms": r.get("trackTimeMillis", 0),
                                "preview_url": r.get("previewUrl", ""),
                                "track_number": r.get("trackNumber", track_index),
                                "artists": [{"id": f"itunes_artist_{r.get('artistId')}", "name": r.get("artistName")}],
                                "album": {
                                    "id": album_id,
                                    "name": album_name,
                                    "images": [{"url": album_url}] if album_url else []
                                }
                            })
                            track_index += 1
            
            if not tracks:
                return None
                
            return {
                "id": album_id,
                "name": album_name,
                "album_type": "album",
                "release_date": release_date,
                "images": [{"url": album_url}] if album_url else [],
                "artists": [{"id": f"fallback_artist_{album_id}", "name": artist_name}],
                "tracks": {"items": tracks}
            }
        except Exception as e:
            logger.warning(f"Failed to fetch album from iTunes fallback: {e}")
            return None

    def get_album(self, album_id, auth_token=None, fallback_name=None, fallback_artist=None, fallback_image=None):
        if not album_id:
            return None
        if str(album_id).startswith("itunes_"):
            cache_key = f"spotify_album_{album_id}"
            cached = cache.get(cache_key)
            if cached:
                return cached
                
            collection_id = str(album_id).replace("itunes_album_", "").replace("itunes_alb_", "").replace("itunes_", "")
            try:
                lookup_url = "https://itunes.apple.com/lookup"
                response = requests.get(lookup_url, params={"id": collection_id, "entity": "song"}, timeout=5)
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        collection_info = results[0]
                        album_name = collection_info.get("collectionName", "Unknown Album")
                        artist_name = collection_info.get("artistName", "Unknown Artist")
                        album_url = collection_info.get("artworkUrl100", "").replace("100x100bb", "600x600bb") if collection_info.get("artworkUrl100") else ""
                        release_date = collection_info.get("releaseDate", "2024-01-01")[:10]
                        artist_id = collection_info.get("artistId", "")
                        
                        tracks = []
                        track_index = 1
                        for r in results:
                            if r.get("wrapperType") == "track":
                                tracks.append({
                                    "id": f"itunes_{r.get('trackId')}",
                                    "name": r.get("trackName"),
                                    "duration_ms": r.get("trackTimeMillis", 0),
                                    "preview_url": r.get("previewUrl", ""),
                                    "track_number": r.get("trackNumber", track_index),
                                    "artists": [{"id": f"itunes_art_{r.get('artistId')}", "name": r.get("artistName")}],
                                    "album": {
                                        "id": album_id,
                                        "name": album_name,
                                        "images": [{"url": album_url}] if album_url else []
                                    }
                                })
                                track_index += 1
                        
                        album_data = {
                            "id": album_id,
                            "name": album_name,
                            "album_type": "album",
                            "release_date": release_date,
                            "images": [{"url": album_url}] if album_url else [],
                            "artists": [{"id": f"itunes_art_{artist_id}", "name": artist_name}],
                            "tracks": {"items": tracks}
                        }
                        cache.set(cache_key, album_data, 86400 * 7)
                        return album_data
            except Exception as e:
                logger.warning(f"Failed to lookup iTunes album {album_id}: {e}")

        if str(album_id).startswith("mock_"):
            mock_albums = self._get_mock_albums()
            album = next((a for a in mock_albums if a['id'] == album_id), mock_albums[0])
            return {
                **album,
                "tracks": {"items": self._get_mock_tracks()}
            }

        cache_key = f"spotify_album_{album_id}"
        cached = cache.get(cache_key)
        if cached:
            return cached

        if not self.is_configured and not auth_token:
            # Try iTunes fallback first if we have metadata
            simple_cached = cache.get(f"spotify_album_simple_{album_id}")
            a_name = fallback_name or (simple_cached.get("name") if simple_cached else None)
            a_artist = fallback_artist or (simple_cached.get("artist") if simple_cached else None)
            a_image = fallback_image or (simple_cached.get("image") if simple_cached else None)
            
            itunes_album = self._get_album_from_itunes(album_id, a_name, a_artist, a_image)
            if itunes_album:
                cache.set(cache_key, itunes_album, 86400)
                return itunes_album

            mock_albums = self._get_mock_albums()
            album = next((a for a in mock_albums if a['id'] == album_id), mock_albums[0])
            return {
                **album,
                "tracks": {"items": self._get_mock_tracks()}
            }
            
        res = self._get(f"albums/{album_id}", auth_token=auth_token)
        if not res:
            # Try iTunes fallback first if we have metadata
            simple_cached = cache.get(f"spotify_album_simple_{album_id}")
            a_name = fallback_name or (simple_cached.get("name") if simple_cached else None)
            a_artist = fallback_artist or (simple_cached.get("artist") if simple_cached else None)
            a_image = fallback_image or (simple_cached.get("image") if simple_cached else None)
            
            itunes_album = self._get_album_from_itunes(album_id, a_name, a_artist, a_image)
            if itunes_album:
                cache.set(cache_key, itunes_album, 86400)
                return itunes_album

            mock_albums = self._get_mock_albums()
            album = next((a for a in mock_albums if a['id'] == album_id), mock_albums[0])
            res = {
                **album,
                "tracks": {"items": self._get_mock_tracks()}
            }
        else:
            if "tracks" in res and "items" in res["tracks"]:
                album_images = res.get("images", [])
                album_name = res.get("name", "")
                for t in res["tracks"]["items"]:
                    t["album"] = {"images": album_images, "name": album_name}
                res["tracks"]["items"] = self._resolve_tracks_previews(res["tracks"]["items"])
            cache.set(cache_key, res, 86400)
            
        return res

    def get_artists(self, artist_ids, auth_token=None):
        if not artist_ids:
            return {"artists": []}
            
        # Filter out mock IDs and resolve them separately if needed
        real_ids = [aid for aid in artist_ids if aid and not str(aid).startswith("mock_")]
        mock_ids = [aid for aid in artist_ids if aid and str(aid).startswith("mock_")]
        
        results = []
        ids_to_fetch = []
        
        # Retrieve cached versions first
        for aid in real_ids:
            cache_key = f"spotify_artist_{aid}"
            cached = cache.get(cache_key)
            if cached:
                results.append(cached)
            else:
                ids_to_fetch.append(aid)
                
        # Batch fetch from Spotify if any are missing
        if ids_to_fetch:
            # Spotify allows max 50 IDs per request
            for i in range(0, len(ids_to_fetch), 50):
                chunk = ids_to_fetch[i:i+50]
                ids_param = ",".join(chunk)
                res = self._get("artists", params={"ids": ids_param}, auth_token=auth_token)
                if res and "artists" in res:
                    for artist in res["artists"]:
                        if artist:
                            cache_key = f"spotify_artist_{artist['id']}"
                            cache.set(cache_key, artist, 86400)
                            results.append(artist)
                            
        # Handle mock artists
        if mock_ids:
            mock_artists = self._get_mock_artists()
            for maid in mock_ids:
                artist = next((a for a in mock_artists if a['id'] == maid), mock_artists[0])
                results.append(artist)
                
        # Maintain original order
        order_map = {aid: idx for idx, aid in enumerate(artist_ids)}
        results.sort(key=lambda x: order_map.get(x.get('id'), 999))
        
        return {"artists": results}

    def get_artist(self, artist_id, auth_token=None, fallback_name=None):
        if not artist_id:
            return None
        if str(artist_id).startswith("itunes_"):
            cache_key = f"spotify_artist_{artist_id}"
            cached = cache.get(cache_key)
            if cached:
                return cached
            
            itunes_id = str(artist_id).replace("itunes_artist_", "").replace("itunes_art_", "").replace("itunes_", "")
            try:
                lookup_url = "https://itunes.apple.com/lookup"
                response = requests.get(lookup_url, params={"id": itunes_id}, timeout=5)
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        item = results[0]
                        artist = {
                            "id": artist_id,
                            "name": item.get("artistName", "Unknown Artist"),
                            "genres": [item.get("primaryGenreName")] if item.get("primaryGenreName") else [],
                            "images": [{"url": "https://picsum.photos/id/1025/400/400"}],
                            "followers": {"total": 120000},
                            "popularity": 70
                        }
                        cache.set(cache_key, artist, 86400 * 7)
                        return artist
            except Exception as e:
                logger.warning(f"Failed to lookup iTunes artist {artist_id}: {e}")

        if str(artist_id).startswith("mock_"):
            mock_artists = self._get_mock_artists()
            return next((a for a in mock_artists if a['id'] == artist_id), mock_artists[0])
            
        cache_key = f"spotify_artist_{artist_id}"
        cached = cache.get(cache_key)
        if cached:
            return cached
            
        if not self.is_configured and not auth_token:
            mock_artists = self._get_mock_artists()
            return next((a for a in mock_artists if a['id'] == artist_id), mock_artists[0])
        res = self._get(f"artists/{artist_id}", auth_token=auth_token)
        if not res:
            placeholder = {
                "id": artist_id,
                "name": fallback_name or "Artist Profile (Unavailable)",
                "genres": [],
                "images": [{"url": "https://picsum.photos/id/1025/400/400"}],
                "followers": {"total": 0},
                "popularity": 0
            }
            if fallback_name:
                cache.set(cache_key, placeholder, 86400)
            return placeholder
        cache.set(cache_key, res, 86400)
        return res

    def _get_artist_tracks_from_itunes(self, artist_name, artist_id):
        if not artist_name:
            return []
        try:
            url = "https://itunes.apple.com/search"
            response = requests.get(url, params={"term": artist_name, "entity": "song", "limit": 10}, timeout=5)
            tracks = []
            if response.status_code == 200:
                results = response.json().get("results", [])
                for r in results:
                    tracks.append({
                        "id": f"itunes_track_{r.get('trackId')}",
                        "name": r.get("trackName"),
                        "duration_ms": r.get("trackTimeMillis", 0),
                        "preview_url": r.get("previewUrl", ""),
                        "artists": [{"id": f"itunes_artist_{r.get('artistId')}", "name": r.get("artistName")}],
                        "album": {
                            "id": f"itunes_album_{r.get('collectionId')}",
                            "name": r.get("collectionName"),
                            "images": [{"url": r.get("artworkUrl100", "").replace("100x100bb", "300x300bb")}] if r.get("artworkUrl100") else []
                        }
                    })
            return tracks
        except Exception as e:
            logger.warning(f"Failed to fetch artist tracks from iTunes: {e}")
            return []

    def get_artist_top_tracks(self, artist_id, market="US", auth_token=None):
        if not artist_id:
            return {"tracks": []}
        if str(artist_id).startswith("itunes_"):
            cache_key = f"spotify_artist_tracks_{artist_id}_{market}"
            cached = cache.get(cache_key)
            if cached:
                return cached
            
            itunes_id = str(artist_id).replace("itunes_artist_", "").replace("itunes_art_", "").replace("itunes_", "")
            try:
                lookup_url = "https://itunes.apple.com/lookup"
                response = requests.get(lookup_url, params={"id": itunes_id, "entity": "song", "limit": 10}, timeout=5)
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    tracks = []
                    for r in results:
                        if r.get("wrapperType") == "track":
                            tracks.append({
                                "id": f"itunes_{r.get('trackId')}",
                                "name": r.get("trackName"),
                                "duration_ms": r.get("trackTimeMillis", 0),
                                "preview_url": r.get("previewUrl", ""),
                                "artists": [{"id": artist_id, "name": r.get("artistName")}],
                                "album": {
                                    "id": f"itunes_alb_{r.get('collectionId')}",
                                    "name": r.get("collectionName"),
                                    "images": [{"url": r.get("artworkUrl100", "").replace("100x100bb", "300x300bb")}] if r.get("artworkUrl100") else []
                                }
                            })
                    res = {"tracks": tracks}
                    cache.set(cache_key, res, 86400 * 7)
                    return res
            except Exception as e:
                logger.warning(f"Failed to fetch artist top tracks from iTunes: {e}")

        if str(artist_id).startswith("mock_"):
            return {"tracks": self._get_mock_tracks()[:5]}
            
        cache_key = f"spotify_artist_tracks_{artist_id}_{market}"
        cached = cache.get(cache_key)
        if cached:
            return cached
            
        if not self.is_configured and not auth_token:
            return {"tracks": self._get_mock_tracks()[:5]}
        params = {"market": market}
        res = self._get(f"artists/{artist_id}/top-tracks", params, auth_token=auth_token)
        if not res:
            # Fallback: Search for tracks by the artist's name
            artist = self.get_artist(artist_id, auth_token=auth_token)
            if artist and not artist.get('id', '').startswith('mock_') and artist.get('name') != "Artist Profile (Unavailable)":
                artist_name = artist.get('name')
                itunes_tracks = self._get_artist_tracks_from_itunes(artist_name, artist_id)
                if itunes_tracks:
                    res = {"tracks": itunes_tracks}
            if not res:
                res = {"tracks": self._get_mock_tracks()[:5]}
        else:
            if "tracks" in res:
                res["tracks"] = self._resolve_tracks_previews(res["tracks"])
                
        cache.set(cache_key, res, 86400)
        return res

    def get_artist_related_artists(self, artist_id, auth_token=None):
        if not artist_id:
            return {"artists": []}
        if str(artist_id).startswith("itunes_"):
            cache_key = f"spotify_artist_related_{artist_id}"
            cached = cache.get(cache_key)
            if cached:
                return cached
            
            artist = self.get_artist(artist_id, auth_token=auth_token)
            if artist and artist.get('name') != "Artist Profile (Unavailable)":
                artist_name = artist.get('name')
                search_res = self.search(artist_name, types="artist", limit=7, auth_token=auth_token)
                if search_res and "artists" in search_res and search_res["artists"].get("items"):
                    artists = search_res["artists"]["items"]
                    related = [a for a in artists if a.get('id') != artist_id]
                    if related:
                        res = {"artists": related[:6]}
                        cache.set(cache_key, res, 86400 * 7)
                        return res
            res = {"artists": self._get_mock_artists()[1:5]}
            cache.set(cache_key, res, 86400 * 7)
            return res

        if str(artist_id).startswith("mock_"):
            return {"artists": self._get_mock_artists()[1:5]}
            
        cache_key = f"spotify_artist_related_{artist_id}"
        cached = cache.get(cache_key)
        if cached:
            return cached
            
        if not self.is_configured and not auth_token:
            return {"artists": self._get_mock_artists()[1:5]}
        res = self._get(f"artists/{artist_id}/related-artists", auth_token=auth_token)
        if not res:
            # Fallback: Search for artists with similar name
            artist = self.get_artist(artist_id, auth_token=auth_token)
            if artist and not artist.get('id', '').startswith('mock_') and artist.get('name') != "Artist Profile (Unavailable)":
                artist_name = artist.get('name')
                search_res = self.search(artist_name, types="artist", limit=7, auth_token=auth_token)
                if search_res and "artists" in search_res and search_res["artists"].get("items"):
                    artists = search_res["artists"]["items"]
                    related = [a for a in artists if a.get('id') != artist_id]
                    if related:
                        res = {"artists": related[:6]}
            if not res:
                res = {"artists": self._get_mock_artists()[1:5]}
        else:
            # Cache the related artists details too to save requests later
            if "artists" in res:
                for artist in res["artists"]:
                    if artist and artist.get("id"):
                        cache.set(f"spotify_artist_{artist['id']}", artist, 86400)
                        
        cache.set(cache_key, res, 86400)
        return res

    def _get_playlist_tracks_from_itunes(self, playlist_name, playlist_id):
        if not playlist_name:
            return []
        try:
            url = "https://itunes.apple.com/search"
            response = requests.get(url, params={"term": playlist_name, "entity": "song", "limit": 25}, timeout=5)
            tracks = []
            if response.status_code == 200:
                results = response.json().get("results", [])
                for r in results:
                    tracks.append({
                        "track": {
                            "id": f"itunes_track_{r.get('trackId')}",
                            "name": r.get("trackName"),
                            "duration_ms": r.get("trackTimeMillis", 0),
                            "preview_url": r.get("previewUrl", ""),
                            "artists": [{"id": f"itunes_artist_{r.get('artistId')}", "name": r.get("artistName")}],
                            "album": {
                                "id": f"itunes_album_{r.get('collectionId')}",
                                "name": r.get("collectionName"),
                                "images": [{"url": r.get("artworkUrl100", "").replace("100x100bb", "300x300bb")}] if r.get("artworkUrl100") else []
                            }
                        }
                    })
            return tracks
        except Exception as e:
            logger.warning(f"Failed to fetch playlist tracks from iTunes: {e}")
            return []

    def get_playlist(self, playlist_id, auth_token=None, fallback_name=None):
        if not playlist_id:
            return None
        if str(playlist_id).startswith("mock_"):
            mock_playlists = self._get_mock_playlists()
            playlist = next((p for p in mock_playlists if p['id'] == playlist_id), mock_playlists[0])
            tracks = []
            for track in self._get_mock_tracks():
                tracks.append({"track": track})
            return {
                **playlist,
                "tracks": {"items": tracks}
            }
            
        cache_key = f"spotify_playlist_{playlist_id}"
        cached = cache.get(cache_key)
        if cached:
            return cached

        if not self.is_configured and not auth_token:
            p_name = fallback_name or "Hits"
            itunes_tracks = self._get_playlist_tracks_from_itunes(p_name, playlist_id)
            if itunes_tracks:
                res = {
                    "id": playlist_id,
                    "name": p_name,
                    "description": f"A collection of songs matching {p_name}",
                    "images": [{"url": "https://picsum.photos/id/1043/400/400"}],
                    "owner": {"display_name": "Nexonic Fallback"},
                    "tracks": {"items": itunes_tracks}
                }
                cache.set(cache_key, res, 86400)
                return res

            mock_playlists = self._get_mock_playlists()
            playlist = next((p for p in mock_playlists if p['id'] == playlist_id), mock_playlists[0])
            tracks = []
            for track in self._get_mock_tracks():
                tracks.append({"track": track})
            return {
                **playlist,
                "tracks": {"items": tracks}
            }
        res = self._get(f"playlists/{playlist_id}", auth_token=auth_token)
        if not res:
            p_name = fallback_name or "Hits"
            itunes_tracks = self._get_playlist_tracks_from_itunes(p_name, playlist_id)
            if itunes_tracks:
                res = {
                    "id": playlist_id,
                    "name": p_name,
                    "description": f"A collection of songs matching {p_name}",
                    "images": [{"url": "https://picsum.photos/id/1043/400/400"}],
                    "owner": {"display_name": "Nexonic Fallback"},
                    "tracks": {"items": itunes_tracks}
                }
                cache.set(cache_key, res, 86400)
                return res

            mock_playlists = self._get_mock_playlists()
            playlist = next((p for p in mock_playlists if p['id'] == playlist_id), mock_playlists[0])
            tracks = []
            for track in self._get_mock_tracks():
                tracks.append({"track": track})
            res = {
                **playlist,
                "tracks": {"items": tracks}
            }
        else:
            # Check if tracks are in the response
            if "tracks" not in res or not res["tracks"] or "items" not in res["tracks"] or not res["tracks"]["items"]:
                # Try fetching from playlists/{playlist_id}/tracks
                tracks_res = self._get(f"playlists/{playlist_id}/tracks", auth_token=auth_token)
                if not tracks_res or "items" not in tracks_res:
                    # Try playlists/{playlist_id}/items
                    tracks_res = self._get(f"playlists/{playlist_id}/items", auth_token=auth_token)
                if tracks_res and "items" in tracks_res:
                    res["tracks"] = tracks_res
                else:
                    # Fallback: Search for tracks matching the playlist name
                    p_name = fallback_name or res.get('name', 'Hits')
                    itunes_tracks = self._get_playlist_tracks_from_itunes(p_name, playlist_id)
                    if itunes_tracks:
                        res["tracks"] = {"items": itunes_tracks}
                    else:
                        if not playlist_id.startswith('mock_'):
                            search_query = res.get('name', 'hits')
                            search_res = self.search(search_query, types="track", limit=30, auth_token=auth_token)
                            if search_res and "tracks" in search_res and search_res["tracks"].get("items"):
                                items = [{"track": t} for t in search_res["tracks"]["items"] if t is not None]
                                res["tracks"] = {"items": items}
                
            if "tracks" in res and "items" in res["tracks"]:
                track_items = [item for item in res["tracks"]["items"] if item is not None and item.get("track") is not None]
                res["tracks"]["items"] = track_items
                tracks = [item["track"] for item in track_items]
                self._resolve_tracks_previews(tracks)
            cache.set(cache_key, res, 86400)
            
        return res

    def get_track(self, track_id, auth_token=None):
        if not track_id:
            return None
        if str(track_id).startswith("itunes_"):
            cache_key = f"spotify_track_{track_id}"
            cached = cache.get(cache_key)
            if cached:
                return cached
            
            itunes_id = str(track_id).replace("itunes_track_", "").replace("itunes_", "")
            try:
                url = "https://itunes.apple.com/lookup"
                response = requests.get(url, params={"id": itunes_id}, timeout=5)
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        item = results[0]
                        track = {
                            "id": track_id,
                            "name": item.get("trackName"),
                            "artists": [{"id": f"itunes_art_{item.get('artistId')}", "name": item.get("artistName")}],
                            "album": {
                                "id": f"itunes_alb_{item.get('collectionId')}",
                                "name": item.get("collectionName"),
                                "images": [{"url": item.get("artworkUrl100", "").replace("100x100bb", "600x600bb")}] if item.get("artworkUrl100") else [],
                                "release_date": item.get("releaseDate", "2024-01-01")[:10]
                            },
                            "preview_url": item.get("previewUrl", ""),
                            "duration_ms": item.get("trackTimeMillis", 180000),
                            "explicit": item.get("trackExplicitness") == "explicit",
                            "popularity": 50,
                            "uri": f"spotify:track:{track_id}"
                        }
                        cache.set(cache_key, track, 86400 * 7)
                        return track
            except Exception as e:
                logger.warning(f"Error looking up iTunes track {track_id}: {e}")

        if str(track_id).startswith("mock_"):
            mock_tracks = self._get_mock_tracks()
            track = next((t for t in mock_tracks if t['id'] == track_id), mock_tracks[0])
            return track

        cache_key = f"spotify_track_{track_id}"
        cached = cache.get(cache_key)
        if cached:
            return cached

        if not self.is_configured and not auth_token:
            mock_tracks = self._get_mock_tracks()
            track = next((t for t in mock_tracks if t['id'] == track_id), mock_tracks[0])
            return track
        res = self._get(f"tracks/{track_id}", auth_token=auth_token)
        if not res:
            mock_tracks = self._get_mock_tracks()
            res = next((t for t in mock_tracks if t['id'] == track_id), mock_tracks[0])
        else:
            if not res.get("preview_url"):
                tracks = self._resolve_tracks_previews([res])
                if tracks:
                    res = tracks[0]
            cache.set(cache_key, res, 86400)
                
        return res

    def get_recommendations(self, seed_artists=None, seed_genres=None, seed_tracks=None, limit=12, auth_token=None):
        if not self.is_configured and not auth_token:
            return {"tracks": self._get_mock_tracks()}
            
        params = {"limit": limit}
        if seed_artists:
            params["seed_artists"] = seed_artists
        if seed_genres:
            params["seed_genres"] = seed_genres
        if seed_tracks:
            params["seed_tracks"] = seed_tracks
            
        if not (seed_artists or seed_genres or seed_tracks):
            params["seed_genres"] = "pop,rock,indie"
            
        res = self._get("recommendations", params, auth_token=auth_token)
        if not res:
            # Fallback: Search for tracks matching the seeds since recommendations endpoint is deprecated/404
            fallback_query = "pop"
            if seed_tracks:
                first_track_id = seed_tracks.split(',')[0]
                track_details = self.get_track(first_track_id, auth_token=auth_token)
                if track_details and not track_details.get('id', '').startswith('mock_'):
                    artists = track_details.get('artists', [])
                    artist_name = artists[0].get('name') if artists else ""
                    if artist_name:
                        fallback_query = f"artist:\"{artist_name}\""
            elif seed_artists:
                first_artist_id = seed_artists.split(',')[0]
                artist_details = self.get_artist(first_artist_id, auth_token=auth_token)
                if artist_details and not artist_details.get('id', '').startswith('mock_'):
                    artist_name = artist_details.get('name')
                    if artist_name:
                        fallback_query = f"artist:\"{artist_name}\""
            elif seed_genres:
                first_genre = seed_genres.split(',')[0]
                fallback_query = f"genre:\"{first_genre}\""
                
            search_res = self.search(fallback_query, types="track", limit=limit, auth_token=auth_token)
            if search_res and "tracks" in search_res and search_res["tracks"].get("items"):
                tracks = search_res["tracks"]["items"]
                return {"tracks": self._resolve_tracks_previews(tracks)}
            return {"tracks": self._get_mock_tracks()}
            
        if res and "tracks" in res:
            res["tracks"] = self._resolve_tracks_previews(res["tracks"])
            
        return res

    # --- MOCK DATA FOR DEMO STATE (WHEN CLIENT KEY IS BLANK) ---

    def _get_mock_tracks(self):
        # Beautiful mock tracks playing royalty-free music from SoundHelix
        return [
            {
                "id": "mock_track_1",
                "name": "Summer Breeze",
                "duration_ms": 372000,
                "preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                "album": {
                    "id": "mock_album_1",
                    "name": "Ocean Waves",
                    "images": [{"url": "https://picsum.photos/id/10/300/300"}]
                },
                "artists": [{"id": "mock_artist_1", "name": "Lumina Project"}],
                "popularity": 85
            },
            {
                "id": "mock_track_2",
                "name": "Midnight Drive",
                "duration_ms": 423000,
                "preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
                "album": {
                    "id": "mock_album_2",
                    "name": "Retro Neon",
                    "images": [{"url": "https://picsum.photos/id/12/300/300"}]
                },
                "artists": [{"id": "mock_artist_2", "name": "Sunset Kid"}],
                "popularity": 78
            },
            {
                "id": "mock_track_3",
                "name": "Cyber Dreamer",
                "duration_ms": 302000,
                "preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
                "album": {
                    "id": "mock_album_3",
                    "name": "Virtual Reality",
                    "images": [{"url": "https://picsum.photos/id/18/300/300"}]
                },
                "artists": [{"id": "mock_artist_3", "name": "Vector Force"}],
                "popularity": 80
            },
            {
                "id": "mock_track_4",
                "name": "Chilled Coffee",
                "duration_ms": 286000,
                "preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
                "album": {
                    "id": "mock_album_4",
                    "name": "Lo-Fi Mornings",
                    "images": [{"url": "https://picsum.photos/id/29/300/300"}]
                },
                "artists": [{"id": "mock_artist_4", "name": "Acoustic Blend"}],
                "popularity": 72
            },
            {
                "id": "mock_track_5",
                "name": "Starlight Odyssey",
                "duration_ms": 344000,
                "preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
                "album": {
                    "id": "mock_album_1",
                    "name": "Ocean Waves",
                    "images": [{"url": "https://picsum.photos/id/10/300/300"}]
                },
                "artists": [{"id": "mock_artist_1", "name": "Lumina Project"}],
                "popularity": 69
            },
            {
                "id": "mock_track_6",
                "name": "Ambient Space",
                "duration_ms": 390000,
                "preview_url": None, # Demonstrates the preview unavailable case
                "album": {
                    "id": "mock_album_2",
                    "name": "Retro Neon",
                    "images": [{"url": "https://picsum.photos/id/12/300/300"}]
                },
                "artists": [{"id": "mock_artist_2", "name": "Sunset Kid"}],
                "popularity": 60
            }
        ]

    def _get_mock_albums(self):
        return [
            {
                "id": "mock_album_1",
                "name": "Ocean Waves",
                "album_type": "album",
                "release_date": "2024-05-12",
                "images": [{"url": "https://picsum.photos/id/10/400/400"}],
                "artists": [{"id": "mock_artist_1", "name": "Lumina Project"}]
            },
            {
                "id": "mock_album_2",
                "name": "Retro Neon",
                "album_type": "album",
                "release_date": "2024-02-18",
                "images": [{"url": "https://picsum.photos/id/12/400/400"}],
                "artists": [{"id": "mock_artist_2", "name": "Sunset Kid"}]
            },
            {
                "id": "mock_album_3",
                "name": "Virtual Reality",
                "album_type": "album",
                "release_date": "2023-11-05",
                "images": [{"url": "https://picsum.photos/id/18/400/400"}],
                "artists": [{"id": "mock_artist_3", "name": "Vector Force"}]
            },
            {
                "id": "mock_album_4",
                "name": "Lo-Fi Mornings",
                "album_type": "album",
                "release_date": "2024-06-01",
                "images": [{"url": "https://picsum.photos/id/29/400/400"}],
                "artists": [{"id": "mock_artist_4", "name": "Acoustic Blend"}]
            }
        ]

    def _get_mock_artists(self):
        return [
            {
                "id": "mock_artist_1",
                "name": "Lumina Project",
                "genres": ["ambient", "chillout", "electronic"],
                "images": [{"url": "https://picsum.photos/id/1025/400/400"}],
                "followers": {"total": 125430},
                "popularity": 75
            },
            {
                "id": "mock_artist_2",
                "name": "Sunset Kid",
                "genres": ["synthwave", "retro", "electronic"],
                "images": [{"url": "https://picsum.photos/id/342/400/400"}],
                "followers": {"total": 89400},
                "popularity": 68
            },
            {
                "id": "mock_artist_3",
                "name": "Vector Force",
                "genres": ["cyberpunk", "synthwave"],
                "images": [{"url": "https://picsum.photos/id/443/400/400"}],
                "followers": {"total": 54200},
                "popularity": 62
            },
            {
                "id": "mock_artist_4",
                "name": "Acoustic Blend",
                "genres": ["acoustic", "indie folk", "lo-fi"],
                "images": [{"url": "https://picsum.photos/id/319/400/400"}],
                "followers": {"total": 142050},
                "popularity": 70
            }
        ]

    def _get_mock_playlists(self):
        return [
            {
                "id": "mock_playlist_1",
                "name": "Today's Top Nexonic Hits",
                "description": "The hottest hits streaming right now on Nexonic. Updated daily.",
                "images": [{"url": "https://picsum.photos/id/445/400/400"}],
                "owner": {"display_name": "Nexonic Editorial"}
            },
            {
                "id": "mock_playlist_2",
                "name": "Chill Vibe Station",
                "description": "Kick back and relax with this collection of ambient and lo-fi tunes.",
                "images": [{"url": "https://picsum.photos/id/1043/400/400"}],
                "owner": {"display_name": "Nexonic Chill"}
            },
            {
                "id": "mock_playlist_3",
                "name": "Late Night Synthesis",
                "description": "Synthwave and retro tracks for the night driving mood.",
                "images": [{"url": "https://picsum.photos/id/1057/400/400"}],
                "owner": {"display_name": "Retro Beats"}
            }
        ]

    def _get_mock_categories(self):
        return [
            {"id": "pop", "name": "Pop", "icons": [{"url": "https://picsum.photos/id/102/300/300"}]},
            {"id": "hiphop", "name": "Hip-Hop", "icons": [{"url": "https://picsum.photos/id/104/300/300"}]},
            {"id": "rock", "name": "Rock", "icons": [{"url": "https://picsum.photos/id/106/300/300"}]},
            {"id": "dance", "name": "Dance & Electronic", "icons": [{"url": "https://picsum.photos/id/108/300/300"}]},
            {"id": "jazz", "name": "Jazz", "icons": [{"url": "https://picsum.photos/id/110/300/300"}]},
            {"id": "ambient", "name": "Ambient", "icons": [{"url": "https://picsum.photos/id/112/300/300"}]}
        ]

    def _get_mock_search(self, query, types):
        query = query.lower()
        
        tracks = [t for t in self._get_mock_tracks() if query in t['name'].lower() or query in t['artists'][0]['name'].lower()]
        albums = [a for a in self._get_mock_albums() if query in a['name'].lower()]
        artists = [art for art in self._get_mock_artists() if query in art['name'].lower()]
        playlists = [p for p in self._get_mock_playlists() if query in p['name'].lower()]
        
        # Simple mocks for shows and episodes as required
        shows = [
            {
                "id": "mock_show_1",
                "name": "The Nexonic Podcast",
                "publisher": "Nexonic Talks",
                "images": [{"url": "https://picsum.photos/id/302/300/300"}],
                "description": "All about tech, design, and premium sound systems."
            }
        ] if query in "the nexonic podcast tech design sound" else []
        
        episodes = [
            {
                "id": "mock_episode_1",
                "name": "Designing a Premium Spotify Clone",
                "description": "In this episode, we dive into database architecture and vanilla JS media controllers.",
                "duration_ms": 1800000,
                "release_date": "2026-07-01",
                "images": [{"url": "https://picsum.photos/id/304/300/300"}],
                "audio_preview_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"
            }
        ] if query in "designing a premium spotify clone database architecture" else []

        result = {}
        if "track" in types:
            result["tracks"] = {"items": tracks}
        if "album" in types:
            result["albums"] = {"items": albums}
        if "artist" in types:
            result["artists"] = {"items": artists}
        if "playlist" in types:
            result["playlists"] = {"items": playlists}
        if "show" in types or "shows" in types:
            result["shows"] = {"items": shows}
        if "episode" in types or "episodes" in types:
            result["episodes"] = {"items": episodes}
            
        return result
