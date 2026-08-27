import { describe, it, expect } from 'vitest';
import { cyrillicToLatin, latinToCyrillicCandidates, isAmbiguousLatin, planCounterparts, LINK_KEY } from '../src/index.js';

describe('README examples', () => {
  it('transliteration block', () => {
    expect(cyrillicToLatin('ђорђе')).toBe('djordje');
    expect(cyrillicToLatin('ђорђе', 'canonical')).toBe('đorđe');
    expect(latinToCyrillicCandidates('konj')).toEqual(['коњ', 'конј']);
    expect(isAmbiguousLatin('konj')).toBe(true);
    expect(isAmbiguousLatin('nikola')).toBe(false);
  });
  it('planCounterparts(djordje.eth) block', () => {
    const p = planCounterparts('djordje.eth');
    expect(p.direction).toBe('latin-to-cyrillic');
    expect(p.deterministic).toBe(false);
    expect(p.candidates.map(c => c.name)).toEqual(['ђорђе.eth','ђордје.eth','дјорђе.eth','дјордје.eth']);
  });
  it('planCounterparts(ђорђе.eth) block', () => {
    const p = planCounterparts('ђорђе.eth');
    expect(p.deterministic).toBe(true);
    expect(p.candidates[0].name).toBe('djordje.eth');
    expect(p.canonicalLatin).toBe('đorđe');
    expect(p.canonicalLatinRegistrable).toBe(false);
  });
  it('LINK_KEY', () => expect(LINK_KEY).toBe('digraphia.alt-script'));
});
