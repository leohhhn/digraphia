import { describe, it, expect } from 'vitest';
import { namehash } from 'viem/ens';
import { ens_normalize } from '@adraffy/ens-normalize';
import { verifyLink, LINK_KEY, type CheckId } from '../src/verify.js';

const ALICE = '0xb4b3798d0b25B1A0d78627fC2a1d4F381aFacDfe';
const MALLORY = '0x5E36ee824ee289368d4d7B220D16e70641a24a0A';

/** Minimal fake of the two PublicClient methods verifyLink uses. */
function client(records: Record<string, { link?: string; addr?: string }>) {
  const at = (name: string) => records[ens_normalize(name)] ?? {};
  return {
    async getEnsText({ name, key }: { name: string; key: string }) {
      return key === LINK_KEY ? (at(name).link ?? null) : null;
    },
    async getEnsAddress({ name }: { name: string }) {
      return at(name).addr ?? null;
    },
  } as any;
}

const failed = (r: { checks: { id: CheckId; ok: boolean }[] }) =>
  r.checks.filter((c) => !c.ok).map((c) => c.id);

const LINKED = {
  'никола.eth': { link: 'nikola.eth', addr: ALICE },
  'nikola.eth': { link: 'никола.eth', addr: ALICE },
};

describe('verifyLink', () => {
  it('accepts a fully mutual cross-script pair', async () => {
    const r = await verifyLink(client(LINKED), 'никола.eth', 'nikola.eth');
    expect(r.linked).toBe(true);
    expect(failed(r)).toEqual([]);
    expect(r.a.script).toBe('Cyrillic');
    expect(r.b.script).toBe('ASCII');
  });

  it('is symmetric in its arguments', async () => {
    const r = await verifyLink(client(LINKED), 'nikola.eth', 'никола.eth');
    expect(r.linked).toBe(true);
  });

  // The security property: a one-sided record proves nothing.
  it('rejects a squatter who points at a name that does not point back', async () => {
    const r = await verifyLink(
      client({
        'никола.eth': { link: 'nikola.eth', addr: MALLORY }, // squatter asserts
        'nikola.eth': { addr: ALICE },                        // victim never did
      }),
      'никола.eth',
      'nikola.eth',
    );
    expect(r.linked).toBe(false);
    expect(failed(r)).toContain('record-b-to-a');
  });

  it('rejects a pair that agrees but resolves to different addresses', async () => {
    const r = await verifyLink(
      client({
        'никола.eth': { link: 'nikola.eth', addr: ALICE },
        'nikola.eth': { link: 'никола.eth', addr: MALLORY },
      }),
      'никола.eth',
      'nikola.eth',
    );
    expect(r.linked).toBe(false);
    expect(failed(r)).toEqual(['addr-match']);
  });

  it('rejects a name with no address set', async () => {
    const r = await verifyLink(
      client({
        'никола.eth': { link: 'nikola.eth', addr: ALICE },
        'nikola.eth': { link: 'никола.eth' },
      }),
      'никола.eth',
      'nikola.eth',
    );
    expect(r.linked).toBe(false);
    expect(failed(r)).toContain('addr-match');
  });

  // Compare by namehash, never by string.
  it('accepts a record written with a trailing dot (same node, different string)', async () => {
    const r = await verifyLink(
      client({
        'никола.eth': { link: 'nikola.eth', addr: ALICE },
        'nikola.eth': { link: 'НИКОЛА.eth', addr: ALICE }, // normalizes to никола.eth
      }),
      'никола.eth',
      'nikola.eth',
    );
    expect(namehash(ens_normalize('НИКОЛА.eth'))).toBe(namehash('никола.eth'));
    expect(r.linked).toBe(true);
  });

  it('rejects a record holding something that is not a normalizable name', async () => {
    const r = await verifyLink(
      client({
        'никола.eth': { link: 'not a name!!', addr: ALICE },
        'nikola.eth': { link: 'никола.eth', addr: ALICE },
      }),
      'никола.eth',
      'nikola.eth',
    );
    expect(r.linked).toBe(false);
    expect(failed(r)).toContain('record-a-to-b');
  });

  it('rejects a name linked to itself', async () => {
    const r = await verifyLink(
      client({ 'nikola.eth': { link: 'nikola.eth', addr: ALICE } }),
      'nikola.eth',
      'NIKOLA.eth',
    );
    expect(r.linked).toBe(false);
    expect(failed(r)).toContain('distinct');
  });

  it('rejects a same-script pair even when mutually asserted', async () => {
    const r = await verifyLink(
      client({
        'nikola.eth': { link: 'nikolas.eth', addr: ALICE },
        'nikolas.eth': { link: 'nikola.eth', addr: ALICE },
      }),
      'nikola.eth',
      'nikolas.eth',
    );
    expect(r.linked).toBe(false);
    expect(failed(r)).toEqual(['scripts-differ']);
  });

  it('reports an unnormalizable input with ENSIP-15 own message', async () => {
    const r = await verifyLink(client({}), 'đorđe.eth', 'ђорђе.eth');
    expect(r.linked).toBe(false);
    expect(failed(r)).toEqual(['normalize']);
    expect(r.checks[0].detail).toMatch(/disallowed character/i);
  });

  it('works on subnames of a name you already own', async () => {
    const r = await verifyLink(
      client({
        'никола.leonh.eth': { link: 'nikola.leonh.eth', addr: ALICE },
        'nikola.leonh.eth': { link: 'никола.leonh.eth', addr: ALICE },
      }),
      'никола.leonh.eth',
      'nikola.leonh.eth',
    );
    expect(r.linked).toBe(true);
  });
});
