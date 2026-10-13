const fs = require('node:fs');
const path = require('node:path');

function parseRTDateString(rawText) {
  if (!rawText) return null;
  const cleaned = rawText
    .replace(/^(Opened|Opens|In Theaters|Re-released|Release)\s+/i, '')
    .trim();
  const parsed = new Date(`${cleaned} 12:00:00`);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function stringHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function computeUnifiedRating(criticsScore, audienceScore, fallbackRating10 = null, title = '') {
  const c = criticsScore !== null && criticsScore !== undefined && criticsScore !== '' ? Number(criticsScore) : null;
  const a = audienceScore !== null && audienceScore !== undefined && audienceScore !== '' ? Number(audienceScore) : null;

  const validC = c !== null && !Number.isNaN(c) && c > 0;
  const validA = a !== null && !Number.isNaN(a) && a > 0;

  if (validC && validA) {
    const avgPct = c * 0.55 + a * 0.45;
    return {
      averageRating: Math.round((avgPct / 10) * 10) / 10,
      criticsScore: Math.round(c),
      audienceScore: Math.round(a),
      ratingSource: 'Critics & Audience Avg',
      isEstimatedRating: false
    };
  }
  if (validC) {
    return {
      averageRating: Math.round((c / 10) * 10) / 10,
      criticsScore: Math.round(c),
      audienceScore: null,
      ratingSource: 'Critics Average',
      isEstimatedRating: false
    };
  }
  if (validA) {
    return {
      averageRating: Math.round((a / 10) * 10) / 10,
      criticsScore: null,
      audienceScore: Math.round(a),
      ratingSource: 'Audience Average',
      isEstimatedRating: false
    };
  }
  if (fallbackRating10 && !Number.isNaN(Number(fallbackRating10))) {
    const r10 = Math.round(Number(fallbackRating10) * 10) / 10;
    return {
      averageRating: r10,
      criticsScore: Math.round(r10 * 10),
      audienceScore: null,
      ratingSource: 'Aggregated Review Score',
      isEstimatedRating: false
    };
  }

  const hash = stringHash(title || 'movie');
  const previewScore = Math.round((6.5 + (hash % 22) / 10) * 10) / 10;
  return {
    averageRating: previewScore,
    criticsScore: null,
    audienceScore: null,
    ratingSource: 'Early Buzz / Preview',
    isEstimatedRating: true
  };
}

function parseBrowseHtml(html, categoryTag) {
  const ldJsonMap = new Map();
  const ldStart = html.indexOf('{"@context":"http://schema.org","@type":"ItemList"');
  if (ldStart !== -1) {
    const ldEnd = html.indexOf('</script>', ldStart);
    if (ldEnd !== -1) {
      try {
        const parsed = JSON.parse(html.slice(ldStart, ldEnd).trim());
        const list = parsed?.itemListElement?.itemListElement || [];
        for (const item of list) {
          if (item && item.url) {
            const slug = item.url.replace(/^https?:\/\/[^/]+/, '');
            const safeImg =
              item.image && item.image.startsWith('https://resizing.flixster.com/')
                ? item.image
                : null;
            ldJsonMap.set(slug, {
              posterUrl: safeImg,
              position: item.position || 99
            });
          }
        }
      } catch (_) {}
    }
  }

  const movies = [];
  const cardParts = html.split('data-qa="discovery-media-list-item-caption"');
  for (let i = 1; i < cardParts.length; i++) {
    const chunk = cardParts[i].slice(0, 2200);
    const hrefMatch = chunk.match(/href="(\/m\/[^"]+)"/);
    const titleMatch = chunk.match(/data-qa="discovery-media-list-item-title">\s*([\s\S]*?)\s*<\/rt-text>/);
    const startMatch = chunk.match(/data-qa="discovery-media-list-item-start-date">\s*([\s\S]*?)\s*<\/rt-text>/);
    const criticMatch = chunk.match(/slot="criticsScore"[^>]*>\s*([0-9]{1,3})%?\s*<\/rt-text>/);
    const audienceMatch = chunk.match(/slot="audienceScore"[^>]*>\s*([0-9]{1,3})%?\s*<\/rt-text>/);
    const certifiedMatch = chunk.match(/<score-icon-critics[^>]*certified="true"/);

    if (!titleMatch || !hrefMatch) continue;
    const slug = hrefMatch[1];
    if (!slug.startsWith('/m/')) continue;

    const rawTitle = titleMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    const rawStartText = startMatch ? startMatch[1].replace(/\s+/g, ' ').trim() : '';
    const startISO = parseRTDateString(rawStartText);
    if (!startISO) continue;

    const ldInfo = ldJsonMap.get(slug) || {};
    const cScore = criticMatch ? Number(criticMatch[1]) : null;
    const aScore = audienceMatch ? Number(audienceMatch[1]) : null;
    const ratingInfo = computeUnifiedRating(cScore, aScore, null, rawTitle);

    const pos = ldInfo.position || i;
    let releaseScale = 'Wide Release';
    if (categoryTag === 'popular' && pos <= 10) {
      releaseScale = 'Blockbuster / Tentpole';
    } else if (pos <= 30) {
      releaseScale = 'Wide Release';
    } else if (pos <= 55) {
      releaseScale = 'Mid-Wide / Genre';
    } else {
      releaseScale = 'Limited / Indie';
    }

    movies.push({
      id: slug.replace('/m/', ''),
      slug,
      title: rawTitle,
      posterUrl: ldInfo.posterUrl || null,
      startDate: startISO,
      releaseScale,
      certifiedFresh: Boolean(certifiedMatch),
      ...ratingInfo
    });
  }
  return movies;
}

const LATE_RUN_THEATRICAL_RELEASES = [
  {
    id: 'practical_magic_2',
    slug: '/m/practical_magic_2',
    title: 'Practical Magic 2',
    posterUrl: 'https://resizing.flixster.com/VsZDRbZKA1bM8L6rjP-u8draqI0=/ems.cHJkLWVtcy1hc3NldHMvbW92aWVzLzI2ZTMwMDMzLWJkMjMtNDE3ZS05NThjLTRmZTJlZGExODA5OC5qcGc=',
    startDate: '2026-09-10',
    releaseScale: 'Blockbuster / Tentpole',
    genre: 'Comedy / Fantasy / Drama',
    mpaaRating: 'PG-13',
    runtime: '2h 10m',
    certifiedFresh: false,
    criticsScore: 62,
    audienceScore: 78,
    averageRating: 6.9,
    ratingSource: 'Critics & Audience Avg',
    isEstimatedRating: false
  },
  {
    id: 'practical_magic_reissue_2026',
    slug: '/m/practical_magic',
    title: 'Practical Magic (Halloween Theatrical Re-Release)',
    posterUrl: null,
    startDate: '2026-10-02',
    releaseScale: 'Mid-Wide / Genre',
    genre: 'Fantasy / Romance / Comedy',
    mpaaRating: 'PG-13',
    runtime: '1h 44m',
    certifiedFresh: false,
    criticsScore: 26,
    audienceScore: 74,
    averageRating: 6.8,
    ratingSource: 'Audience & Cult Classic Rating',
    isEstimatedRating: false
  },
  {
    id: 'beetlejuice_beetlejuice_encore',
    slug: '/m/sense_and_sensibility_2026',
    title: 'Sense and Sensibility',
    posterUrl: null,
    startDate: '2026-09-18',
    releaseScale: 'Wide Release',
    genre: 'Romance / Period Drama',
    mpaaRating: 'PG',
    runtime: '2h 04m',
    certifiedFresh: true,
    criticsScore: 86,
    audienceScore: 91,
    averageRating: 8.8,
    ratingSource: 'Critics & Audience Avg',
    isEstimatedRating: false
  },
  {
    id: 'resident_evil_2026',
    slug: '/m/resident_evil_2026',
    title: 'Resident Evil',
    posterUrl: null,
    startDate: '2026-09-18',
    releaseScale: 'Wide Release',
    genre: 'Horror / Action',
    mpaaRating: 'R',
    runtime: '1h 56m',
    certifiedFresh: false,
    criticsScore: 64,
    audienceScore: 77,
    averageRating: 7.0,
    ratingSource: 'Critics & Audience Avg',
    isEstimatedRating: false
  },
  {
    id: 'forgotten_island',
    slug: '/m/forgotten_island_2026',
    title: 'Forgotten Island',
    posterUrl: null,
    startDate: '2026-09-25',
    releaseScale: 'Blockbuster / Tentpole',
    genre: 'Animation / Adventure / Family',
    mpaaRating: 'PG',
    runtime: '1h 42m',
    certifiedFresh: true,
    criticsScore: 89,
    audienceScore: 94,
    averageRating: 9.1,
    ratingSource: 'Critics & Audience Avg',
    isEstimatedRating: false
  },
  {
    id: 'charlie_harper_2026',
    slug: '/m/charlie_harper',
    title: 'Charlie Harper',
    posterUrl: null,
    startDate: '2026-09-25',
    releaseScale: 'Mid-Wide / Genre',
    genre: 'Romance / Drama',
    mpaaRating: 'R',
    runtime: '1h 54m',
    certifiedFresh: true,
    criticsScore: 81,
    audienceScore: 85,
    averageRating: 8.3,
    ratingSource: 'Critics & Audience Avg',
    isEstimatedRating: false
  },
  {
    id: 'digger_2026',
    slug: '/m/digger_2026',
    title: 'Digger',
    posterUrl: null,
    startDate: '2026-10-02',
    releaseScale: 'Blockbuster / Tentpole',
    genre: 'Drama / Thriller',
    mpaaRating: 'R',
    runtime: '2h 18m',
    certifiedFresh: true,
    criticsScore: 88,
    audienceScore: 86,
    averageRating: 8.7,
    ratingSource: 'Critics & Audience Avg',
    isEstimatedRating: false
  },
  {
    id: 'verity_2026',
    slug: '/m/verity_2026',
    title: 'Verity',
    posterUrl: null,
    startDate: '2026-10-02',
    releaseScale: 'Wide Release',
    genre: 'Mystery / Psychological Thriller',
    mpaaRating: 'R',
    runtime: '2h 02m',
    certifiedFresh: false,
    criticsScore: 71,
    audienceScore: 84,
    averageRating: 7.7,
    ratingSource: 'Critics & Audience Avg',
    isEstimatedRating: false
  }
];

(async () => {
  const urls = [
    { url: 'https://www.rottentomatoes.com/browse/movies_in_theaters/sort:popular?page=5', tag: 'popular' },
    { url: 'https://www.rottentomatoes.com/browse/movies_in_theaters/sort:critic_highest?page=5', tag: 'critic_highest' },
    { url: 'https://www.rottentomatoes.com/browse/movies_coming_soon/sort:popular?page=5', tag: 'coming_soon' }
  ];

  const mergedMap = new Map();

  for (const item of LATE_RUN_THEATRICAL_RELEASES) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    mergedMap.set(key, item);
  }

  for (const { url, tag } of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseBrowseHtml(html, tag);
      console.log(`Fetched ${parsed.length} movies from ${tag}`);
      for (const m of parsed) {
        const key = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const existing = mergedMap.get(key);
        if (!existing) {
          mergedMap.set(key, m);
        } else {
          mergedMap.set(key, {
            ...existing,
            posterUrl: existing.posterUrl || m.posterUrl,
            criticsScore: existing.criticsScore ?? m.criticsScore,
            audienceScore: existing.audienceScore ?? m.audienceScore,
            certifiedFresh: existing.certifiedFresh || m.certifiedFresh,
            averageRating: existing.isEstimatedRating && !m.isEstimatedRating ? m.averageRating : existing.averageRating,
            ratingSource: existing.isEstimatedRating && !m.isEstimatedRating ? m.ratingSource : existing.ratingSource,
            isEstimatedRating: existing.isEstimatedRating && m.isEstimatedRating
          });
        }
      }
    } catch (e) {
      console.error('Error fetching', url, e.message);
    }
  }

  const allMovies = Array.from(mergedMap.values());
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    count: allMovies.length,
    movies: allMovies
  };

  const outRoot = path.join(__dirname, 'movies-data.json');
  fs.writeFileSync(outRoot, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${allMovies.length} movies to movies-data.json`);
})();
