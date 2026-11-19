// 漫游电台 Roam Radio — the data module. `app.contract` is the view.
//
// radio-browser is an open, non-commercial index of ~52k stations: no key, no account,
// CORS open. Its house rules ask for an identifiable User-Agent and one `/json/url/{uuid}`
// per play (which we send from `pushRecent`), and that clients never hard-code one server.
import type { Answer, Sources } from './app.contract.d.ts';

const PRIMARY = 'https://de1.api.radio-browser.info';
const ALIAS = 'https://all.api.radio-browser.info';
const FAVORITES = 'app:/data/favorites.json';
const RECENT = 'app:/data/recent.json';
const RECENT_LIMIT = 80;
const PREFS = 'app:/data/prefs.json';
const UA = 'RoamRadio/0.2 (Exact; radio-browser client)';

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
  /** The plain `url` from the index: tried once if `stream` fails. */
  fallback: string;
  favicon: string;
  country: string;
  /** English display name kept raw so reads can localize per locale. */
  countryEn: string;
  countryCode: string;
  tags: string[];
  codec: string;
  bitrate: number;
  votes: number;
  clicks: number;
  flag: string;
  frequency: number;
  lat: number;
  lon: number;
  distanceKm: number;
};

/** The country's flag emoji from its ISO code, for the favorites tile. */
function flagOf(cc: string): string {
  return /^[A-Z]{2}$/.test(cc)
    ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '\u{1F310}';
}

/** A stable "dial position" per station, so the tuner reads the same every time. */
function emptyStation(): Station {
  return {
    id: '', name: '', tagline: '', stream: '', fallback: '', favicon: '',
    country: '', countryEn: '', countryCode: '', flag: '', tags: [], codec: '', bitrate: 0, votes: 0,
    clicks: 0, frequency: 87.5, lat: 0, lon: 0, distanceKm: 0,
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

function qs(params: Record<string, string | number>): string {
  return Object.keys(params)
    .map((key) => `${key}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

let base = PRIMARY;

async function getJson(path: string, timeoutMs = 16000): Promise<unknown> {
  // timeoutMs is the whole call's budget: each server attempt gets half.
  const attempt = async (b: string): Promise<Response> =>
    fetch(`${b}${path}`, { headers: { 'user-agent': UA }, exactTimeout: Math.ceil(timeoutMs / 2) });
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

// ── the shuffle pool ─────────────────────────────────────────────────────────
// The filter sheet names regions (multi-select) and one genre; the picker, like
// the prototype, jumps to a random country inside the choice and draws from a
// cached pool so repeated taps stay fast and rarely repeat.

const REGIONS: Record<string, string[]> = {
  asia: ['CN', 'JP', 'KR', 'IN', 'ID', 'TH', 'VN', 'PH', 'MY', 'SG', 'TW', 'HK', 'TR', 'IR'],
  europe: ['GB', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'SE', 'NO', 'FI', 'PL', 'GR', 'IE', 'CZ', 'UA', 'AT', 'IS'],
  africa: ['NG', 'KE', 'ZA', 'EG', 'MA', 'GH', 'SN', 'ET', 'TZ', 'UG'],
  americas: ['US', 'CA', 'MX', 'BR', 'AR', 'CO', 'CL', 'PE', 'CU', 'JM'],
  oceania: ['AU', 'NZ', 'FJ', 'PG'],
};

const GENRE_TAG: Record<string, string> = {
  pop: 'pop',
  jazz: 'jazz',
  classical: 'classical',
  rock: 'rock',
  electronic: 'electronic',
  news: 'news',
  folk: 'folk',
};

const CC_ZH: Record<string, string> = {
  CN: '中国', JP: '日本', KR: '韩国', IN: '印度', ID: '印度尼西亚', TH: '泰国', VN: '越南',
  PH: '菲律宾', MY: '马来西亚', SG: '新加坡', TW: '中国台湾', HK: '中国香港', TR: '土耳其', IR: '伊朗',
  GB: '英国', FR: '法国', DE: '德国', IT: '意大利', ES: '西班牙', PT: '葡萄牙', NL: '荷兰',
  SE: '瑞典', NO: '挪威', FI: '芬兰', PL: '波兰', GR: '希腊', IE: '爱尔兰', CZ: '捷克',
  UA: '乌克兰', AT: '奥地利', IS: '冰岛', CH: '瑞士', BE: '比利时', DK: '丹麦', RU: '俄罗斯',
  HU: '匈牙利', RO: '罗马尼亚', RS: '塞尔维亚', HR: '克罗地亚', NG: '尼日利亚', KE: '肯尼亚',
  ZA: '南非', EG: '埃及', MA: '摩洛哥', GH: '加纳', SN: '塞内加尔', ET: '埃塞俄比亚',
  TZ: '坦桑尼亚', UG: '乌干达', US: '美国', CA: '加拿大', MX: '墨西哥', BR: '巴西',
  AR: '阿根廷', CO: '哥伦比亚', CL: '智利', PE: '秘鲁', CU: '古巴', JM: '牙买加',
  AU: '澳大利亚', NZ: '新西兰', FJ: '斐济', PG: '巴布亚新几内亚',
  DZ: '阿尔及利亚', TN: '突尼斯', LY: '利比亚', CM: '喀麦隆', CI: '科特迪瓦',
  ZW: '津巴布韦', ZM: '赞比亚', MZ: '莫桑比克', RW: '卢旺达', BW: '博茨瓦纳',
  NA: '纳米比亚', MU: '毛里求斯', BF: '布基纳法索', ML: '马里', NE: '尼日尔',
  TD: '乍得', MG: '马达加斯加', SK: '斯洛伐克', SI: '斯洛文尼亚',
  BG: '保加利亚', LT: '立陶宛', LV: '拉脱维亚', EE: '爱沙尼亚', BY: '白俄罗斯',
  CY: '塞浦路斯', LU: '卢森堡', MT: '马耳他', MD: '摩尔多瓦', AL: '阿尔巴尼亚',
  BA: '波黑', MK: '北马其顿', ME: '黑山', GE: '格鲁吉亚', AM: '亚美尼亚',
  AZ: '阿塞拜疆', KZ: '哈萨克斯坦', SA: '沙特阿拉伯', AE: '阿联酋', IL: '以色列',
  JO: '约旦', LB: '黎巴嫩', IQ: '伊拉克', PK: '巴基斯坦', BD: '孟加拉国',
  LK: '斯里兰卡', NP: '尼泊尔', KH: '柬埔寨', LA: '老挝', MN: '蒙古',
  DO: '多米尼加', PA: '巴拿马', CR: '哥斯达黎加', GT: '危地马拉', HN: '洪都拉斯',
  NI: '尼加拉瓜', SV: '萨尔瓦多', VE: '委内瑞拉', EC: '厄瓜多尔', BO: '玻利维亚',
  PY: '巴拉圭', UY: '乌拉圭', PR: '波多黎各', TT: '特立尼达和多巴哥',
  BS: '巴哈马', HT: '海地', GY: '圭亚那', SR: '苏里南', BZ: '伯利兹',
};

const CC_EN: Record<string, string> = {
  CN: 'China', JP: 'Japan', KR: 'South Korea', IN: 'India', ID: 'Indonesia', TH: 'Thailand', VN: 'Vietnam',
  PH: 'Philippines', MY: 'Malaysia', SG: 'Singapore', TW: 'Taiwan', HK: 'Hong Kong', TR: 'Türkiye', IR: 'Iran',
  GB: 'United Kingdom', FR: 'France', DE: 'Germany', IT: 'Italy', ES: 'Spain', PT: 'Portugal', NL: 'Netherlands',
  SE: 'Sweden', NO: 'Norway', FI: 'Finland', PL: 'Poland', GR: 'Greece', IE: 'Ireland', CZ: 'Czechia',
  UA: 'Ukraine', AT: 'Austria', IS: 'Iceland', CH: 'Switzerland', BE: 'Belgium', DK: 'Denmark', RU: 'Russia',
  HU: 'Hungary', RO: 'Romania', RS: 'Serbia', HR: 'Croatia', NG: 'Nigeria', KE: 'Kenya',
  ZA: 'South Africa', EG: 'Egypt', MA: 'Morocco', GH: 'Ghana', SN: 'Senegal', ET: 'Ethiopia',
  TZ: 'Tanzania', UG: 'Uganda', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil',
  AR: 'Argentina', CO: 'Colombia', CL: 'Chile', PE: 'Peru', CU: 'Cuba', JM: 'Jamaica',
  AU: 'Australia', NZ: 'New Zealand', FJ: 'Fiji', PG: 'Papua New Guinea',
  DZ: 'Algeria', TN: 'Tunisia', LY: 'Libya', CM: 'Cameroon', CI: "Côte d'Ivoire",
  ZW: 'Zimbabwe', ZM: 'Zambia', MZ: 'Mozambique', RW: 'Rwanda', BW: 'Botswana',
  NA: 'Namibia', MU: 'Mauritius', BF: 'Burkina Faso', ML: 'Mali', NE: 'Niger',
  TD: 'Chad', MG: 'Madagascar', SK: 'Slovakia', SI: 'Slovenia',
  BG: 'Bulgaria', LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', BY: 'Belarus',
  CY: 'Cyprus', LU: 'Luxembourg', MT: 'Malta', MD: 'Moldova', AL: 'Albania',
  BA: 'Bosnia and Herzegovina', MK: 'North Macedonia', ME: 'Montenegro', GE: 'Georgia', AM: 'Armenia',
  AZ: 'Azerbaijan', KZ: 'Kazakhstan', SA: 'Saudi Arabia', AE: 'United Arab Emirates', IL: 'Israel',
  JO: 'Jordan', LB: 'Lebanon', IQ: 'Iraq', PK: 'Pakistan', BD: 'Bangladesh',
  LK: 'Sri Lanka', NP: 'Nepal', KH: 'Cambodia', LA: 'Laos', MN: 'Mongolia',
  DO: 'Dominican Republic', PA: 'Panama', CR: 'Costa Rica', GT: 'Guatemala', HN: 'Honduras',
  NI: 'Nicaragua', SV: 'El Salvador', VE: 'Venezuela', EC: 'Ecuador', BO: 'Bolivia',
  PY: 'Paraguay', UY: 'Uruguay', PR: 'Puerto Rico', TT: 'Trinidad and Tobago',
  BS: 'Bahamas', HT: 'Haiti', GY: 'Guyana', SR: 'Suriname', BZ: 'Belize',
};

// (countrycode|genre) → stations not yet drawn this session.
const pools = new Map<string, Station[]>();

function rnd<T>(xs: T[]): T | undefined {
  if (xs.length === 0) return undefined;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf); // ambient-free draw: crypto is allowed inside a source
  return xs[buf[0] % xs.length];
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1].replace(/^www\./i, '') : '';
}

// Names arrive with padding, with the genre glued on (`0R - Piano Lounge || Jazz,Piano`),
// and sometimes empty — the index is crowd-sourced.
// One rendered line's worth of station name: CJK glyphs draw about twice an
// ASCII letter, so the budget is columns, not characters — 48 columns is
// 24 hanzi or 48 ASCII letters (the old 72-character cut let Chinese names
// run three times past the dial's one-line width).
const NAME_WIDTH = 48;

// Ranges that render wide (double-width) in the UI font: Hangul Jamo, CJK
// radicals through Yi, Hangul syllables, CJK compatibility ideographs and
// forms, fullwidth punctuation/letters, and the supplementary planes.
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function cleanName(raw: string, fallback: string): string {
  let name = raw.trim();
  const bar = name.indexOf('||');
  if (bar > 0) name = name.slice(0, bar);
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) name = fallback || 'Radio station';
  let width = 0;
  for (const ch of name) width += isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1;
  if (width <= NAME_WIDTH) return name;
  // Over budget: keep the widest prefix that still leaves a column for "…".
  // `for…of` walks by code point, so an emoji astral pair is never cut in half.
  let kept = 0;
  let keptWidth = 0;
  for (const ch of name) {
    const w = isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1;
    if (keptWidth + w > NAME_WIDTH - 1) break;
    keptWidth += w;
    kept += ch.length;
  }
  return `${name.slice(0, kept).trimEnd()}…`;
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

function shortCountry(country: string): string {
  return SHORT_COUNTRY[country] ?? country.replace(/^The\s+/i, '');
}

// A playlist document is not an audio stream: no <audio> outside Safari plays it.
const PLAYLIST = /\.(?:m3u8|m3u|pls)(?:[?#]|$)/i;

// When the index's preferred address fails, the plain `url` sometimes still works.
function fallbackFor(url: string, stream: string): string {
  if (!/^https:\/\//i.test(url) || url === stream || PLAYLIST.test(url)) return '';
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
  // The index often says hls=0 for a .m3u8 anyway (see PLAYLIST above).
  if (PLAYLIST.test(stream)) return null;
  const favicon = asString(row.favicon);
  const tags = asString(row.tags)
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length < 18)
    .slice(0, 6);
  const country = shortCountry(asString(row.country));
  const codecRaw = asString(row.codec).toUpperCase();
  const codec = codecRaw === 'UNKNOWN' ? '' : codecRaw;
  const bitrate = asNumber(row.bitrate);
  const cc = asString(row.countrycode).toUpperCase().slice(0, 2);
  return {
    id,
    name: cleanName(asString(row.name), hostOf(stream)),
    tagline: [CC_ZH[cc] ?? country, tags.slice(0, 2).join(' · ')].filter((part) => part.length > 0).join(' · '),
    stream,
    fallback: fallbackFor(asString(row.url), stream),
    favicon: /^https:\/\//i.test(favicon) ? favicon : '',
    country: CC_ZH[cc] ?? country,
    countryEn: country || cc,
    countryCode: cc,
    flag: flagOf(cc),
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

async function readJson<T>(storage: Storage, path: string, keep: (value: unknown) => T | null): Promise<T[]> {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(await storage.fs.readFile(path)));
    if (!Array.isArray(parsed)) return [];
    const out: T[] = [];
    for (const item of parsed) {
      const kept = keep(item);
      if (kept !== null) out.push(kept);
    }
    return out;
  } catch {
    // `ENOENT` the first time, `bake` while the view builds: both are "nothing kept yet".
    return [];
  }
}

// Old saves may predate a field; everything is repaired on read.
function repairStation(v: Station & Record<string, unknown>): Station {
  return {
    ...v,
    frequency: Number.isFinite(v.frequency) && (v.frequency as number) > 0 ? (v.frequency as number) : freqOf(v.id),
    lat: Number.isFinite(v.lat) ? (v.lat as number) : 0,
    lon: Number.isFinite(v.lon) ? (v.lon as number) : 0,
    fallback: typeof v.fallback === 'string' ? v.fallback : '',
    countryCode: typeof v.countryCode === 'string' ? v.countryCode.slice(0, 2) : '',
    flag: flagOf(typeof v.countryCode === 'string' ? v.countryCode.slice(0, 2) : ''),
    tagline: typeof v.tagline === 'string' ? v.tagline : (v.country as string) || '',
    tags: Array.isArray(v.tags) ? (v.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
  };
}

function readStations(storage: Storage, path: string): Promise<Station[]> {
  return readJson(storage, path, (v) => (isStation(v) ? repairStation(v as Station & Record<string, unknown>) : null));
}

async function writeJson(storage: Storage, path: string, value: unknown): Promise<void> {
  try {
    await storage.fs.atomicWriteFile(path, encoder.encode(JSON.stringify(value)));
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') return;
    throw e;
  }
}

// The index counts a play per station per IP per day; it is the only feedback it asks for.
function reportClick(id: string): void {
  fetch(`${base}/json/url/${encodeURIComponent(id)}`, {
    headers: { 'user-agent': UA },
    exactTimeout: 5000,
  }).catch(() => undefined);
}

function agoParts(t: number, now: number): { kind: string; n: number } {
  const minutes = Math.floor((now - t) / 60000);
  if (minutes < 1) return { kind: 'now', n: 0 };
  if (minutes < 60) return { kind: 'min', n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: 'hour', n: hours };
  return { kind: 'day', n: Math.floor(hours / 24) };
}

// Rough local clock at a longitude: one hour per 15°, rounded to the nearest
// zone, spoken the way the prototype does ("当地约 下午 7:24"). `now` comes from
// the view's exactTime resource — sources have no ambient clock.
// Day-part buckets, exactly the five the view's chip chain renders
// (app.contract: dawn/morning/noon/afternoon/evening — a `night` part would
// fall through to evening there, so late hours deliberately stay `evening`):
//   0:00–4:59 dawn (凌晨)   5:00–11:59 morning   12:00–12:59 noon
//   13:00–17:59 afternoon  18:00–23:59 evening (晚上, incl. 21:00+ night)
function localTimeParts(lon: number, now: number): { part: string; time: string } | null {
  if (!Number.isFinite(lon)) return null;
  const shifted = new Date(now + Math.round(lon / 15) * 3600000);
  const h = shifted.getUTCHours();
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  const part = h < 5 ? 'dawn' : h < 12 ? 'morning' : h < 13 ? 'noon' : h < 18 ? 'afternoon' : 'evening';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { part, time: `${h12}:${mm}` };
}

// Localize a station's place strings at read time (favorites/history were saved
// with the base-locale names baked in; `countryEn` keeps the raw English name).
function localizeStation(s: Station, zh: boolean): Station {
  const zhName = CC_ZH[s.countryCode] ?? s.country;
  const enName = s.countryEn || CC_EN[s.countryCode] || s.country;
  const name = zh ? zhName : enName;
  return {
    ...s,
    country: name,
    tagline: [name, s.tags.slice(0, 2).join(' · ')].filter((p) => p.length > 0).join(' · '),
  };
}

const sources: Sources = {
  // The radio face's SHUFFLE. Each sweep carries a total time budget (the
  // index can take two 8-second timeouts per call, and a sweep makes several
  // calls — without a budget the dial can hang a minute on a weak network);
  // when the money runs out the answer says "offline" so the face can offer a
  // retry instead of a false "nothing here". The ladder stays as tight as the
  // index allows: region+genre draws, a genre-wide sweep clipped to the
  // region, then — only if the genre was the blocker — region-only draws,
  // marked "relaxed" so the face can say what it dropped.
  shuffleStation: async ([rev, regionKeys, genreKey, exclude, zh]: [
    number,
    string[],
    string,
    string,
    boolean,
  ]): Promise<{ rev: number; station: Station | null; note: string }[]> => {
    const codes = regionKeys.flatMap((k) => REGIONS[k] ?? []);
    const codeSet = new Set(codes);
    const tag = GENRE_TAG[genreKey] ?? '';
    // No clock is readable inside a source, so the budget is a call count
    // with decaying timeouts: four directory calls at most, 6s, 4s, 3s, 2s
    // (each call's budget split across its two servers). A weak network
    // starves the sweep in ~15s instead of the minute two full timeouts per
    // call could hang it, and a starved sweep answers "offline" so the face
    // offers a retry instead of a false "nothing here". Cached pools cost no
    // budget. The ladder stays as tight as the index allows: region+genre
    // draws, a genre-wide sweep clipped to the region, then — only if the
    // genre was the blocker — region-only draws, marked "relaxed" so the face
    // can say what it dropped.
    const TIMEOUTS = [6000, 4000, 3000, 2000];
    let call = 0;
    const canFetch = () => call < TIMEOUTS.length;
    const fetchRows = async (cc: string, withTag: boolean): Promise<Station[]> => {
      const t = TIMEOUTS[Math.min(call, TIMEOUTS.length - 1)];
      call += 1;
      const filters: Record<string, string | number> = {
        hidebroken: 'true',
        is_https: 'true',
        order: 'random',
        limit: cc ? 30 : 80,
      };
      if (cc) filters.countrycode = cc;
      if (tag && withTag) filters.tag = tag;
      return toStations(await getJson(`/json/stations/search?${qs(filters)}`, t));
    };
    // Up to three draws from a random country in the region (any country when
    // none), preferring stations not yet played this session.
    const drawFromRegion = async (withTag: boolean): Promise<Station | null> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!canFetch()) return null;
        const cc = codes.length ? (rnd(codes) ?? '') : '';
        const key = `${cc}|${withTag ? tag : ''}`;
        let pool = pools.get(key);
        if (!pool || pool.length === 0) {
          pool = await fetchRows(cc, withTag);
        }
        pool = pool.filter((s) => s.id !== exclude);
        const pick = rnd(pool);
        if (pick) {
          pools.set(key, pool.filter((s) => s.id !== pick.id));
          return pick;
        }
      }
      return null;
    };
    try {
      const pick = await drawFromRegion(true);
      if (pick) return [{ rev, station: localizeStation(pick, zh), note: 'ok' }];
      if (tag && canFetch()) {
        // The chosen countries came up empty for the genre (common for sparse
        // region+genre pairs): one genre-wide sweep, clipped to the region.
        const wide = (await fetchRows('', true)).filter((s) => {
          if (s.id === exclude) return false;
          return codes.length === 0 || codeSet.has(s.countryCode.toUpperCase());
        });
        const widePick = rnd(wide);
        if (widePick) return [{ rev, station: localizeStation(widePick, zh), note: 'ok' }];
      }
      if (tag) {
        // Genre was the blocker: play the region without it, and say so.
        const loose = await drawFromRegion(false);
        if (loose) return [{ rev, station: localizeStation(loose, zh), note: 'relaxed' }];
      }
      // Reached the bottom with budget to spare: the index truly answered
      // nothing. Out of budget: that is the network, not the music.
      return [{ rev, station: null, note: canFetch() ? 'empty' : 'offline' }];
    } catch {
      // The directory was unreachable or a call threw — not "nothing here".
      // The face offers a retry instead of shrugging.
      return [{ rev, station: null, note: 'offline' }];
    }
  },

  // The 足迹 tab: everything the shuffle landed on, folded into counts per
  // country, plus the recent rows with a dial position and a relative time.
  footprint: async ([zh, now]: [boolean, number], _store: unknown, storage: Storage): Promise<{
    countryCount: number;
    stationCount: number;
    countries: { cc: string; country: string; count: number; flag: string }[];
    recent: { station: Station; freq: string; place: string; agoKind: string; agoN: number }[];
  }> => {
    // Recent is saved as {station, at} rows so the 足迹 tab can show "5 分钟前".
    const entries = await readJson(storage, RECENT, (v): { station: Station; at: number } | null => {
      if (isStation(v)) return { station: repairStation(v as Station & Record<string, unknown>), at: 0 }; // legacy saves: no timestamp kept
      if (v && typeof v === 'object' && isStation((v as Record<string, unknown>).station)) {
        const row = v as Record<string, unknown>;
        return { station: repairStation(row.station as Station & Record<string, unknown>), at: asNumber(row.at) };
      }
      return null;
    });
    const rows = entries.map((e) => e.station);
    const counts = new Map<string, { cc: string; country: string; count: number; flag: string }>();
    for (const s of rows) {
      const cc = s.countryCode || '??';
      const shown = localizeStation(s, zh);
      const entry = counts.get(cc);
      if (entry) entry.count += 1;
      else counts.set(cc, { cc, country: shown.country || cc, count: 1, flag: flagOf(cc) });
    }
    const countries = [...counts.values()].sort((a, b) => b.count - a.count);
    return {
      countryCount: countries.length,
      stationCount: rows.length,
      countries,
      recent: entries.map((e) => {
        const shown = localizeStation(e.station, zh);
        const ago = e.at > 0 ? agoParts(e.at, now) : { kind: '', n: 0 };
        return {
          station: shown,
          freq: e.station.frequency.toFixed(1),
          place: shown.tagline || shown.country,
          agoKind: ago.kind,
          agoN: ago.n,
        };
      }),
    };
  },

  localTime: async ([lon, now]: [number, number]): Promise<{ part: string; time: string }> =>
    localTimeParts(lon, now) ?? { part: '', time: '' },

  loadFavorites: async ([zh]: [boolean], _store: unknown, storage: Storage): Promise<Station[]> =>
    (await readStations(storage, FAVORITES)).map((s) => localizeStation(s, zh)),

  toggleFavorite: async (
    [station]: [Station],
    _store: unknown,
    storage: Storage,
  ): Promise<{ ok: boolean; favorited: boolean }> => {
    const kept = await readStations(storage, FAVORITES);
    const exists = kept.some((s) => s.id === station.id);
    const next = exists ? kept.filter((s) => s.id !== station.id) : [station, ...kept];
    await writeJson(storage, FAVORITES, next);
    return { ok: true, favorited: !exists };
  },

  loadRecent: async ([zh]: [boolean], _store: unknown, storage: Storage): Promise<Station[]> => {
    const entries = await readJson(storage, RECENT, (v): Station | null => {
      if (isStation(v)) return repairStation(v as Station & Record<string, unknown>);
      if (v && typeof v === 'object' && isStation((v as Record<string, unknown>).station)) {
        return (v as Record<string, unknown>).station as Station;
      }
      return null;
    });
    return entries.map((s) => localizeStation(s, zh));
  },

  pushRecent: async (
    [station, now]: [Station, number],
    _store: unknown,
    storage: Storage,
  ): Promise<{ ok: boolean; favorited: boolean }> => {
    const entries = await readJson(storage, RECENT, (v): { station: Station; at: number } | null => {
      if (isStation(v)) return { station: v, at: 0 };
      if (v && typeof v === 'object' && isStation((v as Record<string, unknown>).station)) {
        const row = v as Record<string, unknown>;
        return { station: row.station as Station, at: asNumber(row.at) };
      }
      return null;
    });
    const next = [{ station, at: now }, ...entries.filter((e) => e.station.id !== station.id)].slice(0, RECENT_LIMIT);
    await writeJson(storage, RECENT, next);
    reportClick(station.id);
    return { ok: true, favorited: false };
  },

  loadPrefs: async (_args: [], _store: unknown, storage: Storage): Promise<{
    regions: string[];
    genre: string;
  }> => {
    try {
      const raw: unknown = JSON.parse(decoder.decode(await storage.fs.readFile(PREFS)));
      if (!raw || typeof raw !== 'object') return { regions: [], genre: '' };
      const p = raw as Record<string, unknown>;
      return {
        regions: Array.isArray(p.regions) ? p.regions.filter((r) => typeof r === 'string') : [],
        genre: asString(p.genre),
      };
    } catch {
      return { regions: [], genre: '' };
    }
  },

  savePrefs: async (
    [regions, genre]: [string[], string],
    _store: unknown,
    storage: Storage,
  ): Promise<{ ok: boolean; favorited: boolean }> => {
    await writeJson(storage, PREFS, { regions, genre });
    return { ok: true, favorited: false };
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
