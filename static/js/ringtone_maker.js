/* Ringtone Maker Logic - Web Audio API Visualizer & WAV PCM Encoder */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dropzone = document.getElementById('ringtone-dropzone');
    const fileInput = document.getElementById('ringtone-file-input');
    const loader = document.getElementById('ringtone-loader');
    const loaderText = document.getElementById('loader-text');
    const editorSection = document.getElementById('ringtone-editor-section');
    const successCard = document.getElementById('ringtone-success-card');
    
    // Waveform Elements
    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');
    const selectionHighlight = document.getElementById('trim-selection-highlight');
    const handleLeft = document.getElementById('trim-handle-left');
    const handleRight = document.getElementById('trim-handle-right');
    const progressLine = document.getElementById('waveform-progress-line');
    
    // Timing Input Elements
    const inputStart = document.getElementById('trim-start-input');
    const inputEnd = document.getElementById('trim-end-input');
    const inputDuration = document.getElementById('trim-duration-input');
    
    // Controls
    const btnPlay = document.getElementById('btn-play-trim');
    const btnPlayIcon = btnPlay.querySelector('i');
    const btnLoop = document.getElementById('btn-loop-trim');
    const btnExport = document.getElementById('btn-export-ringtone');
    
    // Search Elements
    const searchInput = document.getElementById('ringtone-search-input');
    const searchResults = document.getElementById('ringtone-search-results');
    
    // Audio Variables
    let audioCtx = null;
    let audioBuffer = null;
    let audioSource = null;
    let gainNode = null;
    
    let isPlaying = false;
    let isLooping = true;
    let startTime = 0;
    let endTime = 30; // Default 30s selection
    let duration = 0;
    
    let playOffset = 0;
    let playbackStartRealTime = 0;
    let progressAnimFrameId = null;
    let activeDragHandle = null;
    let totalSamples = 0;
    let peakData = [];

    // Preloaded Song Handling
    const preloadTitle = document.getElementById('preload-title');
    if (preloadTitle && preloadTitle.value) {
        const title = preloadTitle.value;
        const artist = document.getElementById('preload-artist').value;
        const previewUrl = document.getElementById('preload-preview-url').value;
        const artUrl = document.getElementById('preload-image').value;
        
        if (previewUrl) {
            loadAudioFromUrl(previewUrl, title, artist, artUrl);
        }
    }

    // Initialize Audio Context on Interaction
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // 1. Drag and Drop handlers
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--brand-green)';
        dropzone.style.background = 'rgba(95, 0, 219, 0.05)';
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = 'var(--border-color)';
        dropzone.style.background = 'transparent';
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--border-color)';
        dropzone.style.background = 'transparent';
        
        if (e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    function handleFileSelection(file) {
        if (!file.type.startsWith('audio/')) {
            alert('Please select a valid audio file.');
            return;
        }
        initAudio();
        stopPreview();
        
        // Hide success card
        successCard.style.display = 'none';
        
        // Display loader
        loader.style.display = 'flex';
        editorSection.style.display = 'none';
        loaderText.innerText = `Decoding ${file.name}...`;

        const reader = new FileReader();
        reader.onload = function(e) {
            audioCtx.decodeAudioData(e.target.result)
                .then(decodedBuffer => {
                    setupAudioWorkspace(decodedBuffer, file.name);
                })
                .catch(err => {
                    console.error("Audio decode failed", err);
                    alert("Failed to decode audio file. Make sure it is a valid format (MP3, WAV, etc.)");
                    loader.style.display = 'none';
                });
        };
        reader.readAsArrayBuffer(file);
    }

    // 2. Fetch and load audio from Spotify/iTunes URL
    function loadAudioFromUrl(url, title, artist, artUrl) {
        initAudio();
        stopPreview();
        
        successCard.style.display = 'none';
        loader.style.display = 'flex';
        editorSection.style.display = 'none';
        loaderText.innerText = `Fetching preview from internet...`;

        // Load visual track info header
        const preloadContainer = document.getElementById('ringtone-preload-info-container');
        preloadContainer.innerHTML = `
            <div class="song-preload-info">
                <img class="song-preload-art" src="${artUrl || 'https://picsum.photos/150'}" alt="">
                <div class="song-preload-details">
                    <div class="song-preload-title">${title}</div>
                    <div class="song-preload-artist">${artist}</div>
                </div>
            </div>
        `;

        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error('Fetch failed');
                return res.arrayBuffer();
            })
            .then(arrayBuffer => {
                loaderText.innerText = "Decoding audio data...";
                return audioCtx.decodeAudioData(arrayBuffer);
            })
            .then(decodedBuffer => {
                setupAudioWorkspace(decodedBuffer, `${title} - ${artist}`);
            })
            .catch(err => {
                console.error("Failed to load audio preview URL", err);
                alert("Failed to fetch or decode the track preview directly due to security restrictions. Try searching and loading another track, or download it and drop the local file here instead!");
                loader.style.display = 'none';
            });
    }

    // 3. Audio Setup and Waveform Processing
    function setupAudioWorkspace(buffer, filename) {
        audioBuffer = buffer;
        duration = buffer.duration;
        
        // Initial trim settings: select first 30 seconds or the whole track if shorter
        startTime = 0;
        endTime = Math.min(30, duration);
        
        // Transition UI first so elements are visible and canvas dimensions can be measured correctly
        loader.style.display = 'none';
        editorSection.style.display = 'block';
        btnExport.removeAttribute('disabled');
        
        // Render Waveform Peak Data
        generateWaveformPeaks(buffer);
        resizeCanvas();
        drawWaveform();
        updateTimeInputs();
        
        // Update document title for file download naming
        btnExport.dataset.filename = filename.replace(/\.[^/.]+$/, "") + " (Nexonic Ringtone).wav";
    }

    function generateWaveformPeaks(buffer) {
        const channelData = buffer.getChannelData(0); // View first channel
        const totalLength = channelData.length;
        const width = canvas.offsetWidth || 800;
        const sampleSize = Math.floor(totalLength / width);
        
        peakData = [];
        for (let i = 0; i < width; i++) {
            let start = i * sampleSize;
            let end = start + sampleSize;
            let min = 0;
            let max = 0;
            
            for (let j = start; j < end; j++) {
                let sample = channelData[j];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }
            peakData.push({ min, max });
        }
    }

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    }

    function drawWaveform() {
        if (!peakData.length) return;
        
        const width = canvas.width / (window.devicePixelRatio || 1);
        const height = canvas.height / (window.devicePixelRatio || 1);
        const centerY = height / 2;
        
        ctx.clearRect(0, 0, width, height);
        
        // Render waveform bars
        const barWidth = 2;
        const gap = 1;
        const count = peakData.length;
        
        const isLightTheme = document.documentElement.classList.contains('light-theme');
        
        // Dynamic green theme colors matching the mockup
        const selectedColor = '#1db954'; // Vibrant green
        const unselectedColor = isLightTheme ? '#a7f3d0' : '#114c3e'; // Muted light green vs dark forest green
        
        for (let i = 0; i < count; i++) {
            const peak = peakData[i];
            const x = i * (barWidth + gap);
            
            // Normalize peak sizes to fit nicely inside canvas height
            const peakHeight = Math.max(2, (peak.max - peak.min) * centerY * 0.95);
            const y = centerY - (peakHeight / 2);
            
            // Render selection highlight vs background
            const timeAtBar = (i / count) * duration;
            if (timeAtBar >= startTime && timeAtBar <= endTime) {
                ctx.fillStyle = selectedColor;
            } else {
                ctx.fillStyle = unselectedColor;
            }
            
            ctx.fillRect(x, y, barWidth, peakHeight);
        }
        
        updateSelectionOverlay();
    }

    function updateSelectionOverlay() {
        const width = canvas.getBoundingClientRect().width;
        
        const leftPercent = (startTime / duration) * 100;
        const rightPercent = (endTime / duration) * 100;
        
        selectionHighlight.style.left = `${leftPercent}%`;
        selectionHighlight.style.width = `${rightPercent - leftPercent}%`;
        
        handleLeft.style.left = `${leftPercent}%`;
        handleRight.style.left = `${rightPercent}%`;
    }

    // 4. Drag & Slide Handles Interaction
    function handleMarkerDrag(e) {
        if (!activeDragHandle) return;
        
        const rect = canvas.getBoundingClientRect();
        const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const dragTime = (x / rect.width) * duration;
        
        const minLength = 0.5; // Min 0.5s loop duration
        
        if (activeDragHandle === 'left') {
            startTime = Math.min(dragTime, endTime - minLength);
        } else if (activeDragHandle === 'right') {
            endTime = Math.max(dragTime, startTime + minLength);
        }
        
        drawWaveform();
        updateTimeInputs();
        
        // If preview is playing, adjust on-the-fly or loop immediately
        if (isPlaying) {
            // Keep playing without crashing
            checkTimelinePlaybackBoundaries();
        }
    }

    function setupDragListeners(handle, side) {
        const startDrag = (e) => {
            e.preventDefault();
            activeDragHandle = side;
            handle.classList.add('active');
            document.body.style.cursor = 'ew-resize';
            
            window.addEventListener('mousemove', handleMarkerDrag);
            window.addEventListener('touchmove', handleMarkerDrag);
            window.addEventListener('mouseup', endDrag);
            window.addEventListener('touchend', endDrag);
        };
        
        const endDrag = () => {
            if (activeDragHandle) {
                handle.classList.remove('active');
                activeDragHandle = null;
                document.body.style.cursor = '';
                window.removeEventListener('mousemove', handleMarkerDrag);
                window.removeEventListener('touchmove', handleMarkerDrag);
                window.removeEventListener('mouseup', endDrag);
                window.removeEventListener('touchend', endDrag);
            }
        };
        
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag);
    }

    setupDragListeners(handleLeft, 'left');
    setupDragListeners(handleRight, 'right');

    window.addEventListener('resize', () => {
        if (audioBuffer) {
            resizeCanvas();
            generateWaveformPeaks(audioBuffer);
            drawWaveform();
        }
    });

    // 5. Precise Input Fields Sync
    function updateTimeInputs() {
        inputStart.value = startTime.toFixed(2);
        inputEnd.value = endTime.toFixed(2);
        inputDuration.value = (endTime - startTime).toFixed(2);
    }

    [inputStart, inputEnd].forEach(input => {
        input.addEventListener('change', () => {
            let startVal = parseFloat(inputStart.value) || 0;
            let endVal = parseFloat(inputEnd.value) || 0;
            const minLength = 0.5;
            
            if (startVal < 0) startVal = 0;
            if (endVal > duration) endVal = duration;
            
            if (input === inputStart) {
                startTime = Math.min(startVal, endTime - minLength);
            } else {
                endTime = Math.max(endVal, startTime + minLength);
            }
            
            drawWaveform();
            updateTimeInputs();
        });
    });

    // 6. Playback Control Engine (Web Audio API Context nodes)
    btnPlay.addEventListener('click', () => {
        if (isPlaying) {
            stopPreview();
        } else {
            playPreview();
        }
    });

    btnLoop.addEventListener('click', () => {
        isLooping = !isLooping;
        btnLoop.classList.toggle('active', isLooping);
    });

    function playPreview() {
        if (!audioBuffer) return;
        initAudio();
        
        // Stop any running instances first
        stopAudioSource();
        
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = audioBuffer;
        
        // Setup volume envelope
        audioSource.connect(gainNode);
        
        // Start playing segment
        const playDuration = endTime - startTime;
        
        playbackStartRealTime = performance.now();
        playOffset = startTime;
        
        audioSource.start(0, startTime, playDuration);
        
        isPlaying = true;
        btnPlayIcon.className = 'fas fa-pause';
        progressLine.style.display = 'block';
        
        // Loop trigger setting
        audioSource.onended = () => {
            if (isPlaying) {
                const currentRealOffset = playOffset + (performance.now() - playbackStartRealTime) / 1000;
                if (currentRealOffset >= endTime - 0.1) {
                    if (isLooping) {
                        playPreview();
                    } else {
                        stopPreview();
                    }
                }
            }
        };
        
        // Draw progressive timeline
        progressAnimFrameId = requestAnimationFrame(updatePlaybackProgress);
    }

    function checkTimelinePlaybackBoundaries() {
        if (!isPlaying || !audioSource) return;
        const elapsed = (performance.now() - playbackStartRealTime) / 1000;
        const currentPosition = playOffset + elapsed;
        
        if (currentPosition >= endTime) {
            if (isLooping) {
                playPreview();
            } else {
                stopPreview();
            }
        }
    }

    function stopAudioSource() {
        if (audioSource) {
            try {
                audioSource.stop();
            } catch (e) {}
            audioSource.disconnect();
            audioSource = null;
        }
    }

    function stopPreview() {
        isPlaying = false;
        btnPlayIcon.className = 'fas fa-play';
        progressLine.style.display = 'none';
        
        stopAudioSource();
        
        if (progressAnimFrameId) {
            cancelAnimationFrame(progressAnimFrameId);
            progressAnimFrameId = null;
        }
    }

    function updatePlaybackProgress() {
        if (!isPlaying) return;
        
        const elapsed = (performance.now() - playbackStartRealTime) / 1000;
        const currentPosition = playOffset + elapsed;
        
        if (currentPosition > endTime) {
            // Managed by checkTimelinePlaybackBoundaries but double cover
            if (isLooping) {
                playPreview();
                return;
            } else {
                stopPreview();
                return;
            }
        }
        
        const percent = (currentPosition / duration) * 100;
        progressLine.style.left = `${percent}%`;
        
        progressAnimFrameId = requestAnimationFrame(updatePlaybackProgress);
    }

    // 7. Client-side WAV Encoder
    btnExport.addEventListener('click', () => {
        if (!audioBuffer) return;
        
        btnExport.setAttribute('disabled', 'true');
        btnExport.innerHTML = '<i class="fas fa-spinner fa-spin"></i> EXPORTING...';
        
        setTimeout(() => {
            try {
                // Slice AudioBuffer and export WAV
                const trimDuration = endTime - startTime;
                const sampleRate = audioBuffer.sampleRate;
                const numChannels = audioBuffer.numberOfChannels;
                const startSample = Math.floor(startTime * sampleRate);
                const numSamples = Math.floor(trimDuration * sampleRate);
                
                // Create a new offline context or sub-buffer context
                const trimmedBuffer = audioCtx.createBuffer(numChannels, numSamples, sampleRate);
                
                // Copy channel segment data
                for (let channel = 0; channel < numChannels; channel++) {
                    const originalData = audioBuffer.getChannelData(channel);
                    const trimmedData = trimmedBuffer.getChannelData(channel);
                    
                    for (let i = 0; i < numSamples; i++) {
                        trimmedData[i] = originalData[startSample + i];
                    }
                }
                
                // Generate WAV file Blob
                const wavBlob = bufferToWav(trimmedBuffer);
                const blobUrl = URL.createObjectURL(wavBlob);
                
                // Trigger download
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = btnExport.dataset.filename || 'ringtone.wav';
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                }, 100);
                
                // Display Success Panel
                successCard.style.display = 'flex';
                successCard.scrollIntoView({ behavior: 'smooth' });
                
            } catch (err) {
                console.error("Export failed", err);
                alert("Failed to export WAV audio snippet.");
            } finally {
                btnExport.removeAttribute('disabled');
                btnExport.innerHTML = '<i class="fas fa-download"></i> EXPORT RINGTONE';
            }
        }, 300);
    });

    // Native binary WAV writer/generator
    function bufferToWav(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const bufferArr = new ArrayBuffer(length);
        const view = new DataView(bufferArr);
        const channels = [];
        let offset = 0;
        let pos = 0;

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }

        // Write WAV descriptor headers
        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"
        setUint32(0x20746d66); // "fmt " chunk
        setUint32(16);         // fmt chunk length (16 bytes)
        setUint16(1);          // sample format (1 = PCM raw)
        setUint16(numOfChan);
        setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * numOfChan * 2); // Byte rate
        setUint16(numOfChan * 2); // block align
        setUint16(16);         // Bits per sample (16-bit PCM)
        setUint32(0x61746164); // "data" chunk
        setUint32(buffer.length * numOfChan * 2); // chunk length

        for (let i = 0; i < numOfChan; i++) {
            channels.push(buffer.getChannelData(i));
        }

        const totalLength = buffer.length;
        for (let idx = 0; idx < totalLength; idx++) {
            for (let channel = 0; channel < numOfChan; channel++) {
                let sample = channels[channel][idx];
                // Clamp floats between [-1, 1]
                sample = Math.max(-1, Math.min(1, sample));
                // Convert float to int16
                sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
                view.setInt16(pos, sample, true);
                pos += 2;
            }
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    // 8. Search Online Integration
    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = searchInput.value.trim();
        
        if (query.length < 2) {
            searchResults.innerHTML = '';
            return;
        }
        
        searchTimeout = setTimeout(() => {
            fetch(`/search/?q=${encodeURIComponent(query)}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
                .then(res => res.json())
                .then(data => {
                    searchResults.innerHTML = '';
                    const tracks = data.tracks || [];
                    
                    if (tracks.length === 0) {
                        searchResults.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:13px; text-align:center;">No songs found.</div>';
                        return;
                    }
                    
                    tracks.forEach(track => {
                        if (!track || !track.preview_url) return; // Must have preview URL to download/clip
                        
                        const item = document.createElement('div');
                        item.className = 'ringtone-search-item';
                        
                        let artUrl = 'https://picsum.photos/100';
                        if (track.album && track.album.images && track.album.images.length > 0) {
                            artUrl = track.album.images[0].url;
                        }
                        
                        item.innerHTML = `
                            <div class="ringtone-item-info">
                                <img class="ringtone-item-art" src="${artUrl}" alt="">
                                <div>
                                    <div class="ringtone-item-title">${track.name}</div>
                                    <div class="ringtone-item-artist">${track.artists[0].name}</div>
                                </div>
                            </div>
                            <button class="btn-load-track">LOAD</button>
                        `;
                        
                        item.querySelector('.btn-load-track').addEventListener('click', () => {
                            loadAudioFromUrl(track.preview_url, track.name, track.artists[0].name, artUrl);
                            searchInput.value = '';
                            searchResults.innerHTML = '';
                        });
                        
                        searchResults.appendChild(item);
                    });
                })
                .catch(err => {
                    console.error("Ringtone track search failed", err);
                });
        }, 400);
    });
});
