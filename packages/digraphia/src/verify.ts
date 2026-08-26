import { ens_normalize, ens_split } from '@adraffy/ens-normalize';
import { namehash } from 'viem/ens';
import type { Address, PublicClient } from 'viem';

/**
 * Text record key holding the cross-script twin.
 *
 * ENSIP-5 reserves bare lowercase keys (`avatar`, `url`, ...) for
 * spec-defined globals and requires application keys to be reverse-dot
 * namespaced with at least one dot. `dvopis` is Serbian for digraphia.
 *
 * The unprefixed global `alt-script` is what the accompanying ENSIP draft
 * proposes; shipping under a namespaced key until a spec exists is the
 * correct behaviour, not a workaround.
 */
export const LINK_KEY = 'rs.dvopis.alt';

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
 * The link holds only if ALL of the following are true:
 *
 *   1. both names normalize under ENSIP-15
 *   2. they are distinct nodes
 *   3. their leading labels belong to different ENSIP-15 script groups
 *   4. A's link record points at B
 *   5. B's link record points at A
 *   6. both resolve to the same nonzero address
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
      detail: `Both normalize under ENSIP-15: ${a.normalized} / ${b.normalized}`,
    });
  } catch (err) {
    checks.push({
      id: 'normalize',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return { linked: false, checks, a, b };
  }

  // 2. distinct nodes
  const distinct = a.node !== b.node;
  checks.push({
    id: 'distinct',
    ok: distinct,
    detail: distinct
      ? 'Distinct namehashes.'
      : 'Both inputs normalize to the same node; a name cannot be its own twin.',
  });
  if (!distinct) return { linked: false, checks, a, b };

  // 3. different script groups
  const scriptsDiffer = a.script !== b.script;
  checks.push({
    id: 'scripts-differ',
    ok: scriptsDiffer,
    detail: scriptsDiffer
      ? `Different ENSIP-15 script groups: ${a.script} vs ${b.script}.`
      : `Both labels are in the ${a.script} group; this is not a cross-script pair.`,
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
    detail: !bothSet
      ? 'At least one name has no address set.'
      : addrMatch
        ? `Both resolve to ${addrA}.`
        : `Addresses differ: ${addrA} vs ${addrB}.`,
  });

  return { linked: checks.every((c) => c.ok), checks, a, b };
}
