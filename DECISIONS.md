# Aleph — Architecture Decision Record

> The near-permanent choices the whole project depends on (ROADMAP §0). Each is
> recorded with the decision, the reasoning, and the date. These are not
> relitigated without a written reason appended here. Status: **decided** unless
> marked otherwise.

Decided: 2026-06-14.

---

## D1 — Launch posture: **testnet-first**

**Decision.** Aleph is first released to the world on a **public testnet**: the
full protocol runs live and anyone can participate, but settlement uses
**test-value** (a testnet stablecoin) until the system has earned trust. Mainnet
(real value) is a later phase, gated by an external audit and legal review
(ROADMAP §7.5, §13.3).

**Why.** It is still a real release of the real protocol — the network is live,
nodes are real, agents transact — but mistakes are cheap, there is no financial
or regulatory liability yet, and real usage teaches us what to fix before stakes
are real. This is the *product phase → expansion phase* sequencing: prove it
works, release it small, earn trust, then raise the stakes. Value-first would
require audit + legal + custody *before* any launch (months) and turns every bug
into a loss of real funds and irrecoverable trust.

**Implication.** Build for real value from day one (correct semantics, hardened
crypto) but *launch* with test value.

---

## D2 — Settlement substrate: **on-chain EVM L2 (Base), testnet first**

**Decision.** Settlement is a **smart-contract escrow on an EVM L2 (Base)**,
settling a **stablecoin (USDC)**, starting on its testnet (**Base Sepolia**).
The existing `SettlementRail` interface stays; the in-memory implementation is
replaced by an on-chain one (`@aleph/settle-evm`). The off-chain PSP option
remains possible behind the same interface as a future bridge, not at launch.

**Why.** The whole Aleph thesis is that the Web3 substrate — verifiable, no
bank, machine-native — is *ideal for agents*. On-chain settlement is what makes
the anti-Sybil reputation real (attestations are backed by settlements anyone
can verify on-chain). Base: low fees, strong tooling (Foundry, viem), broad
USDC support. Because the rail is already an interface, this is *replacing an
implementation*, not redesigning.

**Implication.** Adds a Solidity contract (`contracts/AlephEscrow.sol`, audited
before mainnet), `secp256k1` signature support, and `did:pkh` identity (D3).
Per-call on-chain settlement on a cheap L2 is acceptable for launch; payment
channels / batching are a documented fast-follow for micro-payments.

---

## D3 — Identity methods at launch: **did:key + did:web + did:pkh**

**Decision.** Support three DID methods at launch, behind the existing pluggable
resolver:
- **`did:key`** — self-contained Ed25519 identity (already built). Default for
  agents and quick nodes.
- **`did:web`** — identity bound to a domain via `/.well-known/did.json` (already
  parsed; real fetch + TLS to finish). For organizations/branded nodes.
- **`did:pkh`** — identity derived from a blockchain account (e.g.
  `did:pkh:eip155:8453:0x…`). New. Links a node's **protocol identity** to its
  **on-chain payout identity**, which D2 requires.

**Why.** `did:key` is the zero-dependency floor. `did:web` gives human-meaningful
organizational identity. `did:pkh` is the bridge to settlement — if money moves
on-chain, "who I am" and "where I get paid" must be cryptographically linkable.
The resolver is additive, so more methods can come later without breaking the
waist.

**Implication.** The core must verify **both Ed25519 (key/web) and secp256k1
(pkh)** signatures, abstracted behind the verification-method type.

---

## D4 — License & governance

**Decision.**
- **Implementation (code):** **Apache-2.0**. Includes an explicit patent grant —
  important for a protocol others build on — while staying permissive to
  maximize adoption.
- **Specification & papers (`*.md` spec, paper, foundations):** **CC-BY-4.0** —
  free to share and adapt with attribution, appropriate for a standard.
- **Governance:** an **AIP process** ("Aleph Improvement Proposal", modeled on
  IETF RFCs / Ethereum EIPs). Numbered proposals, public review, a defined
  acceptance bar. Changes to the **thin waist** require an AIP + broad review +
  a major-version bump; **layer** changes are lighter (encoding the §2.3
  asymmetry: the waist is near-frozen, layers evolve freely). Drafted in
  ROADMAP §12.

**Why.** For a protocol meant to be *adopted and built upon*, permissive +
patent-grant (Apache-2.0) beats copyleft (which deters commercial adoption) and
beats bare MIT (no patent clause). CC-BY for the spec mirrors how open standards
are published. An RFC/EIP-style process is the proven way to evolve a shared
protocol without a single owner.

**Owner's note.** This is the one decision with a genuine owner-preference
component. Apache-2.0 + CC-BY-4.0 is chosen as the **adoption-optimal default**;
the repo owner (Leonardo Corte) may override it (e.g. to a stricter copyleft, or
a source-available license) — if so, record the change and reason below.

---

## D5 — Persistence: **async repository interfaces; SQLite (node:sqlite) + Postgres (postgres.js)**

**Decision.** Protocol runtimes depend only on **async repository interfaces**
(`RegistryStore`, `NonceStore`, `ReputationStore`, `SettlementStore`) in
`@aleph/store`, never on a concrete database. Three interchangeable drivers:
**in-memory** (dev/tests, the default), **SQLite** via Node's built-in
`node:sqlite` (operators on a laptop / embedded — zero native deps), and
**Postgres** via `postgres.js` (the deployed registry — JSONB, real concurrency;
an optional, lazily-loaded dependency). One reusable contract test suite every
driver passes identically.

**Scope.** Persisted: the registry (nodes), nonces (replay protection across
restarts), reputation (attestations, with DB-level `UNIQUE(subject, settlement)`
anti-Sybil), and **settlement records** (durable signed history). *Not* persisted:
the in-memory dev rail's live balance/escrow ledger — that is throwaway code the
on-chain rail (D2 / ROADMAP §4) replaces; persisting it would be wasted work.

**Why.** `node:sqlite` gives real persistence with no native compilation, ideal
for the "run your own node" story. Postgres is the standard for the deployed
registry. The async interface lets one codebase serve both, and keeps the door
open for the on-chain settlement store. Invariants are enforced in the database
(unique keys, primary keys), not just in app code — so they hold under
concurrency and forged input.

---

## D6 — Cryptography: RFC 8785 canonicalization, domain-separated signing, Ed25519 + secp256k1

**Decision.**

- **Canonicalization:** signatures are computed over **RFC 8785 (JCS)** canonical
  bytes — the permanent, language-independent definition of "what gets signed".
  Verified against the official JCS vectors and reproduced by an independent
  Python implementation in CI.
- **Domain separation:** the signed message is `<domain>\n<RFC8785(object)>`,
  where each signed object kind has a distinct domain tag (`aleph/0.1:envelope`,
  `:grant`, `:attestation`, `:settlement`, `:manifest`). A signature for one kind
  cannot verify as another.
- **Signature suites:** **Ed25519** (default, Node-native) and **secp256k1**
  (`@noble/curves`, ECDSA over SHA-256 of the message). The suite is encoded in
  the did:key multicodec prefix; verification is dispatched from the signer's DID
  (`verifyByDid`). `@noble/curves`/`@noble/hashes` are the audited pure-JS
  standard; hand-rolling EC crypto would be less safe.
- **Identity:** `did:key` (both suites) and `did:web` (HTTPS + TTL cache).
  **`did:pkh` is deferred to §4**, where Ethereum public-key recovery is handled
  by the chain tooling rather than re-implemented in a security-critical layer.
- **Key management:** private keys are sealed at rest with **scrypt → AES-256-GCM**
  (`sealIdentity`/`unsealIdentity`); a wrong passphrase or any tampering fails the
  GCM tag. Rotation uses a **KeyRing** of validity windows: a signature verifies
  against the key valid at the message's timestamp.

**Why.** The waist is near-frozen (ROADMAP §0 of the protocol), so its crypto must
be right and interoperable from the start. RFC 8785 + domain separation + a
cross-language proof make the signed bytes unambiguous across SDKs. Standard,
audited primitives over clever ones.

---

## D7 — On-chain settlement: immutable escrow, deadline-refund, deferred dispute/oracle

**Decision.**

- **Contract:** `AlephEscrow` — a per-invocation ERC-20 escrow
  (lock → release | refund). **Immutable** (no proxy) to keep the audited surface
  minimal; `ReentrancyGuard` + checks-effects-interactions + `SafeERC20`.
- **Authorization:** the **payer** releases (acknowledging delivery); a
  **deadline-refund** protects the payer if a node never delivers; the payee may
  refund early (decline). A richer dispute mechanism (challenge windows, staked
  arbiters) is a planned AIP, not a launch blocker — declared as a known limit.
- **Proof model:** an on-chain `SettlementRecord` is proven by its `txHash`;
  `EvmSettlementRail.verify()` re-reads the chain (no trusted signer). This is
  what makes settlement-backed reputation un-forgeable.
- **Rail:** `@aleph/settle-evm` via **viem**; the in-memory reference rail stays
  for dev/tests. The fiat on-ramp and off-chain delivery truth are the
  honestly-open boundaries (see `spec/SETTLEMENT.md`).
- **Chain:** EVM L2 (Base), **testnet first** (Base Sepolia). Deployment is the
  owner's manual step (funded key); **mainnet is gated by an external audit**
  (ROADMAP §7.5).

**Why.** On-chain settlement is the substrate the whole thesis rests on
(verifiable, no bank, machine-native). Immutability + a tiny surface + a
deadline safety net make the contract auditable and safe to launch on testnet;
the open boundaries are documented rather than hidden.

---

## D8 — Reputation: consumer-pluggable trust policy, diversity-weighted default, staking deferred

**Decision.**

- **Trust is computed by the consumer**, never minted by the node. `computeTrust`
  is a **pluggable `TrustPolicy`** (issuer weight, decay, confidence scale, clock)
  with a **specified default**; agents may override every knob. The result is an
  **auditable `TrustScore`** exposing every input (per-issuer breakdown, weight,
  distinct issuers) — no opaque number.
- **Default policy.** Group attestations by issuer; apply **per-issuer
  diminishing returns** (`log(1+value)`) so repeated business from one payer
  saturates; **time-decay** by exponential half-life (180 d) so recent custom
  outweighs ancient; fold an **evidence-mass confidence** `1−exp(−W/k)` (k=5) into
  a single comparable `reputation = score × confidence`. Ranking uses
  `reputation`, so at equal rating more **distinct, recent, settlement-backed**
  custom wins — that is the anti-Sybil signal.
- **Anti-Sybil posture.** The base rule (a settlement backs each attestation)
  raises forgery cost; diversity weighting removes the wash-trade lever (faking
  *diversity*, not just volume, is the binding cost). This is **not "solved"** —
  Sybil resistance is an arms race; **staking/slashing** is documented as a
  **planned AIP**, not shipped.
- **Negative attestations** are `rating→0` (no new type); **revocation** is a
  signed statement only the original issuer can make. **On-chain verification**
  is a pluggable async hook (`computeTrustAsync` + `evmSettlementVerifier`) so a
  fabricated settlement reference is rejected by reading the chain; binding an
  on-chain address to the attesting DID awaits **did:pkh** (deferred, D3).
- **Scale.** `/reputation` paginates (keyset) with **ETag/304**; a
  `/reputation/summary` aggregate lets an agent rank without downloading the raw
  set, which stays available for full verification.

**Why.** Reputation is the load-bearing wall: FIND is useless without TRUST.
Keeping the policy in the consumer's hands (with a sane, auditable default) avoids
a central score to capture or game, while diversity weighting + decay make
manufacturing trust economically irrational at expected scale — honestly, without
overclaiming a solution.

---

## Change log

- 2026-06-14 — D1–D4 decided (initial record).
- 2026-06-14 — D5 decided (persistence drivers & scope; ROADMAP §2).
- 2026-06-14 — D6 decided (cryptography: canonicalization, domain separation,
  suites, key management; ROADMAP §3).
- 2026-06-14 — D7 decided (on-chain settlement: escrow design, deadline-refund,
  deferred dispute/oracle; ROADMAP §4).
- 2026-06-15 — D8 decided (reputation: pluggable trust policy, diversity-weighted
  default, decay/revocation/negatives, on-chain verification hook, pagination;
  staking deferred to a planned AIP; ROADMAP §5).
