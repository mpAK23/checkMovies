(() => {
  const state = {
    rawMovies: [],
    searchedExtraMovies: [],
    allMovies: [],
    zipContext: null,
    zipCache: new Map(),
    activeZip: localStorage.getItem('reelwindow_zip') || '',
    searchQuery: '',
    activeTab: 'all', // 'all' | 'urgent' | 'now_playing' | 'coming_soon' | 'watchlist'
    minRating: 0,
    sortBy: 'urgency', // 'urgency' | 'rating_desc' | 'start_desc' | 'start_asc' | 'end_asc' | 'title_asc'
    viewMode: 'cards', // 'cards' | 'table'
    theatersExpanded: true,
    watchlist: new Set(JSON.parse(localStorage.getItem('reelwindow_watchlist') || '[]')),
    tmdbKey: localStorage.getItem('reelwindow_tmdb_key') || ''
  };

  // DOM Elements
  const searchForm = document.getElementById('searchForm');
  const movieSearchInput = document.getElementById('movieSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const zipCodeInput = document.getElementById('zipCodeInput');
  const activeZipBadge = document.getElementById('activeZipBadge');
  const activeZipText = document.getElementById('activeZipText');
  const clearZipHeaderBtn = document.getElementById('clearZipHeaderBtn');

  const errorBanner = document.getElementById('errorBanner');
  const errorBannerText = document.getElementById('errorBannerText');
  const closeErrorBtn = document.getElementById('closeErrorBtn');

  const statUrgentCount = document.getElementById('statUrgentCount');
  const statNowPlayingCount = document.getElementById('statNowPlayingCount');
  const statComingSoonCount = document.getElementById('statComingSoonCount');
  const statWatchlistCount = document.getElementById('statWatchlistCount');

  const zipTheatersSection = document.getElementById('zipTheatersSection');
  const zipLocationHeading = document.getElementById('zipLocationHeading');
  const zipMarketNote = document.getElementById('zipMarketNote');
  const googleAllZipLink = document.getElementById('googleAllZipLink');
  const mapsAllZipLink = document.getElementById('mapsAllZipLink');
  const toggleTheatersBtn = document.getElementById('toggleTheatersBtn');
  const theatersGrid = document.getElementById('theatersGrid');

  const countAll = document.getElementById('countAll');
  const countUrgent = document.getElementById('countUrgent');
  const countNow = document.getElementById('countNow');
  const countComing = document.getElementById('countComing');
  const countWatchlist = document.getElementById('countWatchlist');

  const minRatingSelect = document.getElementById('minRatingSelect');
  const sortSelect = document.getElementById('sortSelect');
  const viewCardsBtn = document.getElementById('viewCardsBtn');
  const viewTableBtn = document.getElementById('viewTableBtn');

  const loadingState = document.getElementById('loadingState');
  const loadingText = document.getElementById('loadingText');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptySubtitle = document.getElementById('emptySubtitle');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');

  const moviesCardGrid = document.getElementById('moviesCardGrid');
  const moviesTableContainer = document.getElementById('moviesTableContainer');
  const moviesTableBody = document.getElementById('moviesTableBody');

  // Modal Elements
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const tmdbKeyInput = document.getElementById('tmdbKeyInput');
  const saveTmdbKeyBtn = document.getElementById('saveTmdbKeyBtn');
  const clearTmdbKeyBtn = document.getElementById('clearTmdbKeyBtn');

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function addDays(dateObj, days) {
    const d = new Date(dateObj.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function toISODate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatReadableDate(isoOrDate) {
    if (!isoOrDate) return 'TBA';
    const d = typeof isoOrDate === 'string' ? new Date(`${isoOrDate}T12:00:00`) : isoOrDate;
    if (Number.isNaN(d.getTime())) return String(isoOrDate);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 3958.8;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  /**
   * Client-side Theatrical Window Estimator (runs directly in browser for GitHub Pages!)
   */
  function calculateTheatricalWindow(movie, marketModifierDays = 0, marketLabel = '') {
    const now = new Date();
    const todayISO = toISODate(now);
    const todayNoon = new Date(`${todayISO}T12:00:00`);

    const startISO = movie.startDate || todayISO;
    let startDateObj = new Date(`${startISO}T12:00:00`);
    if (Number.isNaN(startDateObj.getTime())) {
      startDateObj = todayNoon;
    }

    const releaseScale = movie.releaseScale || 'Wide Release';
    let baseDays = 45;
    if (releaseScale === 'Blockbuster / Tentpole') {
      baseDays = 60;
    } else if (releaseScale === 'Wide Release') {
      baseDays = 45;
    } else if (releaseScale === 'Mid-Wide / Genre') {
      baseDays = 35;
    } else if (releaseScale === 'Limited / Indie') {
      baseDays = 24;
    }

    const avgRating10 = Number(movie.averageRating) || 7.0;
    let ratingModifierDays = 0;
    if (avgRating10 >= 8.3) {
      ratingModifierDays = 14;
    } else if (avgRating10 >= 7.5) {
      ratingModifierDays = 7;
    } else if (avgRating10 > 0 && avgRating10 < 5.5) {
      ratingModifierDays = -7;
    } else if (avgRating10 > 0 && avgRating10 < 6.3) {
      ratingModifierDays = -3;
    }

    const totalRunDays = Math.max(14, baseDays + ratingModifierDays + marketModifierDays);
    const endDateObj = addDays(startDateObj, totalRunDays);
    const endISO = toISODate(endDateObj);

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysSinceStart = Math.round((todayNoon - startDateObj) / msPerDay);
    const daysRemaining = Math.round((endDateObj - todayNoon) / msPerDay);

    let windowStatus = 'now_playing';
    let statusLabel = 'Now Playing';
    let urgencyLevel = 3;

    if (daysSinceStart < 0) {
      windowStatus = 'coming_soon';
      const opensIn = Math.abs(daysSinceStart);
      statusLabel = opensIn === 1 ? 'Opens Tomorrow' : `Opens in ${opensIn} days`;
      urgencyLevel = 4;
    } else if (daysRemaining < 0) {
      windowStatus = 'ended';
      const daysAgo = Math.abs(daysRemaining);
      statusLabel = daysAgo > 365
        ? `Past Release (${startDateObj.getFullYear()})`
        : `Left Theaters (${daysAgo}d ago)`;
      urgencyLevel = 5;
    } else if (daysRemaining <= 7) {
      windowStatus = 'last_chance';
      statusLabel = daysRemaining === 0 ? 'Last Day in Theaters!' : `Last Chance • ${daysRemaining}d left`;
      urgencyLevel = 1;
    } else if (daysRemaining <= 14) {
      windowStatus = 'leaving_soon';
      statusLabel = `Leaving Soon • ${daysRemaining}d left`;
      urgencyLevel = 2;
    } else {
      windowStatus = 'now_playing';
      statusLabel = `Now Playing • ${daysRemaining}d left`;
      urgencyLevel = 3;
    }

    let runProgressPercent = 0;
    if (daysSinceStart >= 0 && totalRunDays > 0) {
      runProgressPercent = Math.min(100, Math.max(4, Math.round((daysSinceStart / totalRunDays) * 100)));
    }

    const explanationParts = [`${releaseScale} (~${baseDays}d base window)`];
    if (ratingModifierDays > 0) {
      explanationParts.push(`+${ratingModifierDays}d strong reviews hold`);
    } else if (ratingModifierDays < 0) {
      explanationParts.push(`${ratingModifierDays}d faster screen turnover`);
    }
    if (marketModifierDays !== 0 && marketLabel) {
      explanationParts.push(
        `${marketModifierDays > 0 ? '+' : ''}${marketModifierDays}d for ${marketLabel}`
      );
    }

    const searchLocation = state.zipContext ? `${state.zipContext.zip}` : 'near me';

    return {
      ...movie,
      startDate: toISODate(startDateObj),
      startDateFormatted: formatReadableDate(startDateObj),
      estimatedEndDate: endISO,
      estimatedEndDateFormatted: formatReadableDate(endDateObj),
      estimatedRunDays: totalRunDays,
      daysSinceStart,
      daysRemaining,
      runProgressPercent,
      windowStatus,
      statusLabel,
      urgencyLevel,
      windowExplanation: explanationParts.join(' • '),
      showtimesGoogleUrl: `https://www.google.com/search?q=${encodeURIComponent(`${movie.title} movie showtimes ${searchLocation}`)}`,
      showtimesMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`movie theaters playing ${movie.title} ${searchLocation}`)}`
    };
  }

  function recomputeAllWindows() {
    const marketMod = state.zipContext ? state.zipContext.marketModifierDays : 0;
    const marketLabel = state.zipContext
      ? `${state.zipContext.city}, ${state.zipContext.stateAbbr} (${state.zipContext.marketTier})`
      : '';

    const mergedMap = new Map();
    for (const m of state.rawMovies) {
      const k = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      mergedMap.set(k, m);
    }
    for (const m of state.searchedExtraMovies) {
      const k = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!mergedMap.has(k)) {
        mergedMap.set(k, m);
      }
    }

    state.allMovies = Array.from(mergedMap.values()).map((m) =>
      calculateTheatricalWindow(m, marketMod, marketLabel)
    );
  }

  function showError(msg) {
    errorBannerText.textContent = msg;
    errorBanner.classList.remove('hidden');
  }

  function hideError() {
    errorBanner.classList.add('hidden');
  }

  function saveWatchlist() {
    localStorage.setItem('reelwindow_watchlist', JSON.stringify(Array.from(state.watchlist)));
  }

  function toggleWatchlistItem(movieId) {
    if (state.watchlist.has(movieId)) {
      state.watchlist.delete(movieId);
    } else {
      state.watchlist.add(movieId);
    }
    saveWatchlist();
    renderAll();
  }

  /**
   * 100% Client-Side ZIP Code & Nearby Theaters Lookup (works on GitHub Pages!)
   */
  async function lookupZipCodeClientSide(zip) {
    const cleanZip = String(zip || '').trim();
    if (!/^\d{5}$/.test(cleanZip)) {
      throw new Error('Please enter a valid 5-digit US ZIP code (e.g., 90210, 10001, 78701).');
    }

    if (state.zipCache.has(cleanZip)) {
      return state.zipCache.get(cleanZip);
    }

    const zipRes = await fetch(`https://api.zippopotam.us/us/${cleanZip}`);
    if (!zipRes.ok) {
      throw new Error(`Could not find US ZIP code "${cleanZip}". Please verify the 5-digit ZIP code.`);
    }

    const zipData = await zipRes.json();
    const place = (zipData.places && zipData.places[0]) || {};
    const city = place['place name'] || 'Local Area';
    const stateName = place.state || '';
    const stateAbbr = place['state abbreviation'] || '';
    const lat = parseFloat(place.latitude);
    const lon = parseFloat(place.longitude);

    const theaters = [];
    const seenNames = new Set();

    try {
      const latDelta = 0.28;
      const lonDelta = 0.35;
      const viewbox = `${lon - lonDelta},${lat + latDelta},${lon + lonDelta},${lat - latDelta}`;
      const nomUrl = `https://nominatim.openstreetmap.org/search?q=cinema&format=json&limit=14&addressdetails=1&viewbox=${viewbox}&bounded=1`;

      const nomRes = await fetch(nomUrl, {
        headers: { Accept: 'application/json' }
      });

      if (nomRes.ok) {
        const nomItems = await nomRes.json();
        for (const item of nomItems || []) {
          const rawName = (item.name || (item.display_name ? item.display_name.split(',')[0] : '')).trim();
          if (!rawName) continue;

          const addr = item.address || {};
          const road = [addr.house_number, addr.road].filter(Boolean).join(' ');
          const locality = addr.city || addr.town || addr.suburb || addr.village || city;
          const itemLat = parseFloat(item.lat);
          const itemLon = parseFloat(item.lon);
          const distMiles = !Number.isNaN(itemLat) && !Number.isNaN(itemLon)
            ? haversineMiles(lat, lon, itemLat, itemLon)
            : null;

          const displayTitle = seenNames.has(rawName.toLowerCase()) && addr.road
            ? `${rawName} (${addr.road})`
            : rawName;
          seenNames.add(displayTitle.toLowerCase());
          seenNames.add(rawName.toLowerCase());

          const fullAddress = [road, locality, stateAbbr || stateName, addr.postcode || cleanZip]
            .filter(Boolean)
            .join(', ');

          theaters.push({
            name: displayTitle,
            address: fullAddress,
            distanceMiles: distMiles,
            googleShowtimesUrl: `https://www.google.com/search?q=${encodeURIComponent(`${displayTitle} ${locality} ${stateAbbr} showtimes`)}`,
            mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${displayTitle} ${fullAddress}`)}`
          });
        }
      }
    } catch (_) {
      // Fallback below if Nominatim is temporarily unreachable
    }

    theaters.sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));

    if (theaters.length === 0) {
      const fallbackHubs = [
        { name: `AMC Theatres (${city} Area)`, address: `${city}, ${stateAbbr} ${cleanZip}`, distanceMiles: 3.2 },
        { name: `Regal Cinemas & IMAX (${city})`, address: `${city}, ${stateAbbr} ${cleanZip}`, distanceMiles: 5.1 },
        { name: `Cinemark Theatres (${city})`, address: `${city}, ${stateAbbr} ${cleanZip}`, distanceMiles: 6.4 }
      ];
      for (const hub of fallbackHubs) {
        theaters.push({
          ...hub,
          googleShowtimesUrl: `https://www.google.com/search?q=${encodeURIComponent(`${hub.name} ${cleanZip} showtimes`)}`,
          mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`movie theater near ${cleanZip}`)}`
        });
      }
    }

    let marketTier = 'Standard Suburban Market';
    let marketModifierDays = 0;
    if (theaters.length >= 8) {
      marketTier = 'Major Metro Cinema Hub';
      marketModifierDays = 7;
    } else if (theaters.length <= 3) {
      marketTier = 'Regional / Smaller Market';
      marketModifierDays = -5;
    }

    const result = {
      zip: cleanZip,
      city,
      state: stateName,
      stateAbbr,
      latitude: lat,
      longitude: lon,
      marketTier,
      marketModifierDays,
      googleZipShowtimesUrl: `https://www.google.com/search?q=${encodeURIComponent(`movies playing near ${cleanZip} showtimes`)}`,
      mapsZipUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`movie theaters near ${cleanZip}`)}`,
      theaters: theaters.slice(0, 10)
    };

    state.zipCache.set(cleanZip, result);
    return result;
  }

  /**
   * Load the static `./movies-data.json` dataset + optional TMDB API feed
   */
  async function loadBaseDataset() {
    hideError();
    loadingState.classList.remove('hidden');
    moviesCardGrid.classList.add('hidden');
    moviesTableContainer.classList.add('hidden');
    emptyState.classList.add('hidden');

    try {
      const res = await fetch('./movies-data.json');
      if (!res.ok) {
        throw new Error('Could not load movies-data.json');
      }
      const data = await res.json();
      let list = data.movies || [];

      // If user configured an optional TMDB API Key, merge live TMDB now_playing & upcoming
      if (state.tmdbKey && state.tmdbKey.trim().length > 8) {
        try {
          const cleanKey = state.tmdbKey.trim();
          const headers = cleanKey.startsWith('eyJ')
            ? { Authorization: `Bearer ${cleanKey}`, Accept: 'application/json' }
            : { Accept: 'application/json' };
          const authParam = cleanKey.startsWith('eyJ') ? '' : `&api_key=${encodeURIComponent(cleanKey)}`;

          const [npRes, upRes] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/movie/now_playing?language=en-US&page=1&region=US${authParam}`, { headers }),
            fetch(`https://api.themoviedb.org/3/movie/upcoming?language=en-US&page=1&region=US${authParam}`, { headers })
          ]);

          const extraTmdb = [];
          for (const r of [npRes, upRes]) {
            if (r.ok) {
              const j = await r.json();
              for (const m of j.results || []) {
                if (!m.title || !m.release_date) continue;
                const rating10 = m.vote_average ? Math.round(m.vote_average * 10) / 10 : 7.0;
                extraTmdb.push({
                  id: `tmdb_${m.id}`,
                  title: m.title,
                  posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
                  startDate: m.release_date,
                  releaseScale: m.popularity > 120 ? 'Blockbuster / Tentpole' : 'Wide Release',
                  certifiedFresh: rating10 >= 7.5,
                  averageRating: rating10,
                  criticsScore: Math.round(rating10 * 10),
                  audienceScore: null,
                  ratingSource: `TMDB (${(m.vote_count || 0).toLocaleString()} votes)`
                });
              }
            }
          }
          list = [...extraTmdb, ...list];
        } catch (_) {}
      }

      state.rawMovies = list;

      if (state.activeZip) {
        try {
          state.zipContext = await lookupZipCodeClientSide(state.activeZip);
        } catch (zErr) {
          showError(zErr.message);
          state.activeZip = '';
          state.zipContext = null;
        }
      }

      recomputeAllWindows();
    } catch (err) {
      showError(err.message || 'Failed to initialize movie dataset.');
    } finally {
      loadingState.classList.add('hidden');
      renderAll();
    }
  }

  /**
   * Client-side search via Apple iTunes CORS API for titles outside the 233 bundled theatrical releases
   */
  async function searchExternalCatalog(query) {
    const cleanQ = (query || '').trim();
    if (cleanQ.length < 3) return;

    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&country=US&limit=15`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const extras = [];
      for (const item of data.results || []) {
        if (!item.trackName || !item.releaseDate) continue;
        if (item.kind && item.kind !== 'feature-movie') continue;
        const releaseISO = item.releaseDate.slice(0, 10);
        const hiResArtwork = item.artworkUrl100
          ? item.artworkUrl100.replace('100x100bb', '600x900bb')
          : null;

        extras.push({
          id: `itunes_${item.trackId}`,
          title: item.trackName,
          posterUrl: hiResArtwork,
          startDate: releaseISO,
          releaseScale: 'Wide Release',
          genre: item.primaryGenreName || 'Feature Film',
          mpaaRating: item.contentAdvisoryRating || 'NR',
          averageRating: 7.2,
          criticsScore: null,
          audienceScore: null,
          ratingSource: 'Catalog Lookup'
        });
      }

      if (extras.length > 0) {
        state.searchedExtraMovies = extras;
        recomputeAllWindows();
        renderAll();
      }
    } catch (_) {}
  }

  /**
   * Render ZIP Code Header Pill & Nearby Theaters Panel
   */
  function renderZipSection() {
    document.querySelectorAll('.zip-preset').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.zip === state.activeZip);
    });

    if (!state.zipContext) {
      activeZipBadge.classList.add('hidden');
      zipTheatersSection.classList.add('hidden');
      return;
    }

    const zc = state.zipContext;
    activeZipText.textContent = `ZIP ${zc.zip}: ${zc.city}, ${zc.stateAbbr}`;
    activeZipBadge.classList.remove('hidden');

    zipTheatersSection.classList.remove('hidden');
    zipLocationHeading.textContent = `Nearby Theaters in ${zc.city}, ${zc.stateAbbr} (${zc.zip})`;

    const modDays = zc.marketModifierDays;
    let modExplanation = 'Standard theatrical screen rotation for this market.';
    if (modDays > 0) {
      modExplanation = `${zc.marketTier}: High cinema density typically extends theatrical runs by +${modDays} days and supports limited/indie releases.`;
    } else if (modDays < 0) {
      modExplanation = `${zc.marketTier}: Screens rotate slightly faster (${modDays} days on estimated end dates) — catch movies early in their run!`;
    }
    zipMarketNote.textContent = modExplanation;

    googleAllZipLink.href = zc.googleZipShowtimesUrl;
    mapsAllZipLink.href = zc.mapsZipUrl;

    theatersGrid.classList.toggle('hidden', !state.theatersExpanded);
    toggleTheatersBtn.textContent = state.theatersExpanded
      ? `Hide Theaters (${zc.theaters.length})`
      : `Show Theaters (${zc.theaters.length})`;

    theatersGrid.innerHTML = zc.theaters
      .map(
        (t) => `
        <article class="theater-card">
          <div>
            <div class="theater-top">
              <h3 class="theater-name">${escapeHtml(t.name)}</h3>
              ${
                t.distanceMiles !== null && t.distanceMiles !== undefined
                  ? `<span class="theater-dist">${escapeHtml(t.distanceMiles)} mi</span>`
                  : ''
              }
            </div>
            <p class="theater-address">${escapeHtml(t.address)}</p>
          </div>
          <div class="theater-links">
            <a href="${escapeHtml(t.googleShowtimesUrl)}" target="_blank" rel="noopener noreferrer" class="theater-link-btn">
              🎟️ Local Showtimes ↗
            </a>
            <a href="${escapeHtml(t.mapsUrl)}" target="_blank" rel="noopener noreferrer" class="theater-link-btn">
              🗺️ View on Map ↗
            </a>
          </div>
        </article>
      `
      )
      .join('');
  }

  /**
   * Filter & sort movies according to current UI controls
   */
  function getFilteredAndSortedMovies() {
    const qLower = state.searchQuery.trim().toLowerCase();

    const baseFiltered = state.allMovies.filter((m) => {
      if (state.minRating > 0 && (Number(m.averageRating) || 0) < state.minRating) {
        return false;
      }
      if (qLower) {
        const matchTitle = m.title.toLowerCase().includes(qLower);
        const matchGenre = m.genre && m.genre.toLowerCase().includes(qLower);
        if (!matchTitle && !matchGenre) return false;
      }
      return true;
    });

    const urgentList = baseFiltered.filter(
      (m) => m.windowStatus === 'last_chance' || m.windowStatus === 'leaving_soon'
    );
    const nowPlayingList = baseFiltered.filter(
      (m) =>
        m.windowStatus === 'now_playing' ||
        m.windowStatus === 'leaving_soon' ||
        m.windowStatus === 'last_chance'
    );
    const comingSoonList = baseFiltered.filter((m) => m.windowStatus === 'coming_soon');
    const watchlistList = baseFiltered.filter((m) => state.watchlist.has(m.id));
    const activeTheatricalList = baseFiltered.filter((m) => m.windowStatus !== 'ended');

    // If user is searching for a specific past movie and there are no active theatrical matches, show past matches in 'all'
    const allTabList =
      activeTheatricalList.length > 0 || !qLower ? activeTheatricalList : baseFiltered;

    statUrgentCount.textContent = urgentList.length;
    statNowPlayingCount.textContent = nowPlayingList.length;
    statComingSoonCount.textContent = comingSoonList.length;
    statWatchlistCount.textContent = state.watchlist.size;

    countAll.textContent = allTabList.length;
    countUrgent.textContent = urgentList.length;
    countNow.textContent = nowPlayingList.length;
    countComing.textContent = comingSoonList.length;
    countWatchlist.textContent = watchlistList.length;

    let list = allTabList;
    if (state.activeTab === 'urgent') {
      list = urgentList;
    } else if (state.activeTab === 'now_playing') {
      list = nowPlayingList;
    } else if (state.activeTab === 'coming_soon') {
      list = comingSoonList;
    } else if (state.activeTab === 'watchlist') {
      list = watchlistList;
    }

    const sorted = [...list].sort((a, b) => {
      if (state.sortBy === 'urgency') {
        if (a.urgencyLevel !== b.urgencyLevel) {
          return a.urgencyLevel - b.urgencyLevel;
        }
        return (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999);
      }
      if (state.sortBy === 'rating_desc') {
        return (Number(b.averageRating) || 0) - (Number(a.averageRating) || 0);
      }
      if (state.sortBy === 'start_desc') {
        return String(b.startDate).localeCompare(String(a.startDate));
      }
      if (state.sortBy === 'start_asc') {
        return String(a.startDate).localeCompare(String(b.startDate));
      }
      if (state.sortBy === 'end_asc') {
        return String(a.estimatedEndDate).localeCompare(String(b.estimatedEndDate));
      }
      if (state.sortBy === 'title_asc') {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

    return sorted;
  }

  /**
   * Render a single Movie Card
   */
  function renderMovieCard(m) {
    const isSaved = state.watchlist.has(m.id);
    const cardUrgentClass =
      m.windowStatus === 'last_chance'
        ? 'card-last-chance'
        : m.windowStatus === 'leaving_soon'
        ? 'card-leaving-soon'
        : '';

    const posterHtml = m.posterUrl
      ? `<img src="${escapeHtml(m.posterUrl)}" alt="${escapeHtml(m.title)} Poster" data-fallback-title="${escapeHtml(m.title)}" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="poster-fallback"><span class="poster-fallback-icon">🎬</span><span>${escapeHtml(m.title)}</span></div>`;

    const subMetaParts = [];
    if (m.genre) subMetaParts.push(m.genre);
    if (m.mpaaRating) subMetaParts.push(m.mpaaRating);
    if (m.runtime) subMetaParts.push(m.runtime);

    const criticsBadge =
      m.criticsScore !== null && m.criticsScore !== undefined
        ? `<span class="score-pill" title="Critics Score">${m.certifiedFresh ? '🍅 Certified ' : '🍅 Critics: '}${m.criticsScore}%</span>`
        : '';

    const audienceBadge =
      m.audienceScore !== null && m.audienceScore !== undefined
        ? `<span class="score-pill" title="Audience Score">🍿 Audience: ${m.audienceScore}%</span>`
        : '';

    const fallbackSourceBadge =
      !criticsBadge && !audienceBadge
        ? `<span class="score-pill">${escapeHtml(m.ratingSource || 'Preview Rating')}</span>`
        : '';

    const zipBtnSuffix = state.zipContext ? ` in ${escapeHtml(state.zipContext.zip)}` : '';

    return `
      <article class="movie-card ${cardUrgentClass}">
        <div>
          <div class="movie-card-top">
            <div class="poster-box">
              ${posterHtml}
            </div>
            <div class="movie-info">
              <div class="status-row">
                <span class="status-badge badge-${escapeHtml(m.windowStatus)}">
                  ${escapeHtml(m.statusLabel)}
                </span>
                <span class="scale-tag">${escapeHtml(m.releaseScale || 'Wide Release')}</span>
              </div>

              <h3 class="movie-title">${escapeHtml(m.title)}</h3>
              ${
                subMetaParts.length > 0
                  ? `<div class="movie-submeta">${escapeHtml(subMetaParts.join(' • '))}</div>`
                  : `<div class="movie-submeta">Theatrical Release (${escapeHtml(m.estimatedRunDays)}-day est. run)</div>`
              }

              <!-- Average Review Rating Panel -->
              <div class="rating-panel" title="Average Review Rating (${escapeHtml(m.ratingSource)})">
                <div class="avg-rating-main">
                  <span class="star-icon">★</span>
                  <span class="avg-score-num">${Number(m.averageRating || 0).toFixed(1)}</span>
                  <span class="avg-score-max">/ 10 Avg</span>
                </div>
                <div class="sub-scores">
                  ${criticsBadge}
                  ${audienceBadge}
                  ${fallbackSourceBadge}
                </div>
              </div>
            </div>
          </div>

          <!-- Theatrical Start & End Dates Box -->
          <div class="window-box">
            <div class="dates-grid">
              <div class="date-col">
                <span class="date-label">Theatrical Start Date</span>
                <span class="date-val">${escapeHtml(m.startDateFormatted)}</span>
              </div>
              <div class="date-col date-col-end">
                <span class="date-label">Est. End Date in Theaters</span>
                <span class="date-val">${escapeHtml(m.estimatedEndDateFormatted)}</span>
              </div>
            </div>

            <div class="progress-track" title="Theatrical run progress (${m.runProgressPercent}%)">
              <div
                class="progress-fill fill-${escapeHtml(m.windowStatus)}"
                style="width: ${m.runProgressPercent}%"
              ></div>
            </div>

            <p class="window-explain">${escapeHtml(m.windowExplanation)}</p>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="movie-card-footer">
          <div class="showtime-btns">
            <a
              href="${escapeHtml(m.showtimesGoogleUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-primary btn-sm"
            >
              🎟️ Showtimes${zipBtnSuffix} ↗
            </a>
            <a
              href="${escapeHtml(m.showtimesMapsUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-ghost btn-sm"
            >
              🗺️ Theaters Map ↗
            </a>
          </div>

          <button
            type="button"
            class="watchlist-btn ${isSaved ? 'saved' : ''}"
            data-watchlist-id="${escapeHtml(m.id)}"
            title="Save to your Don't Miss theatrical watchlist"
          >
            ${isSaved ? '★ Saved' : '☆ Don\'t Miss'}
          </button>
        </div>
      </article>
    `;
  }

  /**
   * Render a single Table Row for Schedule Table View
   */
  function renderMovieTableRow(m) {
    const isSaved = state.watchlist.has(m.id);
    const subScores = [];
    if (m.criticsScore !== null && m.criticsScore !== undefined) {
      subScores.push(`🍅 ${m.criticsScore}%`);
    }
    if (m.audienceScore !== null && m.audienceScore !== undefined) {
      subScores.push(`🍿 ${m.audienceScore}%`);
    }

    const tableThumb = m.posterUrl
      ? `<img src="${escapeHtml(m.posterUrl)}" alt="${escapeHtml(m.title)} Thumbnail" class="table-thumb" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="table-thumb table-thumb-fallback">🎬</div>`;

    return `
      <tr>
        <td>
          <div class="table-title-cell">
            ${tableThumb}
            <div>
              <strong>${escapeHtml(m.title)}</strong>
              <div class="movie-submeta">${escapeHtml(m.releaseScale || 'Wide Release')}</div>
            </div>
          </div>
        </td>
        <td>
          <span class="status-badge badge-${escapeHtml(m.windowStatus)}">
            ${escapeHtml(m.statusLabel)}
          </span>
        </td>
        <td>
          <span class="star-icon">★</span>
          <strong>${Number(m.averageRating || 0).toFixed(1)} / 10</strong>
          <div class="movie-submeta">${escapeHtml(subScores.join(' • ') || m.ratingSource || '')}</div>
        </td>
        <td><strong>${escapeHtml(m.startDateFormatted)}</strong></td>
        <td><strong style="color: #fde68a;">${escapeHtml(m.estimatedEndDateFormatted)}</strong></td>
        <td>
          <div>~${escapeHtml(m.estimatedRunDays)} days total</div>
          <div class="movie-submeta">${escapeHtml(m.windowExplanation)}</div>
        </td>
        <td>
          <div class="showtime-btns">
            <a
              href="${escapeHtml(m.showtimesGoogleUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-primary btn-sm"
            >
              🎟️ Showtimes ↗
            </a>
            <button
              type="button"
              class="watchlist-btn ${isSaved ? 'saved' : ''}"
              data-watchlist-id="${escapeHtml(m.id)}"
            >
              ${isSaved ? '★ Saved' : '☆ Save'}
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderAll() {
    renderZipSection();

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === state.activeTab);
    });

    const movies = getFilteredAndSortedMovies();

    if (movies.length === 0) {
      moviesCardGrid.classList.add('hidden');
      moviesTableContainer.classList.add('hidden');
      emptyState.classList.remove('hidden');

      if (state.activeTab === 'watchlist') {
        emptyTitle.textContent = 'Your "Don\'t Miss" Watchlist is empty';
        emptySubtitle.textContent =
          'Click "☆ Don\'t Miss" on any movie card to track movies you want to see before they leave theaters.';
      } else {
        emptyTitle.textContent = 'No matching movies found';
        emptySubtitle.textContent =
          'Try adjusting your minimum rating filter, switching tabs, or searching for another movie title.';
      }
      return;
    }

    emptyState.classList.add('hidden');

    if (state.viewMode === 'cards') {
      moviesCardGrid.classList.remove('hidden');
      moviesTableContainer.classList.add('hidden');
      moviesCardGrid.innerHTML = movies.map(renderMovieCard).join('');
    } else {
      moviesCardGrid.classList.add('hidden');
      moviesTableContainer.classList.remove('hidden');
      moviesTableBody.innerHTML = movies.map(renderMovieTableRow).join('');
    }
  }

  // Event Listeners
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const q = movieSearchInput.value.trim();
    const z = zipCodeInput.value.trim();

    if (z && !/^\d{5}$/.test(z)) {
      showError('Please enter a valid 5-digit US ZIP code (e.g., 90210, 10001, 78701).');
      return;
    }

    state.searchQuery = q;

    if (z !== state.activeZip) {
      state.activeZip = z;
      if (!z) {
        state.zipContext = null;
        localStorage.removeItem('reelwindow_zip');
      } else {
        loadingState.classList.remove('hidden');
        loadingText.textContent = `Looking up theaters and market window for ZIP ${z}...`;
        try {
          state.zipContext = await lookupZipCodeClientSide(z);
          localStorage.setItem('reelwindow_zip', z);
        } catch (err) {
          showError(err.message);
        } finally {
          loadingState.classList.add('hidden');
        }
      }
    }

    recomputeAllWindows();
    renderAll();

    if (q.length >= 3 && getFilteredAndSortedMovies().length === 0) {
      await searchExternalCatalog(q);
    }
  });

  let searchDebounce = null;
  movieSearchInput.addEventListener('input', () => {
    const val = movieSearchInput.value;
    clearSearchBtn.classList.toggle('hidden', val.length === 0);
    state.searchQuery = val;
    renderAll();

    clearTimeout(searchDebounce);
    if (val.trim().length >= 3) {
      searchDebounce = setTimeout(() => {
        if (getFilteredAndSortedMovies().length === 0) {
          searchExternalCatalog(val.trim());
        }
      }, 500);
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    movieSearchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    state.searchQuery = '';
    state.searchedExtraMovies = [];
    recomputeAllWindows();
    renderAll();
  });

  document.querySelectorAll('.zip-preset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const zip = btn.dataset.zip;
      zipCodeInput.value = zip;
      state.activeZip = zip;
      hideError();
      loadingState.classList.remove('hidden');
      loadingText.textContent = `Looking up nearby cinemas for ZIP ${zip}...`;
      try {
        state.zipContext = await lookupZipCodeClientSide(zip);
        localStorage.setItem('reelwindow_zip', zip);
      } catch (err) {
        showError(err.message);
      } finally {
        loadingState.classList.add('hidden');
      }
      recomputeAllWindows();
      renderAll();
    });
  });

  clearZipHeaderBtn.addEventListener('click', () => {
    zipCodeInput.value = '';
    state.activeZip = '';
    state.zipContext = null;
    localStorage.removeItem('reelwindow_zip');
    recomputeAllWindows();
    renderAll();
  });

  toggleTheatersBtn.addEventListener('click', () => {
    state.theatersExpanded = !state.theatersExpanded;
    renderZipSection();
  });

  closeErrorBtn.addEventListener('click', hideError);

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.filter;
      renderAll();
    });
  });

  document.querySelectorAll('.stat-card').forEach((card) => {
    card.addEventListener('click', () => {
      const target = card.dataset.filterTarget;
      if (target) {
        state.activeTab = target;
        renderAll();
      }
    });
  });

  minRatingSelect.addEventListener('change', () => {
    state.minRating = parseFloat(minRatingSelect.value) || 0;
    renderAll();
  });

  sortSelect.addEventListener('change', () => {
    state.sortBy = sortSelect.value;
    renderAll();
  });

  viewCardsBtn.addEventListener('click', () => {
    state.viewMode = 'cards';
    viewCardsBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
    renderAll();
  });

  viewTableBtn.addEventListener('click', () => {
    state.viewMode = 'table';
    viewTableBtn.classList.add('active');
    viewCardsBtn.classList.remove('active');
    renderAll();
  });

  resetFiltersBtn.addEventListener('click', () => {
    state.activeTab = 'all';
    state.minRating = 0;
    minRatingSelect.value = '0';
    movieSearchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    state.searchQuery = '';
    state.searchedExtraMovies = [];
    recomputeAllWindows();
    renderAll();
  });

  document.addEventListener('click', (e) => {
    const wlBtn = e.target.closest('[data-watchlist-id]');
    if (wlBtn) {
      toggleWatchlistItem(wlBtn.dataset.watchlistId);
    }
  });

  openSettingsBtn.addEventListener('click', () => {
    tmdbKeyInput.value = state.tmdbKey;
    settingsModal.classList.remove('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  saveTmdbKeyBtn.addEventListener('click', () => {
    state.tmdbKey = tmdbKeyInput.value.trim();
    if (state.tmdbKey) {
      localStorage.setItem('reelwindow_tmdb_key', state.tmdbKey);
    } else {
      localStorage.removeItem('reelwindow_tmdb_key');
    }
    settingsModal.classList.add('hidden');
    loadBaseDataset();
  });

  clearTmdbKeyBtn.addEventListener('click', () => {
    tmdbKeyInput.value = '';
    state.tmdbKey = '';
    localStorage.removeItem('reelwindow_tmdb_key');
    settingsModal.classList.add('hidden');
    loadBaseDataset();
  });

  // Robust, CSP-compliant fallback if any image URL fails to load
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img && img.tagName === 'IMG') {
        if (img.classList.contains('table-thumb')) {
          img.outerHTML = '<div class="table-thumb table-thumb-fallback">🎬</div>';
        } else if (img.closest('.poster-box')) {
          const title = img.getAttribute('data-fallback-title') || img.alt?.replace(/ Poster$/, '') || 'Movie';
          const box = img.parentElement;
          if (box) {
            box.innerHTML = `<div class="poster-fallback"><span class="poster-fallback-icon">🎬</span><span>${escapeHtml(title)}</span></div>`;
          }
        }
      }
    },
    true
  );

  if (state.activeZip) {
    zipCodeInput.value = state.activeZip;
  }
  loadBaseDataset();
})();
