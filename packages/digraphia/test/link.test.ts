import { describe, it, expect } from 'vitest';
import { planCounterparts } from '../src/link.js';

describe('planCounterparts', () => {
  it('Cyrillic input is deterministic - exactly one reading', () => {
    const p = planCounterparts('никола.eth');
    expect(p.direction).toBe('cyrillic-to-latin');
    expect(p.deterministic).toBe(true);
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0].name).toBe('nikola.eth');
    expect(p.candidates[0].registrable).toBe(true);
  });

  it('surfaces that the TRUE Latin spelling of ђорђе is unregistrable', () => {
    const p = planCounterparts('ђорђе.eth');
    expect(p.canonicalLatin).toBe('đorđe');
    expect(p.canonicalLatinRegistrable).toBe(false);
    expect(p.canonicalLatinError).toMatch(/disallowed/i);
    // ...and the ASCII fallback is what you get instead
    expect(p.candidates[0].name).toBe('djordje.eth');
    expect(p.candidates[0].registrable).toBe(true);
  });

  it('Latin input with a digraph is ambiguous and returns every reading', () => {
    const p = planCounterparts('djordje.eth');
    expect(p.direction).toBe('latin-to-cyrillic');
    expect(p.deterministic).toBe(false);
    const names = p.candidates.map((c) => c.name);
    expect(names).toContain('ђорђе.eth');
    expect(names).toContain('дјорђе.eth');
    expect(names.length).toBeGreaterThan(1);
  });

  it('konj and injekcija contain the same nj with opposite readings', () => {
    const konj = planCounterparts('konj.eth').candidates.map((c) => c.name);
    const inj = planCounterparts('injekcija.eth').candidates.map((c) => c.name);
    expect(konj).toContain('коњ.eth');      // nj = one letter
    expect(inj).toContain('инјекција.eth'); // nj = two letters
    // Neither list can be narrowed without knowing the word's morphology.
    expect(konj.length).toBeGreaterThan(1);
    expect(inj.length).toBeGreaterThan(1);
  });

  it('unambiguous Latin input is deterministic', () => {
    expect(planCounterparts('nikola.eth').deterministic).toBe(true);
  });

  it('transliterates only the leading label, preserving the suffix', () => {
    const p = planCounterparts('никола.leonh.eth');
    expect(p.label).toBe('никола');
    expect(p.suffix).toBe('leonh.eth');
    expect(p.candidates[0].name).toBe('nikola.leonh.eth');
  });

  it('rejects an input that does not normalize', () => {
    expect(() => planCounterparts('đorđe.eth')).toThrow(/disallowed/i);
  });
});
