// Airwave — the data module. `app.contract` is the view.
//
// radio-browser is an open, non-commercial index of ~52k stations: no key, no account,
// CORS open. Its house rules ask for an identifiable User-Agent and one `/json/url/{uuid}`
// per play (which we send from `pushRecent`), and that clients never hard-code one server.
import type { Answer, Sources } from './app.contract.d.ts';

const PRIMARY = 'https://de1.api.radio-browser.info';
const ALIAS = 'https://all.api.radio-browser.info';
const FAVORITES = 'app:/data/favorites.json';
const RECENT = 'app:/data/recent.json';
const RECENT_LIMIT = 20;
const SEARCHES = 'app:/data/searches.json';
const SEARCH_LIMIT = 8;
const PAGE = 40;
const UA = 'Airwave/0.1 (Exact; radio-browser client)';

export const grants = [
  `net.fetch ${PRIMARY}`,
  `net.fetch ${ALIAS}`,
  'fs.read app:/data',
  'fs.write app:/data',
].join('\n');

type Station = {
  id: string;
  name: string;
  tagline: string;
  stream: string;
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


// ── the map ─────────────────────────────────────────────────────────────────
// A plain slippy map: the tiles are Esri's light grey canvas basemap (no key, attribution
// required), and every
// number the view needs — tile offsets, the pin, the degrees per pixel — is computed
// here, because Contract has no trigonometry.
const RAD = Math.PI / 180;
const TILE = 256;
// The map fills its tab, and the tab's size isn't known here, so the tile layer is built
// for a box big enough to cover the largest window and the view centres it and clips.
const MAP_BOX = 1400;
const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile';

type MapTile = { k: number; url: string; left: number; top: number };

function lonToX(lon: number, scale: number): number {
  return ((lon + 180) / 360) * scale;
}

function latToY(lat: number, scale: number): number {
  const clamped = Math.max(-85.05, Math.min(85.05, lat)) * RAD;
  const s = Math.sin(clamped);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
}

function mapView(
  lat: number,
  lon: number,
  zoom: number,
  markerLat: number,
  markerLon: number,
  pickLat: number,
  pickLon: number,
) {
  const z = Math.max(1, Math.min(8, Math.round(zoom)));
  const scale = TILE * Math.pow(2, z);
  const centerX = lonToX(lon, scale);
  const centerY = latToY(lat, scale);
  const left = centerX - MAP_BOX / 2;
  const top = centerY - MAP_BOX / 2;
  const span = Math.pow(2, z);
  const tiles: MapTile[] = [];
  for (let x = Math.floor(left / TILE); x <= Math.floor((left + MAP_BOX - 1) / TILE); x += 1) {
    for (let y = Math.floor(top / TILE); y <= Math.floor((top + MAP_BOX - 1) / TILE); y += 1) {
      if (y < 0 || y >= span) continue;
      const wrapped = ((x % span) + span) % span;
      tiles.push({
        k: y * span + wrapped,
        url: `${TILE_URL}/${z}/${y}/${wrapped}`,
        left: Math.round(x * TILE - left),
        top: Math.round(y * TILE - top),
      });
    }
  }
  const hasMarker = markerLat !== 0 || markerLon !== 0;
  const markerLeft = hasMarker ? Math.round(lonToX(markerLon, scale) - left) : -100;
  const markerTop = hasMarker ? Math.round(latToY(markerLat, scale) - top) : -100;
  // Where the user let go — the pin that keeps "I chose this spot" on screen.
  const hasPick = pickLat !== 0 || pickLon !== 0;
  const pickLeft = hasPick ? Math.round(lonToX(pickLon, scale) - left) : -100;
  const pickTop = hasPick ? Math.round(latToY(pickLat, scale) - top) : -100;
  const lonPerPx = 360 / scale;
  return {
    box: MAP_BOX,
    half: MAP_BOX / 2,
    tiles,
    markerLeft,
    markerTop,
    hasMarker,
    pickLeft,
    pickTop,
    hasPick,
    lonPerPx,
    latPerPx: lonPerPx * Math.cos(((Math.abs(lat) > 80 ? 80 : Math.abs(lat)) * RAD)),
  };
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

function normalize(raw: unknown): Station | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.stationuuid);
  // `url_resolved` is the playlist and redirects already followed: always prefer it.
  const stream = asString(row.url_resolved) || asString(row.url);
  if (!id || !/^https:\/\//i.test(stream)) return null;
  if (asNumber(row.hls) !== 0) return null; // HLS: Apple plays it, a browser's <audio> does not
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
  if (!f || want <= PAGE) {
    f = { items: [], raw: 0, done: false };
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
  map: async ([lat, lon, zoom, mLat, mLon, pLat, pLon]: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]) => mapView(lat, lon, zoom, mLat, mLon, pLat, pLon),

  // What's around the point the user let go of: the index answers by distance when asked
  // with geo_distance, and the rows come back nearest first after the sort below.
  nearest: async ([lat, lon, radiusKm]: [number, number, number]): Promise<Station[]> => {
    // `geo_distance` is in metres — passing kilometres quietly searches a few blocks.
    const metres = Math.round(Math.max(10, radiusKm) * 1000);
    const url = `/json/stations/search?${qs({
      geo_lat: lat.toFixed(3),
      geo_long: lon.toFixed(3),
      geo_distance: metres,
      hidebroken: 'true',
      is_https: 'true',
      limit: 40,
    })}`;
    const rows = await getJson(url);
    if (!Array.isArray(rows)) return [];
    const sorted = (rows as unknown[])
      .map((row) => ({ row, km: asNumber((row as Record<string, unknown>).geo_distance) }))
      .filter((entry) => Number.isFinite(entry.km))
      .sort((a, b) => a.km - b.km);
    const stations = toStations(sorted.map((entry) => entry.row));
    // The card lists them by distance, so keep the index's own number on each row.
    const kept = stations.slice(0, 10);
    return kept.map((station, index) => ({ ...station, distanceKm: Math.round(sorted[index].km / 100) / 10 }));
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
