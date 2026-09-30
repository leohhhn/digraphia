---
title: Cross-Script Identity Linking
description: A text record convention letting the holders of two or more ENS names assert, mutually, that they are the same identity written in different scripts.
contributors:
  - leohhhn
ensip:
  created: "2026-09-07"
  status: draft
track: Ecosystem
---

# ENSIP-draft: Cross-Script Identity Linking (`alt-script`)

> **Status of this file:** working draft, not yet opened as a PR against `ensdomains/ensips`.
> Filed in this repo rather than the ENSIPs repo so it can be iterated on alongside the reference
> implementation.

## Abstract

This ENSIP defines `alt-script`, a global text record key (per ENSIP-5) whose value lists the
other ENS names that the holder asserts are the same identity, spelled in a different script. A
set of names is linked only when every member lists all the others — comparing by namehash, never
by string — and all members resolve to the same nonzero address. A pair is the two-name case of the
same rule. No new contract, registry, or oracle is required: the mechanism is ordinary `setText`
writes plus a client-side read and comparison.

## Motivation

ENS resolves one name to one address; nothing in the protocol relates two *different* names to
each other. For a monoscriptal language this is invisible. For a digraphic one — a language
written natively in more than one script, with no single canonical spelling — it splits one
person's identity into as many unrelated ENS nodes as they have spellings.

Serbian is the sharpest example: it is written in both Cyrillic and Latin, both official, and any
one piece of text is in one script or the other, never mixed. `никола.eth` and `nikola.eth` hash
to two completely unrelated nodes — two registrations, two resolvers, two profiles, two histories.
To ENS they are as unrelated as `nikola.eth` and `vitalik.eth`. The same structure recurs for
Kazakh (state-mandated Cyrillic→Latin transition, ~20M people, live now), Mongolian, Uzbek,
Traditional/Simplified Chinese, Japanese kanji/kana, and Serbian/Croatian/Montenegrin Latin
diacritics that ENSIP-15 cannot register at all (`đ`, forcing the ASCII fallback `dj`). Some of
these have three or more coexisting forms for one identity (Traditional Han / Simplified Han /
Pinyin; kanji / hiragana / katakana / rōmaji), so a pairwise-only mechanism would not cover them.

This is not the homograph-spoofing problem that ENSIP-15 already solves by rejecting mixed-script
and whole-script-confusable labels. It is the inverse, and it is *created by* that correct
rejection: a digraphic user is forced into separate, valid, unmixed labels, and given no way to
say they belong together.

**The link cannot be derived, only declared.** Cyrillic→Latin Serbian transliteration is a total
function, but Latin→Cyrillic is not: `nj` is one letter (`њ`) in `konj`/`коњ` and two letters
(`н`+`ј`) in `injekcija`/`инјекција`, and nothing in the string says which. A client cannot compute
the correct twin; only the person who is both can assert it, and only mutual assertion — not a
one-sided claim anyone could forge — makes that assertion trustworthy.

## Specification

### Record key

```
alt-script
```

`alt-script` is a Global Key under [ENSIP-5](https://docs.ens.domains/ensip/5/) (lowercase letters,
numbers and hyphens). The reference implementation in this repo currently uses a project-scoped key
(`digraphia.alt-script`) while this ENSIP is under review; it is not a Service Key in ENSIP-5's
reverse-dot sense and is expected to migrate to `alt-script` if this ENSIP is accepted.

### Value

A comma-separated list of the **other** ENS names in the cluster, with no whitespace:

```
text(namehash("никола.eth"), "alt-script")  →  "nikola.eth"
text(namehash("繁體.eth"),   "alt-script")  →  "简体.eth,pinyin.eth"
```

A single name is a list of one, so a pair needs no special form. An empty value means the name
declares no cluster.

Commas are unambiguous as a delimiter because ENSIP-15 disallows `,` in every name, so no valid
name can be split by it. Writers SHOULD omit the name's own name and SHOULD list members in a
consistent order (e.g. sorted by normalized string) to make records easy to compare by eye, but
readers MUST treat the value as an unordered set.

### Definitions

For a name `X` whose value parses successfully, `cluster(X)` is the set containing `X` and every
name in `X`'s list (each normalized, duplicates and `X` itself collapsed).

### Verification algorithm

A client asked whether name `A` is linked to other names MUST perform, in order:

1. **Normalize** `A` under [ENSIP-15](https://docs.ens.domains/ensip/15/). If it fails to
   normalize, there is no link.
2. **Read and parse** `text(namehash(A), "alt-script")`. Split on `,`, and normalize each entry.
   If any entry fails to normalize (this includes entries containing whitespace or empty entries),
   there is no link. Compute `S = cluster(A)`. If `|S| < 2`, there is no link.
3. **Read every other member.** For each `M` in `S` other than `A`, read
   `text(namehash(M), "alt-script")` and compute `cluster(M)` the same way. Reads MUST go through a
   path that performs live resolution (e.g. the Universal Resolver, so CCIP-Read / ENSIP-10
   wildcard names resolve correctly) rather than an indexer or cache.
4. **Compare as sets, by namehash.** The link requires `cluster(M) == S` for every `M` in `S`,
   where set equality is decided on `namehash` of each normalized member. Raw string comparison
   MUST NOT be used — it is defeated by an unnormalized or differently cased variant that
   nonetheless hashes to the same node.
5. **Compare `addr()`.** Every member MUST resolve to the same nonzero address. This is what ties
   the assertions to a single controlling identity rather than several cooperating but distinct
   controllers.

The cluster is valid **iff all five checks pass.** If any member fails, the entire cluster is not
linked; a client MUST NOT display a partial subset as linked. A client MAY separately report the
partial state to help users repair it ("`A` lists `B`, but `B` does not list `A`").

A client MAY reject lists with more entries than it is willing to resolve. Since each entry costs
further resolution, a cap of 8 members is RECOMMENDED to bound the cost of a hostile or careless
record. A client MAY additionally report whether members fall in different ENSIP-15 script groups,
but MUST NOT require it: ENSIP-15 script groups are coarser than writing systems (Traditional and
Simplified Han share the `Han` group; hiragana and katakana both fall under `Japanese`), so gating
on differing groups would reject same-group cross-script sets that are otherwise entirely valid.

### Why mutual closure is the security property

A one-directional record proves nothing: any name's resolver can point a text record at any other
name, including one the writer does not control. What a third party cannot do is make the *other*
names list the writer back — that requires control of each name's own resolver. Requiring every
member to list the same set, plus matching `addr()`, establishes common control without any
issuer, oracle, or on-chain registry of links.

```
A ──lists──▶ B          proves nothing — anyone can point at anyone
A ◀─lists──▶ B          requires control of BOTH names
   └── same addr() ──┘  and ties both to one controlling identity

A lists {B, C}, B lists {A, C}, C lists {A, B}, one addr()  →  3-name cluster
A lists {B, C}, B lists {A},    C lists {A, B}              →  no link (B is out of sync)
```

### Client guidance (non-normative)

Verification cost is small: a cluster of `n` names takes `n` text reads and `n` `addr()` reads,
which can be issued in parallel.

The harder problem is writing. Linking `n` names takes one `setText` per name, and every member's
value must describe the same set. A client that offers to create a link SHOULD:

- generate all values from a single entered set of names, rather than asking the user to type each;
- walk the user through one transaction per name, and show which members are still out of sync
  until the last one lands;
- where all names share a resolver the connected wallet manages, MAY batch the writes with the
  resolver's `multicall`;
- when adding or removing a member, remind the user that every existing member's record must be
  updated, not only the new one.

## Rationale

**Why a text record and not a new contract.** ENSIP-15 normalization requires Unicode tables, NFC,
emoji-sequence handling and confusables data that cannot run on the EVM. Any on-chain component
can therefore only ever accept precomputed namehashes and can never itself validate that a string
normalizes correctly — so string-level logic must live in a client, and the natural on-chain
counterpart is the resolver primitive ENS already has: `text()`. It also works today against every
resolver already deployed.

**Why a list rather than a single name.** A scalar value would cover only pairs, and several of the
motivating cases have three or more coexisting forms. Standardizing a scalar and retrofitting lists
later would change the meaning of a value clients already read; defining the list form from the
start avoids that. The single-name case remains valid and identical.

**Why the delimiter is a comma, and why no JSON.** ENSIP-15 makes `,` unusable in any name, so a
comma-separated list is unambiguous and requires no parser beyond a split. JSON would add escaping
and structure with no benefit for a list of names.

**Why the key is global rather than namespaced long-term.** The mechanism is identical regardless
of which scripts are involved — Cyrillic/Latin, Han/Han, kanji/kana, Gurmukhi/Shahmukhi — so a
language- or script-specific namespace would be actively misleading once used outside its
originating case. A prior draft of the reference implementation used a Serbian-specific namespace
(`rs.dvopis.alt`) and abandoned it for exactly this reason.

**Why the link is not computed, and why the spec makes no attempt to standardize
transliteration.** See Motivation — for Serbian specifically, and for essentially every digraphic
language in general, the Latin→other-script direction is not a function. Any attempt by this ENSIP
to standardize a transliteration table would be solving the wrong layer: the record does not encode
*how* to transliterate, only *that* specific already-registered names are asserted, mutually, to be
the same identity.

**Cost of the design.** Because there is no registry, changing a cluster means updating every
member's record: going from three names to four is four writes, and a member whose record goes
stale silently breaks the whole cluster until repaired. For the small, slow-changing clusters this
targets (typically 2–3 names), this is a modest one-time cost; it is the price of needing no new
infrastructure.

## Backwards Compatibility

This ENSIP defines a new text record key and introduces no changes to existing records, resolver
interfaces, or registry behavior. Clients that do not recognize `alt-script` are unaffected; the
record is inert to them, identical to any other text record they don't render.

**Future work (not part of this proposal).** For large or frequently changing clusters, the cost of
updating every member's record may become significant. A registry-based extension, built on the
ENSv2 registry model, could reduce this cost; it is outside the scope of this proposal and, if
pursued, would be specified separately as an optional upgrade that leaves records defined here
valid. A non-normative sketch is kept in the reference repository:
[cluster-registry-design.md](https://github.com/leohhhn/digraphia/blob/master/proposal/cluster-registry-design.md).

## Security Considerations

**Mutual closure, not the record's mere presence, is what must be checked.** An implementation
that treats a one-sided `alt-script` record as sufficient evidence of a link is trivially defeated:
anyone can write a text record on a name pointing at any target, including names they do not
control.

**Namehash comparison, not string comparison.** Comparing raw strings is defeated by an
unnormalized, differently cased, or trailing-dot variant that nonetheless resolves to the same node
as the intended target. All comparisons MUST be by namehash of the normalized value.

**Live reads, not indexed data.** A subgraph or other indexer is push-based and can be stale by
design; a party could set or remove a record moments before or after an indexer's last sync. All
reads that gate a security-relevant decision (e.g. displaying names as one identity) MUST be live
`eth_call`s through a path that performs correct resolution, not cached or indexed data.

**Offchain resolvers (CCIP-Read / ENSIP-10) shift trust to the gateway operator.** For a name
served by an offchain resolver, both the `text()` and `addr()` values used in verification are
supplied by a gateway that signs its response rather than being read from L1 state directly. This
specification's guarantees hold only as far as that gateway is honest; a compromised or malicious
gateway for any name in a cluster can forge that member's assertion and its address. Because
verification depends on every member, one dishonest gateway is enough to vouch falsely for its own
name, but it cannot make the other members list it back, so it cannot on its own create a link to
names it does not serve. This is an inherited property of CCIP-Read generally and not unique to
this record; implementers displaying a linked identity to end users should be aware that the trust
root for an offchain name is the gateway, not the chain.

**Resolution amplification.** A record listing many names makes a client perform many further
resolutions. Clients SHOULD cap the number of members they will resolve (see Verification
algorithm) and treat over-long lists as no link.

**A member can break a cluster.** Any member can change its record at any time, which takes the
whole cluster out of the linked state until repaired. This is fail-safe (no link is shown), but
clients should not treat a previously observed link as durable.

**This record makes no claim about which script is "correct" or "canonical."** It asserts mutual
identity between specific, already-registered names, nothing about the linguistic relationship
between the scripts themselves.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
