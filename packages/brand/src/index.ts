/**
 * Brand. Making a slot look like the thing it stands for.
 *
 * "My bank, my plan, my money" only reads as true if the bank looks like the
 * bank. But a host cannot ship somebody else's logo, so this does the part that
 * is actually safe and actually enough: the name, set in the right colours, on
 * a mark drawn from its own initials.
 *
 * Nothing here downloads, embeds or reproduces a trademark. A host that has
 * LICENSED a real mark passes it in as `markSrc` and this gets out of the way.
 */

import type { Option } from '@intermenu/aiuic-core';

export type Brand = {
  id: string;
  name: string;
  /** The brand's own colour. */
  color: string;
  /** Text that sits on `color`. Computed when omitted. */
  on?: string;
  /** A licensed mark, if the host has the right to show one. */
  markSrc?: string;
  aliases?: string[];
};

export type BrandStyle = { color: string; on: string; soft: string; initials: string; markSrc?: string };

function srgb(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance, so text on a brand colour is legible by measurement. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

export function readableOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#10121a' : '#ffffff';
}

export function softOf(hex: string, alpha = 0.16): string {
  const rgb = parseHex(hex);
  if (!rgb) return 'rgba(255,255,255,.08)';
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export class Brands {
  private readonly items = new Map<string, Brand>();

  register(...brands: Brand[]): void {
    for (const b of brands) {
      if (!b.id || !b.name || !parseHex(b.color)) {
        throw new Error(`brand "${b?.id ?? '?'}" needs an id, a name and a hex colour`);
      }
      this.items.set(b.id, b);
    }
  }

  get all(): Brand[] { return [...this.items.values()]; }
  get(id: string): Brand | undefined { return this.items.get(id); }

  /** As slot options, so a brand picker is just a chip like any other. */
  options(): Option[] {
    return this.all.map((b) => ({ value: b.id, label: b.name, aliases: b.aliases }));
  }

  style(id: string): BrandStyle | undefined {
    const b = this.items.get(id);
    if (!b) return undefined;
    const out: BrandStyle = {
      color: b.color,
      on: b.on ?? readableOn(b.color),
      soft: softOf(b.color),
      initials: initialsOf(b.name),
    };
    if (b.markSrc) out.markSrc = b.markSrc;
    return out;
  }

  /**
   * A square mark drawn from the brand's own initials. Not a logo, and never
   * passed off as one: if the host holds a licence it supplies `markSrc` and
   * this returns an <image> instead.
   */
  mark(id: string, size = 40): string {
    const s = this.style(id);
    const b = this.items.get(id);
    if (!s || !b) return '';
    const r = Math.round(size * 0.28);
    if (s.markSrc) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(b.name)}">` +
        `<image href="${esc(s.markSrc)}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/></svg>`;
    }
    const fs = Math.round(size * 0.42);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(b.name)}">` +
      `<rect width="${size}" height="${size}" rx="${r}" fill="${esc(s.color)}"/>` +
      `<text x="50%" y="50%" dy=".35em" text-anchor="middle" fill="${esc(s.on)}" ` +
      `font-family="system-ui,sans-serif" font-size="${fs}" font-weight="600" letter-spacing="-.02em">${esc(s.initials)}</text></svg>`;
  }

  /** Find a brand in what the user said, by name or alias. */
  match(text: string): Brand | undefined {
    const t = text.toLowerCase();
    return this.all.find((b) => [b.name, ...(b.aliases ?? [])].some((n) => t.includes(n.toLowerCase())));
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
