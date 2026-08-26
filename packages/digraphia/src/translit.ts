/**
 * Serbian Latin <-> Cyrillic transliteration, constrained by what ENS
 * (ENSIP-15) will actually accept as a label.
 *
 * Two facts drive every design decision in this file:
 *
 *   1. Cyrillic -> Latin is a total function. Every Cyrillic letter has
 *      exactly one Latin reading.
 *
 *   2. Latin -> Cyrillic is NOT. The digraphs `nj`, `lj` and `dž` are each
 *      either ONE Cyrillic letter or TWO, decidable only by morphology:
 *
 *          konj      -> коњ         (nj = њ)
 *          injekcija -> инјекција   (nj = н + ј, morpheme boundary)
 *          džep      -> џеп         (dž = џ)
 *          nadživeti -> надживети   (dž = д + ж, prefix boundary)
 *
 *      This is why the link between a name pair cannot be derived and must
 *      be asserted on-chain. See `latinToCyrillicCandidates`.
 */

/** Serbian Cyrillic letter -> its canonical Serbian Latin reading. */
const CYR_TO_LAT: Record<string, string> = {
  а: 'a',  б: 'b',  в: 'v',  г: 'g',  д: 'd',  ђ: 'đ',  е: 'e',  ж: 'ž',
  з: 'z',  и: 'i',  ј: 'j',  к: 'k',  л: 'l',  љ: 'lj', м: 'm',  н: 'n',
  њ: 'nj', о: 'o',  п: 'p',  р: 'r',  с: 's',  т: 't',  ћ: 'ć',  у: 'u',
  ф: 'f',  х: 'h',  ц: 'c',  ч: 'č',  џ: 'dž', ш: 'š',
};

/**
 * Latin letters that ENSIP-15 rejects outright, and the ASCII digraph
 * Serbian conventionally substitutes.
 *
 *   đ  U+0111  disallowed  -> "dj"
 *   ǆ  U+01C6  disallowed  -> "dž"  (precomposed digraph; use d + ž)
 *
 * Consequence: `đorđe.eth` can never exist, while `ђорђе.eth` is valid.
 * A class of Serbian names is Cyrillic-only inside the ENS namespace.
 */
export const ENS_DISALLOWED_LATIN: Record<string, string> = {
  'đ': 'dj',
  'ǆ': 'dž',
  'Ǆ': 'dž',
  'ǅ': 'dž',
};

/** Digraphs that are a single Cyrillic letter, longest-first for greedy scan. */
const LAT_DIGRAPHS: ReadonlyArray<readonly [string, string]> = [
  ['dž', 'џ'],
  ['lj', 'љ'],
  ['nj', 'њ'],
];

/** Single Latin letter -> Cyrillic. Excludes the ambiguous digraphs above. */
const LAT_TO_CYR: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', ž: 'ж', z: 'з',
  i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  r: 'р', s: 'с', t: 'т', ć: 'ћ', u: 'у', f: 'ф', h: 'х', c: 'ц',
  č: 'ч', š: 'ш', 'đ': 'ђ',
};

export type LatinStyle = 'canonical' | 'ens-safe';

/**
 * Cyrillic -> Latin. Deterministic.
 *
 * `style: 'canonical'` emits real Serbian orthography (`ђорђе` -> `đorđe`).
 * `style: 'ens-safe'`  emits only characters ENS permits (`ђорђе` -> `djordje`).
 *
 * Always use 'ens-safe' when producing a candidate ENS label.
 */
export function cyrillicToLatin(input: string, style: LatinStyle = 'ens-safe'): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    const mapped = CYR_TO_LAT[ch];
    if (mapped === undefined) {
      out += ch; // pass through digits, hyphens, anything non-Serbian
      continue;
    }
    out += style === 'ens-safe' ? (ENS_DISALLOWED_LATIN[mapped] ?? mapped) : mapped;
  }
  return out;
}

/**
 * Latin -> Cyrillic, returning EVERY valid reading rather than guessing one.
 *
 * Each occurrence of `nj` / `lj` / `dž` doubles the result set, because the
 * pair is either one Cyrillic letter or two. `injekcija` and `konj` both
 * contain `nj` and resolve differently; nothing in the string distinguishes
 * them.
 *
 * The ASCII fallback `dj` is likewise ambiguous: it is either `ђ` (the
 * substitute for the ENS-disallowed `đ`) or a literal `д` + `ј`.
 *
 * Results are ordered with the single-letter (digraph) reading first, which
 * is the more common case, but the ordering carries no authority. Callers
 * that need the true twin must read the on-chain assertion, not this list.
 *
 * `maxResults` guards against combinatorial blowup on adversarial input.
 */
export function latinToCyrillicCandidates(input: string, maxResults = 64): string[] {
  const s = input.toLowerCase();
  let results: string[] = [''];

  for (let i = 0; i < s.length; ) {
    const two = s.slice(i, i + 2);
    const digraph = LAT_DIGRAPHS.find(([lat]) => lat === two);

    if (digraph) {
      const [lat, asOneLetter] = digraph;
      const asTwoLetters = (LAT_TO_CYR[lat[0]] ?? lat[0]) + (LAT_TO_CYR[lat[1]] ?? lat[1]);
      results = results.flatMap((p) => [p + asOneLetter, p + asTwoLetters]);
      i += 2;
    } else if (two === 'dj') {
      // ENS-safe stand-in for `đ`, or a genuine д+ј sequence.
      results = results.flatMap((p) => [p + 'ђ', p + 'дј']);
      i += 2;
    } else {
      const ch = s[i];
      results = results.map((p) => p + (LAT_TO_CYR[ch] ?? ch));
      i += 1;
    }

    if (results.length > maxResults) results = results.slice(0, maxResults);
  }

  return [...new Set(results)];
}

/**
 * True when the Latin input contains a construct with more than one reading.
 * Use it to decide whether to show the "this cannot be derived" explanation.
 */
export function isAmbiguousLatin(input: string): boolean {
  return latinToCyrillicCandidates(input).length > 1;
}
