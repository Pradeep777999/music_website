// Song Studio Sequencer & Synthesizer Engine
class SongStudio {
    constructor() {
        this.audioCtx = null;
        this.isPlaying = false;
        
        // Sequencer Clock properties
        this.currentStep = 0;
        this.nextStepTime = 0.0;
        this.lookahead = 25.0; // milliseconds
        this.scheduleAheadTime = 0.1; // seconds
        this.timerId = null;
        
        // Default Settings
        this.bpm = 120;
        this.masterVolume = 0.7; // 0.0 to 1.0
        
        // Synth Settings
        this.waveType = 'sine';
        this.adsr = {
            attack: 0.1,  // seconds
            decay: 0.2,   // seconds
            sustain: 0.7, // gain multiplier (0-1)
            release: 0.5  // seconds
        };
        this.filterCutoff = 20000; // Hz
        this.filterQ = 1.0;
        
        // Sequence Grid State
        this.gridState = {
            kick: Array(16).fill(false),
            snare: Array(16).fill(false),
            hihat: Array(16).fill(false),
            clap: Array(16).fill(false),
            synth: {
                "C5": Array(16).fill(false),
                "B4": Array(16).fill(false),
                "A4": Array(16).fill(false),
                "G4": Array(16).fill(false),
                "F4": Array(16).fill(false),
                "E4": Array(16).fill(false),
                "D4": Array(16).fill(false),
                "C4": Array(16).fill(false)
            }
        };

        // Note frequencies mapping
        this.frequencies = {
            "C4": 261.63, "C#4": 277.18, "D4": 293.66, "D#4": 311.13, "E4": 329.63,
            "F4": 349.23, "F#4": 369.99, "G4": 392.00, "G#4": 415.30, "A4": 440.00,
            "A#4": 466.16, "B4": 493.88, "C5": 523.25
        };

        // Custom Track properties
        this.customAudioBuffer = null;
        this.customAudioBlob = null;
        this.customAudioTriggerStep = 0;
        this.customAudioVolume = 0.8;
        this.customAudioMuted = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.activeCustomAudioSources = [];
        this.db = null;

        this.initDOMElements();
        this.initEventListeners();
        this.initDB().then(() => {
            this.loadPreloadedData();
        }).catch(err => {
            console.error("IndexedDB failed to init, loading data anyway:", err);
            this.loadPreloadedData();
        });
    }


    initDOMElements() {
        this.playBtn = document.getElementById('btn-studio-play');
        this.stopBtn = document.getElementById('btn-studio-stop');
        this.bpmSlider = document.getElementById('bpm-slider');
        this.bpmNumber = document.getElementById('bpm-number');
        this.volumeSlider = document.getElementById('master-volume');
        this.volumeDisplay = document.getElementById('volume-display');
        this.clearBtn = document.getElementById('btn-clear-grid');
        this.randomBtn = document.getElementById('btn-randomize');
        this.exportBtn = document.getElementById('btn-export-wav');
        this.saveBtn = document.getElementById('btn-save-project');
        
        // ADSR Inputs
        this.attackInput = document.getElementById('adsr-attack');
        this.decayInput = document.getElementById('adsr-decay');
        this.sustainInput = document.getElementById('adsr-sustain');
        this.releaseInput = document.getElementById('adsr-release');
        
        this.attackVal = document.getElementById('attack-val');
        this.decayVal = document.getElementById('decay-val');
        this.sustainVal = document.getElementById('sustain-val');
        this.releaseVal = document.getElementById('release-val');
        this.adsrIndicator = document.getElementById('adsr-indicator');

        // Filter Inputs
        this.filterCutoffInput = document.getElementById('filter-cutoff');
        this.filterCutoffVal = document.getElementById('filter-cutoff-val');
        this.filterQInput = document.getElementById('filter-q');
        this.filterQVal = document.getElementById('filter-q-val');

        // Modal
        this.saveModal = document.getElementById('save-project-modal');
        this.saveModalClose = document.getElementById('save-modal-close-btn');
        this.saveModalCancel = document.getElementById('save-modal-cancel-btn');
        this.saveModalConfirm = document.getElementById('save-modal-confirm-btn');
        this.projectNameInput = document.getElementById('project-name-input');
        this.projectTitleDisplay = document.getElementById('project-title-display');
        this.currentSongIdInput = document.getElementById('current-song-id');
        this.projectsList = document.getElementById('projects-list');

        // Custom Audio elements
        this.customUploadZone = document.getElementById('custom-upload-zone');
        this.customFileInput = document.getElementById('custom-file-input');
        this.customTriggerSelect = document.getElementById('custom-trigger-step');
        this.btnRecord = document.getElementById('btn-record-audio');
        this.recordingIndicator = document.getElementById('recording-indicator');
        this.customWaveformCanvas = document.getElementById('custom-waveform-canvas');
        this.btnClearCustom = document.getElementById('btn-clear-custom');
        this.btnMuteCustom = document.getElementById('btn-mute-custom');

        // Studio search elements
        this.studioSearchInput = document.getElementById('studio-search-input');
        this.studioSearchResults = document.getElementById('studio-search-results');
    }



    initEventListeners() {
        // Sequencer Playback controls
        this.playBtn.addEventListener('click', () => this.togglePlayback());
        this.stopBtn.addEventListener('click', () => this.stopPlayback());

        // BPM adjustments
        this.bpmSlider.addEventListener('input', (e) => {
            this.bpm = parseInt(e.target.value);
            this.bpmNumber.value = this.bpm;
        });
        this.bpmNumber.addEventListener('change', (e) => {
            let val = parseInt(e.target.value);
            if (val < 60) val = 60;
            if (val > 200) val = 200;
            this.bpm = val;
            this.bpmSlider.value = this.bpm;
            this.bpmNumber.value = this.bpm;
        });

        // Master Volume
        this.volumeSlider.addEventListener('input', (e) => {
            this.masterVolume = parseInt(e.target.value) / 100;
            this.volumeDisplay.textContent = e.target.value + "%";
        });

        // Grid Click Handling
        document.querySelectorAll('.step-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                const row = cell.closest('.sequencer-row');
                const channel = row.dataset.channel;
                const step = parseInt(cell.dataset.step);
                
                cell.classList.toggle('active');
                const isActive = cell.classList.contains('active');

                if (channel === 'synth') {
                    const note = row.dataset.note;
                    this.gridState.synth[note][step] = isActive;
                    if (isActive) this.playLiveNote(note); // Audition note
                } else {
                    this.gridState[channel][step] = isActive;
                    if (isActive) this.playLiveDrum(channel); // Audition sound
                }
            });
        });

        // Live playable keyboard
        document.querySelectorAll('.piano-key').forEach(key => {
            key.addEventListener('mousedown', () => {
                key.classList.add('active');
                this.playLiveNote(key.dataset.note);
            });
            key.addEventListener('mouseup', () => {
                key.classList.remove('active');
            });
            key.addEventListener('mouseleave', () => {
                key.classList.remove('active');
            });
        });

        // Keyboard Hotkeys
        window.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT') return; // Skip if typing in input
            const activeKey = document.querySelector(`.piano-key[data-key="${e.key.toLowerCase()}"]`);
            if (activeKey && !activeKey.classList.contains('active')) {
                activeKey.classList.add('active');
                this.playLiveNote(activeKey.dataset.note);
            }
        });
        window.addEventListener('keyup', (e) => {
            const activeKey = document.querySelector(`.piano-key[data-key="${e.key.toLowerCase()}"]`);
            if (activeKey) {
                activeKey.classList.remove('active');
            }
        });

        // Waveform buttons
        document.querySelectorAll('.btn-wave').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-wave').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.waveType = btn.dataset.wave;
            });
        });

        // ADSR slider updates
        this.attackInput.addEventListener('input', (e) => {
            this.adsr.attack = parseFloat(e.target.value) / 100;
            this.attackVal.textContent = this.adsr.attack.toFixed(2) + "s";
            this.updateAdsrIndicator();
        });
        this.decayInput.addEventListener('input', (e) => {
            this.adsr.decay = parseFloat(e.target.value) / 100;
            this.decayVal.textContent = this.adsr.decay.toFixed(2) + "s";
            this.updateAdsrIndicator();
        });
        this.sustainInput.addEventListener('input', (e) => {
            this.adsr.sustain = parseFloat(e.target.value) / 100;
            this.sustainVal.textContent = this.adsr.sustain.toFixed(1);
            this.updateAdsrIndicator();
        });
        this.releaseInput.addEventListener('input', (e) => {
            this.adsr.release = parseFloat(e.target.value) / 100;
            this.releaseVal.textContent = this.adsr.release.toFixed(2) + "s";
            this.updateAdsrIndicator();
        });

        // Filter adjustments
        this.filterCutoffInput.addEventListener('input', (e) => {
            this.filterCutoff = parseInt(e.target.value);
            this.filterCutoffVal.textContent = this.filterCutoff + " Hz";
        });
        this.filterQInput.addEventListener('input', (e) => {
            this.filterQ = parseFloat(e.target.value);
            this.filterQVal.textContent = this.filterQ.toFixed(1);
        });

        // Grid functions
        this.clearBtn.addEventListener('click', () => this.clearGrid());
        this.randomBtn.addEventListener('click', () => this.randomizeGrid());
        this.exportBtn.addEventListener('click', () => this.exportWav());

        // Saving Project
        this.saveBtn.addEventListener('click', () => this.openSaveModal());
        this.saveModalClose.addEventListener('click', () => this.closeSaveModal());
        this.saveModalCancel.addEventListener('click', () => this.closeSaveModal());
        this.saveModalConfirm.addEventListener('click', () => this.saveProjectToServer());

        // Load & Delete delegated actions from drawer
        if (this.projectsList) {
            this.projectsList.addEventListener('click', (e) => {
                const loadBtn = e.target.closest('.btn-project-load');
                const deleteBtn = e.target.closest('.btn-project-delete');
                
                if (loadBtn) {
                    const id = loadBtn.dataset.id;
                    this.loadProjectFromServer(id);
                } else if (deleteBtn) {
                    const id = deleteBtn.dataset.id;
                    this.deleteProjectFromServer(id);
                }
            });
        }

        // Custom Audio Drag & Drop & Selection Listeners
        if (this.customUploadZone) {
            this.customUploadZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.customUploadZone.classList.add('dragover');
            });
            this.customUploadZone.addEventListener('dragleave', () => {
                this.customUploadZone.classList.remove('dragover');
            });
            this.customUploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                this.customUploadZone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    this.handleCustomFile(e.dataTransfer.files[0]);
                }
            });
            this.customUploadZone.addEventListener('click', () => {
                this.customFileInput.click();
            });
        }
        if (this.customFileInput) {
            this.customFileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleCustomFile(e.target.files[0]);
                }
            });
        }

        // Record Audio Toggle
        if (this.btnRecord) {
            this.btnRecord.addEventListener('click', () => {
                this.initAudio();
                this.pauseGlobalPlayer();
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording();
                }
            });
        }

        // Clear Custom Audio Track
        if (this.btnClearCustom) {
            this.btnClearCustom.addEventListener('click', () => {
                this.customAudioBuffer = null;
                this.customAudioBlob = null;
                const canvas = this.customWaveformCanvas;
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
                const uploadPrompt = document.getElementById('custom-upload-prompt');
                if (uploadPrompt) uploadPrompt.style.display = 'block';
                const songId = this.currentSongIdInput.value;
                if (songId) {
                    this.deleteAudioFromLocalDB(songId);
                }
            });
        }

        // Mute Custom Audio Track
        if (this.btnMuteCustom) {
            this.btnMuteCustom.addEventListener('click', () => {
                this.customAudioMuted = !this.customAudioMuted;
                this.btnMuteCustom.classList.toggle('active', this.customAudioMuted);
                this.btnMuteCustom.innerHTML = this.customAudioMuted ? 
                    '<i class="fas fa-volume-mute"></i> Unmute' : 
                    '<i class="fas fa-volume-up"></i> Mute';
            });
        }

        // Trigger Step select change
        if (this.customTriggerSelect) {
            this.customTriggerSelect.addEventListener('change', (e) => {
                this.customAudioTriggerStep = parseInt(e.target.value);
            });
        }

        // Online Search in Studio
        if (this.studioSearchInput) {
            let studioSearchTimeout = null;
            this.studioSearchInput.addEventListener('input', () => {
                clearTimeout(studioSearchTimeout);
                const query = this.studioSearchInput.value.trim();
                
                if (query.length < 2) {
                    this.studioSearchResults.innerHTML = '';
                    return;
                }
                
                studioSearchTimeout = setTimeout(() => {
                    fetch(`/search/?q=${encodeURIComponent(query)}`, {
                        headers: { 'X-Requested-With': 'XMLHttpRequest' }
                    })
                    .then(res => res.json())
                    .then(data => {
                        this.studioSearchResults.innerHTML = '';
                        const tracks = data.tracks || [];
                        
                        if (tracks.length === 0) {
                            this.studioSearchResults.innerHTML = '<div style="padding:8px; color:var(--text-muted); font-size:11px; text-align:center;">No songs found.</div>';
                            return;
                        }
                        
                        tracks.forEach(track => {
                            if (!track || !track.preview_url) return;
                            
                            const item = document.createElement('div');
                            item.className = 'studio-search-item';
                            
                            let artUrl = 'https://picsum.photos/100';
                            if (track.album && track.album.images && track.album.images.length > 0) {
                                artUrl = track.album.images[0].url;
                            }
                            
                            item.innerHTML = `
                                <div class="studio-item-info">
                                    <img class="studio-item-art" src="${artUrl}" alt="">
                                    <div style="overflow:hidden; text-align:left;">
                                        <div class="studio-item-title">${track.name}</div>
                                        <div class="studio-item-artist">${track.artists[0].name}</div>
                                    </div>
                                </div>
                                <button class="btn-studio-load-track">LOAD</button>
                            `;
                            
                            item.querySelector('.btn-studio-load-track').addEventListener('click', () => {
                                this.loadAudioFromUrl(track.preview_url, track.name, track.artists[0].name);
                                this.studioSearchInput.value = '';
                                this.studioSearchResults.innerHTML = '';
                            });
                            
                            this.studioSearchResults.appendChild(item);
                        });
                    })
                    .catch(err => {
                        console.error("Studio track search failed", err);
                    });
                }, 400);
            });
        }
    }



    updateAdsrIndicator() {
        this.adsrIndicator.textContent = `A: ${this.adsr.attack.toFixed(2)}s D: ${this.adsr.decay.toFixed(2)}s S: ${this.adsr.sustain.toFixed(1)} R: ${this.adsr.release.toFixed(2)}s`;
    }

    // Audio Engine Setup
    initAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    pauseGlobalPlayer() {
        if (window.player) {
            if (window.player.audio && !window.player.audio.paused) {
                window.player.audio.pause();
                const playPauseBtn = document.getElementById('player-play-pause');
                if (playPauseBtn) playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            }
            if (window.player.isSpotifyActive && window.player.spotifyPlayer) {
                window.player.spotifyPlayer.pause().catch(err => console.log(err));
            }
        }
    }

    // Sequencer Loop scheduler logic
    togglePlayback() {
        this.initAudio();
        this.pauseGlobalPlayer();
        
        if (this.isPlaying) {
            this.timerId && clearInterval(this.timerId);
            this.isPlaying = false;
            this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
            this.playBtn.classList.remove('active');
            this.stopActiveCustomSources();
        } else {
            this.isPlaying = true;
            this.playBtn.innerHTML = '<i class="fas fa-pause"></i>';
            this.playBtn.classList.add('active');
            
            this.currentStep = 0;
            this.nextStepTime = this.audioCtx.currentTime;
            this.timerId = setInterval(() => this.scheduler(), this.lookahead);
        }
    }

    stopPlayback() {
        if (this.isPlaying) {
            this.togglePlayback();
        }
        this.currentStep = 0;
        this.removePlayheadStyles();
        this.stopActiveCustomSources();
    }

    scheduler() {
        while (this.nextStepTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
            this.scheduleStep(this.currentStep, this.nextStepTime);
            this.advanceStep();
        }
    }

    advanceStep() {
        const secondsPerBeat = 60.0 / this.bpm;
        const stepDuration = 0.25 * secondsPerBeat; // 16th notes
        
        this.nextStepTime += stepDuration;
        
        // Move visual playhead
        const prevStep = (this.currentStep - 1 + 16) % 16;
        document.querySelectorAll(`.step-cell[data-step="${prevStep}"]`).forEach(c => c.classList.remove('playhead-active'));
        document.querySelectorAll(`.step-cell[data-step="${this.currentStep}"]`).forEach(c => c.classList.add('playhead-active'));
        
        this.currentStep = (this.currentStep + 1) % 16;
    }

    removePlayheadStyles() {
        document.querySelectorAll('.step-cell').forEach(c => c.classList.remove('playhead-active'));
    }

    scheduleStep(step, time) {
        // Trigger drums
        if (this.gridState.kick[step]) this.synthesizeKick(time);
        if (this.gridState.snare[step]) this.synthesizeSnare(time);
        if (this.gridState.hihat[step]) this.synthesizeHihat(time);
        if (this.gridState.clap[step]) this.synthesizeClap(time);
        
        // Trigger synth notes
        Object.keys(this.gridState.synth).forEach(note => {
            if (this.gridState.synth[note][step]) {
                this.synthesizeNote(this.frequencies[note], time);
            }
        });

        // Trigger custom audio track at trigger step
        if (step === this.customAudioTriggerStep && this.customAudioBuffer && !this.customAudioMuted) {
            this.playCustomAudioBuffer(time);
        }
    }


    // --- Drum Synthesisers ---
    
    synthesizeKick(time, offlineCtx = null) {
        const ctx = offlineCtx || this.audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        
        // Route to Master node (offline triggers route differently)
        if (offlineCtx) {
            gain.connect(ctx.destination);
        } else {
            const masterGain = this.getMasterGainNode();
            gain.connect(masterGain);
        }
        
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.15);
        
        gain.gain.setValueAtTime(this.masterVolume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
        
        osc.start(time);
        osc.stop(time + 0.15);
    }

    synthesizeSnare(time, offlineCtx = null) {
        const ctx = offlineCtx || this.audioCtx;
        
        // 1. Noise channel
        const bufferSize = ctx.sampleRate * 0.2;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noiseNode = ctx.createBufferSource();
        noiseNode.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1000, time);
        
        const noiseGain = ctx.createGain();
        noiseNode.connect(filter);
        filter.connect(noiseGain);
        
        // 2. Click transient channel
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.connect(oscGain);
        
        if (offlineCtx) {
            noiseGain.connect(ctx.destination);
            oscGain.connect(ctx.destination);
        } else {
            const masterGain = this.getMasterGainNode();
            noiseGain.connect(masterGain);
            oscGain.connect(masterGain);
        }
        
        // Snare sweep setup
        osc.frequency.setValueAtTime(180, time);
        osc.frequency.exponentialRampToValueAtTime(100, time + 0.08);
        oscGain.gain.setValueAtTime(this.masterVolume * 0.8, time);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
        
        noiseGain.gain.setValueAtTime(this.masterVolume * 0.6, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
        
        osc.start(time);
        osc.stop(time + 0.08);
        
        noiseNode.start(time);
        noiseNode.stop(time + 0.2);
    }

    synthesizeHihat(time, offlineCtx = null) {
        const ctx = offlineCtx || this.audioCtx;
        
        // Noise buffer
        const bufferSize = ctx.sampleRate * 0.05;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noiseNode = ctx.createBufferSource();
        noiseNode.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(7000, time);
        
        const gain = ctx.createGain();
        noiseNode.connect(filter);
        filter.connect(gain);
        
        if (offlineCtx) {
            gain.connect(ctx.destination);
        } else {
            const masterGain = this.getMasterGainNode();
            gain.connect(masterGain);
        }
        
        gain.gain.setValueAtTime(this.masterVolume * 0.35, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
        
        noiseNode.start(time);
        noiseNode.stop(time + 0.05);
    }

    synthesizeClap(time, offlineCtx = null) {
        const ctx = offlineCtx || this.audioCtx;
        
        // Make noise burst
        const bufferSize = ctx.sampleRate * 0.25;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noiseNode = ctx.createBufferSource();
        noiseNode.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, time);
        
        const gainNode = ctx.createGain();
        noiseNode.connect(filter);
        filter.connect(gainNode);
        
        if (offlineCtx) {
            gainNode.connect(ctx.destination);
        } else {
            const masterGain = this.getMasterGainNode();
            gainNode.connect(masterGain);
        }
        
        // Multi-trigger pulse envelopes simulating clap reverb delay
        const now = time;
        const v = this.masterVolume * 0.6;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(v, now + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
        
        gainNode.gain.setValueAtTime(0, now + 0.015);
        gainNode.gain.linearRampToValueAtTime(v * 0.8, now + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        
        gainNode.gain.setValueAtTime(0, now + 0.03);
        gainNode.gain.linearRampToValueAtTime(v * 0.6, now + 0.035);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        
        noiseNode.start(now);
        noiseNode.stop(now + 0.25);
    }

    // --- Melodic Synthesizer Voice ---
    
    synthesizeNote(freq, time, duration = 0.2, offlineCtx = null) {
        const ctx = offlineCtx || this.audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        
        osc.type = this.waveType;
        osc.frequency.setValueAtTime(freq, time);
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(this.filterCutoff, time);
        filter.Q.setValueAtTime(this.filterQ, time);
        
        osc.connect(filter);
        filter.connect(gain);
        
        if (offlineCtx) {
            gain.connect(ctx.destination);
        } else {
            const masterGain = this.getMasterGainNode();
            gain.connect(masterGain);
        }
        
        // Apply ADSR Envelope calculations
        const t = time;
        const vol = this.masterVolume * 0.5;
        const attackEnd = t + this.adsr.attack;
        const decayEnd = attackEnd + this.adsr.decay;
        const releaseTime = decayEnd + duration;
        
        gain.gain.setValueAtTime(0, t);
        // Attack
        gain.gain.linearRampToValueAtTime(vol, attackEnd);
        // Decay to Sustain
        gain.gain.exponentialRampToValueAtTime(vol * this.adsr.sustain, decayEnd);
        // Release
        gain.gain.setValueAtTime(vol * this.adsr.sustain, releaseTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, releaseTime + this.adsr.release);
        
        osc.start(t);
        osc.stop(releaseTime + this.adsr.release);
    }

    // Audition notes live from piano keyboard
    playLiveNote(note) {
        this.initAudio();
        this.pauseGlobalPlayer();
        const freq = this.frequencies[note];
        if (freq) {
            this.synthesizeNote(freq, this.audioCtx.currentTime, 0.15);
        }
    }

    playLiveDrum(drum) {
        this.initAudio();
        this.pauseGlobalPlayer();
        if (drum === 'kick') this.synthesizeKick(this.audioCtx.currentTime);
        else if (drum === 'snare') this.synthesizeSnare(this.audioCtx.currentTime);
        else if (drum === 'hihat') this.synthesizeHihat(this.audioCtx.currentTime);
        else if (drum === 'clap') this.synthesizeClap(this.audioCtx.currentTime);
    }

    getMasterGainNode() {
        if (!this.masterGainNode) {
            this.masterGainNode = this.audioCtx.createGain();
            this.masterGainNode.connect(this.audioCtx.destination);
        }
        this.masterGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
        return this.masterGainNode;
    }

    // --- Grid Utilities ---

    clearGrid() {
        this.gridState.kick.fill(false);
        this.gridState.snare.fill(false);
        this.gridState.hihat.fill(false);
        this.gridState.clap.fill(false);
        Object.keys(this.gridState.synth).forEach(note => {
            this.gridState.synth[note].fill(false);
        });
        
        document.querySelectorAll('.step-cell').forEach(c => c.classList.remove('active'));
    }

    randomizeGrid() {
        this.clearGrid();
        
        // Randomize Kick (strong downbeats)
        for (let i = 0; i < 16; i++) {
            if (i % 4 === 0) {
                this.gridState.kick[i] = true;
            } else if (Math.random() < 0.2) {
                this.gridState.kick[i] = true;
            }
            
            // Randomize Snare (beats 4 and 12)
            if (i === 4 || i === 12) {
                this.gridState.snare[i] = true;
            } else if (Math.random() < 0.1) {
                this.gridState.snare[i] = true;
            }
            
            // Randomize Hi-hat (continuous off-beats)
            if (i % 2 === 1) {
                this.gridState.hihat[i] = Math.random() < 0.75;
            } else {
                this.gridState.hihat[i] = Math.random() < 0.3;
            }
            
            // Randomize clap
            if (i === 12 && Math.random() < 0.5) {
                this.gridState.clap[i] = true;
            }
            
            // Randomize Synth melody note per step (sometimes empty)
            if (Math.random() < 0.35) {
                const notes = Object.keys(this.gridState.synth);
                const randomNote = notes[Math.floor(Math.random() * notes.length)];
                this.gridState.synth[randomNote][i] = true;
            }
        }
        
        // Render updated grid state visual styles
        this.syncGridUI();
    }

    syncGridUI() {
        // Clear cells
        document.querySelectorAll('.step-cell').forEach(c => c.classList.remove('active'));
        
        // Mapped drum values
        ['kick', 'snare', 'hihat', 'clap'].forEach(drum => {
            this.gridState[drum].forEach((isActive, step) => {
                if (isActive) {
                    const row = document.querySelector(`.sequencer-row[data-channel="${drum}"]`);
                    const cell = row?.querySelector(`.step-cell[data-step="${step}"]`);
                    if (cell) cell.classList.add('active');
                }
            });
        });
        
        // Synth values
        Object.keys(this.gridState.synth).forEach(note => {
            this.gridState.synth[note].forEach((isActive, step) => {
                if (isActive) {
                    const row = document.querySelector(`.synth-row[data-note="${note}"]`);
                    const cell = row?.querySelector(`.step-cell[data-step="${step}"]`);
                    if (cell) cell.classList.add('active');
                }
            });
        });
    }

    // --- SQLite Integration & REST Fetchings ---

    openSaveModal() {
        this.saveModal.style.display = 'flex';
        this.projectNameInput.focus();
    }

    closeSaveModal() {
        this.saveModal.style.display = 'none';
    }

    async saveProjectToServer() {
        const title = this.projectNameInput.value.trim() || 'Untitled Beat';
        const songId = this.currentSongIdInput.value;
        const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || '';
        
        const payload = {
            song_id: songId || null,
            title: title,
            bpm: this.bpm,
            sequence_data: {
                gridState: this.gridState,
                adsr: this.adsr,
                waveType: this.waveType,
                filterCutoff: this.filterCutoff,
                filterQ: this.filterQ,
                customAudioTriggerStep: this.customAudioTriggerStep
            }
        };

        try {
            const response = await fetch('/api/save-custom-song/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            
            if (data.success) {
                this.currentSongIdInput.value = data.song_id;
                this.projectTitleDisplay.textContent = data.title;
                this.closeSaveModal();
                
                // Save custom audio file locally to IndexedDB if it exists
                if (this.customAudioBlob) {
                    await this.saveAudioToLocalDB(data.song_id, this.customAudioBlob);
                }
                
                if (window.player) {
                    window.player.showNotification("Project saved to library!", "success");
                }
                
                this.refreshProjectsListDrawer(data.song_id, data.title, data.bpm, data.updated_at);
            } else {
                alert("Failed to save: " + (data.error || "Unknown error"));
            }
        } catch (err) {
            console.error("Save error:", err);
            alert("Error sending request to database.");
        }
    }


    refreshProjectsListDrawer(songId, title, bpm, dateStr) {
        if (!this.projectsList) return;
        
        // Remove empty state if exists
        const emptyMsg = this.projectsList.querySelector('.empty-projects-message');
        if (emptyMsg) emptyMsg.remove();
        
        // Find existing list item
        let item = this.projectsList.querySelector(`.project-item[data-id="${songId}"]`);
        if (item) {
            // Update metadata
            item.querySelector('.project-item-title').textContent = title;
            item.querySelector('.project-item-details').innerHTML = `${bpm} BPM &bull; Just now`;
        } else {
            // Add new element at top
            item = document.createElement('div');
            item.className = 'project-item active';
            item.dataset.id = songId;
            item.innerHTML = `
                <div class="project-item-meta">
                    <span class="project-item-title">${title}</span>
                    <span class="project-item-details">${bpm} BPM &bull; Just now</span>
                </div>
                <div class="project-item-actions">
                    <button class="btn-project-load" title="Load Project" data-id="${songId}"><i class="fas fa-folder-open"></i></button>
                    <button class="btn-project-delete" title="Delete Project" data-id="${songId}"><i class="fas fa-trash-alt"></i></button>
                </div>
            `;
            this.projectsList.insertBefore(item, this.projectsList.firstChild);
        }
        
        // Highlight active item
        this.projectsList.querySelectorAll('.project-item').forEach(i => {
            if (i.dataset.id == songId) i.classList.add('active');
            else i.classList.remove('active');
        });
    }

    async loadProjectFromServer(songId) {
        try {
            const response = await fetch(`/api/load-custom-song/${songId}/`);
            const data = await response.json();
            
            if (data.success) {
                this.stopPlayback();
                
                const song = data.sequence_data;
                this.currentSongIdInput.value = data.song_id;
                this.projectTitleDisplay.textContent = data.title;
                this.projectNameInput.value = data.title;
                
                this.bpm = data.bpm;
                this.bpmSlider.value = this.bpm;
                this.bpmNumber.value = this.bpm;
                
                // Reconstruct Grid and values
                if (song.gridState) {
                    this.gridState = song.gridState;
                }
                
                if (song.adsr) {
                    this.adsr = song.adsr;
                    this.attackInput.value = this.adsr.attack * 100;
                    this.attackVal.textContent = this.adsr.attack.toFixed(2) + "s";
                    
                    this.decayInput.value = this.adsr.decay * 100;
                    this.decayVal.textContent = this.adsr.decay.toFixed(2) + "s";
                    
                    this.sustainInput.value = this.adsr.sustain * 100;
                    this.sustainVal.textContent = this.adsr.sustain.toFixed(1);
                    
                    this.releaseInput.value = this.adsr.release * 100;
                    this.releaseVal.textContent = this.adsr.release.toFixed(2) + "s";
                    this.updateAdsrIndicator();
                }

                if (song.waveType) {
                    this.waveType = song.waveType;
                    document.querySelectorAll('.btn-wave').forEach(b => {
                        if (b.dataset.wave === this.waveType) b.classList.add('active');
                        else b.classList.remove('active');
                    });
                }

                if (song.filterCutoff) {
                    this.filterCutoff = song.filterCutoff;
                    this.filterCutoffInput.value = this.filterCutoff;
                    this.filterCutoffVal.textContent = this.filterCutoff + " Hz";
                }

                if (song.filterQ) {
                    this.filterQ = song.filterQ;
                    this.filterQInput.value = this.filterQ;
                    this.filterQVal.textContent = this.filterQ.toFixed(1);
                }

                this.syncGridUI();
                
                // Restore custom audio step trigger from saved sequence data if it exists
                if (song.customAudioTriggerStep !== undefined) {
                    this.customAudioTriggerStep = song.customAudioTriggerStep;
                    if (this.customTriggerSelect) this.customTriggerSelect.value = this.customAudioTriggerStep;
                } else {
                    this.customAudioTriggerStep = 0;
                    if (this.customTriggerSelect) this.customTriggerSelect.value = 0;
                }

                // Load custom audio from IndexedDB
                this.customAudioBuffer = null;
                this.customAudioBlob = null;
                const canvas = this.customWaveformCanvas;
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
                const uploadPrompt = document.getElementById('custom-upload-prompt');
                if (uploadPrompt) uploadPrompt.style.display = 'block';

                const audioBlob = await this.loadAudioFromLocalDB(songId);
                if (audioBlob) {
                    this.customAudioBlob = audioBlob;
                    // Decode blob
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    this.initAudio();
                    this.audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
                        this.customAudioBuffer = decodedBuffer;
                        if (uploadPrompt) uploadPrompt.style.display = 'none';
                        this.drawCustomWaveform();
                    }, (err) => console.error("Error decoding saved audio:", err));
                }

                // Active highlighting in project sidebar
                if (this.projectsList) {
                    this.projectsList.querySelectorAll('.project-item').forEach(i => {
                        if (i.dataset.id == songId) i.classList.add('active');
                        else i.classList.remove('active');
                    });
                }

                if (window.player) {
                    window.player.showNotification(`Loaded project: ${data.title}`, "success");
                }
            } else {
                alert("Failed to load project: " + (data.error || "Unknown"));
            }
        } catch (err) {
            console.error("Load project error:", err);
        }
    }

    async deleteProjectFromServer(songId) {
        if (!confirm("Are you sure you want to delete this project?")) return;
        
        const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || '';
        try {
            await this.deleteAudioFromLocalDB(songId);
            const response = await fetch(`/api/delete-custom-song/${songId}/`, {

                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken,
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            if (data.success) {
                // Remove list item
                const item = this.projectsList.querySelector(`.project-item[data-id="${songId}"]`);
                if (item) item.remove();
                
                // If loaded item is deleted, reset variables
                if (this.currentSongIdInput.value == songId) {
                    this.currentSongIdInput.value = '';
                    this.projectTitleDisplay.textContent = 'New Composition';
                    this.projectNameInput.value = '';
                    this.clearGrid();
                }

                if (window.player) {
                    window.player.showNotification("Project deleted successfully", "success");
                }

                if (this.projectsList.children.length === 0) {
                    this.projectsList.innerHTML = `<div class="empty-projects-message" style="font-size:12px; text-align:center; color:var(--text-muted); padding: 20px 0;">No projects saved yet.</div>`;
                }
            } else {
                alert("Delete failed: " + (data.error || "Unknown"));
            }
        } catch (err) {
            console.error("Delete error:", err);
        }
    }

    loadPreloadedData() {
        const preloadedDataInput = document.getElementById('preloaded-sequence-data');
        const preloadedBpmInput = document.getElementById('preloaded-bpm');
        
        if (preloadedDataInput) {
            try {
                const song = JSON.parse(preloadedDataInput.value);
                this.bpm = parseInt(preloadedBpmInput.value || 120);
                this.bpmSlider.value = this.bpm;
                this.bpmNumber.value = this.bpm;
                
                if (song.gridState) {
                    this.gridState = song.gridState;
                }
                
                if (song.adsr) {
                    this.adsr = song.adsr;
                    this.attackInput.value = this.adsr.attack * 100;
                    this.attackVal.textContent = this.adsr.attack.toFixed(2) + "s";
                    this.decayInput.value = this.adsr.decay * 100;
                    this.decayVal.textContent = this.adsr.decay.toFixed(2) + "s";
                    this.sustainInput.value = this.adsr.sustain * 100;
                    this.sustainVal.textContent = this.adsr.sustain.toFixed(1);
                    this.releaseInput.value = this.adsr.release * 100;
                    this.releaseVal.textContent = this.adsr.release.toFixed(2) + "s";
                    this.updateAdsrIndicator();
                }

                if (song.waveType) {
                    this.waveType = song.waveType;
                    document.querySelectorAll('.btn-wave').forEach(b => {
                        if (b.dataset.wave === this.waveType) b.classList.add('active');
                        else b.classList.remove('active');
                    });
                }

                if (song.filterCutoff) {
                    this.filterCutoff = song.filterCutoff;
                    this.filterCutoffInput.value = this.filterCutoff;
                    this.filterCutoffVal.textContent = this.filterCutoff + " Hz";
                }

                if (song.filterQ) {
                    this.filterQ = song.filterQ;
                    this.filterQInput.value = this.filterQ;
                    this.filterQVal.textContent = this.filterQ.toFixed(1);
                }

                this.syncGridUI();
            } catch (err) {
                console.error("Error loading preloaded sequence:", err);
            }
        }
    }

    // --- Offline rendering to WAV downloadable blob ---

    async exportWav() {
        this.initAudio();
        const secondsPerBeat = 60.0 / this.bpm;
        const stepDuration = 0.25 * secondsPerBeat;
        const loopDuration = 16 * stepDuration;
        
        // Export exactly 4 loop iterations for a full song feel (approx 8 seconds at 120bpm)
        const totalLoops = 4;
        const totalDuration = loopDuration * totalLoops;
        const sampleRate = 44100;
        
        this.exportBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Rendering...';
        this.exportBtn.disabled = true;

        try {
            const offlineCtx = new OfflineAudioContext(2, sampleRate * totalDuration, sampleRate);
            
            // Loop and schedule events
            for (let loop = 0; loop < totalLoops; loop++) {
                const loopOffset = loop * loopDuration;
                for (let step = 0; step < 16; step++) {
                    const stepTime = loopOffset + (step * stepDuration);
                    
                    if (this.gridState.kick[step]) this.synthesizeKick(stepTime, offlineCtx);
                    if (this.gridState.snare[step]) this.synthesizeSnare(stepTime, offlineCtx);
                    if (this.gridState.hihat[step]) this.synthesizeHihat(stepTime, offlineCtx);
                    if (this.gridState.clap[step]) this.synthesizeClap(stepTime, offlineCtx);
                    
                    Object.keys(this.gridState.synth).forEach(note => {
                        if (this.gridState.synth[note][step]) {
                            this.synthesizeNote(this.frequencies[note], stepTime, 0.2, offlineCtx);
                        }
                    });

                    // Render custom audio if it exists and is not muted
                    if (step === this.customAudioTriggerStep && this.customAudioBuffer && !this.customAudioMuted) {
                        this.playCustomAudioBuffer(stepTime, offlineCtx);
                    }
                }
            }


            const renderedBuffer = await offlineCtx.startRendering();
            const wavBlob = this.bufferToWav(renderedBuffer);
            
            // Trigger automatic browser download
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            const title = this.projectNameInput.value.trim() || 'Untitled Beat';
            a.download = `${title.toLowerCase().replace(/\s+/g, '_')}.wav`;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 100);
            
            if (window.player) {
                window.player.showNotification("Audio exported successfully!", "success");
            }
        } catch (err) {
            console.error("Offline bounce render error:", err);
            alert("Could not render WAV audio loop.");
        } finally {
            this.exportBtn.innerHTML = '<i class="fas fa-file-download"></i> Export WAV';
            this.exportBtn.disabled = false;
        }
    }

    // Convert AudioBuffer to downloadable 16-bit PCM Stereo WAV Blob
    bufferToWav(buffer) {
        let numOfChan = buffer.numberOfChannels,
            length = buffer.length * numOfChan * 2 + 44,
            bufferArr = new ArrayBuffer(length),
            view = new DataView(bufferArr),
            channels = [], i, sample,
            offset = 0,
            pos = 0;

        // RIFF Header
        setUint32(0x46464952);                         // "RIFF"
        setUint32(length - 8);                         // file length - 8
        setUint32(0x45564157);                         // "WAVE"

        // Format Chunk
        setUint32(0x20746d66);                         // "fmt " chunk
        setUint32(16);                                 // chunk length
        setUint16(1);                                  // sample format (raw PCM)
        setUint16(numOfChan);                          // channel count
        setUint32(buffer.sampleRate);                  // sample rate
        setUint32(buffer.sampleRate * 2 * numOfChan);  // byte rate
        setUint16(numOfChan * 2);                      // block align (channels * bytes/sample)
        setUint16(16);                                 // bits per sample

        // Data Chunk
        setUint32(0x61746264);                         // "data" chunk (using 0x61746264 for PCM "data")
        // Correction: data chunk header is "data" which is 0x61746164 (ASCII for "data")
        // Let's explicitly write 0x61746164
        // Wait, yes, let's fix it:
        pos -= 4; // Reset to write correct ASCII code for "data"
        setUint32(0x61746164);                         // "data" chunk
        setUint32(length - pos - 4);                   // chunk length

        // Interleave channels into 16-bit PCM integer samples
        for(i=0; i<buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while(pos < length) {
            for(i=0; i<numOfChan; i++) {             
                sample = Math.max(-1, Math.min(1, channels[i][offset])); 
                sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF); 
                view.setInt16(pos, sample, true);          
                pos += 2;
            }
            offset++;                                     
        }

        return new Blob([bufferArr], {type: "audio/wav"});

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }

    // --- IndexedDB Local Audio Storage ---
    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("SongStudioDB", 1);
            request.onerror = (e) => reject("IndexedDB error");
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("audio_tracks")) {
                    db.createObjectStore("audio_tracks", { keyPath: "song_id" });
                }
            };
        });
    }

    async saveAudioToLocalDB(songId, blob) {
        if (!this.db || !songId) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["audio_tracks"], "readwrite");
            const store = transaction.objectStore("audio_tracks");
            const request = store.put({ song_id: String(songId), blob: blob });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(false);
        });
    }

    async loadAudioFromLocalDB(songId) {
        if (!this.db || !songId) return null;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["audio_tracks"], "readonly");
            const store = transaction.objectStore("audio_tracks");
            const request = store.get(String(songId));
            request.onsuccess = (e) => {
                resolve(e.target.result ? e.target.result.blob : null);
            };
            request.onerror = () => reject(null);
        });
    }

    async deleteAudioFromLocalDB(songId) {
        if (!this.db || !songId) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["audio_tracks"], "readwrite");
            const store = transaction.objectStore("audio_tracks");
            const request = store.delete(String(songId));
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(false);
        });
    }

    // --- Custom Audio Input & Processing Handlers ---

    handleCustomFile(file) {
        if (!file.type.startsWith('audio/')) {
            alert("Please upload a valid audio file.");
            return;
        }

        this.customAudioBlob = file;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            this.initAudio();
            this.audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
                this.customAudioBuffer = decodedBuffer;
                const uploadPrompt = document.getElementById('custom-upload-prompt');
                if (uploadPrompt) uploadPrompt.style.display = 'none';
                this.drawCustomWaveform();
                if (window.player) {
                    window.player.showNotification("Audio track loaded successfully!", "success");
                }
            }, (err) => {
                console.error("Decode audio error:", err);
                alert("Could not decode audio file.");
            });
        };
        reader.readAsArrayBuffer(file);
    }

    // --- Microphone Live Recording ---

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.recordedChunks = [];
            this.mediaRecorder = new MediaRecorder(stream);
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.recordedChunks.push(e.data);
            };

            this.mediaRecorder.onstop = async () => {
                const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(this.recordedChunks, { type: mimeType });
                this.customAudioBlob = audioBlob;
                
                // Decode recorded data
                const arrayBuffer = await audioBlob.arrayBuffer();
                this.initAudio();
                this.audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
                    this.customAudioBuffer = decodedBuffer;
                    const uploadPrompt = document.getElementById('custom-upload-prompt');
                    if (uploadPrompt) uploadPrompt.style.display = 'none';
                    this.drawCustomWaveform();
                    if (window.player) {
                        window.player.showNotification("Recording loaded into track!", "success");
                    }
                }, (err) => console.error("Error decoding recorded audio:", err));
                
                // Release microphone stream tracks
                stream.getTracks().forEach(track => track.stop());
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.btnRecord.innerHTML = '<i class="fas fa-stop"></i> Stop';
            this.btnRecord.classList.add('active');
            if (this.recordingIndicator) this.recordingIndicator.style.display = 'inline-block';
        } catch (err) {
            console.error("Microphone access denied or error:", err);
            alert("Microphone access denied or not available.");
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.isRecording = false;
        this.btnRecord.innerHTML = '<i class="fas fa-microphone"></i> Record';
        this.btnRecord.classList.remove('active');
        if (this.recordingIndicator) this.recordingIndicator.style.display = 'none';
    }

    // --- Waveform Visualizer Drawer ---

    drawCustomWaveform() {
        const canvas = this.customWaveformCanvas;
        if (!canvas || !this.customAudioBuffer) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.parentElement.clientWidth || 300;
        const height = canvas.height = 42;
        ctx.clearRect(0, 0, width, height);

        const data = this.customAudioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2.2;

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#1db954');
        gradient.addColorStop(0.5, '#191414');
        gradient.addColorStop(1, '#1db954');

        ctx.fillStyle = 'rgba(29, 185, 84, 0.15)';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#1db954';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, amp);

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const idx = (i * step) + j;
                if (idx >= data.length) break;
                const datum = data[idx];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            ctx.lineTo(i, amp + (min * amp));
            ctx.lineTo(i, amp + (max * amp));
        }

        ctx.stroke();
    }

    // --- Custom Track Audio Playback & Stop ---

    playCustomAudioBuffer(time, offlineCtx = null) {
        const ctx = offlineCtx || this.audioCtx;
        
        // Stop any currently playing instances of this custom audio track to prevent overlapping loops
        if (!offlineCtx) {
            this.stopActiveCustomSources();
        }

        const source = ctx.createBufferSource();
        source.buffer = this.customAudioBuffer;

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(this.customAudioVolume, time);

        source.connect(gainNode);

        if (offlineCtx) {
            gainNode.connect(ctx.destination);
        } else {
            const masterGain = this.getMasterGainNode();
            gainNode.connect(masterGain);
            this.activeCustomAudioSources.push(source);
        }

        source.start(time);
    }


    async loadAudioFromUrl(url, title, artist) {
        try {
            if (window.player) {
                window.player.showNotification(`Loading preview: ${title}...`, "info");
            }
            
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            
            // Convert arrayBuffer to a Blob so we can save it to IndexedDB!
            const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' }); // Previews are typically mp3
            this.customAudioBlob = audioBlob;
            
            this.initAudio();
            this.audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
                this.customAudioBuffer = decodedBuffer;
                const uploadPrompt = document.getElementById('custom-upload-prompt');
                if (uploadPrompt) uploadPrompt.style.display = 'none';
                this.drawCustomWaveform();
                if (window.player) {
                    window.player.showNotification(`Loaded track: ${title} by ${artist}`, "success");
                }
            }, (err) => {
                console.error("Decode URL audio error:", err);
                alert("Could not decode track audio preview.");
            });
        } catch (err) {
            console.error("Fetch audio preview failed:", err);
            alert("Could not retrieve track preview.");
        }
    }

    stopActiveCustomSources() {
        if (this.activeCustomAudioSources) {
            this.activeCustomAudioSources.forEach(src => {
                try {
                    src.stop();
                } catch(e) {}
            });
            this.activeCustomAudioSources = [];
        }
    }
}


// Initialise the studio editor once DOM is fully drawn
document.addEventListener('DOMContentLoaded', () => {
    window.studio = new SongStudio();
});

