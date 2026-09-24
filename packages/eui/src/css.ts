/**
 * The stylesheet, generated from the tokens rather than kept beside them.
 *
 * Two files holding the same hex value is how a design system rots: one of
 * them gets corrected and the other does not, and six months later nobody
 * knows which is the real mint. There is one mint, in tokens.ts, and this
 * emits it.
 */

import {
  DOMAIN_COLOUR, SEMANTIC, GROUND, SURFACE, RADIUS_PX, TYPE, FONT_STACK,
  SPRING, MIN_TARGET_PX, ORB_PX,
} from './tokens.js';

const px = (n: number) => `${n}px`;

/** Every token as a custom property, so a host can read them without importing JS. */
export function cssVariables(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(DOMAIN_COLOUR)) lines.push(`  --eui-${k}: ${v};`);
  for (const [k, v] of Object.entries(SEMANTIC)) lines.push(`  --eui-${k}: ${v};`);
  for (const [k, v] of Object.entries(GROUND)) lines.push(`  --eui-ground-${k}: ${v};`);
  for (const [k, v] of Object.entries(SURFACE)) lines.push(`  --eui-surface-${k}: ${v};`);
  for (const [k, v] of Object.entries(RADIUS_PX)) lines.push(`  --eui-radius-${k}: ${px(v)};`);
  for (const [k, t] of Object.entries(TYPE)) {
    lines.push(`  --eui-type-${k}-size: ${px(t.size)};`);
    lines.push(`  --eui-type-${k}-line: ${px(t.line)};`);
    lines.push(`  --eui-type-${k}-tracking: ${t.tracking}px;`);
    lines.push(`  --eui-type-${k}-weight: ${t.weight};`);
  }
  for (const [k, s] of Object.entries(SPRING)) lines.push(`  --eui-motion-${k}: ${s.approxMs}ms;`);
  lines.push(`  --eui-target-min: ${px(MIN_TARGET_PX)};`);
  lines.push(`  --eui-orb-idle: ${px(ORB_PX.idle)};`);
  lines.push(`  --eui-orb-card: ${px(ORB_PX.cardUp)};`);
  lines.push(`  --eui-orb-header: ${px(ORB_PX.header)};`);
  lines.push(`  --eui-font: ${FONT_STACK};`);
  // The domain colour of the card currently on stage. Set per-card, never
  // globally: two domains never share a stage, so this is always unambiguous.
  lines.push(`  --eui-domain: var(--eui-neutral);`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * The card, its rows, the ring and the mark.
 *
 * Deliberately small. Anything a host would want to restyle is a custom
 * property; anything that would break a rule if restyled is a declaration.
 * `.eui-card .eui-card { display: none }` is not a joke — a card inside a card
 * is a bug in the host's markup, and it should look like one.
 */
export function stylesheet(): string {
  return `${cssVariables()}

.eui-stage {
  font-family: var(--eui-font);
  color: #E9EEF7;
  display: flex; flex-direction: column; gap: 12px;
  align-items: stretch;
}

/* "Their words above it." Not inside the card: the card is the reading, the
   line above is what was said, and merging them hides which is which. */
.eui-said {
  font-size: var(--eui-type-detail-size); line-height: var(--eui-type-detail-line);
  opacity: .62; font-style: italic; padding: 0 4px;
}

.eui-card {
  position: relative;
  border-radius: var(--eui-radius-stage);
  background: rgba(255,255,255, var(--eui-surface-card));
  border: 1px solid rgba(255,255,255,.06);
  padding: 18px;
  display: flex; flex-direction: column; gap: 10px;
  transition: opacity var(--eui-motion-smooth) ease, background var(--eui-motion-smooth) ease;
}
.eui-card[data-strong="true"] { background: rgba(255,255,255, var(--eui-surface-cardStrong)); }

/* Board 13, NEVER: "A card inside a card." Made visible rather than documented. */
.eui-card .eui-card { outline: 2px dashed var(--eui-danger); }

.eui-kicker {
  font-size: var(--eui-type-kicker-size); line-height: var(--eui-type-kicker-line);
  letter-spacing: var(--eui-type-kicker-tracking); font-weight: var(--eui-type-kicker-weight);
  text-transform: uppercase;
  color: var(--eui-domain);
}

.eui-headline {
  font-size: var(--eui-type-headline-size); line-height: var(--eui-type-headline-line);
  letter-spacing: var(--eui-type-headline-tracking); font-weight: var(--eui-type-headline-weight);
}

/* A row is a tint, not a surface. No radius of its own beyond sm, no border,
   no shadow — three things that would make it read as a card. */
.eui-row {
  display: flex; align-items: center; gap: 10px;
  min-height: var(--eui-target-min);
  padding: 6px 10px;
  border-radius: var(--eui-radius-sm);
  background: rgba(255,255,255, var(--eui-surface-row));
  font-size: var(--eui-type-row-size); line-height: var(--eui-type-row-line);
  font-weight: var(--eui-type-row-weight);
}
.eui-row[data-state="filled"][data-source="spoken"] { color: var(--eui-domain); }
.eui-row[data-state="empty"] { opacity: .38; }
.eui-row[data-focused="true"] {
  opacity: 1;
  outline: 1px dashed rgba(255,255,255,.28);
}
.eui-row[data-provisional="true"] { opacity: .72; }
.eui-detail {
  font-size: var(--eui-type-detail-size); line-height: var(--eui-type-detail-line);
  opacity: .55; margin-left: auto;
}

.eui-chip, .eui-drop {
  min-height: var(--eui-target-min); min-width: var(--eui-target-min);
  border-radius: var(--eui-radius-pill);
  border: 1px solid rgba(255,255,255,.14);
  background: transparent; color: inherit;
  padding: 0 14px; font: inherit; cursor: pointer;
  transition: transform var(--eui-motion-snappy) ease, background var(--eui-motion-snappy) ease;
}
.eui-chip:active { transform: scale(.96); }
.eui-drop { margin-left: auto; padding: 0; }

.eui-ring {
  height: 3px; border-radius: var(--eui-radius-pill);
  background: var(--eui-domain);
  transition: width var(--eui-motion-settle) linear;
}
.eui-count {
  font-size: var(--eui-type-detail-size); opacity: .7;
}
.eui-mark { color: var(--eui-success); font-size: var(--eui-type-row-size); }
.eui-explicit { color: var(--eui-warning); font-size: var(--eui-type-detail-size); }

.eui-out {
  align-self: flex-start;
  min-height: var(--eui-target-min);
  background: none; border: 0; color: inherit; opacity: .6;
  font: inherit; cursor: pointer; padding: 0 4px;
}

/* The next act, waiting. A row on the stage, never a second card. */
.eui-chained { opacity: .38; }

/* "Reduce Motion swaps every move for a cross-fade and keeps the timing." The
   durations are unchanged below — only what moves changes. */
@media (prefers-reduced-motion: reduce) {
  .eui-stage * {
    transition-property: opacity, background, color !important;
    animation: none !important;
  }
  .eui-chip:active { transform: none; }
}
`;
}
