import { describe, expect, it } from 'vitest';
import { Brands, initialsOf, luminance, readableOn } from '../src/index.js';

const bank = { id: 'rbc', name: 'Royal Bank', color: '#0051A5', aliases: ['RBC'] };
const light = { id: 'sunny', name: 'Sunny Credit Union', color: '#FFD23F' };

describe('brand', () => {
  it('picks legible text by measuring the colour, not guessing', () => {
    expect(readableOn('#0051A5')).toBe('#ffffff');
    expect(readableOn('#FFD23F')).toBe('#10121a');
    expect(luminance('#ffffff')).toBeCloseTo(1, 2);
  });

  it('makes initials from a name', () => {
    expect(initialsOf('Royal Bank')).toBe('RB');
    expect(initialsOf('Wealthsimple')).toBe('WE');
    expect(initialsOf('')).toBe('?');
  });

  it('draws a mark from initials, never a downloaded logo', () => {
    const b = new Brands(); b.register(bank);
    const svg = b.mark('rbc');
    expect(svg).toContain('RB');
    expect(svg).toContain('#0051A5');
    expect(svg).not.toContain('<image');
  });

  it('gets out of the way when the host holds a licence', () => {
    const b = new Brands();
    b.register({ ...bank, markSrc: 'data:image/svg+xml;base64,AAA' });
    expect(b.mark('rbc')).toContain('<image');
  });

  it('escapes a hostile brand name instead of rendering it', () => {
    const b = new Brands();
    b.register({ id: 'x', name: '<script>alert(1)</script>', color: '#123456' });
    expect(b.mark('x')).not.toContain('<script>');
    expect(b.mark('x')).toContain('&lt;script&gt;');
  });

  it('serves brands as slot options and finds them in speech', () => {
    const b = new Brands(); b.register(bank, light);
    expect(b.options().map((o) => o.label)).toEqual(['Royal Bank', 'Sunny Credit Union']);
    expect(b.match('move it to my RBC account')?.id).toBe('rbc');
    expect(b.match('nothing in here')).toBeUndefined();
  });

  it('refuses a brand with no colour', () => {
    const b = new Brands();
    expect(() => b.register({ id: 'n', name: 'No Colour', color: 'blurple' })).toThrow(/hex colour/);
  });
});
