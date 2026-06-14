# Aleph — Production Development Roadmap

### From a working prototype to a protocol released to the world

> **What this document is.** A complete, exhaustive, section-by-section engineering roadmap to take Aleph from the tested prototype that exists today (`code/`, 27 passing tests, all five verbs working in-memory on localhost) to a **production network that real agents, run by real people, can use over the public internet with real value at stake.**
>
> **How to read it.** Sections are ordered by dependency: each builds on the previous. Inside each section you will find — **Goal** (what done looks like), **Why** (the reasoning, so you can change the plan if a premise changes), **Decisions** (the forks where a choice must be made, with a recommendation), **Steps** (numbered, concrete, down to file names and commands), **Code** (real snippets to start from), **Acceptance criteria** (the checklist that proves the section is done), and **Risks**. Nothing is assumed; where a term is technical, it is explained on first use.
>
> **The honest framing.** The prototype proves the protocol *works*. Production is a different discipline: it is about what happens when the process restarts, when two people hit it at once, when someone is hostile, when real money moves, and when the author is asleep. That is the gap this roadmap closes. Budget: realistically 6–10 weeks of focused work to a credible public testnet launch, longer to mainnet with real value. That is normal and good — shipping a network protocol fast and sloppy is how you lose trust you never get back.

---

## Table of contents

- **Section 0 — Strategic decisions (the forks that gate everything)**
- **Section 1 — Engineering foundation (monorepo, build, CI, quality gates)**
- **Section 2 — Persistence (the data must survive a restart)**
- **Section 3 — Hardening the core to production grade (crypto, identity, canonicalization)**
- **Section 4 — The settlement rail for real (on-chain escrow + the fiat/oracle boundary)**
- **Section 5 — Reputation & anti-Sybil at scale**
- **Section 6 — The registry at scale (discovery, federation, persistence, caching)**
- **Section 7 — Security (threat model, authz, rate limiting, audit)**
- **Section 8 — Observability (logs, metrics, traces, alerts)**
- **Section 9 — Deployment & infrastructure (containers, TLS, domains, secrets)**
- **Section 10 — SDKs & developer experience**
- **Section 11 — Real capability nodes & the vocabulary**
- **Section 12 — Protocol governance & the v1 spec freeze**
- **Section 13 — Public launch (testnet → mainnet, docs site, community)**
- **Appendix A — Recommended technology stack (with rationale)**
- **Appendix B — Milestone timeline & critical path**
- **Appendix C — Definition of Done for "released to the world"**

---

# Section 0 — Strategic decisions (the forks that gate everything)

**Goal.** Lock the four irreversible choices that every later section depends on. Making these explicitly, now, prevents weeks of rework.

**Why.** Some decisions are cheap to change (a variable name) and some are near-permanent (the identity format, the payment substrate). Section 0 is only the permanent ones. Pick them deliberately; write the choice down; do not relitigate without a real reason.

## 0.1 — Decision: launch posture — testnet-first vs value-first

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A — Testnet-first (RECOMMENDED)** | The full protocol runs publicly, but money is a testnet/stablecoin on a test chain (no real value). Real code, real network, fake stakes. | Ship in weeks; learn from real usage; no legal/financial liability yet; mistakes are cheap. | Not "real money" yet; a second push needed for mainnet. |
| **B — Value-first** | Real money from day one. | "Real" immediately. | Requires a security audit, legal review, money-transmission analysis, and key custody *before* launch — months, and a single bug can cost real funds and trust. |

**Recommendation: A.** Release the protocol to the world on a **public testnet** first. This is still "the real protocol released to the world" — the network is live, anyone can run a node, agents transact — it simply uses test value while the system earns trust. Mainnet (real value) becomes Section 13's second phase, after the audit (Section 7) passes. This is exactly the *product phase → expansion phase* sequencing in the ESO corpus, and it is how every serious chain protocol launched.

## 0.2 — Decision: settlement substrate — on-chain vs off-chain

The prototype's rail is in-memory. Production needs a real one. The thesis of Aleph (the Web3 substrate is *ideal for machines*) points on-chain, but be deliberate:

| Option | What it means | When to pick |
|---|---|---|
| **On-chain EVM + stablecoin (RECOMMENDED)** | An escrow smart contract on an EVM chain (e.g. Base), settling a stablecoin (e.g. USDC). | The faithful path: agent-to-agent, no bank, verifiable settlement → backs the anti-Sybil reputation natively. |
| Off-chain PSP (Stripe/x402) | A payment processor holds the escrow; the protocol records signed receipts. | A pragmatic bridge if on-chain UX/cost is blocking. Can coexist behind the same rail interface. |

**Recommendation: On-chain EVM, on a low-fee L2 (Base or Optimism), starting on its testnet (Base Sepolia).** Rationale: it is the substrate the whole thesis rests on; it gives genuinely trustless settlement; and the rail interface already in the code (`SettlementRail`) means we are *replacing an implementation*, not redesigning. Keep the off-chain option open behind the same interface for a future bridge.

## 0.3 — Decision: identity methods to support at launch

Keep `did:key` (already built). Add:
- **`did:web`** (already parsed) — for nodes identified by a domain (organizations).
- **`did:pkh`** — a DID derived from a blockchain account (a wallet address). **Add this**, because if settlement is on-chain, a node's payout identity and its protocol identity should be linkable. This is the bridge between "who I am in Aleph" and "where I get paid".

**Recommendation:** ship `did:key` + `did:web` + `did:pkh` at launch; design the resolver (already pluggable) so more methods are additive.

## 0.4 — Decision: license & governance

- **License:** the code is MIT in `package.json` but "TBD" in the README. **Decide now.** Recommendation: **Apache-2.0** for the implementation (patent grant matters for a protocol others build on) and **CC-BY-4.0** for the spec/papers. Replace every "TBD".
- **Governance:** who can change the *thin waist*? Recommendation: an **AIP process** ("Aleph Improvement Proposal", modeled on RFCs/EIPs) — numbered proposals, public discussion, a defined acceptance bar. Drafted in Section 12; decided in principle now.

**Acceptance criteria for Section 0.**
- [ ] A `DECISIONS.md` exists recording: launch posture (A), substrate (on-chain EVM L2 testnet), identity methods (`did:key`/`did:web`/`did:pkh`), license (Apache-2.0 + CC-BY-4.0), governance (AIP).
- [ ] Every "TBD" in the repo is replaced with the chosen license.
- [ ] These choices are committed and will not be relitigated without a written reason.

**Risks.** The biggest risk here is *not deciding* and letting ambiguity propagate. The second is over-engineering for mainnet before the testnet has taught you anything.

---

# Section 1 — Engineering foundation (monorepo, build, CI, quality gates)

**Goal.** Turn a folder of `.ts` files run with `node` into a professional, multi-package, built, linted, continuously-tested codebase that strangers can contribute to and that deploys reproducibly.

**Why.** Today the code runs via Node's native TypeScript execution — perfect for a prototype, wrong for production (no type-checking gate, no published packages, no CI, no separation between "core protocol" and "the registry server you deploy"). A protocol meant for others to build on must be a *set of versioned packages* with guaranteed quality.

## 1.1 — Restructure into a workspace monorepo

Split the single `code/` into packages with clear boundaries, so the protocol library, the servers, and the SDK version and ship independently.

```
aleph/
├── packages/
│   ├── core/            # @aleph/core — the thin waist + crypto (no I/O, no servers)
│   ├── node/            # @aleph/node — the capability-provider runtime
│   ├── registry/        # @aleph/registry — the discovery service
│   ├── settle-evm/      # @aleph/settle-evm — the on-chain settlement rail
│   ├── client/          # @aleph/client — the agent-facing SDK (THE target)
│   ├── mcp/             # @aleph/mcp — the MCP server wrapping the client
│   └── cli/             # @aleph/cli — the terminal tool
├── contracts/           # Solidity escrow contracts + tests (Foundry)
├── apps/
│   ├── registry-server/ # deployable registry (uses @aleph/registry + persistence)
│   └── demo-node/       # a deployable example node
├── docs/                # the docs site (Section 10)
├── spec/                # the normative spec + AIPs (Section 12)
├── package.json         # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .github/workflows/   # CI
```

**Why `core` has no I/O:** the thin waist must be usable in a browser, in a server, in an edge function. Keep all network/disk code out of `@aleph/core` so it stays portable and auditable.

## 1.2 — Tooling decisions

- **Package manager:** `pnpm` (workspace-native, fast, strict). 
- **Build:** `tsup` (esbuild-based) → each package emits ESM + `.d.ts` type declarations to `dist/`. Real builds, not run-from-source, so consumers get types and tree-shaking.
- **Type-checking gate:** `tsc --noEmit` in CI (native execution never type-checks — this is a real gap to close).
- **Lint/format:** `eslint` + `prettier` with a committed config.
- **Test:** keep `node --test` (zero-dep, already used) for unit/integration; add coverage via `c8`.
- **Versioning/releases:** `changesets` — every change declares a semver bump; releases are generated and published to npm.

## 1.3 — Continuous integration (GitHub Actions)

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck      # tsc --noEmit everywhere
      - run: pnpm -r lint
      - run: pnpm -r build
      - run: pnpm -r test
      - run: pnpm -r test:coverage
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - run: forge test -vvv        # Solidity tests (Section 4)
```

**Why CI matters for a protocol:** the moment a stranger opens a pull request, CI is the contract that says "this still works." Without it, every contribution is a gamble.

## 1.4 — Migration steps (do not break what works)

1. `git mv code/src/core packages/core/src` (and so on per package) — preserve history.
2. Add a `package.json` per package with correct `name`, `exports`, `dependencies` (e.g. `@aleph/node` depends on `@aleph/core`).
3. Replace cross-package relative imports (`../core/envelope.ts`) with package imports (`@aleph/core`).
4. Move the 27 tests next to their packages; ensure all green under the new layout.
5. Pin Node to an LTS (22) in `engines` and `.nvmrc`.

**Acceptance criteria for Section 1.**
- [ ] `pnpm install && pnpm -r build && pnpm -r test` is green from a clean clone.
- [ ] `pnpm -r typecheck` passes (no type errors — a gate that did not exist before).
- [ ] CI runs on every push/PR and is green.
- [ ] Each package builds to `dist/` with `.d.ts` types.
- [ ] `changesets` is configured; a dry-run release produces correct version bumps.

**Risks.** Monorepo migration can churn imports; do it in one focused pass with tests as the safety net. Don't gold-plate the tooling — the goal is gates, not a tool museum.

---

# Section 2 — Persistence (the data must survive a restart)

**Goal.** Every piece of protocol state — registered nodes, attestations/reputation, nonces seen, settlement records, escrow state — survives a process restart and is consistent under concurrent access.

**Why.** This is the single most important difference between the prototype and a real service. Today everything is a JavaScript `Map`: restart the registry and the network forgets every node; restart a node and its hard-won reputation vanishes. A network whose memory is erased on every deploy is not a network.

## 2.1 — Decision: which database

- **Production:** **PostgreSQL.** Battle-tested, transactional, JSON-capable (we store signed JSON documents), good hosting everywhere.
- **Local/dev/embedded nodes:** **SQLite.** Zero-setup so anyone can run a node on a laptop.
- **Access:** a thin **repository interface** so the same code runs on either. Use **Drizzle ORM** (typed, lightweight, SQL-first) or plain `node:sql`/`postgres.js`. Recommendation: Drizzle for typed migrations.

**Why both:** the registry you deploy wants Postgres; a hobbyist running a node on a Raspberry Pi wants SQLite. The repository pattern lets one codebase serve both.

## 2.2 — The data model

Define tables (shown as SQL DDL; Drizzle generates migrations from typed schema):

```sql
-- Nodes known to a registry (a registered Manifest pointer).
CREATE TABLE nodes (
  did            TEXT PRIMARY KEY,
  manifest_url   TEXT NOT NULL,
  manifest_json  JSONB NOT NULL,
  reputation_url TEXT,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Capability index for fast RESOLVE (a node advertises many capabilities).
CREATE TABLE node_capabilities (
  did         TEXT NOT NULL REFERENCES nodes(did) ON DELETE CASCADE,
  capability  TEXT NOT NULL,
  risk        TEXT,
  PRIMARY KEY (did, capability)
);
CREATE INDEX idx_caps ON node_capabilities (capability);

-- Attestations written about a node (the raw reputation facts).
CREATE TABLE attestations (
  id            BIGSERIAL PRIMARY KEY,
  subject_did   TEXT NOT NULL,
  issuer_did    TEXT NOT NULL,
  settlement_id TEXT NOT NULL,          -- the escrow/settlement that backs it
  rating        REAL NOT NULL,
  claim         TEXT,
  attestation   JSONB NOT NULL,         -- the full signed object
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_did, settlement_id)   -- one settlement backs at most one attestation
);
CREATE INDEX idx_att_subject ON attestations (subject_did);

-- Replay protection: seen (from, nonce) within a window.
CREATE TABLE seen_nonces (
  from_did  TEXT NOT NULL,
  nonce     TEXT NOT NULL,
  ts        BIGINT NOT NULL,
  PRIMARY KEY (from_did, nonce)
);
CREATE INDEX idx_nonce_ts ON seen_nonces (ts);   -- for windowed GC

-- Settlement records (mirror of on-chain events; the off-chain ledger of truth).
CREATE TABLE settlements (
  id            TEXT PRIMARY KEY,       -- escrow id / tx hash
  payer_did     TEXT NOT NULL,
  payee_did     TEXT NOT NULL,
  amount        NUMERIC NOT NULL,
  unit          TEXT NOT NULL,
  invoke_ref    TEXT NOT NULL,
  status        TEXT NOT NULL,          -- locked | released | refunded
  chain_tx      TEXT,                   -- on-chain transaction hash (Section 4)
  record_json   JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2.3 — The repository interface

Refactor every in-memory `Map` behind an interface, so the protocol logic never touches storage directly:

```ts
// packages/registry/src/store.ts
export interface RegistryStore {
  upsertNode(manifest: Manifest, manifestUrl: string): Promise<boolean>; // true if first-seen
  resolveByCapability(capability: string, limit: number): Promise<Pointer[]>;
  touchNode(did: string): Promise<void>;
}

export interface NonceStore {
  checkAndRecord(from: string, nonce: string, ts: number): Promise<boolean>;
  gc(beforeTs: number): Promise<void>;
}

export interface ReputationStore {
  addAttestation(att: Attestation): Promise<void>;     // enforces UNIQUE(subject, settlement)
  getAttestations(subjectDid: string): Promise<Attestation[]>;
}
```

Provide two implementations per interface: `PostgresRegistryStore` and `SqliteRegistryStore` (and keep the in-memory one for tests). Note the signatures became `async` — propagate `await` through node/registry (a mechanical change, caught by the type-checker).

## 2.4 — Migrations & GC

- **Migrations:** Drizzle migration files in `packages/*/drizzle/`; a `pnpm db:migrate` command; CI runs migrations against an ephemeral Postgres to verify them.
- **Nonce GC:** a periodic job (`DELETE FROM seen_nonces WHERE ts < now()-window`) so the table does not grow unbounded.
- **Backups:** document a `pg_dump` schedule for the deployed registry.

**Acceptance criteria for Section 2.**
- [ ] Registry, nonces, attestations, settlements all persist across a full restart (a test stops and restarts the process and finds the data).
- [ ] Postgres and SQLite implementations both pass the same store test-suite.
- [ ] Concurrent writes (two registrations at once) do not corrupt state (a concurrency test).
- [ ] `UNIQUE(subject, settlement)` is enforced at the DB level (a forged duplicate attestation is rejected by the database, not just app code).
- [ ] Migrations apply cleanly from empty on CI.

**Risks.** Making storage `async` ripples through the codebase — lean on the type-checker. Don't skip the concurrency test: races are the bugs that only appear in production.

---

# Section 3 — Hardening the core to production grade (crypto, identity, canonicalization)

**Goal.** Make the thin waist cryptographically rigorous enough that a professional auditor (Section 7) signs off on it. The prototype's crypto is *correct* but uses pragmatic shortcuts that production cannot keep.

**Why.** The waist is near-permanent (Section 0 of the protocol itself): a flaw here is the one mistake you cannot cheaply fix later, and it is the layer that, if broken, breaks everything above it. This section removes every "good enough for a demo" from the core.

## 3.1 — Canonicalization: move to a strict, spec'd standard

**The problem.** Signatures are computed over `JSON.stringify(sortedKeys)`. This is *deterministic enough* for one implementation, but two implementations (e.g. a Python SDK) could disagree on number formatting, Unicode escaping, or whitespace — and then a valid signature would fail to verify across languages. For a cross-language protocol this is unacceptable.

**The fix.** Adopt **RFC 8785 (JSON Canonicalization Scheme, JCS)** exactly, including its number serialization rules, and add a conformance test vector file (`spec/test-vectors/canonical.json`) that every SDK must reproduce byte-for-byte.

```ts
// packages/core/src/canonical.ts — replace the pragmatic sorter with strict JCS.
// Numbers per ECMAScript Number::toString as RFC 8785 mandates; strings with
// the exact escaping rules; reject NaN/Infinity; reject duplicate keys.
export function canonicalize(value: unknown): string { /* full RFC 8785 */ }
```

**Even better:** sign over the *hash* of the canonical bytes (`sign(sha256(jcs(obj)))`) and define the signature input as a domain-separated string (`"aleph/0.1:" + type + ":" + hash`) to prevent a signature for one message type being replayed as another. This is **domain separation** and it is standard practice.

## 3.2 — Signature envelope format: adopt a standard

Today the signature is a bare base64url string in `sig`. Production should use a recognized container so tooling and auditors understand it:
- **Option A:** **JWS** (JSON Web Signature) — ubiquitous, well-audited libraries.
- **Option B:** keep detached Ed25519 but specify it rigorously in the spec with test vectors.

**Recommendation:** specify detached Ed25519 precisely (it is simpler and avoids JWS's footguns), *with* published test vectors, *and* domain separation (3.1). Document the exact bytes signed.

## 3.3 — Key management (the part the prototype completely ignores)

The prototype generates a keypair in memory and forgets it on exit. Production needs a real key lifecycle:

1. **Storage.** Private keys never live in plaintext on disk. Support:
   - dev: an encrypted keystore file (scrypt + AES-GCM), unlocked by a passphrase;
   - production server identities (the registry): keys in a secrets manager / KMS (e.g. cloud KMS, or HashiCorp Vault), never in env vars in plaintext;
   - agent/user identities: a wallet (for `did:pkh`) or an encrypted keystore.
2. **Rotation & revocation.** A DID Document (for `did:web`) can list multiple verification methods and mark old ones revoked. Define how a node rotates its key without losing its identity/reputation: the DID stays; the key under it rotates; old receipts remain verifiable against the key valid at their timestamp. **This requires storing the key's validity window** and verifying a signature against the key that was valid at the envelope's `ts`.
3. **Compromise playbook.** Document what a node operator does if their key leaks (revoke, rotate, re-attest).

```ts
// packages/core/src/keystore.ts
export interface KeyStore {
  load(): Promise<Identity>;
  rotate(): Promise<{ old: string; new: string }>;  // returns DIDs/keys
}
export class EncryptedFileKeyStore implements KeyStore { /* scrypt + AES-GCM */ }
export class KmsKeyStore implements KeyStore { /* signs via cloud KMS, key never leaves */ }
```

## 3.4 — DID methods: add did:pkh and finalize did:web

- **`did:web`:** finish the real fetch path (the prototype tests only the parser). Fetch `https://domain/.well-known/did.json`, cache with TTL, verify TLS, and verify the returned key. Handle the `did:web:domain:path` form.
- **`did:pkh`:** resolve a DID from a blockchain account (e.g. `did:pkh:eip155:8453:0xabc…`). For settlement-linked identities, this ties "who I am" to "where I get paid". Verify signatures via the chain's signature scheme (secp256k1 for EVM) — note this means the core must support **both Ed25519 and secp256k1**; abstract the signature suite behind the verification method's declared type.

## 3.5 — Envelope correctness edge cases

- Reject duplicate keys in incoming JSON (a canonicalization attack vector).
- Enforce a strict max envelope size at parse time (already have a transport cap; add a semantic cap on `body`).
- Validate `ts` is an integer in a sane range; reject pre-epoch or far-future.
- Make `nonce` a minimum entropy (reject trivially short/guessable nonces).
- Constant-time comparison anywhere secrets are compared.

**Acceptance criteria for Section 3.**
- [ ] `canonicalize` passes the RFC 8785 official test vectors plus an Aleph vector file.
- [ ] Two independent implementations (a tiny Python reimplementation in CI) produce identical signatures for the vector set — proving cross-language interop.
- [ ] Domain separation is in place; a signed RECEIPT cannot be reinterpreted as an INVOKE.
- [ ] Keys are loaded from an encrypted keystore or KMS; no plaintext private keys anywhere in the repo or runtime config.
- [ ] Key rotation works: a node rotates its key, old receipts still verify (against the historically-valid key), new ones use the new key.
- [ ] `did:key`, `did:web` (real fetch), and `did:pkh` (secp256k1) all verify signatures.

**Risks.** Supporting two signature suites (Ed25519 + secp256k1) doubles the crypto surface — keep it behind one interface and test both with vectors. Canonicalization is subtle; the RFC vectors are non-negotiable.

---

# Section 4 — The settlement rail for real (on-chain escrow + the fiat/oracle boundary)

**Goal.** Replace the in-memory escrow ledger with a **real escrow smart contract** on an EVM L2 testnet, settling a stablecoin, with the off-chain node/client integrated so that PAY is genuinely trustless: funds lock on-chain at INVOKE, release on delivery, refund on failure — all verifiable by anyone.

**Why.** This is the verb that makes reputation real (attestations are backed by settlements; if settlements are fake, so is trust). It is also the hardest and highest-stakes section, which is why it comes after the core is hardened and why it launches on **testnet** first (Section 0.1).

## 4.1 — The escrow contract

Use **Foundry** (Solidity toolchain) in `contracts/`. The contract holds a stablecoin (ERC-20) in escrow keyed by an invocation, and supports lock/release/refund with the right authorization.

```solidity
// contracts/src/AlephEscrow.sol  (sketch — to be audited)
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "openzeppelin/utils/ReentrancyGuard.sol";

contract AlephEscrow is ReentrancyGuard {
    IERC20 public immutable token;          // the stablecoin (e.g. USDC)
    enum Status { None, Locked, Released, Refunded }

    struct Escrow {
        address payer;
        address payee;
        uint256 amount;
        bytes32 invokeRef;                  // hash of the INVOKE envelope
        Status  status;
        uint64  deadline;                   // auto-refundable after this
    }

    mapping(bytes32 => Escrow) public escrows;   // key = escrowId

    event Locked(bytes32 indexed id, address payer, address payee, uint256 amount, bytes32 invokeRef);
    event Released(bytes32 indexed id);
    event Refunded(bytes32 indexed id);

    constructor(IERC20 _token) { token = _token; }

    // Payer locks funds for a specific invocation.
    function lock(bytes32 id, address payee, uint256 amount, bytes32 invokeRef, uint64 deadline)
        external nonReentrant
    {
        require(escrows[id].status == Status.None, "exists");
        require(token.transferFrom(msg.sender, address(this), amount), "transfer");
        escrows[id] = Escrow(msg.sender, payee, amount, invokeRef, Status.Locked, deadline);
        emit Locked(id, msg.sender, payee, amount, invokeRef);
    }

    // Release to payee. Authorized by the payer's signature OR by the payee
    // presenting a payer-signed delivery acknowledgement (see 4.3).
    function release(bytes32 id) external nonReentrant {
        Escrow storage e = escrows[id];
        require(e.status == Status.Locked, "not locked");
        require(msg.sender == e.payer, "only payer");   // simplest authz; see 4.3 for delegated
        e.status = Status.Released;
        require(token.transfer(e.payee, e.amount), "transfer");
        emit Released(id);
    }

    // Refund to payer after the deadline (delivery failed / timed out).
    function refund(bytes32 id) external nonReentrant {
        Escrow storage e = escrows[id];
        require(e.status == Status.Locked, "not locked");
        require(block.timestamp >= e.deadline || msg.sender == e.payee, "too early");
        e.status = Status.Refunded;
        require(token.transfer(e.payer, e.amount), "transfer");
        emit Refunded(id);
    }
}
```

**Design notes (each is a real decision):**
- **Reentrancy:** `ReentrancyGuard` + checks-effects-interactions ordering — the classic smart-contract footgun.
- **Authorization for release (4.3):** the simplest model is "payer releases on satisfaction." A more agent-native model lets the payee claim with a payer-signed delivery acknowledgement. Start simple; the deadline-based auto-refund protects the payer from a stalling node.
- **The deadline** prevents funds being locked forever if a party vanishes.
- **No upgradeability at first** (immutable contract = smaller trust surface to audit); add a governed proxy only if needed later.

## 4.2 — Contract tests (Foundry)

```solidity
// contracts/test/AlephEscrow.t.sol
function test_lock_release_paysPayee() public { /* … */ }
function test_refund_afterDeadline_returnsToPayer() public { /* … */ }
function test_cannotReleaseTwice() public { /* … */ }
function test_reentrancyGuarded() public { /* … */ }
function test_onlyPayerCanRelease() public { /* … */ }
```

Fuzz tests (`forge test` supports property fuzzing) for amounts and timing. Aim for ~100% line + branch coverage on the contract — it holds money.

## 4.3 — The off-chain integration (the `settle-evm` package)

Implement the existing `SettlementRail` interface against the chain via **viem** (typed EVM client):

```ts
// packages/settle-evm/src/rail.ts
export class EvmSettlementRail implements SettlementRail {
  async lock(payer, payee, amount, invokeRef): Promise<LockResult> {
    // 1. ensure ERC-20 allowance, 2. call escrow.lock, 3. wait for receipt,
    // 4. return { escrowId, txHash }
  }
  async release(escrowId): Promise<SettlementRecord> {
    // call escrow.release, wait, build a SettlementRecord from the on-chain event
  }
  async refund(escrowId): Promise<SettlementRecord> { /* … */ }
  async verify(record): Promise<boolean> {
    // re-read the on-chain event by txHash and confirm it matches the record
  }
}
```

Crucially, a `SettlementRecord` now references an **on-chain transaction hash**, and `verifyAttestation` (Section 5) can independently confirm the settlement happened by reading the chain — *that* is what makes reputation un-forgeable.

## 4.4 — The fiat/oracle boundary (the honestly-open problem)

The chain proves what happens *inside* it. It cannot prove that the off-chain *world* delivered (did the node actually return a correct answer?) or that fiat entering the system is real. Address it explicitly:
- **On-ramp:** users acquire the testnet stablecoin from a faucet (testnet) or a regulated on-ramp (mainnet, later — a legal question, Section 13).
- **Delivery truth:** for now, "delivery" = the node returns a signed RECEIPT; disputes are handled by the deadline-refund and by reputation (a node that delivers garbage loses reputation). A fuller **dispute/oracle mechanism** (challenge windows, staked arbiters) is a documented future AIP, not a launch blocker — but it must be *written down as a known limit*, not hidden.

## 4.5 — Cost & UX realities

- **Gas:** even on an L2, each lock/release is a transaction with a fee. For micro-payments this can dominate. Document this; consider **payment channels / batching** (settle many invocations in one on-chain tx) as a fast-follow. For launch, per-call on-chain settlement on a cheap L2 is acceptable.
- **Latency:** an on-chain confirmation takes seconds. The client must handle async settlement (it already supports async receipts). The agent UX: "locking…", "settled."

**Acceptance criteria for Section 4.**
- [ ] `AlephEscrow.sol` deployed to Base Sepolia (testnet); address recorded in `DECISIONS.md`.
- [ ] Foundry tests pass with ~100% coverage incl. reentrancy and double-release.
- [ ] `EvmSettlementRail` performs a real lock→release on testnet in an integration test (gated, uses a funded test key).
- [ ] A `SettlementRecord` carries a real `txHash` and `verify()` re-reads it from chain.
- [ ] The fiat/oracle boundary and the absence of a full dispute mechanism are documented as known limits.
- [ ] Gas cost per settlement measured and documented.

**Risks.** This is the section where real value can be lost, even on testnet UX confusion can erode trust. The mitigations: immutable audited contract, deadline-refund safety net, testnet-first, and an explicit dispute-mechanism limitation. Do **not** rush to mainnet before Section 7's audit.

---

# Section 5 — Reputation & anti-Sybil at scale

**Goal.** Turn the working-but-naive reputation layer into one that holds up against an adversary actively trying to manufacture trust, and that scales to many attestations per node.

**Why.** Reputation is the load-bearing wall of the whole network: FIND is useless if you cannot TRUST the results, and ACT/PAY on an untrusted node is reckless. The prototype's anti-Sybil rule (an attestation counts only if backed by a real settlement) is correct but not sufficient at scale.

## 5.1 — Strengthen the anti-Sybil economics

The base rule (settlement-backed attestations) raises the *cost* of forgery but a determined attacker can still **wash-trade**: create two identities, pay yourself, attest yourself, repeat. Layer defenses:

1. **Cost asymmetry.** Each fake reputation point costs a real settlement (gas + the spread you don't recover). Make the cost of faking trust exceed its value by weighting attestations by *settled value* and by the *diversity* of distinct counterparties (see 5.2).
2. **Counterparty diversity.** Reputation from 100 distinct payers is worth far more than 100 attestations from one payer. Compute trust with a **diversity-weighted** function: cap the contribution of any single issuer (e.g. logarithmic in repeated business from the same payer).
3. **Stake (future AIP).** Nodes optionally stake collateral that is slashed on proven fraud — a stronger Sybil deterrent. Document as a planned mechanism.

```ts
// packages/core/src/trust.ts — diversity-weighted, consumer-computed
export function computeTrust(atts: Attestation[], opts?: TrustPolicy): TrustScore {
  // verify each (sig + on-chain settlement), dedupe by settlement,
  // group by issuer, apply diminishing returns per issuer (e.g. sqrt or log),
  // weight by settled value, and expose the inputs so the policy is auditable.
}
```

The key property stays: **trust is computed by the consumer**, with a *policy they control*. The protocol ships a sane default policy; agents may override it.

## 5.2 — Attestation storage & retrieval at scale

- Attestations live in the DB (Section 2), indexed by subject.
- A node serves `/reputation` with **pagination** and an **ETag/If-None-Match** cache so an agent re-fetching is cheap.
- Provide a **summary** endpoint (counts, distinct issuers, total settled value, time distribution) so an agent can rank candidates without downloading every raw attestation — but the raw set stays available for full verification.

## 5.3 — Revocation & decay

- **Decay:** recent reputation should weigh more than ancient (a node good two years ago may have changed hands). The default policy applies a time-decay.
- **Negative attestations:** a payer can attest a *bad* outcome (low rating) backed by the same settlement; the trust function incorporates them honestly.
- **Revocation:** if an attestation was issued in error, the issuer can publish a signed revocation referencing it.

**Acceptance criteria for Section 5.**
- [ ] A wash-trading simulation (N self-dealing identities) fails to outrank an honest node with diverse real custom — proving the diversity weighting works.
- [ ] Trust is computed from on-chain-verified settlements (a fabricated settlement reference is rejected by reading the chain).
- [ ] `/reputation` paginates and supports conditional requests (ETag).
- [ ] Time-decay and negative attestations are reflected in the default policy, with tests.
- [ ] The trust policy is pluggable and documented; the default is specified.

**Risks.** Sybil resistance is an arms race with no perfect solution (this is honestly flagged in the spec as an open frontier). The goal is to make it *economically irrational* at the scales we expect, and to keep the policy in the consumer's hands. Don't claim it is "solved."

---

# Section 6 — The registry at scale (discovery, federation, persistence, caching)

**Goal.** A registry that persists (Section 2), federates reliably, serves discovery fast under load, and that no single party controls — the "DNS/Google of agents," done right.

**Why.** Discovery is where, historically, the value of a network concentrates (DNS, Google). It is also the component most likely to be a bottleneck or a censorship point, so it must be fast, persistent, and federated.

## 6.1 — Persistent, indexed discovery

- Back the registry with Postgres (Section 2); `RESOLVE` becomes an indexed query on `node_capabilities`.
- Add **filtering** in `RESOLVE`: by capability, by minimum reputation summary, by region/locale, by price ceiling — pushing selectivity to the registry so the agent pulls fewer candidates (the pull-not-push efficiency).
- **Pagination** on results.

## 6.2 — Robust federation

The prototype gossips on registration. Production federation needs:
- **Anti-entropy sync:** periodic reconciliation between peers (not just push-on-write), so a registry that was offline catches up. A simple approach: each registry exposes a `/since?ts=` feed of registrations; peers pull deltas.
- **Loop & dedupe:** content-addressed registration ids so the same node re-gossiped is idempotent (already partly handled).
- **Trust between registries:** a registry should not blindly accept a peer's claims; it re-verifies the Manifest (signature/structure) before indexing. Registries are *replicators*, not authorities.
- **No global authority:** document that anyone can run a registry; agents may query several and merge. The network is the set of nodes, not any registry.

## 6.3 — Manifest hosting & verification

- A node's Manifest is fetched from its `manifest_url` (or resolved from its DID Document for `did:web`). The registry stores a **pointer**; the agent fetches the full Manifest lazily (the two-stage design) and **re-verifies** it against the node's DID before trusting it.
- Add a **Manifest signature**: the node signs its own Manifest so the registry/agent can verify the Manifest is authentic and unaltered, independent of where it is hosted. (The prototype's Manifest is unsigned — add a `sig`.)

## 6.4 — Caching & performance

- HTTP caching headers (ETag, Cache-Control) on Manifests and reputation.
- A read cache in the registry for hot capabilities.
- Load targets: define and test (e.g. p99 RESOLVE latency < 50ms at X req/s).

**Acceptance criteria for Section 6.**
- [ ] RESOLVE is an indexed DB query with capability + reputation + price filtering and pagination.
- [ ] Two registries reconcile via anti-entropy: stop one, register at the other, restart, and it catches up.
- [ ] A registry re-verifies Manifests (signed) before indexing; a forged Manifest is rejected.
- [ ] A load test meets a stated p99 latency target.
- [ ] Documentation: "how to run your own registry and federate it."

**Risks.** Federation correctness (split-brain, stale data) is subtle; keep the model simple (re-verifiable, idempotent, eventually-consistent) and test the catch-up path. Resist making the registry "smart" — it is a replicating index, not an authority (the end-to-end principle).

---

# Section 7 — Security (threat model, authz, rate limiting, audit)

**Goal.** A written threat model, every gate enforced and tested, basic abuse defenses live, and — before any real value — a professional external audit of the core crypto and the escrow contract.

**Why.** Aleph moves trust and (eventually) money between mutually-distrusting parties over the open internet. Security is not a feature here; it is the product. A single exploited flaw in the waist or the escrow contract can end the project's credibility permanently.

## 7.1 — Write the threat model

Create `spec/THREAT-MODEL.md` enumerating adversaries and mitigations. At minimum:

| Threat | Vector | Mitigation (where) |
|---|---|---|
| Impersonation | forge a signature / claim another DID | Ed25519/secp256k1 verify against the DID (§3) |
| Replay | resend a captured envelope | nonce store + skew window (§A1, persisted §2) |
| Message confusion | reuse a RECEIPT sig as an INVOKE | domain separation (§3.1) |
| Sybil / wash-trust | self-deal to fake reputation | settlement-backed + diversity-weighted trust (§5) |
| Escrow theft | reentrancy / double-release | audited contract + ReentrancyGuard (§4) |
| Funds locked forever | counterparty vanishes | deadline auto-refund (§4) |
| DoS | flood registry/node | rate limiting + body caps (§7.3) |
| Manifest tampering | serve a forged manifest | signed Manifest, re-verified (§6.3) |
| Key theft | steal a private key | KMS/encrypted keystore + rotation/revocation (§3.3) |
| Malicious capability | node returns harmful output | bounded Grant + reputation + risk field; agent sandboxing (§7.4) |
| Registry censorship | a registry hides a node | federation, query several, no authority (§6) |

For each, link the exact code/test that enforces the mitigation. A threat with no linked test is an open hole.

## 7.2 — Authorization model, fully specified

- The **Grant** is the authorization primitive. Specify precisely: scope matching, limit semantics (per-call vs cumulative), expiry, and **sub-delegation** (`delegable`) rules — including a depth limit and a chain-verification (a sub-grant cannot exceed its parent's scope).
- Define **capability-scoped payment limits**: a Grant that authorizes `payment.spend ≤ €X` must be enforced jointly by the node *and* checked against the escrow amount.

## 7.3 — Abuse defenses

- **Rate limiting:** per-DID and per-IP token-bucket limits on RESOLVE/INVOKE/register. (A library like a token-bucket in front of the HTTP handlers.)
- **Proof-of-work or stake for registration** (optional): make spamming the registry with fake nodes costly.
- **Body & complexity caps:** already have a size cap; add limits on array sizes, nesting depth, and number of capabilities per Manifest.
- **Connection limits & timeouts:** request timeouts, max concurrent connections, slow-loris protection (set `server.headersTimeout`, `requestTimeout`).

## 7.4 — Agent-side safety (the consumer's risk)

A node can return malicious *content*. The agent calling it must treat results as untrusted input:
- Document that capability outputs are untrusted; agents should validate output against the declared schema and never execute returned content blindly.
- The `risk` and `reversibility` Manifest fields let an agent require principal confirmation for dangerous actions.

## 7.5 — The external audit (gate to mainnet)

- **Core crypto & protocol:** engage a firm to review canonicalization, signature/domain-separation, replay, and key management.
- **Smart contract:** a dedicated Solidity audit of `AlephEscrow.sol` (this is non-negotiable before real value).
- **Process:** freeze the audited code, publish the report, fix findings, re-review criticals.
- **Bug bounty:** stand up a bounty program (e.g. on a bounty platform) before mainnet.

**Acceptance criteria for Section 7.**
- [ ] `spec/THREAT-MODEL.md` exists; every row links to enforcing code + a test.
- [ ] Grant sub-delegation is specified and enforced (a sub-grant exceeding its parent is rejected, with a test).
- [ ] Rate limiting is live on all public endpoints, with tests.
- [ ] HTTP server hardening (timeouts, connection caps) is configured.
- [ ] Testnet launch: internal review + threat model complete.
- [ ] Mainnet gate: external core audit + contract audit passed, report published, bug bounty live.

**Risks.** The temptation is to skip the audit "because it's just testnet." Hold the line: the audit gates *mainnet*, but the threat model and the gate-tests are required even for testnet. Security debt compounds silently.

---

# Section 8 — Observability (logs, metrics, traces, alerts)

**Goal.** When the deployed registry or a node misbehaves at 3am, you can see *what* happened and *why*, and you are alerted before users notice.

**Why.** "It works on my machine" has no meaning in production. A network you cannot observe is a network you cannot operate or trust. Observability is also how you *prove* the network is healthy to the people you're asking to build on it.

## 8.1 — Structured logging

- Replace `console.log` with a structured logger (`pino`) emitting JSON logs with levels, request ids, and DID context.
- **Never log secrets** (private keys, full tokens). Redact by policy.
- Correlate a request across services with a propagated request id (and tie it to the Envelope `nonce`).

## 8.2 — Metrics

- Expose Prometheus metrics (`/metrics`): request rates and latencies per verb, error rates per `AlephErrorCode`, RESOLVE result counts, settlement success/refund counts, reputation queries, DB query latency.
- Define **SLOs** (e.g. RESOLVE p99 < 50ms, INVOKE availability > 99.5%).

## 8.3 — Tracing

- OpenTelemetry spans across the agent → registry → node → chain path, so a slow composition can be diagnosed end to end.

## 8.4 — Alerting & dashboards

- Dashboards (Grafana) for the SLOs.
- Alerts: error-rate spike, settlement failure spike, DB saturation, registry federation lag, abnormal registration rate (possible Sybil flood).

**Acceptance criteria for Section 8.**
- [ ] Structured JSON logs with request correlation; a secrets-redaction test.
- [ ] `/metrics` exposes the key counters/histograms; a dashboard renders them.
- [ ] Traces span agent→registry→node→chain in the demo.
- [ ] At least the critical alerts (error spike, settlement failures, registration flood) are wired.

**Risks.** Over-instrumenting wastes time; start with the four golden signals (latency, traffic, errors, saturation) and the settlement/Sybil-specific counters that matter for *this* protocol.

---

# Section 9 — Deployment & infrastructure (containers, TLS, domains, secrets)

**Goal.** The registry and a reference node run reproducibly on the public internet over HTTPS, with managed secrets, automated deploys, and a documented "run your own" path so the network is genuinely decentralized.

**Why.** A protocol nobody can reach is not released. And a protocol only *you* can run is not a network. This section makes Aleph both reachable and reproducible by anyone.

## 9.1 — Containerization

- A `Dockerfile` per deployable (`apps/registry-server`, `apps/demo-node`): multi-stage build (build with full toolchain → slim runtime image), non-root user, pinned base image, healthcheck.
- A `docker-compose.yml` for local full-stack (registry + node + Postgres) so a contributor runs the whole network with one command.

```dockerfile
# apps/registry-server/Dockerfile (sketch)
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm -r build
FROM node:22-slim AS run
USER node
WORKDIR /app
COPY --from=build /app/apps/registry-server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
HEALTHCHECK CMD node dist/healthcheck.js
CMD ["node", "dist/server.js"]
```

## 9.2 — Hosting

- **Registry:** a managed platform (Fly.io / Railway / Render) or a small Kubernetes cluster, with managed Postgres. Start simple (one platform), document scaling later.
- **TLS:** HTTPS everywhere (the platform's managed certs, or Caddy/Traefik with automatic Let's Encrypt). `did:web` *requires* valid TLS.
- **Domains:** a real domain for the canonical registry and for `did:web` identities.

## 9.3 — Secrets & config

- Secrets (DB creds, KMS access, the registry's signing key, RPC keys for the chain) via the platform's secret store — never in the repo, never in plain env files committed.
- A typed config loader with validation (fail fast on missing/invalid config).
- Separate config per environment (local / testnet / mainnet).

## 9.4 — Release & rollback

- CD: on a tagged release, CI builds images, runs migrations, deploys, and can roll back.
- **Migrations run before the new code** (and must be backward-compatible for zero-downtime).
- A documented rollback procedure.

## 9.5 — "Run your own node/registry" guide

- A `docs/operators/` guide: minimum hardware, `docker run` one-liner, how to register, how to federate a registry, how to back up. This is what makes the network *decentralized in practice*, not just in theory.

**Acceptance criteria for Section 9.**
- [ ] `docker compose up` brings up registry + node + Postgres locally; the demo passes against it.
- [ ] The registry is deployed at a real HTTPS domain; a `did:web` identity resolves against it.
- [ ] Secrets are in a managed store; nothing sensitive in the repo (a secret-scan in CI confirms).
- [ ] A tagged release auto-deploys; rollback is tested.
- [ ] A stranger can follow `docs/operators/` and run a node that registers and is discoverable.

**Risks.** Cloud lock-in and cost creep; keep the deployable a plain container so it runs anywhere. The "run your own" path is easy to neglect and essential to the decentralization claim — test it with a fresh machine.

---

# Section 10 — SDKs & developer experience

**Goal.** A developer (or an agent author) can integrate Aleph in minutes: install a package, read clear docs, run an example, and ship a node or an agent integration.

**Why.** A protocol's adoption is bounded by how easy it is to build on. The thin waist is for machines; the SDK is for the humans who build the machines. This is the "edges are smart" principle applied to developer experience.

## 10.1 — The TypeScript SDK (the reference)

- Publish `@aleph/client`, `@aleph/node`, `@aleph/core`, `@aleph/mcp` to npm via changesets.
- Stable, documented public API (the `index.ts` barrel already exists — formalize it as the semver surface).
- TypeDoc-generated API reference.

## 10.2 — A second-language SDK (proves the spec, widens adoption)

- **Python** (`aleph-protocol` on PyPI) — the language of most AI/agent work. Implement the client + node minimally.
- Critically, the Python SDK **must reproduce the canonicalization test vectors** (§3.1) — this is the proof the protocol is truly language-independent, not just "whatever the TS code does."

## 10.3 — The docs site

- A static docs site (Docusaurus/Astro) at a real domain: concept guides (the five verbs), quickstarts (run a node in 10 minutes, integrate an agent), the full spec, the AIP index, API reference, operator guides.
- Every concept page links to runnable code.

## 10.4 — Examples & templates

- `examples/`: a minimal node, a paid node, an agent that resolves+invokes+pays, a composition across nodes, an MCP integration.
- A `create-aleph-node` scaffolder (`npx create-aleph-node`) generating a working node skeleton.

**Acceptance criteria for Section 10.**
- [ ] `npm i @aleph/client` works; a 10-line example resolves+invokes against the live testnet registry.
- [ ] The Python SDK reproduces the canonicalization vectors byte-for-byte and can invoke a TS node (cross-language interop proven).
- [ ] The docs site is live with quickstarts, spec, and API reference.
- [ ] `npx create-aleph-node` produces a node that registers and serves a capability.

**Risks.** Maintaining two SDKs doubles surface; keep the Python one minimal (client + node) and vector-locked to the spec. Docs rot — wire doc examples into CI where possible.

---

# Section 11 — Real capability nodes & the vocabulary

**Goal.** At least a few *genuinely useful* nodes exist on the network at launch, and the capability vocabulary is rich and governed enough to describe real work.

**Why.** A network whose only capability is `math.add` demonstrates the protocol but gives no one a reason to use it. Launch needs nodes an agent actually wants, and a shared vocabulary so two nodes offering "the same thing" really match.

## 11.1 — Seed the vocabulary for real

- Expand `SEED_VOCABULARY` (§E3) into a curated set covering the launch nodes' domains, each with a JSON Schema for input/output, a description, and a risk default.
- Stand up the **AIP-style proposal flow** for new keys (§12): a PR to `spec/vocabulary/` with schema + rationale.

## 11.2 — Build reference nodes

Pick capabilities that are useful, safe, and easy to verify. Candidates:
- `data.geocode` (place → coordinates) — useful, deterministic, easy to verify.
- `compute.inference` (run a prompt against an open model) — directly relevant to agents; ties to the "compute as the bottleneck" thesis.
- `text.summarize`, `data.fetch` (fetch + clean a URL into structured data) — the "turn a human page into agent data" deficit, solved.
- A `priced` node (charges via the EVM rail) to exercise PAY + reputation end to end with a real service.

## 11.3 — A flagship demonstration

Build one end-to-end demo that tells the story: an agent, given a real task, **resolves** several nodes, **ranks by trust**, **composes** two or three, **pays** each on testnet, and returns a result with a **verifiable receipt chain** — all via MCP, drivable from Claude. This is the launch's centerpiece.

**Acceptance criteria for Section 11.**
- [ ] ≥4 useful capabilities live on the testnet network, each with a schema and reputation.
- [ ] ≥1 priced node settles on testnet and accrues real (testnet-backed) reputation.
- [ ] The flagship composition demo runs end to end via MCP and is recorded for the launch.
- [ ] The vocabulary proposal flow is documented and has accepted at least one community-style proposal.

**Risks.** Scope creep into building products instead of demonstrations — keep nodes small and verifiable. `compute.inference` raises content-safety and cost questions; gate it behind sane limits.

---

# Section 12 — Protocol governance & the v1 spec freeze

**Goal.** The normative spec is complete, matches the code exactly, is frozen at a stable major version, and there is a public process for evolving it without breaking the network.

**Why.** Others will build on the waist. The waist must stop moving (§2.3 of the protocol: the waist is near-frozen). A spec that drifts from the code, or changes silently, destroys interoperability and trust.

## 12.1 — Spec ↔ code lockstep

- Audit `aleph-manifest-spec.md` against the implemented behavior end to end; every MUST has a corresponding test; every implemented gate is in the spec.
- Publish **test vectors** (`spec/test-vectors/`) for envelopes, grants, canonicalization, attestations — the machine-checkable definition of conformance.
- A conformance test-suite any implementation can run to claim "Aleph v1 compliant."

## 12.2 — The AIP process

- `spec/aips/` with a template (`AIP-0: the process`, `AIP-1: …`). Status flow: Draft → Review → Accepted/Rejected → Final.
- Rules: changes to the **waist** require an AIP + broad review + a major-version bump; **layer** changes are lighter. Encode the §2.3 asymmetry (waist near-frozen, layers free).
- A versioning policy (semver for packages; a separate protocol-version for the wire format).

## 12.3 — Freeze v1.0 of the wire format

- Declare the Envelope/Manifest/Grant wire format **v1.0** once the testnet has validated it and the audit is clean.
- After freeze, the waist changes only via AIP + major bump; this is the promise that lets the ecosystem grow.

**Acceptance criteria for Section 12.**
- [ ] Spec and code are in lockstep; a conformance suite passes against the reference implementation.
- [ ] Test vectors published and reproduced by the Python SDK.
- [ ] The AIP process is documented (`AIP-0`) with at least the template and the waist-vs-layer rule.
- [ ] Wire format v1.0 is tagged and declared frozen (post-testnet, post-audit).

**Risks.** Freezing too early locks in mistakes; freezing too late means no one can rely on it. The sequencing — testnet validates, audit clears, *then* freeze — manages this. Keep the frozen surface as small as possible (the thin waist) so the freeze is safe.

---

# Section 13 — Public launch (testnet → mainnet, docs site, community)

**Goal.** Aleph is released to the world: a live public testnet network, a docs site, an announcement, an open contribution process — then, after the audit and legal review, a mainnet with real value.

**Why.** This is the point of all the prior sections. But "launch" is two launches: a low-risk testnet release to gather real usage and trust, and a later high-stakes mainnet release with real money. Conflating them is how projects get hurt.

## 13.1 — Testnet launch (the first release to the world)

Checklist:
- [ ] Registry live at a real HTTPS domain; ≥4 useful nodes registered (§11).
- [ ] Escrow contract on Base Sepolia; settlement working with a testnet stablecoin + faucet (§4).
- [ ] SDKs published to npm/PyPI; docs site live (§10).
- [ ] MCP integration documented; flagship demo recorded (§11.3).
- [ ] Threat model + internal review done; rate limiting + observability live (§7, §8).
- [ ] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, the AIP process (§12).
- [ ] Announcement: a clear writeup (what it is, why, how to try it), the demo video, the GitHub.

## 13.2 — Gather, learn, iterate

- Run the testnet for a real period; collect usage, break things, fix them, accept community AIPs and nodes. This is the *product phase* generating the validation that justifies mainnet.

## 13.3 — Mainnet launch (real value)

Gated by:
- [ ] External core audit + contract audit passed; report published; criticals fixed (§7.5).
- [ ] Legal review: money-transmission/regulatory analysis for the stablecoin settlement and the usage-credit token in target jurisdictions; the non-refundable usage-credit guardrail validated by counsel.
- [ ] Bug bounty live; an incident-response plan documented.
- [ ] Mainnet contract deployed; a real on-ramp path; key custody via KMS.
- [ ] Wire format frozen at v1.0 (§12).

## 13.4 — Sustainability

- A model for keeping the canonical registry funded (and the decentralization story that means it isn't a single point of failure).
- A maintenance cadence, a security contact, a release schedule.

**Acceptance criteria for Section 13.**
- [ ] Testnet: a stranger, from the docs alone, runs a node, registers it, and an agent discovers+invokes+pays it on testnet — with no help.
- [ ] The announcement is published; the repo is contribution-ready.
- [ ] Mainnet (later): all mainnet gates above are checked, audits published, legal sign-off recorded.

**Risks.** The legal/regulatory dimension of moving value is real and jurisdiction-specific — do not skip counsel before mainnet. The other risk is launching to silence; line up the first nodes and the demo so day one shows the network *doing something*, per the lesson that a network must show value on day one.

---

# Appendix A — Recommended technology stack (with rationale)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 22 LTS) | Already the reference; strong types for a protocol; native crypto. |
| 2nd SDK | Python | The agent/AI ecosystem's language; proves cross-language conformance. |
| Package mgr | pnpm + workspaces | Fast, strict, monorepo-native. |
| Build | tsup (esbuild) | ESM + d.ts, fast, simple. |
| Tests | node:test + c8 | Zero-dep, already used; coverage. |
| Releases | changesets | Disciplined semver + npm publishing. |
| DB | PostgreSQL (prod) / SQLite (dev, nodes) | Transactional + ubiquitous / zero-setup for node operators. |
| DB access | Drizzle ORM | Typed, SQL-first, typed migrations. |
| Chain | EVM L2 (Base), testnet first | Cheap, trustless settlement; the thesis substrate. |
| Contracts | Solidity + Foundry | Standard, fuzzable, fast tests. |
| Chain client | viem | Typed, modern EVM client. |
| Stablecoin | USDC (testnet faucet → mainnet) | Liquid, regulated, widely supported. |
| Crypto | Ed25519 (did:key/web) + secp256k1 (did:pkh) | Standard suites; chain-compatible. |
| Canonicalization | RFC 8785 (JCS) | The cross-language interop guarantee. |
| Logging | pino | Structured, fast. |
| Metrics/traces | Prometheus + OpenTelemetry + Grafana | Industry standard observability. |
| Containers | Docker (multi-stage) | Reproducible, run-anywhere. |
| Hosting | Fly.io/Railway/Render + managed Postgres | Simple to start; portable container. |
| TLS | Managed certs / Caddy (Let's Encrypt) | Required for did:web; automatic. |
| Secrets | Platform secret store / KMS | No plaintext keys, ever. |
| Docs | Docusaurus/Astro | Static, fast, versionable. |

**Principle:** every choice favors *standard, auditable, portable* over clever. A protocol is a trust object; boring, well-understood tech is a feature.

---

# Appendix B — Milestone timeline & critical path

A realistic sequence (focused solo/small-team effort). Weeks are indicative, not promises.

| Milestone | Sections | ~Effort |
|---|---|---|
| **M1 — Production skeleton** | 0, 1, 2 | 1–2 weeks |
| **M2 — Hardened core** | 3 | 1 week |
| **M3 — Real settlement (testnet)** | 4 | 1–2 weeks |
| **M4 — Trust & registry at scale** | 5, 6 | 1–1.5 weeks |
| **M5 — Security, observability, deploy** | 7 (internal), 8, 9 | 1.5 weeks |
| **M6 — SDKs, nodes, docs** | 10, 11 | 1.5 weeks |
| **M7 — Spec freeze + testnet launch** | 12, 13.1 | 1 week |
| **— Mainnet** | 7 (audit), 13.3 | +external audit + legal (weeks–months) |

**Critical path:** 0 → 1 → 2 → 3 → 4 → (5,6 parallel) → 7/8/9 → 10/11 → 12 → 13.1. Settlement (4) and the audit (7.5) are the long poles; everything that can be parallelized around them should be.

**The honest total:** ~8–10 focused weeks to a credible **public testnet launch** (a real release to the world). Mainnet with real value is gated by an external audit and legal review and should not be rushed.

---

# Appendix C — Definition of Done for "released to the world"

Aleph is *released to the world* (testnet) when **all** of these are true:

1. A stranger, using only the public docs, can install the SDK and, in minutes, have an agent discover → trust-rank → invoke → pay (testnet) → verify a node — with no help from us.
2. A stranger can run their own node and registry from the operator docs, and it federates into the live network.
3. The wire format is specified with published test vectors, and a second-language (Python) SDK reproduces them.
4. The five verbs work over the public internet, over HTTPS, against persistent storage, with rate limiting and observability live.
5. Settlement is real (on testnet), backing real (testnet) reputation, with the escrow contract deployed and its tests + threat model published.
6. The repo is contribution-ready: license chosen, CONTRIBUTING/AIP process, CI green, issue/PR templates.
7. There is a recorded flagship demo and a public announcement.

Aleph is *released with real value* (mainnet) when, additionally: the external core + contract audits have passed and been published; legal/regulatory review of settlement and the usage-credit token is complete; a bug bounty and incident-response plan are live; and the wire format is frozen at v1.0.

> **Closing note.** This roadmap is itself a living document: when reality contradicts a section, the section changes. Build in dependency order, keep the waist small and the tests green, ship the testnet to the world, learn from it, and only then carry real value. That sequence — prove it works, release it small, earn trust, then raise the stakes — is how a protocol becomes infrastructure instead of a demo.
