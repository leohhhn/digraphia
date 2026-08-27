/**
 * Planning the counterpart of a name: given one spelling, what could the
 * twin be, and which of those are even expressible as ENS labels?
 *
 * This is the layer the UI drives. It deliberately stops short of picking
 * a winner - that is the whole thesis (see translit.ts). It enumerates,
 * annotates, and hands the choice back.
 */
import { ens_normalize, ens_split } from '@adraffy/ens-normalize';
import { namehash } from 'viem/ens';
import {
  cyrillicToLatin,
  latinToCyrillicCandidates,
  isAmbiguousLatin,
} from './translit.js';

export type Direction = 'cyrillic-to-latin' | 'latin-to-cyrillic';

/** One possible twin, with the verdict on whether ENS will accept it. */
export interface Candidate {
  /** Full name, e.g. "ђорђе.eth". */
  name: string;
  /** Just the transliterated leading label. */
  label: string;
  /** False when ENSIP-15 rejects it outright. */
  registrable: boolean;
  /** ENSIP-15's own rejection message, when registrable is false. */
  error?: string;
  node?: `0x${string}`;
  script?: string;
}

export interface CounterpartPlan {
  input: string;
  normalized: string;
  /** Leading label of the input - the part that actually changes script. */
  label: string;
  /** Everything after the leading label, e.g. "eth". */
  suffix: string;
  script: string;
  node: `0x${string}`;
  direction: Direction;
  /**
   * True when exactly one reading exists. Cyrillic->Latin is always
   * deterministic; Latin->Cyrillic usually is not.
   */
  deterministic: boolean;
  candidates: Candidate[];
  /**
   * For Cyrillic input: the TRUE Serbian Latin spelling, which may be
   * unregistrable. `ђорђе` -> `đorđe`, which ENSIP-15 rejects. When
   * `canonicalLatinRegistrable` is false the user is being forced onto the
   * ASCII fallback, and that fallback is what introduces the ambiguity.
   */
  canonicalLatin?: string;
  canonicalLatinRegistrable?: boolean;
  canonicalLatinError?: string;
}

function describe(label: string, suffix: string): Candidate {
  const name = suffix ? `${label}.${suffix}` : label;
  try {
    const normalized = ens_normalize(name);
    return {
      name: normalized,
      label,
      registrable: true,
      node: namehash(normalized),
      script: ens_split(normalized)[0]?.type,
    };
  } catch (err) {
    return {
      name,
      label,
      registrable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Enumerate the possible cross-script twins of `input`.
 *
 * Throws if the input itself does not normalize - there is nothing to plan
 * from a name ENS would not accept in the first place.
 */
export function planCounterparts(input: string): CounterpartPlan {
  const normalized = ens_normalize(input);
  const parts = normalized.split('.');
  const label = parts[0];
  const suffix = parts.slice(1).join('.');
  const script = ens_split(normalized)[0]?.type ?? 'unknown';
  const node = namehash(normalized);

  const base = { input, normalized, label, suffix, script, node };

  if (script === 'Cyrillic') {
    // Deterministic direction. One reading, but the honest orthography may
    // not be registrable - surface that rather than hiding the substitution.
    const ensSafe = cyrillicToLatin(label, 'ens-safe');
    const canonical = cyrillicToLatin(label, 'canonical');
    const canonicalProbe = describe(canonical, suffix);
    return {
      ...base,
      direction: 'cyrillic-to-latin',
      deterministic: true,
      candidates: [describe(ensSafe, suffix)],
      canonicalLatin: canonical,
      canonicalLatinRegistrable: canonicalProbe.registrable,
      canonicalLatinError: canonicalProbe.error,
    };
  }

  // Latin/ASCII input: every reading, no ranking with authority.
  const readings = latinToCyrillicCandidates(label);
  return {
    ...base,
    direction: 'latin-to-cyrillic',
    deterministic: !isAmbiguousLatin(label),
    candidates: readings.map((r) => describe(r, suffix)),
  };
}
