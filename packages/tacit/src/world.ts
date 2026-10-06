/**
 * The world, served to the app without the key.
 *
 * The World Monitor key lives on the server and nowhere else: not in the web
 * page, not in the iPhone bundle. The app asks this route for what the world
 * holds; the route answers from a cache it refreshes at most every few
 * minutes, so a page left open, or a hundred of them, costs one upstream call
 * per window. Errors come back as words, with anything that looks like the key
 * taken out first.
 */
import { ContextMemory, type ContextItem, type WorldSource } from '@intermenu/aiuic-notify';

export type WorldReply = { status: number; body: { items: ContextItem[]; refreshedAt: number | null; errors: string[] } };

export function worldRoute(o: { sources: WorldSource[]; secrets?: string[]; refreshMs?: number; now?: () => number }) {
  const now = o.now ?? Date.now;
  const every = o.refreshMs ?? 10 * 60_000;
  const memory = new ContextMemory(o.sources);
  let refreshedAt: number | null = null;
  let errors: string[] = [];
  let pending: Promise<unknown> | null = null;

  const scrub = (s: string) => (o.secrets ?? []).filter(Boolean).reduce((t, k) => t.split(k).join('[key]'), s);

  return async function get(q: { topics?: string[]; since?: number } = {}): Promise<WorldReply> {
    if (refreshedAt === null || now() - refreshedAt >= every) {
      // Many callers at once share one refresh.
      pending ??= memory.refresh(now()).then((r) => {
        refreshedAt = now();
        errors = [
          ...r.failed.map((n) => `${n}: did not answer`),
          ...o.sources.flatMap((s) => ((s as { lastErrors?: string[] }).lastErrors ?? [])),
        ].map(scrub);
      }, (e: unknown) => { errors = [scrub(`could not refresh: ${(e as Error).message}`)]; }).finally(() => { pending = null; });
      await pending;
    }
    const items = (q.topics?.length ? memory.query({ topics: q.topics }) : memory.all()).filter((it) => !q.since || it.at >= q.since);
    return { status: 200, body: { items, refreshedAt, errors } };
  };
}
