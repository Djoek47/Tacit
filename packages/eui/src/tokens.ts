/**
 * The material. Transcribed from the Ultramax EUI visual language, board 13,
 * which in turn cites docs/design-system/02-design-language.md.
 *
 * These are not suggestions. The whole point of the language is that a value
 * appearing twice in two apps means the same thing in both, so everything here
 * is `as const` and nothing derives a colour at runtime.
 *
 * The one rule that needs stating out loud, because it is the one a themer
 * breaks first:
 *
 *   The colour says which part of the app this is.
 *   The accent says which person you are.
 *
 * A member's accent pack never repaints a domain. `resolveColours()` in
 * domain.ts is the only thing that hands a renderer a colour, and it takes the
 * accent as an argument precisely so it can refuse to apply it.
 */

/** Fixed domain colours. Board 13. */
export const DOMAIN_COLOUR = {
  /** Tasks, homework, groceries: the doing. */
  mint: '#76C4AE',
  /** Plan: events, trips, places. */
  planPurple: '#A78BFA',
  /** Rewards, allowance, ranks. */
  rewardsGold: '#FAC775',
  /** Home, household, teaching. */
  cyan: '#378ADD',
  /** The assistant's own tab. Nothing else, ever. */
  poppinsCyan: '#06B6D4',
  /** Memory and anything with no part of the app to belong to. */
  neutral: '#94A3B8',
} as const;

export type DomainColour = keyof typeof DOMAIN_COLOUR;

/** Semantic, never themed. A warning is orange in every accent pack. */
export const SEMANTIC = {
  success: '#34D399',
  warning: '#FB923C',
  danger: '#F87171',
} as const;

/**
 * Ground and surface. Three grounds, three surface tints.
 *
 * "A card never contains a card. Inside the stage card, rows are tints — not
 * nested cards." The tints are the reason that rule is followable: a row has a
 * surface without being a surface.
 */
export const GROUND = {
  recessed: '#0B1220',
  base: '#111827',
  elevated: '#1B2434',
} as const;

export const SURFACE = {
  /** The stage card itself. */
  card: 0.05,
  /** A card that carries a total, or the one in focus. */
  cardStrong: 0.07,
  /** A row inside the card. Not a card. */
  row: 0.03,
} as const;

export const RADIUS_PX = {
  sm: 12,
  md: 20,
  /** The stage card. There is only one of these on screen. */
  stage: 28,
  pill: 999,
} as const;

/**
 * Type. Bricolage Grotesque, four sizes and no more. Each one has a job, and
 * the job is what picks it — not how much room is left.
 */
export const TYPE = {
  /** The one thing. "Jam". */
  headline: { size: 30, line: 34, tracking: -0.4, weight: 600 },
  /** A row. "Milk". */
  row: { size: 19, line: 24, tracking: 0, weight: 500 },
  /** Detail under a row. "Spreads · aisle 4". */
  detail: { size: 13, line: 18, tracking: 0, weight: 400 },
  /** The kicker. Always caps, always coloured by domain. "GROCERIES". */
  kicker: { size: 11, line: 14, tracking: 1.3, weight: 600, caps: true },
} as const;

export type TypeRole = keyof typeof TYPE;

export const FONT_STACK =
  "'Bricolage Grotesque', 'Inter var', Inter, ui-sans-serif, system-ui, -apple-system, sans-serif";

/**
 * Motion: three springs, and every move on screen is one of them.
 *
 * "Positions and scales use springs; opacity and colour use timings at the same
 * feel. Nothing slides sideways, nothing bounces."
 *
 * `approxMs` is what the spring settles in — it is what the budget is measured
 * against, and what a CSS timing has to match when Reduce Motion swaps the
 * move for a cross-fade.
 */
export const SPRING = {
  /** Taps, chips, drops. */
  snappy: { damping: 20, stiffness: 300, mass: 0.8, approxMs: 150 },
  /** Rows coming in, the card growing. */
  smooth: { damping: 18, stiffness: 180, mass: 1, approxMs: 300 },
  /** The mark and the ring. */
  settle: { damping: 22, stiffness: 90, mass: 1.2, approxMs: 600 },
} as const;

export type SpringName = keyof typeof SPRING;

/**
 * Board 10's budget. "Miss these and it stops feeling like a reflex."
 *
 * These are asserted against in beats.ts, not left as a note in a design doc:
 * a budget nobody measures is a wish.
 */
export const BUDGET_MS = {
  /** Words end → card on screen. */
  show: 150,
  /** Card up → the writes landed. */
  commit: 1500,
  /** Undo pressed → gone. */
  undo: 600,
} as const;

/** Board 10, beat 4. The base pause, before the radius multiplier. */
export const HOLD_MS = {
  adult: 850,
  child: 1300,
} as const;

/** Board 13, ALWAYS: "44 px targets, including a row's ×." */
export const MIN_TARGET_PX = 44;

/** Board 14. One object, three sizes, and it never unmounts. */
export const ORB_PX = {
  idle: 196,
  cardUp: 72,
  header: 34,
} as const;

/** Board 14. State is the tint. */
export const ORB_TINT = {
  idle: DOMAIN_COLOUR.poppinsCyan,
  listening: SEMANTIC.success,
  thinking: DOMAIN_COLOUR.planPurple,
  speaking: DOMAIN_COLOUR.poppinsCyan,
  done: SEMANTIC.success,
} as const;

export type OrbState = keyof typeof ORB_TINT;

/** Board 14: below this the water turns amber. Empty is a dry glass, not an error. */
export const ORB_LOW_WATER = 0.15;
