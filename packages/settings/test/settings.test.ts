import { describe, expect, it } from 'vitest';
import { FakeClock, type Ctx } from '@intermenu/aiuic-core';
import { createApp } from '@intermenu/aiuic-kit';
import { CORE_SETTINGS, Settings, settingActs } from '../src/index.js';

const T0 = 1_700_000_000_000;
declare const setTimeout: (fn: () => void, ms: number) => unknown;
const tick = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const ctx = () => ({ actor: { id: 'me', basePauseMs: 850 },
  attention: { foreground: true, unlocked: true, proximityClear: true, listening: true },
  reachLimit: 1, undoWindowMs: 5000 }) as Omit<Ctx, 'now'>;

function setup() {
  const clock = new FakeClock(T0);
  const settings = new Settings(CORE_SETTINGS, () => clock.now());
  const app = createApp({ clock, ctx, acts: settingActs(settings) });
  return { clock, settings, app };
}

describe('the fixed screen', () => {
  it('lays out every setting in its section, in the order declared, with what it does', () => {
    const s = new Settings(CORE_SETTINGS).screen();
    expect(s.map((x) => x.section)).toEqual(['Notifications', 'Briefing', 'Voice', 'Permissions']);
    expect(s[0]!.items[0]).toMatchObject({ key: 'quiet_hours', display: 'On', locked: false });
    expect(s[3]!.items[0]).toMatchObject({ key: 'act_while_away', display: 'Off', locked: true });
  });

  it('refuses a value a setting cannot take', () => {
    expect(() => new Settings(CORE_SETTINGS).set('briefing_length', 99, 'screen')).toThrow(/not a value/);
  });

  it('refuses two settings with one name, and a default it would itself refuse', () => {
    expect(() => new Settings([CORE_SETTINGS[0]!, CORE_SETTINGS[0]!])).toThrow(/two settings/);
    expect(() => new Settings([{ ...CORE_SETTINGS[1]!, default: 99 }])).toThrow(/defaults to a value/);
  });
});

describe('every setting can also be said', () => {
  it('routes "turn off quiet hours" and changes it on silence, because it is yours and reversible', async () => {
    const { clock, settings, app } = setup();
    expect(app.hear('turn off quiet hours', { final: true }).act).toBe('set_quiet_hours');
    clock.advance(5_000); await tick(); await tick();
    expect(settings.get('quiet_hours')).toBe(false);
    expect(settings.changes().at(-1)).toMatchObject({ key: 'quiet_hours', from: true, to: false, by: 'voice' });
  });

  it('puts back exactly what was there on undo', async () => {
    const { clock, settings, app } = setup();
    app.hear('make the briefing short', { final: true });
    clock.advance(5_000); await tick(); await tick();
    expect(settings.get('briefing_length')).toBe(5);
    await app.act!.undo();
    expect(settings.get('briefing_length')).toBe(15);
  });

  it('shows the same value on the screen as the voice just set: one store, two doors', async () => {
    const { clock, settings, app } = setup();
    app.hear('do not disturb off', { final: true });
    clock.advance(5_000); await tick(); await tick();
    expect(settings.screen()[0]!.items[0]!.display).toBe('Off');
  });

  it('never lets silence hand the assistant more power', async () => {
    const { clock, settings, app } = setup();
    expect(app.hear('turn on act while I am away', { final: true }).act).toBe('set_act_while_away');
    clock.advance(60_000); await tick(); await tick();
    expect(settings.get('act_while_away')).toBe(false);
    // And no conductor can do it unattended either.
    await expect(Promise.resolve().then(() => app.act!.assentUnattended())).rejects.toThrow();
    expect(settings.get('act_while_away')).toBe(false);
  });
});
