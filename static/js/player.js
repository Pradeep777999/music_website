// Nexonic Media Player Engine
class NexonicPlayer {
    constructor() {
        this.audio = new Audio();
        this.queue = [];
        this.originalQueue = []; // Backup of original order for turning off shuffle
        this.currentIndex = -1;
        this.isShuffle = false;
        this.repeatState = 'none'; // 'none' | 'all' | 'one'
        
        // CSRF Token Helper
        this.csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || '';

        // Spotify Integration properties
        this.spotifyPlayer = null;
        this.spotifyDeviceId = null;
        this.spotifyAccessToken = null;
        this.isSpotifyActive = false;

        // DOM elements
        this.initDOMElements();
        this.initEventListeners();
        
        // Start Spotify Player connection
        this.initSpotifyPlayer();
    }

    initSpotifyPlayer() {
        if (!window.isSpotifyConnected) return;

        window.onSpotifyWebPlaybackSDKReady = () => {
            this.setupSpotifyPlayerInstance();
        };

        if (window.Spotify && window.Spotify.Player) {
            this.setupSpotifyPlayerInstance();
        }
    }

    async setupSpotifyPlayerInstance() {
        try {
            const token = await this.fetchSpotifyToken();
            if (!token) return;
            this.spotifyAccessToken = token;

            this.spotifyPlayer = new Spotify.Player({
                name: 'Nexonic Web Player',
                getOAuthToken: cb => { cb(token); },
                volume: parseFloat(localStorage.getItem('player-volume') || '0.5')
            });

            // Ready
            this.spotifyPlayer.addListener('ready', ({ device_id }) => {
                console.log('Spotify Player is ready on device:', device_id);
                this.spotifyDeviceId = device_id;
            });

            // Not Ready
            this.spotifyPlayer.addListener('not_ready', ({ device_id }) => {
                console.log('Device ID has gone offline', device_id);
            });

            this.spotifyPlayer.addListener('initialization_error', ({ message }) => {
                console.error('Initialization error:', message);
            });

            this.spotifyPlayer.addListener('authentication_error', ({ message }) => {
                console.error('Authentication error:', message);
            });

            this.spotifyPlayer.addListener('account_error', ({ message }) => {
                console.error('Account error:', message);
                this.showNotification("Spotify Premium is required for official playback.", "error");
            });

            // Playback state changes
            this.spotifyPlayer.addListener('player_state_changed', state => {
                if (!state) return;
                this.handleSpotifyPlayerStateChanged(state);
            });

            this.spotifyPlayer.connect();
        } catch (err) {
            console.error("Failed to setup Spotify Player instance:", err);
        }
    }

    async fetchSpotifyToken() {
        try {
            const response = await fetch('/api/spotify/token/');
            const data = await response.json();
            if (data.success) {
                return data.access_token;
            }
        } catch (err) {
            console.error("Failed to fetch Spotify token:", err);
        }
        return null;
    }

    handleSpotifyPlayerStateChanged(state) {
        if (!this.isSpotifyActive) return;

        const isPlaying = !state.paused;
        const currentTrack = this.queue[this.currentIndex];

        if (currentTrack) {
            this.updatePlayerUI(currentTrack, isPlaying);
        }

        // Update progress bar (convert ms to seconds)
        const position = state.position / 1000;
        const duration = state.duration / 1000;
        this.updateProgressSlider(position, duration);
    }

    initDOMElements() {
        this.playPauseBtn = document.getElementById('player-play-pause');
        this.prevBtn = document.getElementById('player-prev');
        this.nextBtn = document.getElementById('player-next');
        this.shuffleBtn = document.getElementById('player-shuffle');
        this.repeatBtn = document.getElementById('player-repeat');
        
        this.trackArt = document.getElementById('player-art');
        this.trackTitle = document.getElementById('player-title');
        this.trackArtist = document.getElementById('player-artist');
        this.likeBtn = document.getElementById('player-like');
        this.addPlaylistBtn = document.getElementById('player-add-playlist');
        
        this.currentTimeLabel = document.getElementById('player-current-time');
        this.totalTimeLabel = document.getElementById('player-total-time');
        
        this.timelineContainer = document.getElementById('player-timeline-container');
        this.timelineFill = document.getElementById('player-timeline-fill');
        
        this.volumeIcon = document.getElementById('player-volume-icon');
        this.volumeContainer = document.getElementById('player-volume-container');
        this.volumeFill = document.getElementById('player-volume-fill');
        
        this.playlistModal = document.getElementById('add-playlist-modal');
        this.modalClose = document.getElementById('modal-close-btn');
        this.modalList = document.getElementById('modal-playlists-list');
        
        this.queuePanel = document.getElementById('queue-drawer');
        this.queueBtn = document.getElementById('player-queue-toggle');
        this.queueList = document.getElementById('queue-drawer-items');
        
        // Track modal state
        this.selectedTrackForModal = null;
    }

    initEventListeners() {
        // Audio callbacks
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('durationchange', () => this.updateTotalDuration());
        this.audio.addEventListener('ended', () => this.handleTrackEnd());
        
        // Player buttons
        if (this.playPauseBtn) this.playPauseBtn.addEventListener('click', () => this.togglePlay());
        if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.prev());
        if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.next());
        if (this.shuffleBtn) this.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        if (this.repeatBtn) this.repeatBtn.addEventListener('click', () => this.toggleRepeat());
        if (this.likeBtn) this.likeBtn.addEventListener('click', () => this.toggleLikeCurrentTrack());
        if (this.addPlaylistBtn) this.addPlaylistBtn.addEventListener('click', () => {
            if (this.currentIndex >= 0) {
                this.openPlaylistModal(this.queue[this.currentIndex]);
            }
        });
        
        // Progress and Volume Seeking
        if (this.timelineContainer) {
            this.timelineContainer.addEventListener('click', (e) => this.seek(e));
        }
        if (this.volumeContainer) {
            this.volumeContainer.addEventListener('click', (e) => this.seekVolume(e));
        }
        if (this.volumeIcon) {
            this.volumeIcon.addEventListener('click', () => this.toggleMute());
        }

        // Modal triggers
        if (this.modalClose) {
            this.modalClose.addEventListener('click', () => this.closePlaylistModal());
        }
        window.addEventListener('click', (e) => {
            if (e.target === this.playlistModal) this.closePlaylistModal();
        });

        // Queue Drawer
        if (this.queueBtn) {
            this.queueBtn.addEventListener('click', () => {
                this.queuePanel.classList.toggle('show');
                this.queueBtn.classList.toggle('active');
                if (this.queuePanel.classList.contains('show')) {
                    this.renderQueueDrawer();
                }
            });
        }

        // Global page delegation: Entire song row clickable, action buttons independent
        document.addEventListener('click', (e) => {
            const likeTrigger = e.target.closest('[data-action="like-track"]');
            if (likeTrigger) {
                e.preventDefault();
                e.stopPropagation();
                this.handleLikeTrigger(likeTrigger);
                return;
            }

            const playlistTrigger = e.target.closest('[data-action="add-to-playlist"]');
            if (playlistTrigger) {
                e.preventDefault();
                e.stopPropagation();
                const trackData = this.getTrackDataFromElement(playlistTrigger);
                this.openPlaylistModal(trackData);
                return;
            }

            const removePlaylistSongTrigger = e.target.closest('[data-action="remove-playlist-song"]');
            if (removePlaylistSongTrigger) {
                e.preventDefault();
                e.stopPropagation();
                this.handleRemovePlaylistSong(removePlaylistSongTrigger);
                return;
            }

            // Keep independent links (Ringtone Maker, Artist/Album links, dropdown menus) independent
            const independentLinkOrBtn = e.target.closest('a[href], button:not([data-action="play-track"]):not(.player-left)');
            if (independentLinkOrBtn && !independentLinkOrBtn.closest('[data-action="play-track"]')) {
                return;
            }

            // Clicking anywhere on a song row [data-track-id] (thumbnail, title, artist, album, duration, empty space, or play icon)
            const trackRow = e.target.closest('[data-track-id]');
            if (trackRow) {
                e.preventDefault();
                this.playSong(trackRow);
                return;
            }

            // Clicking on the bottom player song bar (.player-left) toggles play/resume
            const playerBarClick = e.target.closest('.player-left');
            if (playerBarClick) {
                e.preventDefault();
                this.togglePlay();
                return;
            }
        });
    }

    getTrackDataFromElement(element) {
        const row = element.closest('[data-track-id]');
        if (!row) return null;
        return {
            id: row.dataset.trackId,
            name: row.dataset.trackName,
            artist: row.dataset.trackArtist,
            album: row.dataset.trackAlbum,
            album_art: row.dataset.trackArt,
            duration_ms: parseInt(row.dataset.trackDuration || 0),
            preview_url: row.dataset.trackPreview || '',
            is_episode: row.dataset.trackIsEpisode === 'true'
        };
    }


    playSong(songOrElement) {
        let trackData = null;
        if (songOrElement && songOrElement.nodeType) {
            trackData = this.getTrackDataFromElement(songOrElement);
        } else if (songOrElement && songOrElement.id) {
            trackData = songOrElement;
        } else {
            return;
        }
        if (!trackData) return;

        // If the track is already the active one, toggle play/pause
        if (this.currentIndex >= 0 && this.queue[this.currentIndex] && this.queue[this.currentIndex].id === trackData.id) {
            this.togglePlay();
            return;
        }

        // Collect all song rows on the page to build a seamless queue
        const siblingRows = document.querySelectorAll('[data-track-id]');
        const pageTracks = [];
        let clickedIndex = 0;

        siblingRows.forEach((row, index) => {
            const t = {
                id: row.dataset.trackId,
                name: row.dataset.trackName,
                artist: row.dataset.trackArtist,
                album: row.dataset.trackAlbum,
                album_art: row.dataset.trackArt,
                duration_ms: parseInt(row.dataset.trackDuration || 0),
                preview_url: row.dataset.trackPreview || '',
                is_episode: row.dataset.trackIsEpisode === 'true'
            };
            pageTracks.push(t);
            if (t.id === trackData.id) {
                clickedIndex = index;
            }
        });

        if (pageTracks.length > 0) {
            this.setQueue(pageTracks, clickedIndex);
        } else {
            this.setQueue([trackData], 0);
        }

        this.updateActiveRowStyles(true);
        this.updatePlayerUI(trackData, true);

        this.play();
    }

    handlePlayTrigger(element) {
        this.playSong(element);
    }

    setQueue(tracks, startIndex = 0) {
        this.originalQueue = [...tracks];
        if (this.isShuffle) {
            this.queue = this.shuffleArray([...tracks]);
            // Find starting track in shuffled array
            this.currentIndex = this.queue.findIndex(t => t.id === tracks[startIndex].id);
            if (this.currentIndex === -1) this.currentIndex = 0;
        } else {
            this.queue = [...tracks];
            this.currentIndex = startIndex;
        }
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    async play() {
        if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) return;
        
        const track = this.queue[this.currentIndex];
        const isSpotifyTrack = track.id && !track.id.startsWith('mock_') && !track.id.startsWith('itunes_');

        if (window.isSpotifyConnected && isSpotifyTrack) {
            this.isSpotifyActive = true;
            this.audio.pause(); // Pause HTML5 audio

            if (!this.spotifyDeviceId) {
                this.showNotification("Connecting to Spotify Web Player...", "info");
                this.playFallback(track);
                return;
            }

            try {
                const token = this.spotifyAccessToken || await this.fetchSpotifyToken();
                if (!token) {
                    this.showNotification("Unable to authorize Spotify connection.", "error");
                    this.playFallback(track);
                    return;
                }
                this.spotifyAccessToken = token;

                const url = `https://api.spotify.com/v1/me/player/play?device_id=${this.spotifyDeviceId}`;
                const uriPrefix = track.is_episode ? 'spotify:episode' : 'spotify:track';
                const response = await fetch(url, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        uris: [`${uriPrefix}:${track.id}`]
                    })
                });


                if (response.status === 204 || response.status === 200) {
                    this.updatePlayerUI(track, true);
                    this.logRecentlyPlayedToServer(track);
                    this.updateActiveRowStyles();
                    if (this.queuePanel.classList.contains('show')) {
                        this.renderQueueDrawer();
                    }
                } else if (response.status === 403) {
                    this.showNotification("Spotify Premium is required. Playing preview fallback.", "warning");
                    this.isSpotifyActive = false;
                    this.playFallback(track);
                } else {
                    console.error("Spotify SDK play failed:", response.status);
                    this.playFallback(track);
                }
            } catch (err) {
                console.error("Spotify SDK play error:", err);
                this.playFallback(track);
            }
        } else {
            this.isSpotifyActive = false;
            if (this.spotifyPlayer) {
                this.spotifyPlayer.pause().catch(err => console.error(err));
            }
            this.playFallback(track);
        }
    }

    async playFallback(track) {
        // Dynamic fallback resolving for real Spotify tracks with missing preview URLs
        if ((!track.preview_url || track.preview_url === 'None' || track.preview_url === '') && track.id && !track.id.startsWith('mock_') && !track.id.startsWith('itunes_')) {
            try {
                if (this.playPauseBtn) {
                    this.playPauseBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
                }
                const response = await fetch(`/api/get-preview/?track_id=${encodeURIComponent(track.id)}&name=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(track.artist)}`);
                const data = await response.json();
                if (data.success && data.preview_url) {
                    track.preview_url = data.preview_url;
                    
                    // Update any matching DOM elements' dataset
                    const rows = document.querySelectorAll(`[data-track-id="${track.id}"]`);
                    rows.forEach(row => {
                        row.dataset.trackPreview = data.preview_url;
                        const playIcon = row.querySelector('.play-icon-table');
                        if (playIcon) {
                            playIcon.removeAttribute('style');
                            playIcon.removeAttribute('title');
                            // If index number was greyed out, reset it
                            const indexNum = row.querySelector('.index-number');
                            if (indexNum) {
                                indexNum.removeAttribute('style');
                            }
                        }
                    });
                }
            } catch (err) {
                console.error("Failed to dynamically fetch track preview:", err);
            }
        }
        
        // Check if track has preview URL
        if (!track.preview_url || track.preview_url === 'None' || track.preview_url === '') {
            if (track.is_episode) {
                track.preview_url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3";
                this.showNotification(`Playing episode audio`, 'info');
            } else {
                track.preview_url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
                this.showNotification(`Playing song audio for: ${track.name}`, 'info');
            }
        }


        // Set audio source
        this.audio.src = track.preview_url;
        this.audio.load();
        
        const playPromise = this.audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.updatePlayerUI(track, true);
                this.logRecentlyPlayedToServer(track);
                this.updateActiveRowStyles();
                if (this.queuePanel.classList.contains('show')) {
                    this.renderQueueDrawer();
                }
            }).catch(error => {
                console.error("Audio playback error:", error);
                this.updatePlayerUI(track, false);
            });
        }
    }

    togglePlay() {
        if (this.currentIndex === -1) {
            // Try playing first track on page if queue is empty
            const firstRow = document.querySelector('[data-action="play-track"]');
            if (firstRow) {
                this.handlePlayTrigger(firstRow);
            }
            return;
        }

        const currentTrack = this.queue[this.currentIndex];
        
        if (this.isSpotifyActive && this.spotifyPlayer) {
            this.spotifyPlayer.togglePlay().catch(err => console.error(err));
        } else {
            if (!currentTrack.preview_url || currentTrack.preview_url === 'None' || currentTrack.preview_url === '') {
                this.play();
                return;
            }

            if (this.audio.paused) {
                this.audio.play()
                    .then(() => {
                        this.updatePlayerUI(currentTrack, true);
                        this.updateActiveRowStyles(true);
                    })
                    .catch(err => console.error(err));
            } else {
                this.audio.pause();
                this.updatePlayerUI(currentTrack, false);
                this.updateActiveRowStyles(false);
            }
        }
    }

    next() {
        if (this.queue.length === 0) return;
        
        if (this.repeatState === 'one') {
            if (this.isSpotifyActive && this.spotifyPlayer) {
                this.spotifyPlayer.seek(0).catch(err => console.error(err));
            } else {
                this.audio.currentTime = 0;
                this.audio.play();
            }
            return;
        }

        this.currentIndex++;
        if (this.currentIndex >= this.queue.length) {
            if (this.repeatState === 'all') {
                this.currentIndex = 0;
            } else {
                this.currentIndex = this.queue.length - 1;
                if (this.isSpotifyActive && this.spotifyPlayer) {
                    this.spotifyPlayer.pause().catch(err => console.error(err));
                } else {
                    this.audio.pause();
                    this.updatePlayerUI(this.queue[this.currentIndex], false);
                }
                return;
            }
        }
        this.play();
    }

    prev() {
        if (this.queue.length === 0) return;

        if (this.isSpotifyActive && this.spotifyPlayer) {
            this.spotifyPlayer.getCurrentState().then(state => {
                if (state && state.position > 3000) {
                    this.spotifyPlayer.seek(0).catch(err => console.error(err));
                } else {
                    this.goToPrevTrack();
                }
            }).catch(() => this.goToPrevTrack());
            return;
        } else {
            if (this.audio.currentTime > 3) {
                this.audio.currentTime = 0;
                return;
            }
            this.goToPrevTrack();
        }
    }

    goToPrevTrack() {
        this.currentIndex--;
        if (this.currentIndex < 0) {
            if (this.repeatState === 'all') {
                this.currentIndex = this.queue.length - 1;
            } else {
                this.currentIndex = 0;
            }
        }
        this.play();
    }

    seek(e) {
        const rect = this.timelineContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const percentage = Math.max(0, Math.min(1, clickX / width));

        if (this.isSpotifyActive && this.spotifyPlayer) {
            if (this.currentIndex >= 0) {
                const track = this.queue[this.currentIndex];
                const positionMs = percentage * track.duration_ms;
                this.spotifyPlayer.seek(positionMs).catch(err => console.error(err));
            }
        } else {
            if (!this.audio.duration) return;
            this.audio.currentTime = percentage * this.audio.duration;
        }
    }

    seekVolume(e) {
        const rect = this.volumeContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        let percentage = clickX / width;
        percentage = Math.max(0, Math.min(1, percentage));
        
        this.audio.volume = percentage;
        if (this.volumeFill) {
            this.volumeFill.style.width = `${percentage * 100}%`;
        }
        
        this.updateVolumeIcon(percentage);
        
        // Save volume setting
        localStorage.setItem('player-volume', percentage);
        
        if (this.spotifyPlayer) {
            this.spotifyPlayer.setVolume(percentage).catch(err => console.error(err));
        }
    }

    toggleMute() {
        if (this.audio.muted) {
            this.audio.muted = false;
            this.updateVolumeIcon(this.audio.volume);
            if (this.volumeFill) this.volumeFill.style.width = `${this.audio.volume * 100}%`;
            if (this.spotifyPlayer) {
                this.spotifyPlayer.setVolume(this.audio.volume).catch(err => console.error(err));
            }
        } else {
            this.audio.muted = true;
            if (this.volumeIcon) this.volumeIcon.className = "fas fa-volume-mute ctrl-btn";
            if (this.volumeFill) this.volumeFill.style.width = "0%";
            if (this.spotifyPlayer) {
                this.spotifyPlayer.setVolume(0).catch(err => console.error(err));
            }
        }
    }

    updateVolumeIcon(volume) {
        if (!this.volumeIcon) return;
        if (volume === 0 || this.audio.muted) {
            this.volumeIcon.className = "fas fa-volume-mute ctrl-btn";
        } else if (volume < 0.5) {
            this.volumeIcon.className = "fas fa-volume-down ctrl-btn";
        } else {
            this.volumeIcon.className = "fas fa-volume-up ctrl-btn";
        }
    }

    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        if (this.shuffleBtn) {
            this.shuffleBtn.classList.toggle('active', this.isShuffle);
        }
        
        if (this.queue.length === 0) return;
        
        const currentTrack = this.queue[this.currentIndex];
        
        if (this.isShuffle) {
            let temp = [...this.originalQueue];
            temp = temp.filter(t => t.id !== currentTrack.id);
            this.queue = [currentTrack, ...this.shuffleArray(temp)];
            this.currentIndex = 0;
        } else {
            this.queue = [...this.originalQueue];
            this.currentIndex = this.queue.findIndex(t => t.id === currentTrack.id);
        }
        
        this.showNotification(this.isShuffle ? "Shuffle on" : "Shuffle off");
        if (this.queuePanel.classList.contains('show')) {
            this.renderQueueDrawer();
        }
    }

    toggleRepeat() {
        if (this.repeatState === 'none') {
            this.repeatState = 'all';
            this.repeatBtn.classList.add('active');
            this.repeatBtn.innerHTML = '<i class="fas fa-redo"></i>';
            this.showNotification("Repeat all");
        } else if (this.repeatState === 'all') {
            this.repeatState = 'one';
            this.repeatBtn.classList.add('active');
            this.repeatBtn.innerHTML = '<span style="position:relative;"><i class="fas fa-redo"></i><span style="position:absolute;font-size:8px;top:-4px;right:-4px;background:#1db954;color:#000;border-radius:50%;padding:1px 3px;font-weight:bold;">1</span></span>';
            this.showNotification("Repeat one");
        } else {
            this.repeatState = 'none';
            this.repeatBtn.classList.remove('active');
            this.repeatBtn.innerHTML = '<i class="fas fa-redo"></i>';
            this.showNotification("Repeat off");
        }
    }

    handleTrackEnd() {
        if (window.sleepTimerEndOfSongActive) {
            if (typeof window.triggerSleepTimerEnd === 'function') {
                window.triggerSleepTimerEnd();
            }
            return;
        }
        this.next();
    }

    updateProgressSlider(currentSeconds, durationSeconds) {
        if (!durationSeconds) return;
        const percent = (currentSeconds / durationSeconds) * 100;
        if (this.timelineFill) {
            this.timelineFill.style.width = `${percent}%`;
        }
        if (this.currentTimeLabel) {
            this.currentTimeLabel.innerText = this.formatTime(currentSeconds);
        }
        if (this.totalTimeLabel) {
            this.totalTimeLabel.innerText = this.formatTime(durationSeconds);
        }
    }

    updateProgress() {
        if (this.isSpotifyActive) return; // Managed separately
        if (!this.audio.duration) return;
        this.updateProgressSlider(this.audio.currentTime, this.audio.duration);
    }

    updateTotalDuration() {
        if (this.isSpotifyActive) return; // Managed separately
        if (this.totalTimeLabel && this.audio.duration) {
            this.totalTimeLabel.innerText = this.formatTime(this.audio.duration);
        }
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    updatePlayerUI(track, isPlaying) {
        if (this.trackArt) this.trackArt.src = track.album_art || 'https://picsum.photos/300';
        if (this.trackTitle) this.trackTitle.innerText = track.name;
        if (this.trackArtist) this.trackArtist.innerText = track.artist;
        
        // Update play button state
        if (this.playPauseBtn) {
            this.playPauseBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
        }

        // Update all play triggers on the page matching this track ID
        document.querySelectorAll('[data-action="play-track"]').forEach(btn => {
            const btnTrackId = btn.dataset.trackId || btn.closest('[data-track-id]')?.dataset.trackId;
            if (btnTrackId === track.id) {
                if (btn.classList.contains('btn-primary')) {
                    btn.innerHTML = isPlaying 
                        ? '<i class="fas fa-pause" style="margin-right: 8px;"></i> PAUSE' 
                        : '<i class="fas fa-play" style="margin-right: 8px;"></i> RESUME';
                } else if (btn.classList.contains('play-icon-table')) {
                    btn.className = isPlaying 
                        ? 'fas fa-pause play-icon-table text-success' 
                        : 'fas fa-play play-icon-table';
                } else {
                    btn.innerHTML = isPlaying 
                        ? '<i class="fas fa-pause"></i>' 
                        : '<i class="fas fa-play"></i>';
                }
            } else {
                // Reset other buttons to play state
                if (btn.classList.contains('btn-primary')) {
                    btn.innerHTML = '<i class="fas fa-play" style="margin-right: 8px;"></i> RESUME';
                } else if (btn.classList.contains('play-icon-table')) {
                    btn.className = 'fas fa-play play-icon-table';
                } else {
                    btn.innerHTML = '<i class="fas fa-play"></i>';
                }
            }
        });
        
        // Sync like heart indicator based on document rows or local state lookup
        this.checkIfTrackIsLiked(track.id);
        
        // Sync document titles or elements
        document.title = isPlaying ? `▶ ${track.name} - ${track.artist} | Nexonic` : "Nexonic - Premium Spotify Clone";
    }

    updateActiveRowStyles() {
        if (this.currentIndex < 0) return;
        const currentTrack = this.queue[this.currentIndex];
        
        // Remove active class from all rows and restore original index number
        document.querySelectorAll('tr[data-track-id]').forEach(row => {
            row.classList.remove('active-row');
            const idxCell = row.querySelector('.index-number');
            if (idxCell) {
                if (row.dataset.originalIndex) {
                    idxCell.innerHTML = row.dataset.originalIndex;
                }
                idxCell.style.color = '';
            }
            const titleCell = row.querySelector('.track-name-main');
            if (titleCell) titleCell.style.color = '';
        });
        
        // Add active style to playing row on screen matching IMAGE 1 exactly
        const activeRows = document.querySelectorAll(`tr[data-track-id="${currentTrack.id}"]`);
        activeRows.forEach(row => {
            row.classList.add('active-row');
            const idxCell = row.querySelector('.index-number');
            if (idxCell) {
                if (!row.dataset.originalIndex && idxCell.textContent.trim()) {
                    row.dataset.originalIndex = idxCell.textContent.trim();
                }
                idxCell.innerHTML = '<i class="fas fa-play" style="color: #a855f7; font-size: 14px;"></i>';
            }
            const titleCell = row.querySelector('.track-name-main');
            if (titleCell) titleCell.style.color = '#1ed760';
        });
    }

    async checkIfTrackIsLiked(trackId) {
        if (!this.likeBtn) return;
        
        // Check if there is an active row on screen matching trackId and see if it's liked
        const row = document.querySelector(`tr[data-track-id="${trackId}"]`);
        const isLikedOnPage = row?.querySelector('[data-action="like-track"] i')?.classList.contains('fas');
        
        if (isLikedOnPage !== undefined) {
            this.updatePlayerLikeButton(isLikedOnPage);
        } else {
            // Default look up in DOM to check
            this.updatePlayerLikeButton(false);
        }
    }

    updatePlayerLikeButton(isLiked) {
        if (!this.likeBtn) return;
        if (isLiked) {
            this.likeBtn.innerHTML = '<i class="fas fa-heart text-success"></i>';
        } else {
            this.likeBtn.innerHTML = '<i class="far fa-heart"></i>';
        }
    }

    // --- DB SYNC OPERATIONS via FETCH API ---

    async logRecentlyPlayedToServer(track) {
        try {
            await fetch('/api/recently-played/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    track_id: track.id,
                    track_name: track.name,
                    artist_name: track.artist,
                    album_name: track.album,
                    album_image: track.album_art,
                    duration_ms: track.duration_ms,
                    preview_url: track.preview_url
                })
            });
        } catch (e) {
            console.error("Failed to log recently played:", e);
        }
    }

    async toggleLikeCurrentTrack() {
        if (this.currentIndex === -1) return;
        const track = this.queue[this.currentIndex];
        await this.toggleLikeTrack(track);
    }

    async toggleLikeTrack(track) {
        try {
            const res = await fetch('/api/like-song/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    track_id: track.id,
                    track_name: track.name,
                    artist_name: track.artist,
                    album_name: track.album,
                    album_image: track.album_art,
                    duration_ms: track.duration_ms,
                    preview_url: track.preview_url
                })
            });
            const data = await res.json();
            if (data.success) {
                // Update player heart
                if (this.currentIndex >= 0 && this.queue[this.currentIndex].id === track.id) {
                    this.updatePlayerLikeButton(data.liked);
                }
                
                // Update page hearts
                const pageHearts = document.querySelectorAll(`[data-track-id="${track.id}"] [data-action="like-track"]`);
                pageHearts.forEach(btn => {
                    if (data.liked) {
                        btn.innerHTML = '<i class="fas fa-heart text-success"></i>';
                        btn.classList.add('active');
                    } else {
                        btn.innerHTML = '<i class="far fa-heart"></i>';
                        btn.classList.remove('active');
                    }
                });
                
                this.showNotification(data.liked ? "Added to Liked Songs" : "Removed from Liked Songs");
            }
        } catch (e) {
            console.error("Error toggling like status:", e);
        }
    }

    handleLikeTrigger(element) {
        const trackData = this.getTrackDataFromElement(element);
        if (!trackData) return;
        this.toggleLikeTrack(trackData);
    }

    // --- PLAYLIST MODAL OPERATIONS ---

    openPlaylistModal(trackData) {
        this.selectedTrackForModal = trackData;
        this.playlistModal.classList.add('show');
        this.loadPlaylistsForModal();
    }

    closePlaylistModal() {
        this.playlistModal.classList.remove('show');
        this.selectedTrackForModal = null;
    }

    async loadPlaylistsForModal() {
        if (!this.modalList) return;
        this.modalList.innerHTML = '<div style="text-align:center;padding:20px;color:#9fa0a6;"><i class="fas fa-circle-notch fa-spin"></i> Loading playlists...</div>';
        
        try {
            const response = await fetch('/playlists/api/my-playlists/');
            const data = await response.json();
            
            if (data.success && data.playlists.length > 0) {
                this.modalList.innerHTML = '';
                data.playlists.forEach(playlist => {
                    const item = document.createElement('div');
                    item.className = 'modal-list-item';
                    item.innerHTML = `
                        <img class="modal-list-art" src="${playlist.cover_url || 'https://picsum.photos/id/1043/100/100'}" alt="">
                        <div class="modal-list-name">${playlist.name}</div>
                        <div class="modal-list-count">${playlist.songs_count} tracks</div>
                    `;
                    item.addEventListener('click', () => this.addTrackToPlaylist(playlist.id));
                    this.modalList.appendChild(item);
                });
            } else {
                this.modalList.innerHTML = `
                    <div class="modal-empty-state">
                        <p style="margin-bottom:12px;">You don't have any playlists yet.</p>
                        <a href="/playlists/create/" class="btn-primary" style="display:inline-flex;padding:8px 16px;font-size:12px;">Create Playlist</a>
                    </div>
                `;
            }
        } catch (e) {
            this.modalList.innerHTML = '<div style="text-align:center;padding:20px;color:#bd2130;">Error loading playlists.</div>';
            console.error(e);
        }
    }

    async addTrackToPlaylist(playlistId) {
        if (!this.selectedTrackForModal) return;
        const track = this.selectedTrackForModal;
        
        try {
            const response = await fetch('/playlists/api/add-song/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    playlist_id: playlistId,
                    track_id: track.id,
                    track_name: track.name,
                    artist_name: track.artist,
                    album_name: track.album,
                    album_image: track.album_art,
                    duration_ms: track.duration_ms,
                    preview_url: track.preview_url
                })
            });
            const data = await response.json();
            if (data.success) {
                this.showNotification(data.message, 'success');
                this.closePlaylistModal();
            } else {
                this.showNotification(data.error, 'error');
            }
        } catch (e) {
            console.error(e);
            this.showNotification('Failed to add track to playlist', 'error');
        }
    }

    async handleRemovePlaylistSong(element) {
        const row = element.closest('[data-track-id]');
        const playlistId = element.dataset.playlistId;
        if (!row || !playlistId) return;
        
        const trackId = row.dataset.trackId;
        
        try {
            const response = await fetch('/playlists/api/remove-song/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    playlist_id: playlistId,
                    track_id: trackId
                })
            });
            const data = await response.json();
            if (data.success) {
                this.showNotification(data.message, 'success');
                row.remove(); // Remove track from list immediately
                
                // Recalculate track counters or index labels
                document.querySelectorAll('.tracks-table tbody tr').forEach((r, idx) => {
                    const idxCell = r.querySelector('.index-number');
                    if (idxCell && !r.classList.contains('active-row')) {
                        idxCell.innerText = idx + 1;
                    }
                });
            } else {
                this.showNotification(data.error, 'error');
            }
        } catch (e) {
            console.error(e);
            this.showNotification('Failed to remove track', 'error');
        }
    }

    // --- QUEUE DRAWER DRAWING ---

    renderQueueDrawer() {
        if (!this.queueList) return;
        this.queueList.innerHTML = '';
        
        if (this.queue.length === 0) {
            this.queueList.innerHTML = '<div style="text-align:center;padding:40px 0;color:#9fa0a6;font-size:13px;">Queue is empty.</div>';
            return;
        }
        
        this.queue.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = `queue-item ${index === this.currentIndex ? 'active' : ''}`;
            item.innerHTML = `
                <img class="queue-item-art" src="${track.album_art || 'https://picsum.photos/100'}" alt="">
                <div class="queue-item-info">
                    <div class="queue-item-name">${track.name}</div>
                    <div class="queue-item-artist">${track.artist}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                this.currentIndex = index;
                this.play();
            });
            this.queueList.appendChild(item);
        });
    }

    // --- NOTIFICATION BANNER UTILITY ---

    showNotification(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `message-alert ${type}`;
        toast.innerHTML = `
            <span>${message}</span>
            <span class="message-close">&times;</span>
        `;
        
        toast.querySelector('.message-close').addEventListener('click', () => toast.remove());
        container.appendChild(toast);
        
        // Auto remove after 3.5s
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 3500);
    }
}

// Instantiate globally on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.player = new NexonicPlayer();
    window.playSong = (song) => window.player && window.player.playSong(song);
});
