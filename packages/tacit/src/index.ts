/**
 * Tacit: the parts, made into one product.
 *
 * Every piece so far was built and tested alone — the stage, the menus, the
 * desk, the briefing, the context, the settings. Alone, each one keeps its own
 * promises. Together they have to keep each other's: a setting changed by
 * voice must change what the desk does with the very next notice, and the
 * briefing must run as long as the setting says. This file is where that
 * happens, and its tests are the ones that check the parts agree.
 *
 * It is also the shape the iPhone app wraps. Everything here runs without a
 * screen; a host gives it an element to draw on, a voice to speak with, and a
 * channel to send through, and keeps none of the logic for itself.
 */

import type { ActDef, Clock, Ctx } from '@intermenu/aiuic-core';
import { mount, type Mounted, type MountOptions } from '@intermenu/sdk';
import { ContextMemory, DEFAULT_BUDGET, Desk, briefingAct, notifyAct, type Channel, type Notice, type Profile, type WorldSource } from '@intermenu/aiuic-notify';
import { CORE_SETTINGS, Settings, settingActs, type SettingDef } from '@intermenu/aiuic-settings';

export type TacitOptions = {
  /** Who this is for. Interests are in their words, most important first. */
  profile: Profile & { name?: string };
  /** The app's own capabilities: any of the SDK's four doors. */
  sources?: Pick<MountOptions, 'acts' | 'functions' | 'openapi' | 'connections'>;
  /** Where the world comes from: World Monitor, or anything that pulls. */
  world?: WorldSource[];
  /** Where a notification to a person goes. Without one, Tacit cannot send. */
  channel?: Channel;
  /** People a notification can go to. */
  people?: { value: string; label: string }[];
  /** Settings the app adds to the core ones. */
  settings?: SettingDef[];
  /** How Tacit talks: a voice, a caption, both. Called with every briefing. */
  speak?: (text: string) => void | Promise<void>;
  el?: unknown;
  clock?: Clock;
  ctx?: () => Omit<Ctx, 'now'> & { now?: Date };
  now?: () => number;
  hourOf?: (t: number) => number;
};

export type Tacit = Mounted & {
  desk: Desk;
  context: ContextMemory;
  settings: Settings;
  /** A notice arriving from anywhere: an app, the world, a person. */
  receive(n: Notice): ReturnType<Desk['ingest']>;
  /** Pull the world in. Run it daily, or when the person asks. */
  refresh(): ReturnType<ContextMemory['refresh']>;
};

export function createTacit(o: TacitOptions): Tacit {
  const now = o.now ?? Date.now;
  const settings = new Settings([...CORE_SETTINGS, ...(o.settings ?? [])], now);

  // The desk reads its budget from the settings on every notice, so a setting
  // changed by voice or on the screen applies to the next one, not the next restart.
  const desk = new Desk(() => ({
    ...DEFAULT_BUDGET,
    perHour: Number(settings.get('interruptions_per_hour')),
    ...(settings.get('quiet_hours') ? { quiet: DEFAULT_BUDGET.quiet! } : { quiet: undefined as never }),
  }), o.hourOf);
  const context = new ContextMemory(o.world ?? []);

  const own: ActDef[] = [
    briefingAct({
      desk, context, now,
      profile: () => ({ ...o.profile, minutes: Number(settings.get('briefing_length')) }),
      defaultMinutes: () => Number(settings.get('briefing_length')),
      ...(o.speak ? { speak: async (t: string) => { if (settings.get('voice')) await o.speak!(t); } } : {}),
    }),
    ...settingActs(settings),
    ...(o.channel ? [notifyAct(o.channel, o.people ?? [])] : []),
  ];

  const m = mount({
    ...(o.sources ?? {}),
    acts: [...own, ...(o.sources?.acts ?? [])],
    ...(o.el ? { el: o.el } : {}),
    ...(o.clock ? { clock: o.clock } : {}),
    ...(o.ctx ? { ctx: o.ctx } : {}),
  });

  return {
    ...m, desk, context, settings,
    receive: (n) => desk.ingest(n),
    refresh: () => context.refresh(now()),
  };
}
