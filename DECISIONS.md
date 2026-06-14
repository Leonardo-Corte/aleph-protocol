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

## Change log

- 2026-06-14 — D1–D4 decided (initial record).
- 2026-06-14 — D5 decided (persistence drivers & scope; ROADMAP §2).
