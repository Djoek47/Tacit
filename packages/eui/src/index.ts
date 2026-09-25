/**
 * aiuic-eui — the visual language, as code.
 *
 * Taken from the Ultramax EUI boards and made into something a build can fail
 * on. Three parts:
 *
 *   tokens   the material: colours, ground, shape, type, three springs, a budget
 *   domain   what an act in each part of the app is allowed to be — checkable
 *   stage    one card, drawn in the language, over the same view every
 *            presenter gets
 *
 * Nothing here restates a contract rule. If a card decides when silence
 * commits, the boundary is in the wrong place and the fix is upstream.
 */

export * from './tokens.js';
export * from './domain.js';
export * from './beats.js';
export * from './css.js';
export * from './stage.js';
export * from './theme.js';
