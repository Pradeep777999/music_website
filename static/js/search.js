// Nexonic Debounced Instant Search Module
class NexonicSearch {
    constructor() {
        this.searchInput = document.querySelector('.search-input');
        this.searchContainer = document.getElementById('search-results-pane');
        this.categoriesPane = document.getElementById('browse-categories-pane');
        this.debounceTimeout = null;
        
        if (this.searchInput) {
            this.initEventListeners();
        }
    }

    initEventListeners() {
        this.searchInput.addEventListener('input', () => {
            clearTimeout(this.debounceTimeout);
            const query = this.searchInput.value.trim();
            
            if (query.length === 0) {
                this.showCategories();
                return;
            }
            
            this.debounceTimeout = setTimeout(() => {
                this.performSearch(query);
            }, 300);
        });
    }

    showCategories() {
        if (this.searchContainer) this.searchContainer.innerHTML = '';
        if (this.searchContainer) this.searchContainer.style.display = 'none';
        if (this.categoriesPane) this.categoriesPane.style.display = 'block';
    }

    async performSearch(query) {
        if (this.categoriesPane) this.categoriesPane.style.display = 'none';
        if (this.searchContainer) {
            this.searchContainer.style.display = 'block';
            this.searchContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#9fa0a6;"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p style="margin-top:12px;">Searching Nexonic...</p></div>';
        }
        
        try {
            const response = await fetch(`/search/?q=${encodeURIComponent(query)}`, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            const data = await response.json();
            
            if (data.success) {
                this.renderSearchResults(data);
            } else {
                this.renderError();
            }
        } catch (e) {
            console.error("Search error:", e);
            this.renderError();
        }
    }

    renderError() {
        if (this.searchContainer) {
            this.searchContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#bd2130;"><p>Something went wrong. Please check your connection or try again.</p></div>';
        }
    }

    renderSearchResults(data) {
        if (!this.searchContainer) return;
        this.searchContainer.innerHTML = '';
        
        const hasTracks = data.tracks && data.tracks.length > 0;
        const hasAlbums = data.albums && data.albums.length > 0;
        const hasArtists = data.artists && data.artists.length > 0;
        const hasPlaylists = data.playlists && data.playlists.length > 0;
        const hasShows = data.shows && data.shows.length > 0;
        const hasEpisodes = data.episodes && data.episodes.length > 0;

        if (!hasTracks && !hasAlbums && !hasArtists && !hasPlaylists && !hasShows && !hasEpisodes) {
            this.searchContainer.innerHTML = `
                <div style="text-align:center;padding:80px 20px;">
                    <i class="fas fa-search" style="font-size:36px;color:#333;margin-bottom:16px;"></i>
                    <h3 style="font-size:18px;margin-bottom:8px;">No results found for "${this.searchInput.value}"</h3>
                    <p style="color:#9fa0a6;font-size:14px;">Please make sure your words are spelled correctly or use fewer keywords.</p>
                </div>
            `;
            return;
        }

        // Render structure: Grid columns for "Top Result" and "Songs"
        const topRow = document.createElement('div');
        topRow.className = 'section-container';
        topRow.style.display = 'grid';
        topRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
        topRow.style.gap = '24px';
        this.searchContainer.appendChild(topRow);

        // 1. Top Result
        if (hasTracks || hasArtists) {
            const topCol = document.createElement('div');
            const topHeader = document.createElement('h2');
            topHeader.className = 'section-title';
            topHeader.style.marginBottom = '18px';
            topHeader.innerText = 'Top Result';
            topCol.appendChild(topHeader);

            const topItem = hasArtists ? data.artists[0] : data.tracks[0];
            const isArtist = hasArtists;
            const topCard = document.createElement('div');
            topCard.className = 'media-card';
            topCard.style.padding = '24px';
            topCard.style.backgroundColor = '#16161a';
            topCard.style.borderRadius = '12px';
            topCard.style.flex = '1';
            
            const artUrl = isArtist 
                ? (topItem.images && topItem.images.length > 0 ? topItem.images[0].url : 'https://picsum.photos/300')
                : (topItem.album.images && topItem.album.images.length > 0 ? topItem.album.images[0].url : 'https://picsum.photos/300');
                
            topCard.innerHTML = `
                <img src="${artUrl}" alt="" style="width:92px;height:92px;border-radius:${isArtist ? '50%' : '8px'};object-fit:cover;box-shadow:0 8px 16px rgba(0,0,0,0.5);margin-bottom:20px;">
                <h1 style="font-size:24px;font-weight:700;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${topItem.name}</h1>
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-size:12px;background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:20px;color:#fff;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                        ${isArtist ? 'Artist' : 'Song'}
                    </span>
                </div>
            `;
            
            // Wire play button inside top card if it's a song
            if (!isArtist && topItem.preview_url) {
                const playBtn = document.createElement('button');
                playBtn.className = 'card-play-btn';
                playBtn.style.opacity = '1';
                playBtn.style.transform = 'translateY(0)';
                playBtn.style.position = 'relative';
                playBtn.style.marginTop = '-30px';
                playBtn.style.alignSelf = 'flex-end';
                playBtn.innerHTML = '<i class="fas fa-play"></i>';
                
                // Add properties for standard row parsing
                const fakeRow = document.createElement('div');
                fakeRow.dataset.trackId = topItem.id;
                fakeRow.dataset.trackName = topItem.name;
                fakeRow.dataset.trackArtist = topItem.artists[0].name;
                fakeRow.dataset.trackAlbum = topItem.album.name;
                fakeRow.dataset.trackArt = artUrl;
                fakeRow.dataset.trackDuration = topItem.duration_ms;
                fakeRow.dataset.trackPreview = topItem.preview_url;
                
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.player.setQueue([
                        {
                            id: topItem.id,
                            name: topItem.name,
                            artist: topItem.artists[0].name,
                            album: topItem.album.name,
                            album_art: artUrl,
                            duration_ms: topItem.duration_ms,
                            preview_url: topItem.preview_url
                        }
                    ], 0);
                    window.player.play();
                });
                
                topCard.appendChild(playBtn);
            } else if (isArtist) {
                topCard.addEventListener('click', () => {
                    window.location.href = `/artist/${topItem.id}/?name=${encodeURIComponent(topItem.name)}`;
                });
            } else if (!isArtist) {
                topCard.addEventListener('click', () => {
                    const artistName = (topItem.artists && topItem.artists.length > 0) ? topItem.artists[0].name : 'Unknown Artist';
                    const albumArt = (topItem.album.images && topItem.album.images.length > 0) ? topItem.album.images[0].url : '';
                    window.location.href = `/album/${topItem.album.id}/?name=${encodeURIComponent(topItem.album.name)}&artist=${encodeURIComponent(artistName)}&image=${encodeURIComponent(albumArt)}`;
                });
            }

            topCol.appendChild(topCard);
            topRow.appendChild(topCol);
        }

        // 2. Songs Results Column
        if (hasTracks) {
            const songsCol = document.createElement('div');
            const songsHeader = document.createElement('h2');
            songsHeader.className = 'section-title';
            songsHeader.style.marginBottom = '18px';
            songsHeader.innerText = 'Songs';
            songsCol.appendChild(songsHeader);

            const table = document.createElement('table');
            table.className = 'tracks-table';
            const tbody = document.createElement('tbody');
            table.appendChild(tbody);

            data.tracks.slice(0, 4).forEach((track, index) => {
                if (!track) return;
                const tr = document.createElement('tr');
                tr.dataset.trackId = track.id;
                tr.dataset.trackName = track.name;
                tr.dataset.trackArtist = track.artists[0].name;
                tr.dataset.trackAlbum = track.album.name;
                tr.dataset.trackArt = track.album.images && track.album.images.length > 0 ? track.album.images[0].url : '';
                tr.dataset.trackDuration = track.duration_ms;
                tr.dataset.trackPreview = track.preview_url || '';

                const heartIconClass = track.is_liked ? 'fas fa-heart text-success' : 'far fa-heart';
                const hasPreview = track.preview_url ? '' : 'style="opacity:0.3;cursor:not-allowed;" title="Preview not available"';

                tr.innerHTML = `
                    <td class="track-index-col">
                        <span class="index-number" ${hasPreview}>${index + 1}</span>
                        <i class="fas fa-play play-icon-table" data-action="play-track" ${hasPreview}></i>
                    </td>
                    <td class="track-title-cell">
                        <img class="track-thumbnail" src="${tr.dataset.trackArt || 'https://picsum.photos/100'}" alt="">
                        <div>
                            <div class="track-name-main">${track.name}</div>
                            <div class="track-artist-sub"><a href="/artist/${track.artists[0].id}/">${track.artists[0].name}</a></div>
                        </div>
                    </td>
                    <td class="track-actions-col">
                        <button class="btn-icon" data-action="like-track" style="border:none;width:30px;height:30px;font-size:14px;display:inline-flex;">
                            <i class="${heartIconClass}"></i>
                        </button>
                        <button class="btn-icon" data-action="add-to-playlist" style="border:none;width:30px;height:30px;font-size:14px;display:inline-flex;">
                            <i class="fas fa-plus"></i>
                        </button>
                    </td>
                    <td class="track-duration-col">${track.duration_str}</td>
                `;
                tbody.appendChild(tr);
            });
            songsCol.appendChild(table);
            topRow.appendChild(songsCol);
        }

        // 3. Render Albums
        if (hasAlbums) {
            this.renderGridSection('Albums', data.albums, 'album');
        }

        // 4. Render Artists
        if (hasArtists) {
            this.renderGridSection('Artists', data.artists, 'artist');
        }

        // 5. Render Playlists
        if (hasPlaylists) {
            this.renderGridSection('Playlists', data.playlists, 'spotify_playlist');
        }

        // 6. Render Shows & Episodes
        if (hasShows || hasEpisodes) {
            const podcastSection = document.createElement('div');
            podcastSection.className = 'section-container';
            podcastSection.innerHTML = `<h2 class="section-title" style="margin-bottom:18px;">Podcasts & Episodes</h2>`;
            
            const grid = document.createElement('div');
            grid.className = 'media-grid';
            podcastSection.appendChild(grid);

            if (hasShows) {
                data.shows.forEach(show => {
                    if (!show) return;
                    const card = document.createElement('div');
                    card.className = 'media-card';
                    card.style.cursor = 'pointer';
                    const publisherText = show.publisher && show.publisher !== "None" ? `By ${show.publisher}` : 'Podcast';
                    card.innerHTML = `
                        <div class="card-image-wrapper">
                            <img class="card-image" src="${show.images && show.images.length > 0 ? show.images[0].url : 'https://picsum.photos/300'}" alt="">
                        </div>
                        <div class="card-title">${show.name}</div>
                        <div class="card-subtitle">${publisherText}</div>
                    `;
                    card.addEventListener('click', () => {
                        window.location.href = `/podcast/${show.id}/`;
                    });
                    grid.appendChild(card);

                });
            }


            if (hasEpisodes) {
                data.episodes.forEach(episode => {
                    if (!episode) return;
                    const card = document.createElement('div');
                    card.className = 'media-card';
                    
                    const fakeRow = document.createElement('div');
                    fakeRow.dataset.trackId = episode.id;
                    fakeRow.dataset.trackName = episode.name;
                    fakeRow.dataset.trackArtist = "Podcast Episode";
                    fakeRow.dataset.trackAlbum = "Episode";
                    fakeRow.dataset.trackArt = episode.images && episode.images.length > 0 ? episode.images[0].url : '';
                    fakeRow.dataset.trackDuration = episode.duration_ms;
                    fakeRow.dataset.trackPreview = episode.audio_preview_url || '';

                    const playIconHtml = `<button class="card-play-btn"><i class="fas fa-play"></i></button>`;

                    card.innerHTML = `
                        <div class="card-image-wrapper">
                            <img class="card-image" src="${fakeRow.dataset.trackArt || 'https://picsum.photos/300'}" alt="">
                            ${playIconHtml}
                        </div>
                        <div class="card-title">${episode.name}</div>
                        <div class="card-subtitle">${episode.description}</div>
                    `;
                    
                    card.querySelector('.card-play-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.player.setQueue([
                            {
                                id: episode.id,
                                name: episode.name,
                                artist: "Podcast",
                                album: "Episode",
                                album_art: fakeRow.dataset.trackArt,
                                duration_ms: episode.duration_ms,
                                preview_url: episode.audio_preview_url || '',
                                is_episode: true
                            }
                        ], 0);
                        window.player.play();
                    });



                    grid.appendChild(card);
                });
            }
            this.searchContainer.appendChild(podcastSection);
        }
    }

    renderGridSection(title, items, type) {
        const section = document.createElement('div');
        section.className = 'section-container';
        
        const header = document.createElement('h2');
        header.className = 'section-title';
        header.style.marginBottom = '18px';
        header.innerText = title;
        section.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'media-grid';
        
        items.forEach(item => {
            if (!item) return;
            const card = document.createElement('div');
            card.className = 'media-card';
            
            let artUrl = 'https://picsum.photos/300';
            if (item.images && item.images.length > 0) {
                artUrl = item.images[0].url;
            } else if (item.icons && item.icons.length > 0) {
                artUrl = item.icons[0].url;
            }

            const subtitle = type === 'artist' 
                ? 'Artist'
                : (type === 'album' ? item.artists[0].name : (item.owner ? `By ${item.owner.display_name}` : ''));

            card.innerHTML = `
                <div class="card-image-wrapper" style="border-radius: ${type === 'artist' ? '50%' : '8px'};">
                    <img class="card-image" src="${artUrl}" alt="" style="border-radius: ${type === 'artist' ? '50%' : '0'};">
                </div>
                <div class="card-title">${item.name}</div>
                <div class="card-subtitle">${subtitle}</div>
            `;
            
            // Redirects to details pages
            card.addEventListener('click', () => {
                if (type === 'artist') {
                    window.location.href = `/artist/${item.id}/?name=${encodeURIComponent(item.name)}`;
                } else if (type === 'album') {
                    const artistName = (item.artists && item.artists.length > 0) ? item.artists[0].name : 'Unknown Artist';
                    window.location.href = `/album/${item.id}/?name=${encodeURIComponent(item.name)}&artist=${encodeURIComponent(artistName)}&image=${encodeURIComponent(artUrl)}`;
                } else if (type === 'spotify_playlist') {
                    window.location.href = `/spotify-playlist/${item.id}/?name=${encodeURIComponent(item.name)}`;
                }
            });

            grid.appendChild(card);
        });

        section.appendChild(grid);
        this.searchContainer.appendChild(section);
    }
}

// Instantiate globally on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.searchModule = new NexonicSearch();
});
