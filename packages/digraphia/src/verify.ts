import { ens_normalize, ens_split } from '@adraffy/ens-normalize';
import { namehash } from 'viem/ens';
import type { Address, PublicClient } from 'viem';

/**
 * Text record key holding the cross-script twin.
 *
 * ENSIP-5 reserves bare lowercase keys (`avatar`, `url`, ...) for
 * spec-defined globals and requires application keys to be namespaced with
 * at least one dot.
 *
 * The namespace is deliberately language-neutral. An earlier version used a
 * Serbian one, which was incoherent the moment someone linked a Japanese or
 * Kazakh pair - the mechanism is identical for every script, and the key
 * should not claim otherwise.
 *
 * The unprefixed global `alt-script` is what the accompanying ENSIP draft
 * proposes; shipping under a namespaced key until a spec exists is the
 * correct behaviour, not a workaround.
 */
export const LINK_KEY = 'digraphia.alt-script';

export type CheckId =
  | 'normalize'
  | 'distinct'
  | 'scripts-differ'
  | 'record-a-to-b'
  | 'record-b-to-a'
  | 'addr-match';

export interface Check {
  id: CheckId;
  ok: boolean;
  /**
   * 'required' checks gate the link. 'advisory' checks are reported but do
   * not, on their own, make a link invalid.
   */
  severity: 'required' | 'advisory';
  /** Human-readable statement of what was proven, or why it failed. */
  detail: string;
}

export interface NameFacts {
  input: string;
  normalized?: string;
  node?: `0x${string}`;
  /** ENSIP-15 script group: 'ASCII' | 'Latin' | 'Cyrillic' | ... */
  script?: string;
  /** Raw string found in the link text record, as stored. */
  linkRecord?: string | null;
  address?: Address | null;
}

export interface VerifyResult {
  linked: boolean;
  checks: Check[];
  a: NameFacts;
  b: NameFacts;
}

const ZERO = '0x0000000000000000000000000000000000000000';

/** Normalize + namehash + script group, or throw with ENSIP-15's own message. */
function inspect(input: string): Required<Pick<NameFacts, 'normalized' | 'node' | 'script'>> {
  const normalized = ens_normalize(input);
  const labels = ens_split(normalized);
  // Script group of the leftmost label - the part that actually differs
  // between a cross-script pair. `eth` is always ASCII and tells us nothing.
  const script = labels[0]?.type ?? 'unknown';
  return { normalized, node: namehash(normalized), script };
}

/**
 * Verify that two ENS names are a mutually-asserted cross-script pair.
 *
 * The link holds only if all of the REQUIRED checks pass:
 *
 *   1. both names normalize under ENSIP-15          required
 *   2. they are distinct nodes                      required
 *   3. their leading labels are in different
 *      ENSIP-15 script groups                       ADVISORY - see below
 *   4. A's link record points at B                  required
 *   5. B's link record points at A                  required
 *   6. both resolve to the same nonzero address     required
 *
 * Check 3 is reported but never gates the result. ENSIP-15 script groups are
 * coarser than writing systems, and enforcing it would reject the two largest
 * script-variant populations on earth (see the comment at step 3).
 *
 * Steps 4 and 5 are compared BY NAMEHASH, never by raw string. A string
 * comparison is defeated by an unnormalized or trailing-dot variant that
 * hashes to the same node.
 *
 * Steps 4+5 together are what carries the security property: a one-sided
 * record proves nothing, because anyone may point a record at anyone. Only
 * the counter-assertion, which only the twin's controller can write,
 * completes the proof. No issuer, no oracle, no registry contract.
 *
 * All reads are live `eth_call`s through the Universal Resolver. Indexed
 * data is not acceptable here: a squatter can set a record thirty seconds
 * before it is checked.
 */
export async function verifyLink(
  client: PublicClient,
  inputA: string,
  inputB: string,
  opts: { key?: string } = {},
): Promise<VerifyResult> {
  const key = opts.key ?? LINK_KEY;
  const checks: Check[] = [];
  const a: NameFacts = { input: inputA };
  const b: NameFacts = { input: inputB };

  // 1. normalize
  try {
    Object.assign(a, inspect(inputA));
    Object.assign(b, inspect(inputB));
    checks.push({
      id: 'normalize',
      ok: true,
      severity: 'required',
      detail: `Both normalize under ENSIP-15: ${a.normalized} / ${b.normalized}`,
    });
  } catch (err) {
    checks.push({
      id: 'normalize',
      ok: false,
      severity: 'required',
      detail: err instanceof Error ? err.message : String(err),
    });
    return { linked: false, checks, a, b };
  }

  // 2. distinct nodes
  const distinct = a.node !== b.node;
  checks.push({
    id: 'distinct',
    ok: distinct,
    severity: 'required',
    detail: distinct
      ? 'Distinct namehashes.'
      : 'Both inputs normalize to the same node; a name cannot be its own twin.',
  });
  if (!distinct) return { linked: false, checks, a, b };

  // 3. different script groups - ADVISORY, not a gate.
  //
  // ENSIP-15 groups are coarser than writing systems. The two largest
  // script-variant populations on earth both fall inside a single group:
  //
  //   台灣 / 台湾        both 'Han'       (Traditional / Simplified Chinese)
  //   とうきょう / トウキョウ  both 'Japanese'  (hiragana / katakana)
  //
  // Gating on differing groups would reject them. Distinct nodes plus a
  // mutual assertion is the real security property; the script difference
  // is descriptive colour, so it is reported and never enforced.
  const scriptsDiffer = a.script !== b.script;
  checks.push({
    id: 'scripts-differ',
    ok: scriptsDiffer,
    severity: 'advisory',
    detail: scriptsDiffer
      ? `Different ENSIP-15 script groups: ${a.script} vs ${b.script}.`
      : `Both labels are in the ${a.script} group. ENSIP-15 groups are coarser `
        + `than writing systems (Simplified and Traditional Han share a group), `
        + `so this does not invalidate the link.`,
  });

  // 4 + 5. mutual assertion, compared by namehash
  const [recA, recB] = await Promise.all([
    client.getEnsText({ name: a.normalized!, key }).catch(() => null),
    client.getEnsText({ name: b.normalized!, key }).catch(() => null),
  ]);
  a.linkRecord = recA;
  b.linkRecord = recB;

  const pointsAt = (record: string | null, expected: `0x${string}`) => {
    if (!record) return false;
    try {
      return namehash(ens_normalize(record)) === expected;
    } catch {
      return false; // record holds something that isn't a normalizable name
    }
  };

  const aToB = pointsAt(recA, b.node!);
  checks.push({
    id: 'record-a-to-b',
    ok: aToB,
    severity: 'required',
    detail: aToB
      ? `${a.normalized} → ${recA} (namehash matches ${b.normalized}).`
      : recA
        ? `${a.normalized} claims "${recA}", which is not ${b.normalized}.`
        : `${a.normalized} has no ${key} record.`,
  });

  const bToA = pointsAt(recB, a.node!);
  checks.push({
    id: 'record-b-to-a',
    ok: bToA,
    severity: 'required',
    detail: bToA
      ? `${b.normalized} → ${recB} (namehash matches ${a.normalized}).`
      : recB
        ? `${b.normalized} claims "${recB}", which is not ${a.normalized}.`
        : `${b.normalized} has no ${key} record — the counter-assertion is missing.`,
  });

  // 6. same nonzero address
  const [addrA, addrB] = await Promise.all([
    client.getEnsAddress({ name: a.normalized! }).catch(() => null),
    client.getEnsAddress({ name: b.normalized! }).catch(() => null),
  ]);
  a.address = addrA;
  b.address = addrB;

  const bothSet = !!addrA && !!addrB && addrA !== ZERO && addrB !== ZERO;
  const addrMatch = bothSet && addrA!.toLowerCase() === addrB!.toLowerCase();
  checks.push({
    id: 'addr-match',
    ok: addrMatch,
    severity: 'required',
    detail: !bothSet
      ? 'At least one name has no address set.'
      : addrMatch
        ? `Both resolve to ${addrA}.`
        : `Addresses differ: ${addrA} vs ${addrB}.`,
  });

  const required = checks.filter((c) => c.severity === 'required');
  return { linked: required.every((c) => c.ok), checks, a, b };
}
