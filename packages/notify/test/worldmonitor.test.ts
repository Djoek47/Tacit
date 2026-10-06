import { describe, expect, it, vi } from 'vitest';
import { ContextMemory, Desk, brief, worldMonitorFetch, worldMonitorSource } from '../src/index.js';

const NOW = Date.UTC(2026, 9, 6, 7);

/** Shapes as World Monitor's OpenAPI document describes them. */
const RECORDED: Record<string, unknown> = {
  '/api/climate/v1/list-climate-news': { items: [{ id: 'c1', title: 'Record heat in the Sahel', summary: 'Third week above 45C', sourceName: 'Reuters', publishedAt: '2026-10-06T05:00:00Z' }] },
  '/api/climate/v1/list-air-quality-data': { stations: [
    { city: 'Montreal', countryCode: 'CA', lat: 45.5, lng: -73.57, aqi: 158 },
    { city: 'Quebec', countryCode: 'CA', lat: 46.8, lng: -71.2, aqi: 40 },
  ] },
  '/api/economic/v1/get-energy-prices': { prices: [{ commodity: 'WTI', name: 'WTI crude', price: 88.4, unit: 'USD/bbl', change: 3.6, priceAt: '2026-10-06T06:00:00Z' }] },
  '/api/economic/v1/get-economic-calendar': { events: [{ date: '2026-10-06T12:30:00Z', event: 'CPI release', country: 'US', estimate: '3.1%', actual: null }] },
  '/api/conflict/v1/list-acled-events': { events: [{ id: 'a1', country: 'Sudan', admin1: 'Darfur', eventType: 'Battles', fatalities: 12 }, { country: null }] },
};

const call = (path: string) => (path in RECORDED ? Promise.resolve(RECORDED[path]) : Promise.reject(new Error('answered 403')));

describe('World Monitor, connected and never copied', () => {
  it('turns the recorded shapes into context items, each tagged with what it is about', async () => {
    const items = await worldMonitorSource(call, ['climateNews', 'airQuality', 'energy', 'calendar', 'conflict'], () => NOW).pull(0);
    expect(items.map((i) => i.title)).toEqual([
      'Record heat in the Sahel',
      'Air quality in Montreal is poor (AQI 158)',
      'WTI crude 88.4 USD/bbl (+3.6)',
      'US: CPI release',
      'Battles in Darfur, Sudan (12 dead)',
    ]);
    expect(items.find((i) => /WTI/.test(i.title))!.topics).toContain('trading');
  });

  it('leaves out what is not news: clean air, and a row with nothing in it', async () => {
    const items = await worldMonitorSource(call, ['airQuality', 'conflict'], () => NOW).pull(0);
    expect(items.some((i) => /Quebec/.test(i.title))).toBe(false);
    expect(items.filter((i) => i.source === 'worldmonitor/conflict')).toHaveLength(1);
  });

  it('reports a feed it cannot read and keeps the rest', async () => {
    const src = worldMonitorSource(call, ['energy', 'cyber'], () => NOW);
    const items = await src.pull(0);
    expect(items).toHaveLength(1);
    expect(src.lastErrors).toEqual(['cyber: answered 403']);
  });

  it('sends the key in the header the API asks for, and only there', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await worldMonitorFetch('wm-key', f as unknown as typeof fetch)('/api/economic/v1/get-energy-prices', { limit: 5 });
    expect(f).toHaveBeenCalledWith('https://api.worldmonitor.app/api/economic/v1/get-energy-prices?limit=5', { headers: { WorldMonitorKey: 'wm-key' } });
  });

  it('ends in a morning briefing that is about this person, not the loudest thing on Earth', async () => {
    const ctx = new ContextMemory([worldMonitorSource(call, ['climateNews', 'airQuality', 'energy', 'calendar', 'conflict'], () => NOW)]);
    await ctx.refresh(NOW);
    const b = brief({ interests: ['trading'], home: { lat: 45.5, lon: -73.6, km: 40, label: 'Montreal' } }, new Desk(), ctx, NOW + 3_600_000);
    expect(b.sections.map((s) => [s.name, s.items.map((i) => i.title)])).toEqual([
      ['Around you', ['Air quality in Montreal is poor (AQI 158)']],
      ['What you follow', ['US: CPI release', 'WTI crude 88.4 USD/bbl (+3.6)']],
    ]);
  });
});
