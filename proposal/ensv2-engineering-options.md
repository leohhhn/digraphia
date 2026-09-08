# Engineering options: linking identity at the registry level, not just via text records

**Written:** 2026-09-07. Companion to [`ensip-draft-alt-script.md`](./ensip-draft-alt-script.md) and
[`../HANDOFF.md`](../HANDOFF.md) §4. That document proposed three options purely at the resolver
layer (scalar text record → array text record → new resolver profile). This document asks a
narrower question: **given ENSv2's actual architecture, what could be built at the *registry*
level instead of the resolver level** — closer to a first-class ENS primitive than a convention
riding on `setText`.

Grounded in the real ENSv2 contracts, read from `ensdomains/contracts-v2` (not the v1
`ensdomains/ens-contracts` repo, which is a different, older codebase) on 2026-09-07. Confirmed:
**ENSv2 is deployed to Sepolia today** as a public beta of the new App/Explorer — the same network
this project's demo pair already lives on — but "contracts and interfaces are not yet final and
may change prior to mainnet," per ENS's own beta announcement. Everything below is scoped
accordingly: buildable and demoable now, understood to be against a moving target.

---

## 1. What ENSv2 actually looks like (the part that changes the design space)

ENSv1 (what the shipped demo runs against) is one flat `mapping(bytes32 => {owner, resolver,
ttl})` plus arbitrary resolver contracts. ENSv2 replaces this with a **hierarchical tree of
registry contracts** — `alice.eth` can deploy its own registry for everything beneath it — and a
role-based permission system, **Enhanced Access Control (EAC)**, that replaces the v1
NameWrapper/fuses approach.

Three specifics matter for this project, verified directly against `PermissionedRegistry.sol` and
its interfaces:

**Every registered name has a stable `resource` identifier, independent of its token.**
`IPermissionedRegistry.getResource(anyId)` derives a `resource` from the labelhash plus an
`eacVersionId` that only increments on unregister/re-register — *not* on every resolver change,
subregistry change, or role grant (those instead bump a separate `tokenVersionId`, which
regenerates the ERC-1155 token to prevent front-running a role revocation with a transfer). A link
keyed by `resource` survives a resolver swap or a role grant; a link keyed by the ERC-1155
`tokenId` would not. This is the correct anchor to build against, and it isn't optional trivia —
getting this wrong is exactly the kind of bug that would surface as "my link silently broke when I
changed resolvers," discovered by a user, not by review.

**A registry's per-name storage is a fixed struct, not an extensible one — with a clue about how
ENS itself expects to extend it.** `PermissionedRegistry`'s `Entry` is exactly
`{eacVersionId, tokenVersionId, subregistry, expiry, resolver}`, plus a
`uint256[256] private __gap` storage-gap reserved for the ENS team's own future upgrades to this
contract. There is no free field here for a third party to claim, and there structurally
shouldn't be — `__gap` is reserved for the contract's own owners. **This rules out "just add a
field to the registry" as a real option** for anyone other than ENS Labs itself; see Option D
below for why it's listed anyway and why it's not recommended.

**The Universal Resolver V2 already exposes registry-tree helpers as public view functions**, not
just name resolution: `findOwner(bytes name)`, `findExactRegistry`, `findParentRegistry`,
`findRegistries` (`IUniversalResolverV2.sol`, `LibRegistry.sol`). Concretely,
`findOwner(dnsEncode("nikola.eth"))` walks the registry tree and returns the current controlling
address in one read, regardless of which registry in the hierarchy actually owns that name. Any
new contract that needs to answer "does `msg.sender` currently control this name" can piggyback on
this instead of reimplementing tree traversal — a meaningful reduction in the amount of new code a
proposal needs to write and get right.

## 2. The options, ordered from what's already shipped to what would be new

### Option A (shipped) — scalar text record, resolver-layer only
What exists today: `digraphia.alt-script` / proposed `alt-script` as a `text()` record, verified
entirely client-side by re-reading both sides through the Universal Resolver. Zero new contracts.
This is the baseline the ENSIP draft formalizes. Its limits are exactly HANDOFF.md §3's weaknesses
#3 (pairwise only) and #6 (offchain resolvers' CCIP-Read gateway is trusted, not verified).

### Option B — a standalone on-chain **LinkRegistry** contract, registry-adjacent

A new, small contract — not a resolver, not a fork of `PermissionedRegistry` — that sits beside
the ENS registry tree the way a NameWrapper or a Reverse Registrar does: it reads from the
registry hierarchy for authorization, but owns its own storage for the thing it's actually about.

```solidity
mapping(bytes32 node => bytes32[] cluster) internal clusters;

function assertLink(bytes32 node, bytes32 counterpart) external {
    require(msg.sender == universalResolver.findOwner(nameOf(node)), "not controller");
    clusters[node].push(counterpart);
    emit LinkAsserted(node, counterpart, msg.sender);
}

function isLinked(bytes32 a, bytes32 b) external view returns (bool) {
    return _contains(clusters[a], b) && _contains(clusters[b], a);
}
```

What this buys over Option A, concretely:

- **N-way clusters for free.** The storage is an array from day one — a Traditional/Simplified
  Han/Pinyin trio or a kanji/hiragana/katakana/rōmaji quartet is the same data structure as a
  pairwise Serbian link, not a special case. This is the direct fix for HANDOFF.md weakness #3,
  and it's the "list of variant labels" shape the ENS conversation raised — implemented on-chain
  rather than as a JSON blob inside a text record (Option B in the resolver-layer document), which
  sidesteps that option's biggest weakness: there is no ENSIP-5 precedent for structured values in
  a text record, whereas a dedicated contract with typed storage has none of that ambiguity.
- **The mutual-assertion invariant is enforced by the contract, not left to every client to
  re-derive.** `isLinked()` is a single `eth_call`, no five-step off-chain algorithm to
  reimplement correctly in every client (the six checks in `verify.ts` collapse to one on-chain
  read plus the caller's own choice of what counts as "resolved to the same address," which can
  stay off-chain or be folded in too).
- **Authorization by `findOwner()`, not by resolver-record trust.** Writing a link requires
  `msg.sender` to be the *current* controller per the live registry tree, checked synchronously in
  the same transaction — there is no window where a stale or gateway-forged read could accept a
  write from someone who no longer controls the name. This directly answers HANDOFF.md weakness
  #6 for the write path specifically (the read path for an offchain-resolved name's `addr()`
  still inherits ordinary CCIP-Read trust, which is a broader, pre-existing property of the
  protocol, not something this contract can or should try to fix).
- **Composability.** `isLinked(a, b)` is a plain view function any other contract can call — a
  governance contract could dedupe voting weight across a linked pair, an airdrop contract could
  treat them as one claim. Option A's client-side verifier can't be called from Solidity at all.

Cost: this is real new Solidity, needs its own tests and its own security review (reentrancy on
array mutation, gas growth of `_contains` for large clusters — bound it, same as
`latinToCyrillicCandidates`'s existing candidate-count bound), and needs to be deployed and
maintained. It's more work than Option A. It is not more work than the problem warrants: every
piece of it maps to a named, already-written-down weakness, not to speculative future-proofing.

### Option C — a resolver facade in front of Option B, plus an ERC-7996 feature flag

Wrap the LinkRegistry behind a small adapter implementing `IExtendedResolver.resolve(name, data)`
so that `text(node, "alt-script")` keeps working for any client that only knows the familiar
Universal-Resolver-mediated read path — it just reads through to Option B's contract instead of
arbitrary resolver storage. Declare support for a feature id under
[ENSIP-22](https://docs.ens.domains/ensip/22/) (ERC-7996 contract features, the newest accepted
ENSIP, shipped 2025) — e.g. `eth.alt-script.linkregistry` — so a Universal-Resolver-V2-aware
client can distinguish "this resolver's alt-script record is backed by the verified on-chain
registry" from "this is just a free-text convention with no on-chain guarantee." This is a small
addition on top of Option B (one adapter contract, one feature-id declaration) that buys backward
compatibility with every client that already speaks `text()`/`resolve()`, without asking any of
them to learn a new contract ABI to get the benefit.

### Option D — extend the registry's own `Entry` struct (not recommended, listed for completeness)

The theoretical ceiling: if ENS Labs itself adopted this, `alt-script` could live directly in
`PermissionedRegistry`'s reserved storage gap as core per-name state, resolved by the registry
itself rather than any resolver or peer contract. **Not proposed here.** It requires modifying and
redeploying the canonical registry ENS Labs controls — a governance ask an order of magnitude
larger than shipping an ENSIP or an independent contract, and the `__gap` pattern signals that
space is reserved for ENS's own roadmap, not third-party claims on it. Naming this option and
explicitly declining to pursue it is itself useful: it shows the design space was actually
surveyed against the real contracts, not guessed at.

## 3. Recommendation

Ship Option A as the ENSIP (already drafted) — it's small, matches the working demo, and is the
version most likely to get reviewed quickly. Build **Option B + C together** as the next
engineering milestone, on Sepolia, against the ENSv2 beta contracts that are already live there —
same network the current demo already targets, so there's no new test-infrastructure cost. Frame
Option B/C in any grant application as the concrete deliverable: a reference `LinkRegistry`
contract plus resolver adapter, tested against ENSv2's actual `PermissionedRegistry` and
`findOwner()`, with N-way clusters and on-chain mutual-assertion enforcement — each piece answering
a specific, already-documented gap in the v1 build, not scope invented to look substantial. Do not
pursue Option D; naming it as considered-and-declined is enough.

## 4. Sources

Read directly from source for this document: `ensdomains/contracts-v2`
[`PermissionedRegistry.sol`](https://github.com/ensdomains/contracts-v2/blob/main/contracts/src/registry/PermissionedRegistry.sol),
`IRegistry.sol`, `IStandardRegistry.sol`, `IPermissionedRegistry.sol`, `RegistryRolesLib.sol`,
`IRegistryEvents.sol`, `IUniversalResolverV2.sol`, `LibRegistry.sol` — commit as of 2026-09-07,
`main` branch, contracts explicitly marked not-yet-final. [ENSIP-22 — Contract
Features](https://docs.ens.domains/ensip/22/). [ENS App and Explorer Beta
announcement](https://ens.domains/blog/post/ensv2-beta-public-testing) — ENSv2 on Sepolia, mainnet
date unannounced.
