import { describe, it, expect } from 'vitest';
import { ens_normalize } from '@adraffy/ens-normalize';
import {
  cyrillicToLatin,
  latinToCyrillicCandidates,
  isAmbiguousLatin,
} from '../src/translit.js';

const normalizes = (label: string) => {
  try { ens_normalize(`${label}.eth`); return true; } catch { return false; }
};

describe('cyrillicToLatin', () => {
  it('transliterates common Serbian names', () => {
    expect(cyrillicToLatin('никола')).toBe('nikola');
    expect(cyrillicToLatin('београд')).toBe('beograd');
    expect(cyrillicToLatin('милош')).toBe('miloš');
    expect(cyrillicToLatin('његош')).toBe('njegoš');
    expect(cyrillicToLatin('жељко')).toBe('željko');
    expect(cyrillicToLatin('крагујевац')).toBe('kragujevac');
  });

  it('handles the three digraph letters as single units', () => {
    expect(cyrillicToLatin('љубица')).toBe('ljubica');
    expect(cyrillicToLatin('џеп')).toBe('džep');
    expect(cyrillicToLatin('коњ')).toBe('konj');
  });

  it('emits đ canonically but dj for ENS', () => {
    expect(cyrillicToLatin('ђорђе', 'canonical')).toBe('đorđe');
    expect(cyrillicToLatin('ђорђе', 'ens-safe')).toBe('djordje');
  });

  it('canonical đ is rejected by ENS, proving the fallback is required', () => {
    expect(normalizes('đorđe')).toBe(false);
    expect(normalizes('djordje')).toBe(true);
    expect(normalizes('ђорђе')).toBe(true);
  });

  it('every ens-safe output is a valid ENS label', () => {
    const names = [
      'никола','београд','милош','његош','жељко','крагујевац','ђорђе',
      'љубица','џеп','коњ','ћирилица','чачак','срби','вук','ниш','шабац',
    ];
    for (const cyr of names) {
      expect(normalizes(cyr), `cyrillic ${cyr}`).toBe(true);
      expect(normalizes(cyrillicToLatin(cyr)), `latin of ${cyr}`).toBe(true);
    }
  });
});

describe('latinToCyrillicCandidates — the ambiguity that motivates the protocol', () => {
  it('offers both readings of nj', () => {
    const c = latinToCyrillicCandidates('konj');
    expect(c).toContain('коњ');   // one letter
    expect(c).toContain('конј');  // two letters
  });

  it('produces the correct reading for both real-world nj cases', () => {
    expect(latinToCyrillicCandidates('konj')).toContain('коњ');
    expect(latinToCyrillicCandidates('injekcija')).toContain('инјекција');
  });

  it('produces the correct reading for both real-world dž cases', () => {
    expect(latinToCyrillicCandidates('džep')).toContain('џеп');
    expect(latinToCyrillicCandidates('nadživeti')).toContain('надживети');
  });

  it('cannot distinguish them — identical digraph, different truth', () => {
    // Both contain "nj". Both yield >1 candidate. Nothing in the string
    // says which reading is correct. This is the whole argument for
    // asserting the link on-chain instead of computing it.
    expect(isAmbiguousLatin('konj')).toBe(true);
    expect(isAmbiguousLatin('injekcija')).toBe(true);
  });

  it('is unambiguous when no digraph is present', () => {
    expect(latinToCyrillicCandidates('nikola')).toEqual(['никола']);
    expect(isAmbiguousLatin('nikola')).toBe(false);
  });

  it('treats the dj fallback as ambiguous too', () => {
    const c = latinToCyrillicCandidates('djordje');
    expect(c).toContain('ђорђе');
    expect(c.length).toBeGreaterThan(1);
  });

  it('round-trips unambiguous names', () => {
    for (const cyr of ['никола','београд','срби','вук','стефан']) {
      expect(latinToCyrillicCandidates(cyrillicToLatin(cyr))).toContain(cyr);
    }
  });

  it('bounds the candidate set on digraph-dense input', () => {
    expect(latinToCyrillicCandidates('njnjnjnjnjnjnjnj').length).toBeLessThanOrEqual(64);
  });
});
