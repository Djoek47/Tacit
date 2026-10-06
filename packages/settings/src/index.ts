/**
 * Settings: the one place that is not a conversation, and still answers one.
 *
 * Everything else in the product is reached through the stage. Settings are
 * the exception on purpose: a fixed screen, always in the same place, because
 * the moment someone most needs a setting is the moment the assistant is
 * doing something they did not want — and that is no time to have to ask the
 * assistant for help.
 *
 * But every setting is ALSO an act, so "turn off quiet hours" works by voice.
 * Both doors write through the same store, so the screen and the voice can
 * never disagree about what a setting is.
 *
 * What it costs to change a setting is declared on the setting, like any act:
 * most are 'self' and reversible, so saying one commits on silence and undo
 * puts it back. A setting that hands the assistant more power — letting it
 * send on your behalf, act while you are away — is marked `grantsAuthority`,
 * and like every such act it can only ever be changed by the person: never on
 * silence, never by the conductor, never by a model.
 */

import { defineAct, type ActDef, type Option, type Radius } from '@intermenu/aiuic-core';

export type SettingValue = string | number | boolean;

export type SettingDef = {
  key: string;
  label: string;
  /** Which part of the fixed screen it sits in. */
  section: string;
  /** One line under it, saying what it does in plain words. */
  describe: string;
  kind: 'toggle' | 'choice';
  /** For a choice: what it may be. A toggle is on or off. */
  options?: { value: SettingValue; label: string; aliases?: string[] }[];
  default: SettingValue;
  /** What changing it costs. Most settings are yours alone and reversible. */
  radius?: Radius;
  /** Gives the assistant more power. Only the person may change it, ever. */
  grantsAuthority?: boolean;
  /** Extra ways people say it: "do not disturb" for quiet hours. */
  phrases?: string[];
};

type Change = { key: string; from: SettingValue; to: SettingValue; at: number; by: 'screen' | 'voice' };

/**
 * The values. Both doors write here and nowhere else.
 */
export class Settings {
  private readonly values = new Map<string, SettingValue>();
  private readonly history: Change[] = [];
  readonly defs: readonly SettingDef[];

  constructor(defs: readonly SettingDef[], private readonly now: () => number = Date.now) {
    const keys = new Set<string>();
    for (const d of defs) {
      if (keys.has(d.key)) throw new Error(`two settings are called "${d.key}"`);
      keys.add(d.key);
      if (!this.allowed(d, d.default)) throw new Error(`"${d.key}" defaults to a value it does not allow`);
    }
    this.defs = defs;
  }

  private allowed(d: SettingDef, v: SettingValue): boolean {
    return d.kind === 'toggle' ? typeof v === 'boolean' : !!d.options?.some((o) => o.value === v);
  }

  get(key: string): SettingValue {
    const d = this.defs.find((x) => x.key === key);
    if (!d) throw new Error(`no setting "${key}"`);
    return this.values.has(key) ? this.values.get(key)! : d.default;
  }

  /** Change a value. Refuses anything the setting does not allow; returns what it was. */
  set(key: string, value: SettingValue, by: Change['by']): SettingValue {
    const d = this.defs.find((x) => x.key === key);
    if (!d) throw new Error(`no setting "${key}"`);
    if (!this.allowed(d, value)) throw new Error(`"${String(value)}" is not a value ${d.label} can take`);
    const from = this.get(key);
    this.values.set(key, value);
    this.history.push({ key, from, to: value, at: this.now(), by });
    return from;
  }

  /** What changed, and through which door. A settings screen should be able to show this. */
  changes(): readonly Change[] { return this.history; }

  /** The fixed screen, as data: sections, in the order they were declared. */
  screen(): { section: string; items: { key: string; label: string; describe: string; value: SettingValue; display: string; locked: boolean }[] }[] {
    const order: string[] = [];
    for (const d of this.defs) if (!order.includes(d.section)) order.push(d.section);
    return order.map((section) => ({
      section,
      items: this.defs.filter((d) => d.section === section).map((d) => {
        const v = this.get(d.key);
        return {
          key: d.key, label: d.label, describe: d.describe, value: v,
          display: d.kind === 'toggle' ? (v ? 'On' : 'Off') : d.options!.find((o) => o.value === v)!.label,
          locked: !!d.grantsAuthority,
        };
      }),
    }));
  }
}

const ON: Option = { value: true, label: 'On', aliases: ['on', 'enable', 'enabled', 'turn on', 'switch on', 'yes', 'activate'] };
const OFF: Option = { value: false, label: 'Off', aliases: ['off', 'disable', 'disabled', 'turn off', 'switch off', 'no', 'stop', 'deactivate'] };

const words = (s: string) => s.toLowerCase().replace(/[_-]+/g, ' ');

/**
 * One act per setting, so every one of them can be said. The act's undo puts
 * back exactly what was there, whichever door changed it last.
 */
export function settingActs(settings: Settings): ActDef[] {
  return settings.defs.map((d) => defineAct({
    name: `set_${d.key}`,
    domain: 'settings',
    phrases: [words(d.label), words(d.key), ...(d.phrases ?? [])],
    slots: {
      value: {
        primitive: 'chip',
        options: () => (d.kind === 'toggle' ? [ON, OFF] : d.options!.map((o) => ({ value: o.value, label: o.label, ...(o.aliases ? { aliases: o.aliases } : {}) }))),
        required: true,
        order: 1,
      },
    },
    radius: d.radius ?? 'self',
    ...(d.grantsAuthority ? { grantsAuthority: true } : {}),
    commit: (f) => {
      const previous = settings.set(d.key, f.value as SettingValue, 'voice');
      return { id: `${d.key}@${Date.now()}`, previous };
    },
    undo: (r) => { settings.set(d.key, r.previous as SettingValue, 'voice'); },
  }));
}

/** The settings every Tacit app starts with. Apps add their own. */
export const CORE_SETTINGS: SettingDef[] = [
  { key: 'quiet_hours', label: 'Quiet hours', section: 'Notifications', kind: 'toggle', default: true,
    describe: 'From 10 p.m. to 7 a.m., only a person can interrupt you.', phrases: ['do not disturb', 'dnd'] },
  { key: 'interruptions_per_hour', label: 'Interruptions per hour', section: 'Notifications', kind: 'choice', default: 3,
    options: [{ value: 1, label: '1', aliases: ['one'] }, { value: 3, label: '3', aliases: ['three'] }, { value: 6, label: '6', aliases: ['six'] }],
    describe: 'The most times anything but a person may interrupt you in an hour.' },
  { key: 'briefing_time', label: 'Morning briefing', section: 'Briefing', kind: 'choice', default: '07:00',
    options: [{ value: 'off', label: 'Off', aliases: ['off', 'never'] }, { value: '06:00', label: '6:00', aliases: ['six'] },
      { value: '07:00', label: '7:00', aliases: ['seven'] }, { value: '08:00', label: '8:00', aliases: ['eight'] }],
    describe: 'When your briefing is ready. It waits until you open it; it never starts talking by itself.' },
  { key: 'briefing_length', label: 'Briefing length', section: 'Briefing', kind: 'choice', default: 15,
    options: [{ value: 5, label: 'Short', aliases: ['short', 'quick'] }, { value: 15, label: 'Standard', aliases: ['standard'] }, { value: 20, label: 'Long', aliases: ['long'] }],
    describe: 'How long the briefing runs, read aloud.' },
  { key: 'voice', label: 'Speak replies', section: 'Voice', kind: 'toggle', default: true,
    describe: 'Answers are spoken as well as shown.' },
  { key: 'act_while_away', label: 'Act while I am away', section: 'Permissions', kind: 'toggle', default: false,
    grantsAuthority: true, radius: 'self',
    describe: 'Lets standing orders run when you are not there. Only you can change this, and never by silence.' },
];
