/**
 * What a bridged tool costs to get wrong.
 *
 * MCP tool annotations are hints, and the SDK says so in its own source:
 * "Clients should never make tool use decisions based on ToolAnnotations
 * received from untrusted servers." So here a server's hints may only make a
 * tool look MORE dangerous. Nothing a server says can make its own tool
 * commit on silence. Only the person can, per tool, and only down to a floor
 * the hints and the facts allow.
 *
 * The MCP defaults already lean the right way: a tool that says nothing is
 * assumed to write (readOnlyHint false), to be destructive (destructiveHint
 * true) and to reach the outside world (openWorldHint true). The conservative
 * reading IS the spec's reading.
 *
 * The rule, in order:
 *
 *   read-only claim              a source for the aggregator, never an act.
 *                                Trusted only because the person approved the
 *                                connection, whose preview says so.
 *   no undo in the shape         irreversible. External, always.
 *   destructive (or unstated)    external, always.
 *   otherwise                    starts external. The person may delegate it
 *                                lower, down to a floor: other-person if it
 *                                reaches outside, self if it says it does not.
 */

import type { Radius } from '@intermenu/aiuic-core';

export type Annotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type Classification =
  | { kind: 'read'; why: string }
  | { kind: 'write'; start: Radius; floor: Radius; lowerable: boolean; why: string[] };

const ORDER: Radius[] = ['self', 'shared', 'other-person', 'external'];
export const rank = (r: Radius) => ORDER.indexOf(r);

export function classify(a: Annotations | undefined, hasUndo: boolean): Classification {
  const ann = a ?? {};
  if (ann.readOnlyHint === true) {
    return { kind: 'read', why: 'the server says it only reads' };
  }

  const why: string[] = [];
  let floor: Radius = 'self';

  if (!hasUndo) why.push('no undo is declared, so it cannot be taken back');
  if (ann.destructiveHint !== false) {
    why.push(ann.destructiveHint === true
      ? 'the server says it is destructive'
      : 'the server does not say it is non-destructive, and MCP assumes it is');
  }
  if (ann.openWorldHint !== false) {
    floor = 'other-person';
    why.push('it reaches outside this app');
  }

  const lowerable = hasUndo && ann.destructiveHint === false;
  if (!lowerable) return { kind: 'write', start: 'external', floor: 'external', lowerable: false, why };
  return { kind: 'write', start: 'external', floor, lowerable: true, why };
}

export class DelegationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationError';
  }
}

/**
 * The person lowers a tool's radius. Refuses anything below the floor, and
 * anything at all for a tool that cannot be taken back.
 */
export function checkDelegation(tool: string, c: Classification, to: Radius): Radius {
  if (c.kind === 'read') throw new DelegationError(`${tool} only reads; there is nothing to delegate`);
  if (!c.lowerable) {
    if (to === 'external') return to;
    throw new DelegationError(`${tool} cannot be lowered: ${c.why.join('; ')}`);
  }
  if (rank(to) < rank(c.floor)) {
    throw new DelegationError(`${tool} cannot go below ${c.floor}: ${c.why.join('; ')}`);
  }
  return to;
}
