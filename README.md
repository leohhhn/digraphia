# digraphia

**Cross-script identity linking for ENS.**

`никола.eth` and `nikola.eth` are the same person. ENS has no way to know that.

`@digraphia/core` is a client library and a text-record convention that lets the
holder of both names *assert* the link — bidirectionally, so anyone can verify it
without trusting an issuer, an oracle, or a registry contract. No new contracts:
the whole protocol is two `setText` calls and client-side verification.

Design rationale and research live in [`NOTES.md`](./NOTES.md).

---

## The problem

ENS resolves **one name → one address**. There is no name ↔ name relation
anywhere in the protocol.

For a language written in two alphabets, that splits one identity in two.
Serbian is written in Cyrillic *and* Latin, officially and simultaneously — a
Serb doesn't have two names, they have one name spelled two ways. But the two
spellings produce unrelated namehashes:

```
никола.eth   →  0x5ead07d5c07e46e232c2bcdb51572c3adab96b1b78adc178ea2e72fd10147bff
nikola.eth   →  0xd5819418a57415869202273f3367a2ee0afb3fbc7e7021e211ff2c6242e2dea0
```

Two registrations, two resolvers, two profiles, two sets of records. To ENS they
are as unrelated as `nikola.eth` and `vitalik.eth`. So:

- **Your history splits.** Reputation, attestations, subnames and primary name
  attach to one node; the other is a stranger with your name.
- **Someone else can hold your other spelling.** `nikola.eth` on mainnet is
  already owned by an unrelated address.
- **No client can safely merge them.** A wallet *could* guess the two are one
  person — but on what authority? Guessing wrong shows one person's balance
  under another person's name.

This is not homograph spoofing, which [ENSIP-15](https://docs.ens.domains/ensip/15/)
already prevents by rejecting mixed-script labels. It is the *inverse* problem,
created by that correct design: users are forced into two separate valid labels
and given no way to say they belong together.

## Why the link can't just be computed

The obvious objection is that Serbian transliteration is a clean 1:1 mapping, so
a client could derive the twin. It cannot.

**Cyrillic → Latin is a total function. Latin → Cyrillic is not.** The digraphs
`nj`, `lj`, `dž` are each either *one* Cyrillic letter or *two*, and only the
word's morphology decides which:

| Latin | Cyrillic | the `nj` is |
|---|---|---|
| `konj` | `коњ` | **one** letter `њ` |
| `injekcija` | `инјекција` | **two** letters `н` + `ј` |

Same two characters, opposite correct answers, both valid ENS labels. A client
cannot tell them apart, and a contract certainly cannot.

> **The link is not derivable. It must be declared by whoever holds both names,
> and verified — not computed — by everyone else.**

The API reflects this: `latinToCyrillicCandidates()` returns *every* reading
rather than guessing one.

## The convention

Each name stores a text record naming its twin. Two writes, perfectly symmetric:

```solidity
setText(namehash("никола.eth"), "rs.dvopis.alt", "nikola.eth")
setText(namehash("nikola.eth"), "rs.dvopis.alt", "никола.eth")
```

Both names must additionally resolve to the **same nonzero address**.

**Bidirectionality is the security property.** A one-directional record proves
nothing — anyone may point a text record at any name, and a squatter can claim
your name this afternoon. What a squatter cannot do is make *your* name point
back; that requires control of the other name's resolver.

```
никола.eth ──asserts──▶ nikola.eth     ✗ proves nothing (anyone can claim)
никола.eth ◀─asserts──▶ nikola.eth     ✓ requires control of BOTH
   └────── same addr() ──────┘         ✓ and a single controlling identity
```

The key is namespaced per [ENSIP-5](https://docs.ens.domains/ensip/5/), which
reserves bare lowercase keys for spec-defined globals. `rs.dvopis.alt` complies
(*dvopis* is Serbian for digraphia). The unprefixed global `alt-script` is what
the accompanying proposal suggests; see [NOTES.md §6](./NOTES.md).

---

## Install

Not published to npm yet. Clone and use the workspace:

```bash
git clone <this-repo> && cd hackathon-ethbg26
pnpm install
```

Then depend on it as `"@digraphia/core": "workspace:*"`. Peer requirements are
`viem` and `@adraffy/ens-normalize`.

## Usage

### Verify a link

`verifyLink()` runs six checks and returns each with a human-readable statement
of what was proven, so a UI can render a chain of evidence rather than a boolean.

```ts
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { verifyLink } from '@digraphia/core';

const client = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
});

const result = await verifyLink(client, 'ђорђе.eth', 'djordje.eth');

result.linked; // true
for (const check of result.checks) {
  console.log(check.ok ? 'PASS' : 'FAIL', check.id, check.detail);
}
```

```
PASS normalize        Both normalize under ENSIP-15: ђорђе.eth / djordje.eth
PASS distinct         Distinct namehashes.
PASS scripts-differ   Different ENSIP-15 script groups: Cyrillic vs ASCII.
PASS record-a-to-b    ђорђе.eth → djordje.eth (namehash matches djordje.eth).
PASS record-b-to-a    djordje.eth → ђорђе.eth (namehash matches ђорђе.eth).
PASS addr-match       Both resolve to 0xb4b3798d0b25B1A0d78627fC2a1d4F381aFacDfe.
```

The six checks:

| id | severity | proves |
|---|---|---|
| `normalize` | required | both labels are valid under ENSIP-15 |
| `distinct` | required | `namehash(a) ≠ namehash(b)` — a name cannot be its own twin |
| `scripts-differ` | **advisory** | reported, never gates — see below |
| `record-a-to-b` | required | A's record resolves to B's node |
| `record-b-to-a` | required | the counter-assertion a squatter cannot forge |
| `addr-match` | required | both resolve to an identical nonzero address |

`linked` is true iff every **required** check passes.

`scripts-differ` is advisory because ENSIP-15 script groups are coarser than
writing systems: `台灣` and `台湾` are distinct nodes in the *same* group (`Han`),
as are hiragana and katakana. Enforcing it would reject the two largest
script-variant populations on earth.

Two rules the implementation is strict about:

- **Compared by namehash, never by string.** A string compare is defeated by an
  unnormalized variant that hashes to the same node — `НИКОЛА.eth` and
  `никола.eth` are the same node and both must be accepted.
- **Read live, never from an indexer.** Every read is an `eth_call` through the
  Universal Resolver. A subgraph is push-based and can be stale, and a squatter
  can set a record thirty seconds before a check.

### Find the possible twins

`planCounterparts()` enumerates what the twin *could* be, and refuses to choose.

```ts
import { planCounterparts } from '@digraphia/core';

const plan = planCounterparts('djordje.eth');

plan.direction;      // 'latin-to-cyrillic'
plan.deterministic;  // false — more than one reading exists
plan.candidates.map((c) => c.name);
// ['ђорђе.eth', 'ђордје.eth', 'дјорђе.eth', 'дјордје.eth']
```

Going the other way is deterministic, but may surface a name ENS won't accept:

```ts
const plan = planCounterparts('ђорђе.eth');

plan.deterministic;              // true
plan.candidates[0].name;         // 'djordje.eth'
plan.canonicalLatin;             // 'đorđe'  ← the TRUE Serbian spelling
plan.canonicalLatinRegistrable;  // false    ← ENSIP-15 disallows đ (U+0111)
```

That combination is the whole problem in miniature: the correct spelling is not
a legal ENS label, so the holder is pushed onto the ASCII fallback `djordje` —
which is exactly the form that reverses to four readings.

Unregistrable candidates are returned **with their rejection reason** rather than
filtered out, so a UI can explain the gap instead of hiding it:

```ts
{ name: 'đorđe.eth', registrable: false, error: 'disallowed character: "đ"' }
```

### Transliterate

```ts
import {
  cyrillicToLatin,
  latinToCyrillicCandidates,
  isAmbiguousLatin,
} from '@digraphia/core';

cyrillicToLatin('ђорђе');              // 'djordje'  (ens-safe, default)
cyrillicToLatin('ђорђе', 'canonical'); // 'đorđe'    (true orthography)

latinToCyrillicCandidates('konj');     // ['коњ', 'конј']
isAmbiguousLatin('konj');              // true
isAmbiguousLatin('nikola');            // false
```

Always use the default `'ens-safe'` style when producing a candidate label —
`'canonical'` can emit characters ENS rejects.

### The record key

```ts
import { LINK_KEY } from '@digraphia/core';  // 'rs.dvopis.alt'

const twin = await client.getEnsText({ name: 'ђорђе.eth', key: LINK_KEY });
```

Pass `{ key }` to `verifyLink()` to verify against a different key — useful if
the global `alt-script` is ever standardised.

---

## Try it

A verified pair is live on Sepolia:

```bash
pnpm --filter @digraphia/core test        # 37 tests
node packages/digraphia/test/live.mjs     # verifies ђорђе.eth ↔ djordje.eth
```

`live.mjs` takes `<chain> [nameA] [nameB]`, so the same verifier runs anywhere:

```bash
node packages/digraphia/test/live.mjs mainnet никола.eth nikola.eth
```

### The linking UI

```bash
pnpm --filter @digraphia/web dev          # http://localhost:5173
```

A single page that walks the whole protocol: enter a name you hold, pick the
correct twin from the enumerated readings, see the six checks verified live, and
write both assertions from an injected wallet. With exactly one direction
written it states plainly that a one-sided assertion proves nothing. The pair is
re-read every 12s, so a record written elsewhere appears without a reload.

## Repository

```
packages/digraphia/   @digraphia/core — the library
apps/web/             @digraphia/web  — the linking UI
NOTES.md              design rationale, research, cross-script survey
HANDOFF.md            project background and decision log
```

Built at ETHBelgrade 2026.
