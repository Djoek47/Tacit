/**
 * World Monitor as a world source for the context memory.
 *
 * Connected, never copied. World Monitor's code is AGPL-3.0: vendoring it into
 * a service would oblige that service to publish its own source. Calling its
 * API does not. So this file holds no World Monitor code at all — only a
 * mapping from what its REST API returns to a `ContextItem`.
 *
 * Endpoints and field names are taken from its published OpenAPI document
 * (https://api.worldmonitor.app/openapi.json, read 6 Oct 2026). The key goes
 * in a `WorldMonitorKey` header. Not yet run against the live API: there is no
 * key in this sandbox, so the tests use recorded shapes.
 *
 * The key must never ship inside the iPhone app. Anything in an app bundle can
 * be read out of it; the pull runs on our side (the daemon) and the phone
 * receives briefings, not credentials.
 *
 * Every feed is read defensively: a field missing, renamed or null drops that
 * one item, never the pull.
 */

import type { ContextItem, WorldSource } from './index.js';

export type WMCall = (path: string, query: Record<string, string | number>) => Promise<unknown>;

/** One feed: where to read it, which topics it carries, how to turn a row into an item. */
type Feed = {
  path: string;
  query?: Record<string, string | number>;
  topics: string[];
  /** Rows can sit at the top level or under a named key; this finds them. */
  rows?: string;
  map: (r: Record<string, unknown>, at: number) => Omit<ContextItem, 'source' | 'topics'> | null;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const time = (v: unknown, fallback: number) => {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? (t < 1e12 ? t * 1000 : t) : fallback;
};
const place = (lat: unknown, lon: unknown, label?: string | null) => {
  const a = num(lat), b = num(lon);
  return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lon: b, ...(label ? { label } : {}) } : undefined;
};

export const FEEDS: Record<string, Feed> = {
  climateNews: {
    path: '/api/climate/v1/list-climate-news', topics: ['climate', 'news'],
    map: (r, at) => {
      const title = str(r.title); if (!title) return null;
      const summary = str(r.summary);
      return { id: `wm:climate-news:${str(r.id) ?? title}`, title, ...(summary ? { summary } : {}), at: time(r.publishedAt, at) };
    },
  },
  disasters: {
    path: '/api/climate/v1/list-climate-disasters', query: { limit: 50 }, topics: ['disaster', 'climate'],
    map: (r, at) => {
      const country = str(r.country); if (!country) return null;
      const hit = num(r.affectedPopulation);
      const p = place(r.lat, r.lon ?? r.lng, country);
      return { id: `wm:disaster:${str(r.id) ?? country}`, title: `Disaster in ${country}${hit ? `, ${hit.toLocaleString('en')} affected` : ''}`, at, ...(p ? { place: p } : {}) };
    },
  },
  airQuality: {
    path: '/api/climate/v1/list-air-quality-data', topics: ['air quality', 'weather', 'health'],
    map: (r, at) => {
      const city = str(r.city); const aqi = num(r.aqi);
      if (!city || aqi === null) return null;
      const p = place(r.lat, r.lng, city);
      // Only air worth mentioning: below "unhealthy for sensitive groups" is not news.
      if (aqi < 101) return null;
      return { id: `wm:aqi:${city}:${new Date(at).toISOString().slice(0, 10)}`, title: `Air quality in ${city} is poor (AQI ${aqi})`, at, ...(p ? { place: p } : {}) };
    },
  },
  energy: {
    path: '/api/economic/v1/get-energy-prices', topics: ['energy', 'oil', 'markets', 'trading'],
    map: (r, at) => {
      const name = str(r.name) ?? str(r.commodity); const price = num(r.price);
      if (!name || price === null) return null;
      const change = num(r.change);
      return { id: `wm:energy:${str(r.commodity) ?? name}:${time(r.priceAt, at)}`,
        title: `${name} ${price}${str(r.unit) ? ` ${r.unit}` : ''}${change !== null ? ` (${change >= 0 ? '+' : ''}${change})` : ''}`, at: time(r.priceAt, at) };
    },
  },
  calendar: {
    path: '/api/economic/v1/get-economic-calendar', topics: ['economy', 'markets', 'trading', 'calendar'],
    map: (r, at) => {
      const event = str(r.event); if (!event) return null;
      const country = str(r.country);
      return { id: `wm:cal:${str(r.date) ?? ''}:${event}`, title: `${country ? `${country}: ` : ''}${event}`, at: time(r.date, at),
        ...(r.estimate !== undefined && r.estimate !== null ? { summary: `expected ${r.estimate}${r.actual !== undefined && r.actual !== null ? `, actual ${r.actual}` : ''}` } : {}) };
    },
  },
  conflict: {
    path: '/api/conflict/v1/list-acled-events', query: { limit: 50 }, topics: ['conflict', 'geopolitics', 'security'],
    map: (r, at) => {
      const country = str(r.country); const type = str(r.eventType);
      if (!country || !type) return null;
      const dead = num(r.fatalities);
      const p = place(r.latitude ?? r.lat, r.longitude ?? r.lon, str(r.admin1) ?? country);
      return { id: `wm:acled:${str(r.id) ?? `${country}:${type}`}`, title: `${type} in ${str(r.admin1) ? `${r.admin1}, ` : ''}${country}${dead ? ` (${dead} dead)` : ''}`, at, ...(p ? { place: p } : {}) };
    },
  },
  cyber: {
    path: '/api/cyber/v1/list-cyber-threats', query: { limit: 30 }, topics: ['cyber', 'security', 'tech'],
    map: (r, at) => {
      const ind = str(r.indicatorType); if (!ind) return null;
      return { id: `wm:cyber:${str(r.id) ?? str(r.indicator) ?? ind}`, title: `Cyber threat: ${ind}${str(r.country) ? ` (${r.country})` : ''}`, at: time(r.lastSeenAt ?? r.firstSeenAt, at) };
    },
  },
  airports: {
    path: '/api/aviation/v1/list-airport-delays', query: { limit: 30 }, topics: ['travel', 'aviation'],
    map: (r, at) => {
      const city = str(r.city); const mins = num(r.avgDelayMinutes);
      if (!city || mins === null || mins < 30) return null;
      return { id: `wm:delay:${str(r.id) ?? city}:${new Date(at).toISOString().slice(0, 13)}`, title: `Flights from ${city} delayed about ${Math.round(mins)} minutes`, at };
    },
  },
};

function rowsOf(body: unknown, key?: string): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  if (key && Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
  // The documents name their list differently per service; the first array is the list.
  const first = Object.values(o).find(Array.isArray);
  return (first as Record<string, unknown>[] | undefined) ?? [];
}

/**
 * World Monitor as a `WorldSource`. Choose the feeds a deployment pays for;
 * each failing feed is reported and skipped, never fatal.
 */
export function worldMonitorSource(call: WMCall, feeds: (keyof typeof FEEDS)[] = Object.keys(FEEDS) as (keyof typeof FEEDS)[], now: () => number = Date.now): WorldSource & { lastErrors: string[] } {
  const src = {
    name: 'worldmonitor',
    lastErrors: [] as string[],
    async pull(): Promise<ContextItem[]> {
      src.lastErrors = [];
      const at = now();
      const out: ContextItem[] = [];
      for (const name of feeds) {
        const f = FEEDS[name];
        if (!f) continue;
        try {
          for (const r of rowsOf(await call(f.path, f.query ?? {}), f.rows)) {
            if (!r || typeof r !== 'object') continue;
            const item = f.map(r, at);
            if (item) out.push({ ...item, source: `worldmonitor/${String(name)}`, topics: f.topics });
          }
        } catch (e) {
          src.lastErrors.push(`${String(name)}: ${(e as Error).message}`);
        }
      }
      return out;
    },
  };
  return src;
}

/** The HTTP caller, for the daemon. Key from the environment, never from a file or the app. */
export function worldMonitorFetch(apiKey: string, fetchFn: typeof fetch = fetch, base = 'https://api.worldmonitor.app'): WMCall {
  return async (path, query) => {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
    const res = await fetchFn(`${base}${path}${qs ? `?${qs}` : ''}`, { headers: { WorldMonitorKey: apiKey } });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return res.json();
  };
}
