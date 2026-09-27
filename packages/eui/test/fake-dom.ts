/**
 * A document that is not a browser: enough of one for the presenters, which
 * take `El` and `Doc` rather than reaching for globals. Shared by both test
 * files so the two cannot drift into disagreeing about what an element is.
 */
export type FakeEl = {
  tag: string; textContent: string | null; className: string;
  attrs: Record<string, string>; vars: Record<string, string>;
  children: FakeEl[]; listeners: Array<() => void>;
  appendChild(c: FakeEl): void;
  addEventListener(t: string, fn: () => void): void;
  replaceChildren(): void;
  setAttribute(k: string, v: string): void;
  style: Record<string, string> & { setProperty(k: string, v: string): void };
  click(): void;
  find(cls: string): FakeEl[];
  depth(cls: string, d?: number): number;
  text(): string;
};

export function makeEl(tag: string): FakeEl {
  const vars: Record<string, string> = {};
  const style = Object.assign({} as Record<string, string>, {
    setProperty(k: string, v: string) { vars[k] = v; },
  });
  const node: FakeEl = {
    tag, textContent: null, className: '', attrs: {}, vars, style,
    children: [], listeners: [],
    appendChild(c) { node.children.push(c); },
    addEventListener(_t, fn) { node.listeners.push(fn); },
    replaceChildren() { node.children.length = 0; },
    setAttribute(k, v) { node.attrs[k] = v; },
    click() { for (const fn of node.listeners) fn(); },
    find(cls) {
      const hit: FakeEl[] = node.className.split(' ').includes(cls) ? [node] : [];
      for (const c of node.children) hit.push(...c.find(cls));
      return hit;
    },
    /** Deepest nesting of `cls` inside itself, anywhere in the subtree. */
    depth(cls, d = 0) {
      const here = node.className.split(' ').includes(cls) ? d + 1 : d;
      return node.children.reduce((m, c) => Math.max(m, c.depth(cls, here)), here);
    },
    text() { return [node.textContent ?? '', ...node.children.map((c) => c.text())].join(' ').trim(); },
  };
  return node;
}

export const fakeDom = () => ({ root: makeEl('div'), doc: { createElement: makeEl } });
