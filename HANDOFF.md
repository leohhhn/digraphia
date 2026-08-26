# Handoff — ETHBelgrade 2026 + Canton DevRel

**Written:** 2026-08-24 · **Working dir:** `/Users/sasurai/Desktop/hackathon-ethbg26` (not a git repo yet)
**Audience:** an agent picking up this work cold. Read top to bottom once; the Decisions and Open Questions sections are where you'll actually need to act.

---

## 1. The situation

The user has two goals landing on consecutive days:

| Day | Date | Goal |
|---|---|---|
| Wednesday | 2026-08-26 | **ETH Belgrade hackathon** — ~6h coding, judging after |
| Thursday | 2026-08-27 | **Canton Network DevRel** — in-person approach at the conference |

**ETH Belgrade 2026 runs 26–27 August at Sava Centar, Belgrade.** Hackathon is sponsored by **ENS** and **Superteam Balkans**. Exact bounty list was NOT known at time of writing — the user had not seen the sheet yet. This is the single biggest unknown in the whole plan.

Prep window: the evening of Mon 2026-08-24 plus all of Tue 2026-08-25.

### About the user
- Ethereum/EVM developer. Comfortable with the stack.
- Canton/Daml: **has read about it, never built anything.** Assume zero hands-on.
- Toolchain present: node v23.7.0, pnpm 10.33.2, bun 1.3.11. macOS (darwin 24.6.0).
- Working directory is empty apart from files this session produced.

---

## 2. Goal 1 — the hackathon

### 2.1 Chosen project: cross-script ENS identity linking ("digraphia")

**Premise.** Serbia is officially digraphic — Serbian is written in both Latin and Cyrillic with a clean 1:1 transliteration. So `nikola.eth` and `никола.eth` are the same human, but ENS has no concept that they're related. This gap is *created by the protocol's own correct design* (see 2.2), which is what makes it a real problem rather than a toy.

**Build.** A bidirectional cross-script link:
- Each name sets a text record pointing at its twin
- Verified both directions, plus both must resolve to the same address
- A `<LinkedIdentity>` component that renders the verified pair as one identity
- Stretch: an ENSIP-style writeup proposing a global `alt-script` record key

**Why it scores:** ENS bounties explicitly reward "novel applications of text records" and demand ENS be core rather than an afterthought. Belgrade's writing system is the technical premise, not decoration. It produces a spec proposal, which ENS judges reward disproportionately.

**Status: chosen but not locked.** See Open Questions.

### 2.2 Prior-art research — three ideas were investigated, two died

This research was already done. Do not redo it.

| Idea | Verdict | Why |
|---|---|---|
| **ENS homograph/spoofing guard** | ❌ **DEAD** | ENSIP-15's "wholes" algorithm already rejects whole-script confusables at normalization, and blocks mixed-script labels entirely. Pitching this to an ENS judge means pitching a fix for a problem their spec closed in 2023. Generic homoglyph tooling also exists (Bellingcat IDN Checker, UTS#39 confusables.txt). |
| **One-click `contenthash` → IPFS publishing** | ❌ **DEAD** | Shipped product: **Simple Page** (simplepage.eth) — markdown in browser, stage to IPFS, one contenthash signature, $12/yr. `omnipin` covers the CLI case. |
| **Ephemeral / expiring conference subnames** | ⚠️ **Weak fallback** | Subname expiry is a *native NameWrapper feature*, not an invention. Base already does event badges on basenames via EAS attestations. Reads as "assembled known parts." |

**The ENSIP-15 finding is what produced the digraphia idea** — it kills the spoofing angle but reveals the identity gap underneath. The two are easy to confuse; the surviving idea is about *linking legitimate twins*, NOT about *detecting attacks*. Do not let this drift back into a security pitch.

### 2.3 On-chain design (no new contracts required)

Two writes, symmetric:
```
setText(node("никола.eth"), KEY, "nikola.eth")
setText(node("nikola.eth"), KEY, "никола.eth")
```
Both names must also have `addr()` set to the same address.

Read-side verification:
1. Normalize both names (ENSIP-15) → namehash each; reject if identical
2. Read the text record on each via Universal Resolver
3. **Each must point at the other, compared by namehash — never by raw string** (string comparison is defeated by unnormalized/trailing-dot variants)
4. `addr()` on both must be equal and nonzero

Security property: one-directional records prove nothing. A squatter can point at you; the reverse assertion won't exist. No trusted issuer, no oracle, no registry contract.

**Text record key naming matters for credibility.** ENSIP-5 reserves bare lowercase keys (`avatar`, `url`, …) for spec-defined globals and requires custom keys to use reverse-dot namespacing with at least one dot (`com.github`, `org.telegram`). So ship under something like `rs.dvopis.alt` and *propose* the unprefixed global in the writeup.

**Key design constraint worth saying out loud in the demo:** ENSIP-15 cannot run on the EVM (needs Unicode tables, NFC, emoji sequences, confusables data). So a contract can never validate a name string — any on-chain verifier must take precomputed namehashes. This is why the natural home is a client library plus a resolver read path, not a registry contract.

Optional ~40-line stateless view contract if time remains:
```solidity
function isLinked(bytes32 a, bytes32 b) external view returns (bool);
// nodes assumed pre-normalized off-chain
```

### 2.4 Tonight's scaffold (2.5h hard stop) — NOT YET BUILT

This was the immediate next action when the session ended. Deliverable: a **deployed** repo.

- [ ] Next.js + wagmi + viem + wallet connect (RainbowKit or ConnectKit)
- [ ] Deployed to Vercel with a live URL
- [ ] ENS reads working through the Universal Resolver: forward resolution, primary name, avatar, `getEnsText`
- [ ] `@adraffy/ens-normalize` wired in
- [ ] Serbian Latin↔Cyrillic transliteration map (~30 chars, **must include digraphs `nj/њ`, `lj/љ`, `dž/џ`**, plus `ć/ћ`, `đ/ђ`, `ž/ж`, `š/ш`, `č/ч`)
- [ ] `verifyLink()` implemented with tests against real names
- [ ] Batch resolution via multicall / Universal Resolver so checking many candidates is one round-trip
- [ ] Env: real RPC provider key (Alchemy/Infura — **not** public RPC), WalletConnect project ID
- [ ] **Own both test names on mainnet and pre-fund the demo wallet.** Mainnet `setText` on conference Wi-Fi is Wednesday's biggest risk and this is when it gets removed.

### 2.5 Wednesday schedule (6h)

| Time | Focus |
|---|---|
| 0:00–0:30 | Read every bounty doc. Pick **one**. Write its judging criteria down. Do not multi-bounty. |
| 0:30–1:00 | Scope to one demo-able flow. **Write the demo script first** — it defines what gets built. |
| 1:00–3:30 | Core loop only. Hardcode everything off the demo path. |
| 3:30–4:00 | **Deploy checkpoint — non-negotiable.** Live URL end-to-end however ugly. If not deployed, cut features until it is. |
| 4:00–5:00 | Polish only the screens in the demo script. Real names/avatars, no `0x1234…` placeholders. |
| 5:00–5:30 | Freeze code. Record 60–90s backup video. |
| 5:30–6:00 | README, submission form, rehearse pitch twice out loud. |

Judging: live demo beats slides, backup video beats a failed live demo — have both. Lead with the problem in one sentence, working thing on screen within 20 seconds. Explicitly name the bounty and map the build to its stated criteria.

### 2.6 Hour-0 strategic note

ENS bounty sheets often carry a low-glamour **open-source library contribution** prize (e.g. adding ENSIP-10 / CCIP-Read support to `web3.py`, `go-ens`, `web3.js` — $1k at ETHGlobal London 2024). It's frequently uncontested because it isn't demoable. **If the sheet has one, it may be the highest expected-value 6 hours on the board.** Check for it first.

---

## 3. Goal 2 — Canton Network DevRel

### 3.1 What Canton is
Digital Asset's privacy-focused network for institutional finance. Smart contracts in **Daml**, a purpose-built language for financial workflows where contracts declare upfront which parties can see data and which may act. Coordination via the **Global Synchronizer**, operated by regulated "Super Validators." Essentially zero technical overlap with Ethereum/ENS.

**Momentum:** Digital Asset raised **$355M led by a16z crypto in June 2026**, explicitly for ecosystem expansion and developer adoption. They are spending on this problem right now.

### 3.2 The key finding — what they actually hire for

The closest open role (Senior Developer Relations, Canton @ OpenZeppelin — **now closed to applications**, but diagnostic of what the ecosystem values) lists:

- **Required:** "Solidity/EVM fluency to help Ethereum developers transition to Daml-based models"
- **Required:** 3–5+ yrs DevRel, 1–3+ yrs blockchain, track record of technical content, workshops/live coding at events
- **Nice-to-have only:** hands-on Daml/Canton experience, functional programming background, privacy/UTXO architecture

**They are not looking for a Daml expert. They are looking for someone who can walk Ethereum developers across the bridge.** The user is the target persona and is crossing that bridge this week.

### 3.3 The strategy

Thursday's pitch is **not** "I know Canton." It is:

> "I'm an Ethereum dev. I spent Tuesday going from zero to a running LocalNet and wrote down every place I got stuck. Want it?"

A **friction log from a genuine newcomer** is the highest-value object you can hand a DevRel person — they can never generate it themselves because they can't un-know the product. That one sentence establishes the persona they hire for, proves shipping, and offers free labor. Nobody declines it.

**Do not ask for a job at the conference.** Open with a question about their work, then offer the log.

### 3.4 Tuesday afternoon — the hands-on block (4h)

Clone `digital-asset/cn-quickstart` — full-stack example (Daml contracts, Java backend, React frontend, Docker Compose LocalNet with super validator / app provider / app user, Canton Coin, wallet services).
```
make setup && make build && make start
```

> **TIMEBOX: 2 hours.** LocalNet requires Docker Desktop with **≥8GB** allocated and will fight back. If it isn't up by hour two, **abort to the plain Daml SDK sandbox** (no Docker) and write a Daml template there instead. **Either outcome is a win** — the failure path is better content than the success path.

Log continuously: every error message, every doc page that assumed missing knowledge, every place Solidity instincts were wrong.

**The content centrepiece:** Daml's authorization model. Contracts declare upfront who can see data and who may act, versus Solidity's "everything is public, guard it with modifiers." That inversion is where every EVM dev's mental model breaks. Anything written should be built around it.

### 3.5 Tuesday evening — the artifact (90 min, LOAD-BEARING)

**"An Ethereum developer's first five hours on Canton."** A field report, not a tutorial: where the mental model breaks, what the docs assume, what you'd change.

Publish as an Artifact matching the quality of the ENS Field Manual (see §5) — that page is the proof the user can do this kind of work.

**This 90-minute block is the most protected item in the entire plan.** Without it, Thursday has a story instead of an artifact, which is much weaker.

### 3.6 Tuesday, 15 min — verify the target exists

**Canton / Digital Asset are NOT on ETH Belgrade's visible sponsor list.** Confirmed sponsors found: Ambire, LI.FI, Chainlink Labs. The user believes the Canton conversation happens in person at the conference, but this was not independently verified.

**Action: confirm specific Canton/Digital Asset people are actually attending** — speaker list, LinkedIn, X, the official site. Walking in hoping to bump into "someone from Canton" is not a plan. If nobody is confirmed attending, the Thursday plan needs rethinking (pivot to remote outreach with the same artifact).

### 3.7 Thursday

- Conversation opener as in §3.3
- Hackathon project = ships-things evidence; ENS Field Manual = can-explain-hard-things evidence. Both links ready on phone.
- **Send the follow-up the same day** while they remember the face, with **one specific offer** — a workshop, a written guide, a docs contribution. Vague enthusiasm dies in an inbox; a concrete proposal gets forwarded.

---

## 4. ENS technical reference (verified this session)

Condensed. The full version with diagrams is the ENS Field Manual (§5).

### The one rule
**Whoever controls a node controls resolution for everything beneath it, recursively.** Subnames, L2 names, offchain names, DNS imports are all this one rule at different depths. `.eth` is not special — it's the most valuable instance of the general mechanism.

### Three layers
- **Registrar** — who may acquire a name, at what price. Not a protocol role; just a contract that owns a node and has opinions about subnodes.
- **Registry** — `mapping(bytes32 => {owner, resolver, ttl})` keyed by namehash. Stores nothing else.
- **Resolver** — what the name says (`addr`, `text`, `contenthash`). Pluggable.

`eth` is an ordinary registry entry owned by the BaseRegistrar contract. Root is owned by the Root contract (ENS DAO). In 2019 `.eth` policy changed by transferring the `eth` node from the auction registrar to today's permanent registrar.

### Hashes
- `labelhash = keccak256(normalized_label)` → the **ERC-721 tokenId**
- `namehash` = recursive keccak → the **registry/resolver key**
- **These are not interchangeable.** Mixing them is the classic integration bug.
- The readable string is never stored in contract state. It survives only in registration calldata and in `ETHRegistrarController.NameRegistered(string name, …)`. The BaseRegistrar's same-named event emits only tokenId. Hence the Subgraph / `ens-indexer`.
- Exception: reverse records DO store a string (`name(bytes32) → string`) — you can't invert a hash to display a name.

### Two owners
NFT owner (BaseRegistrar) holds the property right; registry owner controls resolution. NFT owner can always `reclaim()`. Selling the NFT transfers the right regardless of who the registry lists.

### Lifecycle
Registered → Expired (instant, records freeze) → **Grace 90 days** (still resolves, NFT still in wallet, only you can renew) → **Temporary premium 21 days** (anyone may register, no owner priority) → Available.

Premium starts at **$100,000,000**, halves every 24h, reaches ~$0 at day 21. It's an anti-sniping device, not a valuation — under $1,000 by day 7. ENSv2 shortens grace to **28 days**.

Pricing: 3 chars $640/yr · 4 chars $160/yr · 5+ chars $5/yr.

### Resolution
Modern clients call the **Universal Resolver** `resolve(bytes name, bytes data)` — walks the registry, finds the resolver, handles CCIP-Read transparently. Offchain resolvers revert with `OffchainLookup` (ENSIP-10 + EIP-3668); client queries the gateway and verifies the signed response. **Resolution always starts on mainnet** regardless of target chain.

Reverse: `<lowercase-hex-addr>.addr.reverse`, read with `name(bytes32)`. **Unauthenticated claim** — must forward-verify (reverse → name → `addr()` → equals original address) before display.

### Etherscan vs MetaMask
- **Etherscan** = off-chain index built from event logs. Push-based, cached, can be stale, misses offchain names entirely.
- **MetaMask** = live `eth_call` through the Universal Resolver. Pull-based, authoritative, dies quietly when the mainnet RPC does.
- **Implication for the build:** verification logic must be live reads, not indexed data. A squatter could set a record 30 seconds before the demo.

### ENSv2 (status as of 2026-08-24)
- **Namechain was cancelled in February 2026.** ENSv2 deploys directly to mainnet. Cited reason: registration gas down ~99%, gas limit 30M→60M in 2025, 200M target 2026. **Much material online still assumes Namechain is happening — it is not.**
- **Hierarchical registries** replace the flat registry: `sub.alice.eth` is a chain of entries linked by subregistry pointers; any owner can deploy their own subname registry with custom rules. Replaces v1's flat-registry-plus-NameWrapper.
- **Per-account permissioned resolvers** with per-record permissions. **Resolver interface unchanged**; custom resolvers still supported.
- **Universal Resolver V2** walks the hierarchy and orchestrates CCIP-Read.
- Grace 90→28 days, one-step registration, stablecoin payments.
- **Readiness for apps is mostly a library bump:** viem ≥ 2.35.0, ethers ≥ 6.17.0, ENSjs ≥ 4.2.3.
- Status: contracts documented, new App and Explorer in **public alpha**, targeted for release during 2026, production traffic still largely v1. **Re-verify before building against it.**

### Integration gotchas
1. Normalize before hashing — security control, not formatting
2. Compare namehashes, never raw strings
3. Stop gating on `.endsWith(".eth")` — breaks DNS-imported names
4. Keep a mainnet client even in an L2-only app
5. Specify `coinType` for multichain addresses
6. Forward-verify every reverse lookup
7. Read live, not from an indexer, wherever the answer is security-relevant
8. Use a real RPC provider — public RPCs fail exactly when a room is demoing at once

### Mainnet addresses (verified against ENS deployments doc)
| Contract | Address |
|---|---|
| Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| Base Registrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` |
| ETH Registrar Controller | `0x59E16fcCd424Cc24e280Be16E11Bcd56fb0CE547` |
| Public Resolver | `0xF29100983E058B709F3D539b0c765937B804AC15` |
| Reverse Registrar (L1) | `0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb` |
| Name Wrapper | `0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401` |
| Universal Resolver | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| namehash("eth") | `0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae` |

Controller / resolver / UR addresses are versioned and do change — confirm before hardcoding.

---

## 5. Artifacts produced this session

| File | What | Where |
|---|---|---|
| `ens-field-manual.html` | **ENS Field Manual** — full architecture + lifecycle reference, 7 hand-drawn theme-aware SVG diagrams | Published: https://claude.ai/code/artifact/669c047a-24fb-4f35-9c3d-70633036fdcb |
| `HANDOFF.md` | This file | local |

The Field Manual doubles as a **DevRel writing sample** for the Canton conversation. To update it: republish the same file path, or pass the URL as `url` from another conversation.

Design system used (reuse it for the Canton artifact so the two read as one body of work): IBM Plex Sans Condensed / Sans / Mono; cool blue-biased neutrals with a cobalt accent (`#1D3FBF` light / `#89A6FF` dark); semantic lifecycle colors kept separate from the accent; hand-authored inline SVG using `currentColor` so diagrams theme correctly.

---

## 6. Decisions log

| Decision | Rationale |
|---|---|
| Digraphia linking over the other two ideas | Only survivor of prior-art research; strengthened rather than killed by the ENSIP-15 finding; Belgrade context is the technical premise, not decoration |
| Frame as **identity linking**, never as spoofing defense | ENSIP-15 already blocks confusables; pitching it as security means pitching a solved problem to the people who solved it |
| No new contracts for the hackathon build | Two `setText` calls + client-side verification is shippable in 6h and is v2-proof (resolver interface unchanged) |
| Namespaced text key + *propose* the global | ENSIP-5 reserves bare keys; getting this right signals spec literacy |
| Canton artifact written **Tuesday**, not Wednesday night | Wednesday is 6h hackathon + judging; nothing good gets written after that. Buffer built in. |
| Canton pitch = friction log, not Daml competence | Two days cannot produce a credible Daml dev; the open role wants EVM→Daml bridging, which the user embodies right now |
| Hackathon idea stays unlocked until hour 0 | Bounty sheet unseen; sponsors fund what they wrote down |

---

## 7. Open questions / risks

1. **Bounty sheet unseen.** Everything about the hackathon project is provisional. At hour 0, read the sheet and re-decide. If ENS explicitly names subnames/Durin, the ephemeral-subnames fallback jumps ahead. If there's a library-contribution bounty, seriously consider it (§2.6).
2. **Canton attendance unverified** (§3.6). Highest-severity unknown on the Thursday side.
3. **Tuesday is carrying both jobs.** If LocalNet eats the afternoon and the write-up is skipped, Thursday is materially weaker. **The 2-hour Docker timebox is the load-bearing rule in this plan.**
4. **Mainnet writes on conference Wi-Fi** are Wednesday's biggest technical risk. Mitigated only if test names are owned and the wallet is pre-funded tonight.
5. **ENSv2 deployment state is a dated snapshot.** Re-verify rather than trusting §4.
6. Whether a possible Solana track exists (Superteam is Solana-native). Not investigated. `create-solana-dapp` cached as insurance was suggested but is low priority — bet on ENS.

---

## 8. Immediate next action

**Build the scaffold in §2.4.** It was offered and not yet started when this session ended. 2.5h hard stop, then the user sleeps.

Then Tuesday per §3.4–3.6.

---

## 9. Sources

ENS: [protocol docs](https://docs.ens.domains/learn/protocol/) · [ENSv2 contracts](https://docs.ens.domains/contracts/ensv2/overview/) · [ENSv2 readiness](https://docs.ens.domains/web/ensv2-readiness) · [ENSIP-5 text records](https://docs.ens.domains/ensip/5/) · [ENSIP-15 normalization](https://docs.ens.domains/ensip/15/) · [CCIP-Read](https://docs.ens.domains/learn/ccip-read/) · [deployments](https://docs.ens.domains/learn/deployments) · [.eth lifecycle](https://support.ens.domains/en/articles/8046877-eth-name-lifecycle) · [temporary premium](https://support.ens.domains/en/articles/7900612-temporary-premium) · [Namechain cancelled](https://www.theblock.co/post/388932/ens-labs-scraps-namechain-l2-shifts-ensv2-fully-ethereum-mainnet) · [Simple Page](https://simplepage.eth.link/) · [ENS bounty structure example](https://ethglobal.com/events/london2024/prizes/ens)

Canton: [cn-quickstart](https://github.com/digital-asset/cn-quickstart) · [quickstart install](https://docs.digitalasset.com/build/3.3/quickstart/download/cnqs-installation.html) · [Global Synchronizer](https://docs.canton.network/overview/understand/global-synchronizer) · [developer resources](https://www.canton.network/developer-resources) · [OpenZeppelin Canton DevRel role](https://jobs.dcg.co/companies/openzeppelin-2/jobs/81759959-senior-developer-relations-canton) · [$355M raise](https://www.coindesk.com/business/2026/06/11/canton-network-developer-raises-usd355-million-to-bring-wall-street-onchain)

Event: [ETH Belgrade](https://ethbelgrade.rs/)
