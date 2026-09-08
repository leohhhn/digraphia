# Handoff — digraphia, post-ETHBelgrade

**Written:** 2026-09-07 · **Audience:** an agent picking this up cold, or a human deciding what to do next.
**Read this, then [NOTES.md](./NOTES.md) for the full technical argument, then the ENSIP draft in [`proposal/`](./proposal/).**

---

## 1. Where this came from

Built at ETH Belgrade 2026 (26–27 Aug), an ENS-sponsored hackathon. The premise: Serbian is
officially written in both Cyrillic and Latin, so `никола.eth` and `nikola.eth` are the same
person but ENS has no way to express that — a gap *created by*, not overlooked by, ENSIP-15's
correct rejection of mixed-script labels. Full research trail (dead ends, prior art, the
Cyrillic→Latin-is-total/Latin→Cyrillic-is-not finding) is in [NOTES.md](./NOTES.md) §1–2.

**Since the hackathon: ENS has expressed interest in the idea.** This document is the pivot from
"hackathon demo" to "thing we might actually propose to ENS Labs/Foundation."

## 2. What's been built (verify against code before trusting this list)

| Piece | State |
|---|---|
| `packages/digraphia` — transliteration (`translit.ts`), candidate enumeration (`link.ts`), six-check verifier (`verify.ts`) | Done, 37 tests passing |
| `apps/web` — single-page UI: enter a name, enumerate twins, verify live, write both `setText` assertions via injected wallet | Done, deployed at digraphia-web.vercel.app |
| Demo pair on **Sepolia**, `ђорђе.eth` ↔ `djordje.eth`, mutually asserted, `linked: true` | Done — see `pnpm verify` |
| `README.md` / `NOTES.md` — user-facing docs + full design rationale, 7 mermaid diagrams | Done |
| ENSIP submission | **Not started until this session.** §5 of NOTES.md was one paragraph, not a real proposal. See §5 below and `proposal/` |
| Mainnet deployment | **Not done.** Everything verified is Sepolia only; `никола.eth`/`nikola.eth` on mainnet are real, already-squatted, unrelated names used only as the "this fails, correctly" example |

The protocol itself: two `setText` calls (`digraphia.alt-script` → twin name), each direction
required, plus matching `addr()`. No new contract. Full spec in NOTES.md §3.

## 3. What was vague or weak about how we did this — be honest with the next agent

1. **`HANDOFF.md` was deleted on 2026-08-27** (commit `4e63b26`) and NOTES.md kept linking to it
   as if it still existed. That's this file's reason for existing again — don't let it happen
   twice; it's the connective tissue for anyone picking this up between sessions.

2. **The name "digraphia" is narrower than the claim.** README/NOTES explicitly generalize the
   protocol to Han Traditional/Simplified, Japanese kanji/kana, Punjabi Gurmukhi/Shahmukhi,
   Hindi/Urdu — none of which is "digraphia" in the linguistic sense that term actually names
   (two scripts for *one* language). Branding and scope drifted apart and were never reconciled.
   Worth a real decision, not just a footnote, before this goes in front of ENS.

3. **Only pairwise (2-way) links.** The convention supports exactly one twin per name. It has no
   answer for a script cluster of 3+ forms that legitimately belong to one identity — Traditional
   Han / Simplified Han / Pinyin, or Japanese kanji / hiragana / katakana / rōmaji. This is the
   single biggest limitation and the most obvious thing ENS will ask about. See §4.

4. **No deployment or adoption story beyond one demo pair.** There is no reference resolver UI
   outside this app, no wallet integration, no indexer, nothing that makes a rational holder
   discover or trust the record without visiting this specific page. "Ship the convention and
   hope clients adopt it" is not a plan, it's a hope. An ENSIP needs at least a sketch of who the
   first real adopters are.

5. **The ASCII-fallback ambiguity is only described, not resolved.** §2.4/§1.4 of NOTES.md show
   that `đ` isn't a legal ENS character, forcing `dj`, which is *itself* ambiguous on the reverse
   read. The library surfaces this (`canonicalLatinRegistrable`) but the UX answer — what should a
   wallet actually suggest as the default fallback — was left as "ask the user." That's honest but
   incomplete; it's a real product question ENS Labs will have opinions about.

6. **Threat model stops at "a squatter can't forge the counter-assertion."** True, but untested:
   what a malicious or buggy CCIP-Read gateway can return for an off-chain/L2 name. `verifyLink()`
   trusts whatever the Universal Resolver hands back, which for an offchain name is whatever a
   gateway operator signs. Nothing in NOTES.md's Security Considerations (there isn't a formal
   one) addresses this, and an ENSIP needs one.

7. **No gas/incentive discussion.** Two `setText` calls cost real gas on L1 with no protocol-level
   reward for doing it — the entire value only exists once clients actually render the linked
   identity, which doesn't exist yet. Chicken-and-egg, unaddressed.

8. **§6 of NOTES.md ("Proposed ENSIP")** is four sentences, not a document that matches the real
   ENSIP template (frontmatter, Abstract/Motivation/Specification/Rationale/Backwards
   Compatibility/Security Considerations/Copyright, per `ensdomains/ensips` — confirmed by reading
   the actual repo, not assumed). That gap is what `proposal/` now fixes a first draft of.

## 4. Given ENS is interested — alternative ways to execute this

The scalar text record (§3.2 of NOTES.md) is deliberately the smallest possible version: zero new
infra, works with every PublicResolver already deployed, ships as a client convention today. That
was correct for a 6-hour hackathon build. It is not necessarily the right long-term shape once a
real spec is on the table. Three escalating options, in the order I'd present them to ENS:

**Option A — ship what exists, formalize the key.** Keep `alt-script` as a scalar text record
(one name ↔ one twin), just standardize it via ENSIP so wallets/clients have a spec to code
against instead of a convention buried in a hackathon README. Lowest lift, addresses none of
weakness #3 above.

**Option B — array-valued record for N-way clusters.** Instead of a single name string, the value
is a JSON array of every name in the identity cluster: `["nikola.eth", "никола.eth"]`, or for a
3-way case, all three. Verification generalizes cleanly: for every pair (X, Y) that both claim
membership in the same cluster, X's array must contain Y **and** Y's array must contain X (mutual
closure over the declared set), plus all names in the set resolve to the same address. This is a
direct answer to weakness #3 — it's still "just a text record," so it inherits Option A's
zero-new-infra property, but the value is now structured. Tradeoff: JSON-in-a-text-record has no
existing ENS precedent (ENSIP-5 text records are conventionally scalar strings), so this needs its
own parsing convention specified carefully, and verification cost grows O(n²) in cluster size.

**Option C — a dedicated resolver profile.** Define a new resolver interface, alongside `addr()`
and `text()` — e.g. `variants(bytes32 node) view returns (bytes32[])` — returning namehashes
directly rather than strings to parse. This is the ENSIP-9/ENSIP-7-style path (new profile, not a
repurposed generic one): gas-cheaper reads, no string parsing, and namehash-native so the
"compare by hash not string" rule (NOTES.md §3.5) is enforced by the type system instead of by
convention. Cost: every resolver implementation needs to add support before this is usable, which
is a much higher adoption bar than a text record any existing PublicResolver already handles.
Realistically only worth proposing once Option A/B usage justifies it.

**Recommendation to lead with:** Option A as the ENSIP that ships now (small, reviewable, matches
what's already built and demoed), with Option B named explicitly in "Backwards Compatibility /
Future Extensions" as the intended next step once real usage shows up. Don't propose Option C yet
— no evidence of demand, and it's the kind of ask that stalls a first ENSIP in review.

**Registry-level alternative, analyzed separately.** The three options above all live at the
resolver layer (`text()` records, scalar or structured). A fourth path — an on-chain contract that
sits beside the ENS registry tree instead of inside a text record, enforcing N-way mutual links and
authorization synchronously against ENSv2's actual `PermissionedRegistry` — is analyzed in
[`proposal/ensv2-engineering-options.md`](./proposal/ensv2-engineering-options.md), grounded in the
real ENSv2 contracts (`ensdomains/contracts-v2`, deployed to Sepolia beta as of this writing). It's
a bigger engineering lift than anything above, but every piece of it answers a specific weakness
named in §3, rather than being scope added for its own sake — worth reading before deciding how
ambitious the next milestone should be.

## 5. Proposal prep — what's ready and what's still needed

Confirmed by reading the actual `ensdomains/ensips` repo (not assumed):

- Submission = a PR against `github.com/ensdomains/ensips`, new file `ensips/x.md` using their
  template; a number is assigned by maintainers on merge, not chosen up front.
- Required frontmatter: `description`, `contributors` (ENS name or GitHub handle), `ensip.created`
  (YYYY-MM-DD), `ensip.status: draft`.
- Required sections: Abstract, Motivation, Specification, Rationale, Copyright (CC0 waiver, exact
  wording matters — copy it from an existing ENSIP, don't paraphrase).
- Optional but expected in practice: Backwards Compatibility, Security Considerations — both are
  present in essentially every real ENSIP and their absence from our current draft would stand
  out.
- Also relevant: **ENS DAO Small Grants** at ensgrants.xyz, ecosystem-round funding
  (0.7–5 ETH per round historically) for projects that build on/improve the ENS ecosystem — a
  parallel, non-blocking track to the ENSIP itself; worth applying once the ENSIP PR is open,
  since "PR under review" is exactly the kind of evidence a grant reviewer wants to see.

A first-draft ENSIP matching the real template now lives at
[`proposal/ensip-draft-alt-script.md`](./proposal/ensip-draft-alt-script.md). It captures Option A
from §4, references this repo's implementation as the reference client, and has a Security
Considerations section that names weakness #6 above honestly instead of omitting it.

**Still needed before this is submission-ready — the actual next steps:**

1. Decide the branding question (weakness #2) — does the ENSIP call itself `alt-script` (already
   language-neutral, already the proposed key) independent of what the repo/library is named. The
   record key can stay `alt-script` regardless of what happens to "digraphia" as a project name.
2. Fill in `contributors:` with a real ENS name or GitHub handle.
3. Get at least one second reader on the Security Considerations section — the CCIP-Read gateway
   trust issue (weakness #6) is the kind of thing an ENS Labs reviewer will find in five minutes if
   we don't address it first.
4. Decide whether to open the PR before or after Option B is fleshed out. Leaning: open with
   Option A now, since a smaller first ENSIP is more likely to get reviewed, and file Option B as
   a follow-up once Option A has any real feedback.
5. Register `alt-script` isn't already claimed as a bare key by another ENSIP — check the current
   `ensdomains/ensips` README index for key collisions before submitting.

## 6. Immediate next action for whoever picks this up

Read `proposal/ensip-draft-alt-script.md`, fill in the two `[ ]` placeholders (contributors,
mainnet reference pair if one gets registered), and open the PR against `ensdomains/ensips`. In
parallel, decide the Option A vs. B framing (§4) — that's a judgment call, not something to leave
open indefinitely, because it changes what the Specification section says.
