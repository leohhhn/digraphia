<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" width="400"
         alt="digraphia — cross-script identity linking for ENS">
  </picture>
</p>

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

## Try it

Everything here runs against a **live verified pair on Sepolia** —
`ђорђе.eth` ↔ `djordje.eth`, mutually asserted and resolving to one address.

```bash
git clone <this-repo> && cd hackathon-ethbg26
pnpm install
pnpm dev
```

That's the whole setup — the app is at **http://localhost:5173**.

Open the page and enter **`ђорђе.eth`** — copy-paste it, you almost certainly
don't have a Cyrillic keyboard. It walks the whole protocol:

1. **Finds the twin.** Cyrillic in, so exactly one reading. It also flags that
   the *true* Latin spelling `đorđe` is not a legal ENS label, which is why the
   ASCII fallback `djordje` is what you are left with.
2. **Verifies live.** The six checks, each with its evidence, read through the
   Universal Resolver — no indexer.
3. **Writes the assertion.** One `setText` per direction, from an injected
   wallet. Write only one and the page says so: a one-sided assertion proves
   nothing.

Now try **`djordje.eth`** instead. Going the other way is ambiguous, so you get
four Cyrillic readings and the page refuses to pick one for you — only the
on-chain assertion settles it. That is the entire argument, in one input box.

The pair is re-read every 12s, so a record written from anywhere shows up
without a reload. Polling stops once the link verifies.

No wallet? Everything except step 3 works read-only.

### From the terminal

```bash
pnpm test      # 37 tests
pnpm verify    # verifies ђорђе.eth ↔ djordje.eth on Sepolia
```

`pnpm verify` takes `<chain> [nameA] [nameB]`, so the same verifier runs
anywhere:

```bash
pnpm verify mainnet никола.eth nikola.eth
```

That one fails, correctly — and it is the problem itself, in one command. Both
spellings of the name are registered on mainnet today, to **two different
people**:

```
FAIL  record-a-to-b  никола.eth has no rs.dvopis.alt record.
FAIL  record-b-to-a  nikola.eth has no rs.dvopis.alt record — the counter-assertion is missing.
FAIL  addr-match     Addresses differ: 0x7f432f72…0B70FBA vs 0x6Db2485A…2d4D4dD7.

linked: false
```

Neither can prove any relationship to the other, and no client can safely show
them as one identity. That is what the convention exists to fix.

### Deploy it

`vercel.json` is committed, so importing the repo on Vercel needs no further
configuration — it picks up the monorepo build:

| Setting | Value |
|---|---|
| Root directory | repo root — **not** `apps/web` |
| Install | `pnpm install --frozen-lockfile` |
| Build | `pnpm build` |
| Output | `dist` |

The app builds to `dist/` at the repo root rather than `apps/web/dist`, because
Vercel resolves the output directory from the project root and its Vite preset
looks for `dist` there. Emitting straight to that path means the deploy works
whether or not `vercel.json` is honoured over the dashboard settings.

The build is fully static, so any static host works — `pnpm build` and serve
`dist/`.

Two optional environment variables, `VITE_SEPOLIA_RPC` and `VITE_MAINNET_RPC`
(see `apps/web/.env.example`). They default to public endpoints that need no
setup but rate-limit, which is exactly what happens when a room loads the same
demo at once. Point them at your own provider for anything being shown live.

---

## Using the library

Not published to npm yet. Depend on the workspace package as
`"@digraphia/core": "workspace:*"`; peer requirements are `viem` and
`@adraffy/ens-normalize`.

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

## Repository

```
packages/digraphia/   @digraphia/core — the library
apps/web/             @digraphia/web  — the linking UI
assets/               logo and mark, light and dark
NOTES.md              design rationale, research, cross-script survey
HANDOFF.md            project background and decision log
```

Built at ETHBelgrade 2026.
