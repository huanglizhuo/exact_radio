// Airwave — the data module. `app.contract` is the view.
//
// radio-browser is an open, non-commercial index of ~52k stations: no key, no account,
// CORS open. Its house rules ask for an identifiable User-Agent and one `/json/url/{uuid}`
// per play (which we send from `pushRecent`), and that clients never hard-code one server.
import type { Answer, Sources } from './app.contract.d.ts';
import { buildDataset, haversine, nearestIn, parseSeed, type Dataset, type SeedRow } from './globe';
import { GLOBE_SEED } from './data/globe-seed';

const PRIMARY = 'https://de1.api.radio-browser.info';
const ALIAS = 'https://all.api.radio-browser.info';
const FAVORITES = 'app:/data/favorites.json';
const RECENT = 'app:/data/recent.json';
const RECENT_LIMIT = 20;
const SEARCHES = 'app:/data/searches.json';
const SEARCH_LIMIT = 8;
const PAGE = 40;
const GLOBE_CACHE = 'app:/cache/globe.json';
const UA = 'Airwave/0.1 (Exact; radio-browser client)';

export const grants = [
  `net.fetch ${PRIMARY}`,
  `net.fetch ${ALIAS}`,
  'fs.read app:/data',
  'fs.write app:/data',
  'fs.read app:/cache',
  'fs.write app:/cache',
].join('\n');

type Station = {
  id: string;
  name: string;
  tagline: string;
  stream: string;
  /** The plain `url` from the index: tried once if `stream` fails. */
  fallback: string;
  favicon: string;
  country: string;
  countryCode: string;
  tags: string[];
  codec: string;
  bitrate: number;
  votes: number;
  clicks: number;
  frequency: number;
  lat: number;
  lon: number;
  /** Set only by `nearest`: how far this station is from the point the user picked. */
  distanceKm: number;
};

/** A stable "dial position" per station, so the radio face reads the same every time. */
function emptyStation(): Station {
  return {
    id: '', name: '', tagline: '', stream: '', fallback: '', favicon: '',
    country: '', countryCode: '', tags: [], codec: '', bitrate: 0, votes: 0,
    clicks: 0, frequency: 0, lat: 0, lon: 0, distanceKm: 0,
  };
}

function freqOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const spot = Math.abs(hash) % 201; // 0..200 → 87.5 .. 107.5 in 0.1 steps
  return Math.round((87.5 + spot / 10) * 10) / 10;
}

type Storage = {
  fs: {
    readFile(path: string): Promise<ArrayBuffer>;
    atomicWriteFile(path: string, bytes: Uint8Array): Promise<void>;
    mkdir(path: string): Promise<void>;
  };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Only HTTPS streams: iOS/macOS are not asked to relax App Transport Security
// (`appTransportSecurity`), and a page served over HTTPS cannot load an HTTP
// stream anyway. That is roughly two thirds of the index.
const FILTERS = { hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true' };

function qs(params: Record<string, string | number>): string {
  return Object.keys(params)
    .map((key) => `${key}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

let base = PRIMARY;

async function getJson(path: string): Promise<unknown> {
  const attempt = async (b: string): Promise<Response> =>
    fetch(`${b}${path}`, { headers: { 'user-agent': UA }, exactTimeout: 8000 });
  let response: Response;
  try {
    response = await attempt(base);
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e; // no network while the view bakes
    base = base === PRIMARY ? ALIAS : PRIMARY; // the index's other server, once
    response = await attempt(base);
  }
  if (!response.ok) throw new Error(`The station index answered ${response.status}.`);
  return response.json();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}


// ── the globe ────────────────────────────────────────────────────────────────
// The world view draws itself (airwave/globe.ts) from the dataset held here:
// the cached fetch first, then the seed baked in at native build time, then a
// live fetch. `globeLoad(rev)` is asked twice — rev 1 boots from disk, a later
// rev (the once-per-launch task, or the refresh button) refetches and rewrites
// the cache.
let globeData: Dataset | null = null;
let globeLoading = false;

// Five real stations: what tests and the bake see, where every fetch refuses.
const GLOBE_SAMPLE: SeedRow[] = [
  ['bbc-world', 'BBC World Service', 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service', 51.5, -0.12, '', 'AAC', 0, 'GB', 'news', 900],
  ['radio-france', 'France Inter', 'https://icecast.radiofrance.fr/franceinter-midfi.mp3', 48.86, 2.35, '', 'MP3', 128, 'FR', 'general', 500],
  ['nhk-tokyo', 'NHK Radio 1', 'https://netradio-live2.nhk.jp/hls/live/200170/nhkradiru1l/master.m3u8', 35.68, 139.69, '', 'AAC', 0, 'JP', 'news', 400],
  ['kexp-seattle', 'KEXP', 'https://kexp.streamguys1.com/kexp160.aac', 47.6, -122.33, '', 'AAC', 160, 'US', 'alternative', 800],
  ['abc-sydney', 'ABC Triple J', 'https://live-radio01.mediahubaustralia.com/2TJW/aac/', -33.87, 151.21, '', 'AAC', 128, 'AU', 'alternative', 300],
];

// The baked seed is already row arrays (a literal, not JSON text — escapes that
// a template literal would evaluate made JSON.parse quietly corrupt it).
function seedRows(seed: unknown): SeedRow[] {
  if (!Array.isArray(seed)) return [];
  return seed.filter(
    (row): row is SeedRow =>
      Array.isArray(row) && row.length >= 11 && typeof row[0] === 'string' && typeof row[3] === 'number',
  );
}

async function bootGlobe(storage: Storage): Promise<{ rev: number; count: number; origin: string }> {
  try {
    const bytes = await storage.fs.readFile(GLOBE_CACHE);
    const rows = parseSeed(decoder.decode(bytes));
    if (rows.length > 0) {
      globeData = buildDataset(rows, 'cache');
      return { rev: 1, count: rows.length, origin: 'cache' };
    }
  } catch {
    // Nothing cached yet — the seed or the fetch takes over.
  }
  const seeded = seedRows(GLOBE_SEED);
  if (seeded.length > 0) {
    globeData = buildDataset(seeded, 'seed');
    return { rev: 1, count: seeded.length, origin: 'seed' };
  }
  // Nothing on disk and nothing baked in (the web build): pull the whole set now.
  try {
    return await fetchGlobe(1, storage);
  } catch {
    // Tests and the bake: the index's answers there carry no usable coordinates,
    // so the sample keeps the globe drawable and deterministic.
    globeData = buildDataset(GLOBE_SAMPLE, 'sample');
    return { rev: 1, count: GLOBE_SAMPLE.length, origin: 'sample' };
  }
}

// One index row → the compact seed row the globe keeps (see scripts/snapshot-globe.sh).
function seedRowOf(raw: unknown): SeedRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.stationuuid);
  const stream = asString(row.url_resolved) || asString(row.url);
  const lat = asNumber(row.geo_lat);
  const lon = asNumber(row.geo_long);
  if (!id || !/^https:\/\//i.test(stream)) return null;
  // A live `${…}` in a URL never plays and would smuggle code through string data.
  if (stream.includes('${') || stream.includes('`')) return null;
  if (lat === 0 && lon === 0) return null;
  if (asNumber(row.hls) !== 0) return null;
  if (/\.(?:m3u8|m3u|pls)(?:[?#]|$)/i.test(stream)) return null;
  const favicon = asString(row.favicon);
  const codec = asString(row.codec).toUpperCase();
  const tag = asString(row.tags).split(',')[0].trim();
  return [
    id,
    cleanName(asString(row.name), hostOf(stream)).slice(0, 64),
    stream.slice(0, 180),
    Math.round(lat * 1000) / 1000,
    Math.round(lon * 1000) / 1000,
    /^https:\/\//i.test(favicon) ? favicon.slice(0, 120) : '',
    codec === 'UNKNOWN' ? '' : codec.slice(0, 8),
    asNumber(row.bitrate),
    asString(row.countrycode).slice(0, 2),
    tag.slice(0, 24),
    asNumber(row.votes),
  ];
}

async function fetchGlobe(rev: number, storage: Storage): Promise<{ rev: number; count: number; origin: string }> {
  globeLoading = true;
  try {
    const rows: SeedRow[] = [];
    const seen = new Set<string>();
    for (let offset = 0; offset < 12000; offset += 4000) {
      const raw = await getJson(
        `/json/stations/search?${qs({ hidebroken: 'true', is_https: 'true', has_geo_info: 'true', order: 'votes', reverse: 'true', limit: 4000, offset })}`,
      );
      if (!Array.isArray(raw)) break;
      for (const item of raw) {
        const row = seedRowOf(item);
        if (row && !seen.has(row[0])) {
          seen.add(row[0]);
          rows.push(row);
        }
      }
      if (raw.length < 4000) break;
    }
    if (rows.length === 0) throw new Error('The station index answered no geo-tagged stations.');
    globeData = buildDataset(rows, 'net');
    try {
      await storage.fs.atomicWriteFile(GLOBE_CACHE, encoder.encode(JSON.stringify(rows)));
    } catch {
      // The cache is an optimisation; the session still has the fresh set.
    }
    return { rev, count: rows.length, origin: 'net' };
  } finally {
    globeLoading = false;
  }
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1].replace(/^www\./i, '') : '';
}

// Names arrive with padding, with the genre glued on (`0R - Piano Lounge || Jazz,Piano`),
// and sometimes empty — the index is crowd-sourced.
function cleanName(raw: string, fallback: string): string {
  let name = raw.trim();
  const bar = name.indexOf('||');
  if (bar > 0) name = name.slice(0, bar);
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) name = fallback || 'Radio station';
  return name.length > 72 ? `${name.slice(0, 71).trimEnd()}…` : name;
}

// The index spells countries out ("The United Kingdom Of Great Britain And Northern Ireland");
// a row has one line for the place, so the common long ones get short names.
const SHORT_COUNTRY: Record<string, string> = {
  'The United States Of America': 'USA',
  'The United Kingdom Of Great Britain And Northern Ireland': 'UK',
  'United States': 'USA',
  'United Kingdom': 'UK',
  'The Russian Federation': 'Russia',
  'Russian Federation': 'Russia',
  'The Netherlands': 'Netherlands',
  'Czech Republic': 'Czechia',
  'The Republic Of North Macedonia': 'North Macedonia',
  'Korea, Republic of': 'South Korea',
  'Republic of Korea': 'South Korea',
  'The Republic Of Korea': 'South Korea',
  'Iran, Islamic Republic of': 'Iran',
  'The Islamic Republic Of Iran': 'Iran',
  'Bolivarian Republic of Venezuela': 'Venezuela',
  'The Bolivarian Republic Of Venezuela': 'Venezuela',
  'United Republic of Tanzania': 'Tanzania',
  'Syrian Arab Republic': 'Syria',
  'Viet Nam': 'Vietnam',
  'Türkiye': 'Türkiye',
};

const SHORT_LANG: Record<string, string> = {
  english: '英语',
  german: '德语',
  french: '法语',
  spanish: '西班牙语',
  italian: '意大利语',
  russian: '俄语',
  chinese: '中文',
  japanese: '日语',
  portuguese: '葡萄牙语',
  dutch: '荷兰语',
  polish: '波兰语',
  turkish: '土耳其语',
};

function titleCase(name: string): string {
  const known = SHORT_LANG[name.toLowerCase()];
  if (known) return known;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function shortCountry(country: string): string {
  return SHORT_COUNTRY[country] ?? country.replace(/^The\s+/i, '');
}

// When the index's preferred address fails, the plain `url` sometimes still works.
function fallbackFor(url: string, stream: string): string {
  if (!/^https:\/\//i.test(url) || url === stream) return '';
  if (/\.(?:m3u8|m3u|pls)(?:[?#]|$)/i.test(url)) return '';
  return url;
}

function normalize(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.stationuuid);
  // `url_resolved` is the playlist and redirects already followed: always prefer it.
  const stream = asString(row.url_resolved) || asString(row.url);
  if (!id || !/^https:\/\//i.test(stream)) return null;
  if (asNumber(row.hls) !== 0) return null; // HLS: Apple plays it, a browser's <audio> does not
  // The index often says hls=0 for a .m3u8 anyway, and a playlist file is never audio:
  // both are unplayable in <audio> on Android and in every browser but Safari.
  if (/\.m3u8(?:[?#]|$)/i.test(stream)) return null;
  if (/\.(?:m3u|pls)(?:[?#]|$)/i.test(stream)) return null;
  const favicon = asString(row.favicon);
  const tags = asString(row.tags)
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 6);
  const country = shortCountry(asString(row.country));
  const codecRaw = asString(row.codec).toUpperCase();
  const codec = codecRaw === 'UNKNOWN' ? '' : codecRaw;
  const bitrate = asNumber(row.bitrate);
  return {
    id,
    name: cleanName(asString(row.name), hostOf(stream)),
    tagline: [country, tags.slice(0, 2).join(' · ')].filter((part) => part.length > 0).join(' · '),
    stream,
    fallback: fallbackFor(asString(row.url), stream),
    favicon: /^https:\/\//i.test(favicon) ? favicon : '',
    country,
    countryCode: asString(row.countrycode),
    tags,
    codec,
    bitrate: bitrate > 0 ? Math.round(bitrate) : 0,
    votes: asNumber(row.votes),
    clicks: asNumber(row.clickcount),
    frequency: freqOf(id),
    lat: asNumber(row.geo_lat),
    lon: asNumber(row.geo_long),
    distanceKm: 0,
  };
}

function toStations(raw: unknown): Station[] {
  if (!Array.isArray(raw)) return [];
  const out: Station[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const station = normalize(item);
    if (station && !seen.has(station.id)) {
      seen.add(station.id);
      out.push(station);
    }
  }
  return out;
}

function isStation(value: unknown): value is Station {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return typeof s.id === 'string' && typeof s.name === 'string' && typeof s.stream === 'string';
}

async function readStations(storage: Storage, path: string): Promise<Station[]> {
  try {
    const bytes = await storage.fs.readFile(path);
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStation).map((station) => ({
      ...station,
      frequency: Number.isFinite(station.frequency) ? station.frequency : freqOf(station.id),
      lat: Number.isFinite(station.lat) ? station.lat : 0,
      lon: Number.isFinite(station.lon) ? station.lon : 0,
      fallback: typeof station.fallback === 'string' ? station.fallback : '',
    }));
  } catch {
    // `ENOENT` the first time, `bake` while the view builds: both are "nothing kept yet".
    return [];
  }
}

async function readStrings(storage: Storage, path: string): Promise<string[]> {
  try {
    const bytes = await storage.fs.readFile(path);
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
  } catch {
    return [];
  }
}

async function writeStrings(storage: Storage, path: string, values: string[]): Promise<void> {
  try {
    await storage.fs.atomicWriteFile(path, encoder.encode(JSON.stringify(values)));
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') return;
    throw e;
  }
}

async function writeStations(storage: Storage, path: string, stations: Station[]): Promise<void> {
  try {
    await storage.fs.atomicWriteFile(path, encoder.encode(JSON.stringify(stations)));
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') return;
    throw e;
  }
}

// One feed per (kind, value, query): the view asks for `want` rows and gets the accumulated
// list back, so a scroll only fetches what is missing. The index pages with raw offsets, which
// drift once duplicates are dropped, so the raw count is kept beside the kept rows.
type Feed = { items: Station[]; raw: number; done: boolean };
const feeds = new Map<string, Feed>();
// Session-scoped LRU: revisits serve from cache so tab switches stay instant, and the
// cap keeps a long browsing session from hoarding every tag/country/search it touched.
const FEED_LIMIT = 12;

async function pageOf(
  kind: string,
  value: string,
  query: string,
  offset: number,
  lang: string,
  codec: string,
): Promise<{ rows: Station[]; raw: number }> {
  const filters: Record<string, string | number> = { ...FILTERS, limit: PAGE, offset };
  if (kind === 'tag') filters.tagExact = value;
  else if (kind === 'country') filters.countrycode = value;
  else if (kind === 'search') filters.name = query;
  if (lang !== '') filters.language = lang;
  if (codec !== '') filters.codec = codec;
  const raw = await getJson(`/json/stations/search?${qs(filters)}`);
  return { rows: toStations(raw), raw: Array.isArray(raw) ? raw.length : 0 };
}

async function feed(
  kind: string,
  value: string,
  query: string,
  want: number,
  lang = '',
  codec = '',
): Promise<Station[]> {
  const key = `${kind}|${value}|${query}|${lang}|${codec}`;
  let f = feeds.get(key);
  if (!f) {
    f = { items: [], raw: 0, done: false };
    if (feeds.size >= FEED_LIMIT) {
      // Map keeps insertion order, so the first key is the least recently created feed.
      const oldest = feeds.keys().next().value as string;
      feeds.delete(oldest);
    }
    feeds.set(key, f);
  }
  while (f.items.length < want && !f.done) {
    const page = await pageOf(kind, value, query, f.raw, lang, codec);
    f.raw += page.raw;
    const seen = new Set(f.items.map((s) => s.id));
    for (const station of page.rows) {
      if (!seen.has(station.id)) {
        f.items.push(station);
        seen.add(station.id);
      }
    }
    // The index answers a short page at the end; the rows it dropped are not the end.
    if (page.raw < PAGE) f.done = true;
  }
  return f.items.slice(0, want);
}

// The index counts a play per station per IP per day; it is the only feedback it asks for.
function reportClick(id: string): void {
  fetch(`${base}/json/url/${encodeURIComponent(id)}`, {
    headers: { 'user-agent': UA },
    exactTimeout: 5000,
  }).catch(() => undefined);
}

const sources: Sources = {
  // rev 1 reads what the app already has (cache → seed → nothing); rev > 1 fetches.
  globeLoad: async ([rev]: [number], _store, storage): Promise<{ rev: number; count: number; origin: string }> =>
    rev <= 1 ? bootGlobe(storage) : fetchGlobe(rev, storage),

  // The pins a camera at (lat, lon, zoom) should see. The map view owns pan and
  // zoom now, so this only runs when the camera settles: pick the stations with
  // the most votes inside the visible band, capped so the web never has to push
  // thousands of DOM pins. Fewer than a handful in view → widen to nearest-by-
  // distance so remote areas are still marked.
  mapPins: async ([lat, lon, zoom, _rev]: [number, number, number, number]): Promise<
    { id: string; latitude: number; longitude: number; title: string | null }[]
  > => {
    if (!globeData) return [];
    const { rows, lats, lons } = globeData;
    const radiusKm = 66000 / Math.pow(2, zoom);
    const cap = zoom <= 2 ? 250 : zoom <= 4 ? 400 : 600;
    const showTitle = zoom >= 5;
    const idx: number[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (haversine(lat, lon, lats[i], lons[i]) <= radiusKm) idx.push(i);
    }
    if (idx.length > cap) {
      // votes are the index's own popularity ranking — keep the loudest ones
      idx.sort((a, b) => asNumber(rows[b][10]) - asNumber(rows[a][10]));
      idx.length = cap;
    } else if (idx.length < 40) {
      const near = nearestIn(globeData, lat, lon, 40);
      const seen = new Set(idx);
      for (const { row } of near) {
        const j = rows.indexOf(row);
        if (j >= 0 && !seen.has(j)) { seen.add(j); idx.push(j); }
      }
    }
    return idx.map((i) => {
      const r = rows[i];
      return {
        id: r[0],
        latitude: asNumber(r[3]),
        longitude: asNumber(r[4]),
        title: showTitle ? r[1] : null,
      };
    });
  },

  // A tapped pin, hydrated into a playable Station straight from the dataset —
  // distance measured from the live camera so the row reads naturally.
  stationById: async ([id, camLat, camLon]: [string, number, number]): Promise<Station> => {
    if (!globeData) return emptyStation();
    const row = globeData.rows.find((r) => r[0] == id);
    if (!row) return emptyStation();
    return {
      id: row[0],
      name: row[1],
      tagline: [row[8], row[9]].filter(Boolean).join(' · '),
      stream: row[2],
      fallback: '',
      favicon: row[5],
      country: row[8],
      countryCode: row[8],
      tags: row[9] ? [row[9]] : [],
      codec: row[6],
      bitrate: asNumber(row[7]),
      votes: asNumber(row[10]),
      clicks: 0,
      frequency: freqOf(row[0]),
      lat: asNumber(row[3]),
      lon: asNumber(row[4]),
      distanceKm: Math.round(haversine(camLat, camLon, asNumber(row[3]), asNumber(row[4])) * 10) / 10,
    };
  },

  feed: async ([kind, value, query, want, lang, codec]: [
    string,
    string,
    string,
    number,
    string,
    string,
  ]): Promise<Station[]> => {
    if (kind === 'search' && query.trim() === '') return [];
    return feed(kind, value, kind === 'search' ? query.trim() : '', Math.max(PAGE, want), lang ?? '', codec ?? '');
  },

  // The languages the index actually carries, biggest first: the search screen's filter row.
  languages: async (): Promise<{ code: string; name: string }[]> => {
    try {
      const raw = await getJson('/json/languages');
      if (!Array.isArray(raw)) return [];
      const rows = raw as { name: string; stationcount: number }[];
      return rows
        .filter((r) => typeof r.name === 'string' && r.name.trim() !== '' && r.stationcount > 0)
        .sort((a, b) => b.stationcount - a.stationcount)
        .slice(0, 10)
        .map((r) => ({ code: r.name.trim(), name: titleCase(r.name.trim()) }));
    } catch {
      return [];
    }
  },

  // The radio face: a random dial position, never the station already playing.
  randomStation: async (
    [rev, exclude, lat, lon, radiusKm]: [number, string, number, number, number],
  ): Promise<{ rev: number; station: Station }[]> => {
    const filters: Record<string, string | number> = {
      hidebroken: 'true',
      is_https: 'true',
      // The map flies to the pick, so a station without coordinates is no use here.
      has_geo_info: 'true',
      order: 'random',
      limit: 8,
    };
    // "Next" should stay in the neighbourhood the user is looking at, when there is one.
    if (lat !== 0 || lon !== 0) {
      filters.geo_lat = lat.toFixed(3);
      filters.geo_long = lon.toFixed(3);
      filters.geo_distance = Math.round(Math.max(10, radiusKm) * 1000);
    }
    const rows = toStations(await getJson(`/json/stations/search?${qs(filters)}`));
    const station = rows.find((row) => row.id !== exclude) ?? rows[0];
    return station ? [{ rev, station }] : [];
  },

  searchHistory: async (_args: [], _store: unknown, storage: Storage): Promise<string[]> =>
    readStrings(storage, SEARCHES),

  pushSearch: async (
    [query]: [string],
    _store: unknown,
    storage: Storage,
  ): Promise<{ ok: boolean; favorited: boolean }> => {
    const kept = await readStrings(storage, SEARCHES);
    const next = [query, ...kept.filter((q) => q !== query)].slice(0, SEARCH_LIMIT);
    await writeStrings(storage, SEARCHES, next);
    return { ok: true, favorited: false };
  },

  loadFavorites: async (_args: [], _store: unknown, storage: Storage): Promise<Station[]> =>
    readStations(storage, FAVORITES),

  toggleFavorite: async (
    [station]: [Station],
    _store: unknown,
    storage: Storage,
  ): Promise<{ ok: boolean; favorited: boolean }> => {
    const kept = await readStations(storage, FAVORITES);
    const exists = kept.some((s) => s.id === station.id);
    const next = exists ? kept.filter((s) => s.id !== station.id) : [station, ...kept];
    await writeStations(storage, FAVORITES, next);
    return { ok: true, favorited: !exists };
  },

  loadRecent: async (_args: [], _store: unknown, storage: Storage): Promise<Station[]> =>
    readStations(storage, RECENT),

  pushRecent: async (
    [station]: [Station],
    _store: unknown,
    storage: Storage,
  ): Promise<{ ok: boolean; favorited: boolean }> => {
    const kept = await readStations(storage, RECENT);
    await writeStations(storage, RECENT, [station, ...kept.filter((s) => s.id !== station.id)].slice(0, RECENT_LIMIT));
    reportClick(station.id);
    return { ok: true, favorited: false };
  },

};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
