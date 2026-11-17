// The dataset behind the map: every geo-tagged station the index carries,
// held in memory as flat arrays so a camera settle can thin it into pins and
// answer nearest-station queries without another network round trip.
//
// Where the set comes from (in order): the last fetch cached at
// `app:/cache/globe.json`, the seed baked in at native build time
// (scripts/build-native.sh — the web build never carries it), or a live fetch.
import { GLOBE_SEED } from './data/globe-seed';

const RAD = Math.PI / 180;

// A seed row, in build order: uuid, name, stream, lat, lon, favicon, codec,
// bitrate, countrycode, first tag, votes.
export type SeedRow = [string, string, string, number, number, string, string, number, string, string, number];

export type Dataset = {
  origin: 'cache' | 'seed' | 'net' | 'sample';
  rows: SeedRow[];
  lats: Float64Array;
  lons: Float64Array;
  // Unit 3D vectors (x toward lon 0, y toward lon 90°E, z the north pole),
  // computed once so a frame of painting is three dot products per point
  // instead of a handful of trig calls and a fresh {x, y, visible} object.
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
};

export function buildDataset(rows: SeedRow[], origin: Dataset['origin']): Dataset {
  const n = rows.length;
  const lats = new Float64Array(n);
  const lons = new Float64Array(n);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const lat = rows[i][3];
    const lon = rows[i][4];
    lats[i] = lat;
    lons[i] = lon;
    const phi = lat * RAD;
    const lam = lon * RAD;
    const cphi = Math.cos(phi);
    px[i] = cphi * Math.cos(lam);
    py[i] = cphi * Math.sin(lam);
    pz[i] = Math.sin(phi);
  }
  return { origin, rows, lats, lons, px, py, pz };
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

