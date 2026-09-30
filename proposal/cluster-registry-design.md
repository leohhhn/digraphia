# Cluster registry design (non-normative)

> **Status:** design sketch, not part of any proposed ENSIP. It was originally Appendix A of
> [`ensip-draft-alt-script.md`](./ensip-draft-alt-script.md) and was moved here so the ENSIP stays
> small and reviewable on its own. The ENSIP defines a list-valued text record that already
> supports N-way clusters; this document describes an optional registry-based alternative for
> large or frequently changing clusters, built on the ENSv2 registry model (Sepolia beta at the
> time of writing, so details may change).
>
> Reference sketch: [`contracts/ClusterController.sol`](./contracts/ClusterController.sol) —
> untested against the current `contracts-v2` beta. Fuller design-space comparison:
> [`ensv2-engineering-options.md`](./ensv2-engineering-options.md).

## 1. Why a registry, not a bigger text record

The ENSIP's list-valued text record already supports clusters of any size, so this design is not
needed for correctness. It addresses cost: with a text record, adding or removing a member means
updating every member's record (O(n) writes), every read is an O(n) live check with an O(n²)
pairwise comparison in the worst case, and a member whose list has silently gone stale breaks the
whole cluster with nothing on-chain to signal it. A structure purpose-built for group membership
avoids all three. ENSv2's registry tree already _is_
that structure: every registry is a singleton-ownership token collection (`ERC1155Singleton` —
exactly one owner per token ID) with membership changes indexable for free via
`LabelRegistered`/`TransferSingle`/`LabelUnregistered` events, which is a guarantee the text-record
form cannot make (the ENSIP's Security Considerations require live reads, not indexed data,
precisely because `text()` values fall outside ENSv2's offchain-indexing invariant). A cluster is
therefore represented as one small `PermissionedRegistry` subclass — `ClusterController` — where
each member holds one token in it.

## 2. System design

```mermaid
flowchart TD
    Root["Root Registry"] --> EthReg[".eth Registry"]
    Root --> ClustersReg["clusters.eth Registry\n(or any parent name)"]
    ClustersReg -->|getSubregistry label| CC["ClusterController instance\n(one per cluster)"]

    CC -->|singleton token, label 'nikola-cyr'| M1["никола.eth\n(member)"]
    CC -->|singleton token, label 'nikola-lat'| M2["nikola.eth\n(member)"]
    CC -.->|public register#40;#41; entrypoint| Blocked["✗ DirectRegistrationDisabled\n(always reverts)"]

    M1 -. controller proven via .-> UR["UniversalResolverV2.findOwner#40;#41;"]
    M2 -. controller proven via .-> UR

    classDef blocked fill:#f8d7da,stroke:#c0392b,color:#611
    class Blocked blocked
```

Membership is not a new storage shape — it's an ordinary ENSv2 registry token, addressable the same
way any subname is (`<clusterId>.clusters.eth`), enumerable with the same tooling, and reusing the
`Entry` struct and `ERC1155Singleton` machinery `PermissionedRegistry` already provides.

## 3. User flow: invite → accept (the bidirectional join)

The ENSIP's security property — one-sided assertion proves nothing, only mutual assertion
does — is preserved by requiring two independent, live-checked calls: an existing member vouches
for a candidate, and the candidate separately proves control of their own name.

```mermaid
sequenceDiagram
    participant EM as Existing member<br/>(никола.eth controller)
    participant CC as ClusterController
    participant UR as UniversalResolverV2
    participant NC as Candidate<br/>(nikola.eth controller)

    Note over EM,CC: Side 1 — an existing member vouches
    EM->>CC: invite(label, candidateName)
    CC->>CC: require isMember[EM]
    CC->>CC: store keccak256(candidateName) + expiresAt
    CC-->>EM: MemberInvited

    Note over NC,UR: Side 2 — candidate proves control, live
    NC->>CC: accept(label, name)
    CC->>CC: keccak256(name) == pending.nameKey?
    CC->>UR: findOwner(name)
    UR-->>CC: current owner
    CC->>CC: owner == msg.sender (NC)?
    CC->>CC: _admitMember → mint singleton token
    CC-->>NC: MemberJoined
```

Both checks are live at the moment they run — `accept()` never trusts an address `invite()`
supplied earlier, so a name that changes hands between the two calls is judged by its _current_
controller, not a stale snapshot (see `ensv2-engineering-options.md` §1's `resource`-not-`tokenId`
anchoring lesson, applied here to ownership rather than to registry state).

## 4. Permissions

| Actor                       | Action                            | Gate                                                                                                       |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Founding member             | deploy + auto-join                | constructor requires `findOwner(founderName) == msg.sender`                                                |
| Existing member             | `invite(label, candidateName)`    | `isMember[msg.sender]`                                                                                     |
| Any name controller         | `accept(label, name)`             | invite exists for `label`, not expired, `keccak256(name)` matches, **and** `findOwner(name) == msg.sender` |
| Member (own token only)     | `leave(anyId)`                    | inherited `ROLE_UNREGISTER`, granted _only_ to that member's own token at `accept()` time                  |
| `admin` (constructor param) | `setURI(...)` (inherited)         | `ROLE_SET_URI` — cosmetic/metadata only, no membership authority                                           |
| Anyone                      | `register(...)` (base entrypoint) | always reverts — the only mint path is `invite`+`accept`                                                   |

```mermaid
flowchart LR
    Stranger(["Stranger"]) -->|invite#40;#41;| Blocked1["✗ not a member"]
    Stranger -->|register#40;#41; directly| Blocked2["✗ DirectRegistrationDisabled"]
    Stranger -->|accept#40;#41; for a name they control| Accept["accept#40;#41; → join"]

    Member(["Existing member"]) -->|invite#40;#41;| Invite["invite#40;#41; → pending invite"]
    Member -->|leave#40;#41; own token| Leave["leave#40;#41; → unregister"]

    Admin(["admin"]) -->|setURI#40;#41;| URI["setURI#40;#41;"]

    classDef blocked fill:#f8d7da,stroke:#c0392b,color:#611
    classDef ok fill:#d4edda,stroke:#1e7e34,color:#144
    class Blocked1,Blocked2 blocked
    class Accept,Invite,Leave,URI ok
```

## 5. Deliberately unresolved (see contract header for full rationale)

- No multi-member removal ("vote to kick") — only self-service `leave()` exists today.
- No enforcement that a name belongs to at most one cluster.
- No on-chain check that members are actually script-variants of one another — that judgment stays
  off-chain, e.g. via `packages/digraphia/src/verify.ts`, same as the text-record form in the ENSIP.

