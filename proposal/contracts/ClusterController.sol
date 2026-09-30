// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

// Intended location once upstreamed: ensdomains/contracts-v2, contracts/src/registry/ClusterController.sol
// (sibling to PermissionedRegistry.sol / UserRegistry.sol — same package, same import style).
//
// Verified against ensdomains/contracts-v2 @ main, read 2026-09-21:
//   - PermissionedRegistry.sol   (Entry struct, register/_register, ERC1155Singleton base)
//   - IStandardRegistry.sol      (register/unregister/getExpiry signatures)
//   - IPermissionedRegistry.sol  (getOwner/getResource/getState)
//   - RegistryRolesLib.sol       (role bitmap constants)
//   - EnhancedAccessControl.sol  (ROOT_RESOURCE, hasRoles, per-resource role scoping)
//   - IUniversalResolverV2.sol   (findOwner)
//
// NOT verified in this clone (flagged rather than guessed): the exact import path for ENS's
// namehash utility (`NameCoder` or similar, likely from @ensdomains/ens-contracts). This contract
// is deliberately written to need no such import — see "Why keccak256(name), not namehash" below.

import {ILabelStore} from "../utils/interfaces/ILabelStore.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";
import {IUniversalResolverV2} from "../universalResolver/interfaces/IUniversalResolverV2.sol";
import {RegistryRolesLib} from "./libraries/RegistryRolesLib.sol";
import {PermissionedRegistry} from "./PermissionedRegistry.sol";

/// @title ClusterController
///
/// @notice A `PermissionedRegistry` whose tokens represent membership in one n-way cross-script /
///         cross-identity cluster (the generalisation of the pairwise `alt-script` ENSIP to N
///         names — see `../ensip-draft-alt-script.md` §"Why not an N-way (cluster) record" and
///         `../ensv2-engineering-options.md` Option B). One instance of this contract = one
///         cluster, deployed the same way `UserRegistry` is deployed per-user (minimal proxy via
///         `VerifiableFactory`; see design doc §4.5.10 "Proxy Factory Contracts").
///
/// ## Why a registry, not a resolver record or a standalone array-storage contract
///
/// A name's membership in this cluster is exactly what a token in a `PermissionedRegistry`
/// already means: a singleton (`ERC1155Singleton` — see that file's header — exactly one owner
/// per token ID, transfers of value > 1 revert) claim over one slot. Reusing that primitive gets
/// three things for free that a bespoke `mapping(node => bytes32[])` (the array-record design
/// this project considered and rejected) would not:
///
///   1. Membership changes are ordinary `LabelRegistered` / `TransferSingle` / `LabelUnregistered`
///      events — reconstructable by any indexer that already watches every other ENSv2 registry,
///      satisfying the design doc's §1.2 "Offchain Indexing" invariant. The current `alt-script`
///      ENSIP cannot make this claim: its own Security Considerations require *live* reads because
///      `text()` values are not part of that guarantee.
///   2. Enumeration ("who is in this cluster") is the same tooling ENS already ships for listing
///      subnames of any registry — no bespoke array reads.
///   3. It needs zero protocol changes: `Entry{eacVersionId, tokenVersionId, subregistry, expiry,
///      resolver}` (PermissionedRegistry.sol) is untouched. Nothing is added to the `__gap`
///      reserved for ENS Labs (Option D in `ensv2-engineering-options.md` is correctly declined
///      for exactly that field; this contract does not touch it).
///
/// ## The problem this contract exists to solve: bidirectional proof for N parties, not 2
///
/// The pairwise ENSIP's security rests on mutual assertion: `A` alone pointing at `B` proves
/// nothing, because anyone can point a record at a name they don't control; only `A ⟷ B` (both
/// sides asserting, each requiring control of their own name) proves common control. A naive
/// N-way generalisation — "anyone who owns a name can call `register()` and add themselves to any
/// cluster" — drops that property. It proves the joiner controls *their own* name (the base
/// registry's role checks already guarantee that), but not that the cluster's *existing* members
/// consented to the addition. Without that second check, a stranger can self-register into
/// `nikola`'s identity cluster to falsely appear linked to them.
///
/// The fix generalises "A asserts B AND B asserts A" to "an existing member asserts the candidate
/// belongs AND the candidate, acting through their own live-checked name ownership, asserts they
/// accept" — a two-transaction invite/accept handshake, not a single-sided `register()` call. This
/// mirrors the controller-in-front-of-a-locked-registry split the design doc already uses for
/// `.eth` (§4.5.2/§4.5.3: "This allows the core registry contract to be locked, while still
/// providing for upgradeability... over registration logic"): here, the "lock" is that the public
/// `register()` entrypoint is disabled entirely, and the only path to mint a membership token is
/// through this contract's own `invite`/`accept` pair.
///
/// ## Why keccak256(name), not namehash(name)
///
/// `invite()` and `accept()` must agree on *which* candidate name is being admitted without one
/// step trusting the other's word for it. The obvious binding is the name's ENS namehash, but this
/// contract deliberately avoids depending on an unverified namehash implementation (see header).
/// Instead, both calls operate on the identical DNS-encoded `bytes` representation that
/// `IUniversalResolverV2.findOwner` itself takes, and the pending invite is keyed by
/// `keccak256(candidateNameDnsEncoded)`. This is a strictly weaker claim than "this is the
/// canonical namehash" — it only needs to be a collision-resistant binding between "the exact byte
/// string the inviter meant" and "the exact byte string the acceptor is proving ownership of" —
/// and `keccak256` over the same bytes both functions already carry is sufficient for that,
/// without importing ENS's specific recursive-hash algorithm at all.
///
/// ## Live re-derivation, not a cached invite-time snapshot
///
/// `accept()` calls `UNIVERSAL_RESOLVER.findOwner(name)` itself, at accept time — it never trusts
/// an address supplied by `invite()`. If the candidate name changes hands between `invite()` and
/// `accept()`, the *new* controller is who gets to accept (or nobody does, if they never call it);
/// there is no window where a stale ownership snapshot can be replayed. This mirrors the anchoring
/// lesson from `ensv2-engineering-options.md` §1 (anchor to the live-checked `resource`/owner, not
/// a cached `tokenId` or a value some other transaction supplied).
///
/// ## What this contract deliberately does NOT do (kept out of scope; flag, don't guess)
///
///   - No removal-by-other-members ("vote to kick"). Only self-service `leave()` is implemented.
///     Multi-party removal needs a governance/quorum decision this project hasn't made yet — adding
///     it here would be scope invented to look complete, not a requirement that was actually asked
///     for.
///   - No enforcement that a name can only belong to one cluster. A name's controller could accept
///     invites into multiple `ClusterController` instances. Whether that should be prevented (and
///     how, given each instance has no knowledge of the others) is an open question, not resolved
///     here.
///   - No on-chain enforcement of the underlying `alt-script`/script-difference claim this project
///     cares about (i.e. this contract doesn't itself check that the members are actually
///     transliterations of one another — same as the existing ENSIP, that judgment stays off-chain
///     with whoever is building/consuming the cluster, e.g. via `packages/digraphia/src/verify.ts`).
contract ClusterController is PermissionedRegistry {
    ////////////////////////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////////////////////////

    struct PendingInvite {
        /// @dev keccak256 of the candidate's DNS-encoded name, as supplied at invite() time.
        bytes32 nameKey;
        /// @dev Invite expires if not accepted by this timestamp (bounds how long a stale,
        ///      unconsumed invite can sit around before it must be re-issued).
        uint64 expiresAt;
    }

    ////////////////////////////////////////////////////////////////////////
    // Immutables
    ////////////////////////////////////////////////////////////////////////

    /// @notice Used by `accept()` to live-check that the caller currently controls the name they
    ///         claim, per `IUniversalResolverV2.findOwner` (contracts-v2's registry-tree walk,
    ///         not a cached indexer read).
    IUniversalResolverV2 public immutable UNIVERSAL_RESOLVER;

    /// @dev How long an unconsumed invite remains valid. Chosen as a sensible default, not a
    ///      protocol constant — a production deployment may want this configurable per cluster.
    uint64 public constant INVITE_TTL = 7 days;

    /// @dev Role granted to each accepted member's own token: the right to remove *their own*
    ///      membership. Deliberately excludes ROLE_SET_SUBREGISTRY / ROLE_SET_RESOLVER / ROLE_RENEW
    ///      / ROLE_CAN_TRANSFER_ADMIN — a membership slot is not a name a member should be able to
    ///      configure or hand off; it is either held or relinquished.
    uint256 private constant MEMBER_ROLE_BITMAP = RegistryRolesLib.ROLE_UNREGISTER;

    ////////////////////////////////////////////////////////////////////////
    // Storage
    ////////////////////////////////////////////////////////////////////////

    /// @notice True while `account` currently holds a membership token in this cluster.
    mapping(address account => bool) public isMember;

    /// @dev label => pending invite for that slot. A label can only have one outstanding invite;
    ///      issuing a new one for the same label overwrites the old (implicitly revoking it).
    mapping(string label => PendingInvite) private _pendingInvites;

    ////////////////////////////////////////////////////////////////////////
    // Events
    ////////////////////////////////////////////////////////////////////////

    event MemberInvited(string label, bytes32 indexed nameKey, address indexed invitedBy, uint64 expiresAt);
    event MemberJoined(string label, address indexed member, uint256 tokenId);
    event MemberLeft(string label, address indexed member, uint256 tokenId);

    ////////////////////////////////////////////////////////////////////////
    // Errors
    ////////////////////////////////////////////////////////////////////////

    /// @notice `register()`/`unregister()`'s public entrypoint from `IStandardRegistry` is
    ///         disabled; membership must go through `invite()` + `accept()`.
    error DirectRegistrationDisabled();
    /// @notice Caller does not currently hold a membership token, so cannot invite others.
    error NotAMember(address account);
    /// @notice No outstanding invite exists for this label (or it was already consumed).
    error NoSuchInvite(string label);
    /// @notice An outstanding invite for this label has passed `expiresAt`.
    error InviteExpired(string label, uint64 expiresAt);
    /// @notice `keccak256(name)` supplied to `accept()` does not match the invite issued for this label.
    error NameMismatch(string label);
    /// @notice `msg.sender` is not the current controller of `name`, per `findOwner`.
    error NotNameController(address caller, address actualOwner);

    ////////////////////////////////////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////////////////////////////////////

    /// @param labelStore Shared label database (required by `PermissionedRegistry`).
    /// @param universalResolver_ Used for live `findOwner` checks in `accept()`.
    /// @param admin Granted `ROLE_SET_URI` only — cosmetic/metadata admin, no membership authority.
    ///        Membership authority is entirely governed by `invite`/`accept`, not by this role.
    /// @param founderLabel The founding member's chosen slot label (e.g. their own ENS label).
    /// @param founderName The founding member's DNS-encoded ENS name, used to verify they control
    ///        it at deploy time — the same live check every subsequent joiner goes through, just
    ///        without needing an inviter (there is no existing member yet to invite them).
    constructor(
        ILabelStore labelStore,
        IUniversalResolverV2 universalResolver_,
        address admin,
        string memory founderLabel,
        bytes memory founderName
    )
        PermissionedRegistry(labelStore, admin, RegistryRolesLib.ROLE_SET_URI)
    {
        UNIVERSAL_RESOLVER = universalResolver_;
        address founder = universalResolver_.findOwner(founderName);
        if (founder != msg.sender) {
            revert NotNameController(msg.sender, founder);
        }
        _admitMember(founderLabel, founder);
    }

    ////////////////////////////////////////////////////////////////////////
    // Disabled base entrypoint
    ////////////////////////////////////////////////////////////////////////

    /// @inheritdoc PermissionedRegistry
    /// @dev Overridden purely to close the direct path; all membership must go through
    ///      `invite`/`accept` so the "existing member consented" check can never be bypassed.
    function register(string memory, address, IRegistry, address, uint256, uint64)
        public
        pure
        override
        returns (uint256)
    {
        revert DirectRegistrationDisabled();
    }

    ////////////////////////////////////////////////////////////////////////
    // Membership
    ////////////////////////////////////////////////////////////////////////

    /// @notice Invite a candidate name into this cluster under `label`.
    /// @dev Side one of the two-sided proof: proves an *existing* member wants this name added.
    ///      Does not by itself grant membership — see `accept()`.
    /// @param label The membership slot this invite is for (becomes the token's label on accept).
    /// @param candidateName The DNS-encoded name being invited. Only its hash is stored; the
    ///        acceptor must reproduce the exact same bytes.
    function invite(string calldata label, bytes calldata candidateName) external {
        if (!isMember[msg.sender]) {
            revert NotAMember(msg.sender);
        }
        uint64 expiresAt = uint64(block.timestamp) + INVITE_TTL;
        _pendingInvites[label] = PendingInvite({nameKey: keccak256(candidateName), expiresAt: expiresAt});
        emit MemberInvited(label, keccak256(candidateName), msg.sender, expiresAt);
    }

    /// @notice Accept a pending invite and join the cluster.
    /// @dev Side two of the two-sided proof: re-derives control of `name` live, via the
    ///      registry-tree walk in `UniversalResolverV2`, rather than trusting anything cached from
    ///      `invite()`. This is what stops a stranger from accepting an invite meant for someone
    ///      else, and what stops a stale ownership snapshot from being replayed after a transfer.
    /// @param label The slot label from the matching `invite()` call.
    /// @param name The same DNS-encoded name bytes the inviter specified as `candidateName`.
    function accept(string calldata label, bytes calldata name) external {
        PendingInvite memory pending = _pendingInvites[label];
        if (pending.nameKey == bytes32(0)) {
            revert NoSuchInvite(label);
        }
        if (block.timestamp > pending.expiresAt) {
            revert InviteExpired(label, pending.expiresAt);
        }
        if (keccak256(name) != pending.nameKey) {
            revert NameMismatch(label);
        }

        address owner = UNIVERSAL_RESOLVER.findOwner(name);
        if (owner != msg.sender) {
            revert NotNameController(msg.sender, owner);
        }

        delete _pendingInvites[label];
        _admitMember(label, owner);
    }

    /// @notice Leave the cluster, relinquishing a membership token.
    /// @dev `unregister` is the inherited `PermissionedRegistry` function (not overridden — it is
    ///      not `virtual` in the base contract); calling it here directly (not via `this.`)
    ///      preserves `msg.sender`, so its own `ROLE_UNREGISTER` check — granted to the member at
    ///      `accept()` time via `MEMBER_ROLE_BITMAP` — is what actually gates this.
    /// @param anyId The labelhash, token ID, or resource of the caller's own membership token.
    function leave(uint256 anyId) external {
        address member = getOwner(anyId);
        unregister(anyId);
        isMember[member] = false;
        emit MemberLeft(LABEL_STORE.getLabel(anyId), member, anyId);
    }

    ////////////////////////////////////////////////////////////////////////
    // Internal
    ////////////////////////////////////////////////////////////////////////

    /// @dev Mints the membership token via the base contract's internal `_register`, bypassing its
    ///      `ROLE_REGISTRAR` check entirely (`checkRoles: false`) — authorization here has already
    ///      been performed by `invite`/`accept` (or, for the founder, by the constructor's own
    ///      `findOwner` check), which is a strictly stronger, cluster-specific check than the
    ///      generic root-registrar role the base contract would otherwise ask for.
    function _admitMember(string memory label, address member) private {
        uint256 tokenId = _register({
            label: label,
            owner: member,
            registry: IRegistry(address(0)),
            resolver: address(0),
            roleBitmap: MEMBER_ROLE_BITMAP,
            expiry: type(uint64).max,
            checkRoles: false
        });
        isMember[member] = true;
        emit MemberJoined(label, member, tokenId);
    }
}
