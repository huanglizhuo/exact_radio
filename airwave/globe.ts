// The world view: an orthographic globe drawn on a canvas surface, with every
// geo-tagged station the index carries as a dot. Dragging rotates the globe;
// letting go picks the point under the crosshair and finds the nearest dots
// without another network round trip — the whole set is already in memory.
//
// Where the set comes from (in order): the last fetch cached at
// `app:/cache/globe.json`, the seed baked in at native build time
// (scripts/build-native.sh — the web build never carries it), or a live fetch.
import { GLOBE_SEED } from './data/globe-seed';
import { LAND } from './data/land';

import type { Ctx2D, Frame } from './app.contract.d.ts';

const RAD = Math.PI / 180;

// A seed row, in build order: uuid, name, stream, lat, lon, favicon, codec,
// bitrate, countrycode, first tag, votes.
export type SeedRow = [string, string, string, number, number, string, string, number, string, string, number];

export type Dataset = {
  origin: 'cache' | 'seed' | 'net' | 'sample';
  rows: SeedRow[];
  lats: Float64Array;
  lons: Float64Array;
};

export function buildDataset(rows: SeedRow[], origin: Dataset['origin']): Dataset {
  const n = rows.length;
  const lats = new Float64Array(n);
  const lons = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    lats[i] = rows[i][3];
    lons[i] = rows[i][4];
  }
  return { origin, rows, lats, lons };
}

export function parseSeed(text: string): SeedRow[] {
  if (!text || text === '[]') return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const out: SeedRow[] = [];
    for (const row of parsed) {
      if (Array.isArray(row) && row.length >= 5 && typeof row[0] === 'string' && typeof row[3] === 'number') {
        out.push(row as SeedRow);
      }
    }
    return out;
  } catch {
    return [];
  }
}

// Five real stations, so tests (and the bake, where every fetch is refused)
// have a deterministic world to drag around.
const SAMPLE: SeedRow[] = [
  ['bbc-world', 'BBC World Service', 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service', 51.5, -0.12, '', 'AAC', 0, 'GB', 'news', 900],
  ['radio-france', 'France Inter', 'https://icecast.radiofrance.fr/franceinter-midfi.mp3', 48.86, 2.35, '', 'MP3', 128, 'FR', 'general', 500],
  ['nhk-tokyo', 'NHK Radio 1', 'https://netradio-live2.nhk.jp/hls/live/200170/nhkradiru1l/master.m3u8', 35.68, 139.69, '', 'AAC', 0, 'JP', 'news', 400],
  ['kexp-seattle', 'KEXP', 'https://kexp.streamguys1.com/kexp160.aac', 47.6, -122.33, '', 'AAC', 160, 'US', 'alternative', 800],
  ['abc-sydney', 'ABC Triple J', 'https://live-radio01.mediahubaustralia.com/2TJW/aac/', -33.87, 151.21, '', 'AAC', 128, 'AU', 'alternative', 300],
];

// ── projection ──────────────────────────────────────────────────────────────

// Orthographic forward: where (lat, lon) lands with the globe centred on
// (lat0, lon0) at radius R. `visible` says which hemisphere it is on.
export function project(
  lat: number,
  lon: number,
  lat0: number,
  lon0: number,
): { x: number; y: number; visible: boolean } {
  const phi = lat * RAD;
  const phi0 = lat0 * RAD;
  const lam = (lon - lon0) * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const cosLam = Math.cos(lam);
  const kx = cosPhi * Math.sin(lam);
  const ky = Math.cos(phi0) * sinPhi - Math.sin(phi0) * cosPhi * cosLam;
  const cosc = Math.sin(phi0) * sinPhi + Math.cos(phi0) * cosPhi * cosLam;
  return { x: kx, y: ky, visible: cosc > -0.015 };
}

// Great-circle kilometres, the unit every "N 公里外" reads in.
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The nearest `want` rows to (lat, lon), nearest first.
export function nearestIn(dataset: Dataset, lat: number, lon: number, want: number): { row: SeedRow; km: number }[] {
  const hits: { row: SeedRow; km: number }[] = [];
  const { lats, lons, rows } = dataset;
  const n = rows.length;
  for (let i = 0; i < n; i += 1) {
    const km = haversine(lat, lon, lats[i], lons[i]);
    if (hits.length < want) {
      hits.push({ row: rows[i], km });
      if (hits.length === want) hits.sort((a, b) => a.km - b.km);
    } else if (km < hits[hits.length - 1].km) {
      hits[hits.length - 1] = { row: rows[i], km };
      let j = hits.length - 1;
      while (j > 0 && hits[j - 1].km > hits[j].km) {
        const t = hits[j - 1];
        hits[j - 1] = hits[j];
        hits[j] = t;
        j -= 1;
      }
    }
  }
  return hits;
}

// Zoom 1..7 → the globe's radius in CSS pixels.
export function radiusFor(zoom: number): number {
  return 70 * Math.pow(2, Math.max(1, Math.min(7, zoom)));
}

// ── painting ────────────────────────────────────────────────────────────────

type Paint = {
  rev: number;
  lat: number;
  lon: number;
  zoom: number;
  curLat: number;
  curLon: number;
  curId: string;
  flags: number;
};

const OCEAN_IN = '#131a2a';
const OCEAN_OUT = '#0b0d14';
const GRATICULE = 'rgba(148, 163, 184, 0.16)';
const LAND_FILL = 'rgba(148, 163, 184, 0.30)';
const LAND_EDGE = 'rgba(148, 163, 184, 0.42)';
const DOT = 'rgba(52, 211, 153, 0.9)';
const DOT_DIM = 'rgba(52, 211, 153, 0.55)';
const CUR_DOT = '#34d399';
const RETICLE = 'rgba(255, 255, 255, 0.9)';

function strokeGraticule(
  ctx: Ctx2D,
  lat0: number,
  lon0: number,
  R: number,
  cx: number,
  cy: number,
  fixed: number,
  isLat: boolean,
): void {
  let pen = false;
  ctx.beginPath();
  for (let step = -80; step <= 80; step += 5) {
    const lat = isLat ? fixed : step;
    const lon = isLat ? step : fixed;
    const p = project(lat, lon, lat0, lon0);
    if (!p.visible) {
      pen = false;
      continue;
    }
    const x = cx + R * p.x;
    const y = cy - R * p.y;
    if (pen) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      pen = true;
    }
  }
  ctx.stroke();
}

export function paintGlobe(ctx: Ctx2D, frame: Frame, args: Paint, dataset: Dataset | null, loading: boolean): boolean {
  const { width, height } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(radiusFor(args.zoom), Math.max(width, height));
  const { lat: lat0, lon: lon0 } = args;

  ctx.clearRect(0, 0, width, height);

  // The globe disc: an ocean that darkens toward the limb.
  const ocean = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
  ocean.addColorStop(0, OCEAN_IN);
  ocean.addColorStop(1, OCEAN_OUT);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = ocean;
  ctx.fill();

  // Everything on the sphere is clipped to the disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // Graticule every 30°.
  ctx.strokeStyle = GRATICULE;
  ctx.lineWidth = 1;
  for (let lon = -180; lon < 180; lon += 30) strokeGraticule(ctx, lat0, lon0, R, cx, cy, lon, false);
  for (let lat = -60; lat <= 60; lat += 30) strokeGraticule(ctx, lat0, lon0, R, cx, cy, lat, true);

  // Land: vertices behind the horizon are clamped out onto the limb, so a
  // continent sliding off the edge folds onto the rim instead of vanishing.
  ctx.fillStyle = LAND_FILL;
  ctx.strokeStyle = LAND_EDGE;
  ctx.lineWidth = 0.8;
  for (const ring of LAND) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < ring.length; i += 2) {
      const p = project(ring[i + 1], ring[i], lat0, lon0);
      let x: number;
      let y: number;
      if (p.visible) {
        x = cx + R * p.x;
        y = cy - R * p.y;
      } else {
        const len = Math.hypot(p.x, p.y) || 1;
        x = cx + (R * p.x) / len;
        y = cy - (R * p.y) / len;
      }
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      any = true;
    }
    if (any) {
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // Station dots.
  if (dataset && dataset.rows.length > 0) {
    const dot = args.zoom >= 4 ? 2.6 : args.zoom >= 3 ? 2.1 : 1.6;
    ctx.fillStyle = DOT;
    ctx.beginPath();
    const { lats, lons, rows } = dataset;
    for (let i = 0; i < rows.length; i += 1) {
      const p = project(lats[i], lons[i], lat0, lon0);
      if (!p.visible) continue;
      const x = cx + R * p.x;
      const y = cy - R * p.y;
      ctx.moveTo(x + dot, y);
      ctx.arc(x, y, dot, 0, Math.PI * 2);
    }
    ctx.fill();

    // The station on air: a bright ring plus its name when zoomed in.
    if (args.curId !== '') {
      const p = project(args.curLat, args.curLon, lat0, lon0);
      if (p.visible) {
        const x = cx + R * p.x;
        const y = cy - R * p.y;
        ctx.beginPath();
        ctx.arc(x, y, dot + 3.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, dot + 1.5, 0, Math.PI * 2);
        ctx.fillStyle = CUR_DOT;
        ctx.fill();
        if (args.zoom >= 4) {
          let name = '';
          for (const row of dataset.rows) {
            if (row[0] === args.curId) {
              name = row[1];
              break;
            }
          }
          if (name !== '') {
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const w = ctx.measureText(name).width;
            const lx = Math.min(x + 10, width - w - 10);
            ctx.fillStyle = 'rgba(8, 11, 20, 0.72)';
            ctx.fillRect(lx - 5, y - 9, w + 10, 18);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.fillText(name, lx, y);
          }
        }
      }
    }
  }
  ctx.restore();

  // The limb.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // The crosshair: what a release will pick. Steady while idle, open while
  // the globe is under a finger.
  const dragging = (args.flags & 1) !== 0;
  const picked = (args.flags & 2) !== 0;
  if (dragging || picked) {
    const r = dragging ? 10 : 7;
    ctx.strokeStyle = RETICLE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(cx + dx * (r + 3), cy + dy * (r + 3));
      ctx.lineTo(cx + dx * (r + 9), cy + dy * (r + 9));
    }
    ctx.stroke();
  }

  // Loading / empty states read on the globe itself.
  if (loading) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
    ctx.fillText('正在取电台坐标…', cx, cy + R + 22 > height ? cy : cy + R + 22);
  } else if (!dataset || dataset.rows.length === 0) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.fillText('还没有电台坐标：下拉或点右上角刷新', cx, cy + R + 22 > height ? cy : cy + R + 22);
  }

  return false; // repaints are driven by args (state), not animation
}
