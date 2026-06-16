# AGENTS.md — build continuity & modus operandi

> **Read this first.** This file lets an AI agent (or a human) resume building
> Aleph at full quality from a cold start — after a context clear, a new session,
> or a handoff. It captures *what* we're building, *how* we work, *where* things
> are, the *gotchas* already paid for, and *what's next*. Keep it updated as the
> source of truth for build state.

---

## 1. What Aleph is (the 30-second version)

Aleph is a **thin-waist protocol for an agent-native web**: it gives software
agents five verbs they lack today — **FIND, TRUST, ACT, PAY, PROVE** — without a
human in the loop and without a central authority. Every message is a signed,
addressed **Envelope** between two DIDs, carrying one of five types
(`RESOLVE / INVOKE / RECEIPT / ATTEST / SETTLE`). All richness (discovery,
reputation, settlement, identity) sits in **optional layers above** a tiny
universal core (the "thin waist": DID + Manifest + Envelope).

The vision/paper lives in `aleph-protocol-paper.md`, the wire spec in
`aleph-manifest-spec.md`, the from-scratch explainer in `foundations.md`, and the
production plan in `ROADMAP.md`. Architecture decisions are in `DECISIONS.md`
(D1–D7 so far). The lineage is the "Operative Ecosystem (ESO)" corpus.

Repo: **https://github.com/Leonardo-Corte/aleph-protocol** (account: Leonardo-Corte).

---

## 2. Modus operandi (HOW we work — follow this exactly)

We build at **production-finished quality, not prototype**. The discipline that
has kept the build green and trustworthy:

1. **Section → tasks.** Each ROADMAP section is broken into ~6–8 tracked tasks
   (use TaskCreate/TaskUpdate). Encode dependencies with `addBlockedBy`. Work
   lowest-id-ready first. Mark in_progress before starting, completed when truly
   done (gates green).
2. **One clean commit per sub-phase.** Conventional-commit style subject
   (`S<n>.<m>: …` or `feat:`/`fix:`), a body explaining *why*, and **always** end
   with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Push after each
   section (or sooner). Branch is `main` (solo project; committing to main is fine
   here, but never force-push).
3. **Gates must be green before commit.** In order:
   `pnpm -r typecheck` → `pnpm exec eslint …` → `pnpm exec prettier --check …`
   → `pnpm -r build` → tests → `pnpm test:coverage`. A pre-commit hook
   (husky + lint-staged) runs format+lint on staged files automatically.
4. **Tests as the safety net.** Every new behavior gets a test; every security
   gate gets a *negative* test (prove it bites). Integration tests live in `e2e/`.
5. **Verify in CI, not just locally.** After push, poll the run
   (`gh run list --limit 1`, then `gh run view <id>`). CI has caught real bugs
   local state hid (see Gotchas). Fix forward; keep CI green.
6. **Honesty over completeness.** When something genuinely belongs to a later
   section, or can't be verified here, **say so and defer it explicitly** (record
   in DECISIONS + ROADMAP) rather than shipping something unverified. We did this
   for `did:pkh` (→ §4 tooling) and the public-testnet deploy (owner's manual
   step). An honest deferral beats a fragile half-feature.
7. **The thin waist is near-frozen.** Changes to the Envelope/Manifest/Grant wire
   format need extra care (and, post-v1, an AIP). Layers evolve freely.
8. **Decisions the user owns:** anything legal/irreversible/business (license,
   real-money posture, naming). Ask via AskUserQuestion. Everything technically
   derivable: decide, document, proceed. The owner chose Apache-2.0 + CC-BY-4.0
   (the "Foundation" model), testnet-first, on-chain EVM settlement.

Tone with the user: Italian, direct, concise. Explain the *why*, recommend, then
act. The user wants real production work and is fine with it taking time.

---

## 3. Where things are (repo map)

```
packages/                      # pnpm workspace, @aleph/* packages
  core/        @aleph/core      — the thin waist, I/O-FREE. identity (did:key
               ed25519+secp256k1, did:web, did:pkh/eip155 via secp256k1 recovery),
               Signer abstraction, envelope, grant, manifest (signed),
               replay/NonceChecker, schema, canonical (RFC 8785), signing
               (domain separation, verifyByDid), keystore (scrypt+AES-GCM),
               keyring (rotation), resolver, vocabulary, settle/rail (in-memory
               reference) + settle/payments (PayerRail/PayeeRail/EscrowRef seam),
               trust/attest (pluggable TrustPolicy, diversity-weighted
               default, decay, revocation, computeTrustAsync) + chain, grant
               (sub-delegation chain), complexity caps, errors, hash, base58.
  transport/   @aleph/transport — node:http helpers (readJson 1MB cap, sendJson,
               asyncHandler, RateLimiter, clientIp, hardenServer) + observability
               (structured Logger w/ redaction, MetricsRegistry, trace helpers). PRIVATE.
  node/        @aleph/node      — capability provider runtime. Signs its Manifest;
               verifies grant-chain+schema+escrow; rate limit + complexity caps +
               server hardening; pluggable stores.
  registry/    @aleph/registry  — discovery; verifies Manifest sig; RegistryStore;
               filtered+paged RESOLVE; federation (gossip + anti-entropy /since +
               reconcile); short-TTL resolve cache.
  client/      @aleph/client    — agent SDK (THE target): resolve (filtered/paged)/
               resolveRanked/invoke/attest/fetchReputation (paginated)/
               fetchReputationSummary/fetchManifest (re-verifies + pins DID)/
               verifyOutput/requiresConfirmation (agent-side safety)/compose.
  mcp/         @aleph/mcp       — Aleph as an MCP server (buildAlephServer + bin):
               aleph_resolve (ranked by trust), aleph_invoke (pay via rail, verify
               output vs schema, risk-gate, attest). Production agent surface.
  create-aleph-node/  create-aleph-node — `npm create aleph-node` scaffolder.
  cli/         @aleph/cli       — THE deployable: keygen/registry/node/healthcheck/
               resolve/invoke; typed env config (config.ts, fail-fast); Postgres
               when DATABASE_URL set; EncryptedFileKeyStore.
  store/       @aleph/store     — async repos (Registry/Nonce/Reputation/Settlement)
               + drivers: in-memory, SQLite (node:sqlite), Postgres (postgres.js).
               Reputation: keyset pagination + summary. Registry: price/region/rep
               columns, filtered resolve, monotonic rev + changesSince feed.
  settle-evm/  @aleph/settle-evm — on-chain rail (viem) against AlephEscrow;
               evmSettlementVerifier (chain-reading trust hook); evmPayerRail/
               evmPayeeRail/evmPayerRailFromEnv (the PayerRail/PayeeRail seam →
               real value through client.invoke/compose).
contracts/                     # Foundry project (gitignored: lib/ out/ cache/)
  src/AlephEscrow.sol           — ERC-20 escrow (lock/release/refund), immutable.
  test/*.t.sol                  — Foundry tests incl. reentrancy.
e2e/                           # cross-package integration + contract tests (node:test)
  test/*.test.ts                — all real tests live here (per-package test=true noop)
  fixtures/, store-contract.ts  — shared helpers
examples/                      # runnable demos: run.ts, network.ts, flagship.ts
                                 (resolve→rank→compose→pay→receipt chain) +
                                 capabilities.ts (reference handlers: geocode, summarize)
spec/vocabulary/               # curated schema-bearing capability catalog + proposal flow
spec/
  test-vectors/jcs/             — official RFC 8785 vectors (PRETTIER-IGNORED, byte-exact)
  test-vectors/aleph/signing.json — Ed25519 signing vector
  aips/                         — AIP process (AIP-0)
  SETTLEMENT.md                 — on-chain settlement design + deploy procedure
  REPUTATION.md                 — trust policy spec (diversity weighting, decay,
                                  revocation, on-chain verification, pagination)
  REGISTRY.md                   — discovery/federation + run-your-own-registry guide
  THREAT-MODEL.md               — adversaries → mitigation, each linked to code + test
  OBSERVABILITY.md              — golden signals, metrics, SLOs, logging/tracing
deploy/observability/          — Prometheus alerts.yml + Grafana dashboard.json
docs/operators/                — run-your-own-node/registry guide + RELEASE.md
Dockerfile, docker-compose.yml — one-image-two-roles deployable + local full stack
scripts/secret-scan.mjs        — dependency-free CI secret scanner
sdk/python/                    — aleph_protocol Python SDK (canonical/identity/
                                 envelope/client) — pip-installable, vector-locked
conformance/python/            — drives the SDK vs the vectors + Python↔TS interop
docs/QUICKSTART.md             — agent-in-10-lines + run-a-node quickstart
.github/workflows/            — ci.yml (6 jobs, see §5) + release-images.yml (GHCR on tag)
```

Reading-order docs at root: `foundations.md` → `aleph-protocol-paper.md` →
`aleph-manifest-spec.md` → `ROADMAP.md`. `DECISIONS.md` = the ADR.

---

## 4. Environment & commands

- **Node 25** (CI matrix 22+24), **pnpm 9.15.9** (`corepack`). **Foundry** at
  `~/.foundry/bin` (forge/anvil/cast 1.7.1). Python 3 + `cryptography` for the
  conformance check. `gh` CLI authed as Leonardo-Corte.
- TypeScript runs natively (no build step to run); packages **build** via tsup
  (ESM + d.ts). Cross-package types resolve via `paths` → source in each
  `tsconfig.json` (so typecheck works before build — see Gotchas).

```bash
pnpm install                      # workspace
pnpm -r typecheck                 # strict tsc --noEmit, all packages
pnpm exec eslint "packages/*/src/**/*.ts" "e2e/**/*.ts" "examples/**/*.ts"
pnpm exec prettier --check "packages/**/*.ts" "e2e/**/*.ts" "examples/**/*.ts"
pnpm -r build
node --test "e2e/test/**/*.test.ts"        # the test suite (run from repo root or e2e/)
pnpm test:coverage                # c8 over built packages; thresholds in .c8rc.json
# contracts:
cd contracts && forge test && forge coverage --no-match-coverage 'test/|lib/' --report summary
# python conformance:
python3 conformance/python/run_vectors.py
```

Current state: **113 tests (112 pass, 1 skipped = postgres without DATABASE_URL)**,
all gates green. Coverage thresholds: lines/stmts 88, funcs 75, branches 68
(functions lowered because the Postgres/EVM drivers are CI-only).

---

## 5. CI (the merge gate) — `.github/workflows/ci.yml`

All jobs must stay green:
1. **build & test** (Node 22 + 24): install → typecheck → lint → format → build → test.
2. **coverage gate**: `pnpm test:coverage`.
3. **store contract (postgres)**: a postgres:17 service; runs the store contract suite with `DATABASE_URL`.
4. **cross-language conformance (python)**: `pip install cryptography`; runs `conformance/python/run_vectors.py`.
5. **contracts (foundry) + on-chain rail**: `forge test` + coverage, then the anvil integration test (`e2e/test/settle-evm.test.ts`).
6. **secret scan**: `node scripts/secret-scan.mjs` (PEM keys, provider tokens, committed .env).
7. **cross-language conformance (python)** + **cross-language interop (python ↔ ts node)**: the Python SDK reproduces the vectors and a Python-signed INVOKE is answered by a TS node.

`release-images.yml` builds + pushes the container image to GHCR on a **version
tag** (or manual dispatch). `release.yml` (npm) is **manual** until launch.

---

## 6. Gotchas already paid for (don't relearn these)

- **`node:sqlite`** must be loaded via `createRequire("node:sqlite")` — bundlers
  strip the `node:` prefix (it only exists prefixed) and break it.
- **Prettier vs test vectors**: `spec/test-vectors/` is in `.prettierignore` — the
  JCS vectors must stay byte-exact or canonicalization tests fail.
- **Postgres concurrency**: determine first-seen atomically with
  `RETURNING (xmax = 0)`, never SELECT-then-INSERT (races under real parallelism;
  in-memory/SQLite serialize and hide it — the Postgres CI job caught it).
- **CI typechecks before building**, so every package that transitively imports
  another `@aleph/*` needs that path in its `tsconfig.json` `paths` (else tsc
  falls back to a not-yet-built dist). Add paths when adding cross-package deps.
- **Prettier reformats** files between Read and Edit; if an Edit fails "file
  modified", re-Read or use sed/python for precise swaps.
- **zsh reserves `status`** — use another var name in bash loops.
- **anvil in CI**: foundry-toolchain already puts it at `~/.foundry/bin/anvil`;
  symlink only `if [ ! -e ]`.
- **Domain separation**: signatures are over `<domain>\n<RFC8785(obj)>`. If you
  hand-construct a signed object in a test, use `signEd25519(DOMAIN.x, obj, key)`.
- **Async ripple**: stores, nonce checking, and the EVM rail are async; the
  in-memory rail is sync. Keep the in-memory default so existing sync paths work;
  new persistent paths await.
- Per-package `test` script is `true` (noop); **real tests run from `e2e/`**.
  When adding a test that needs a dep (viem, etc.), add it to `e2e`'s devDeps.

---

## 7. Status & what's next

**Done:** S0 (decisions) · S1 (monorepo/CI/quality gates) · S2 (persistence:
async stores + SQLite/Postgres + restart durability) · S3 (hardened core: RFC
8785, domain separation, signed Manifest, Ed25519+secp256k1, did:web, key
mgmt/rotation, cross-language proof) · S4 (on-chain settlement: AlephEscrow +
viem rail + anvil integration + Foundry CI) · S5 (reputation & anti-Sybil at
scale: pluggable diversity-weighted TrustPolicy, decay, negative attestations +
signed revocation, on-chain verification hook, paginated/summarised retrieval,
wash-trading acceptance test — DECISIONS D8, spec/REPUTATION.md) · **S6 (registry
at scale: filtered+paged indexed discovery, anti-entropy federation /since +
reconcile, lazy manifest re-verification + DID pinning, ETag/cache + p99 load
test — DECISIONS D9, spec/REGISTRY.md). Closes Milestone M2. · **S7 (security:
threat model with tested mitigations, grant sub-delegation chain, per-IP/per-DID
rate limiting + complexity caps + server hardening, agent-side safety — DECISIONS
D10, spec/THREAT-MODEL.md). · **S8 (observability: dependency-free structured
logging w/ secret redaction + trace correlation, Prometheus /metrics, SLOs +
alerts + Grafana dashboard — DECISIONS D11, spec/OBSERVABILITY.md). · **S9
(deployment: one-image-two-roles Dockerfile + docker-compose, CLI as deployable
w/ env-validated config + /healthz, GHCR release + additive-migration rollback,
CI secret scan, docs/operators guide — DECISIONS D12). Closes Milestone M3. · **S10
(SDKs & DX: TS reference publish-ready via changesets/TypeDoc, vector-locked Python
SDK + cross-language interop test, create-aleph-node scaffolder, quickstart —
DECISIONS D13). · **S11 (capability nodes: schema-bearing vocabulary catalog +
proposal flow, deterministic reference nodes geocode/summarize + a priced one,
flagship resolve→rank→compose→pay→receipt-chain demo — DECISIONS D14).**

**Deferred (tracked):** `did:pkh` (eip155 recovery) → chain tooling, and it now
also gates binding on-chain settlement *addresses* to attesting *DIDs* (S5.3);
public-testnet deploy of AlephEscrow → owner's manual step (verified on anvil);
**staking/slashing** for reputation → a planned AIP (D8); **external core +
contract audit + bug bounty** → owner's manual gate to MAINNET (D10, ROADMAP §7.5);
**cloud platform + real HTTPS domain + CD auto-deploy + rollback drill** → owner's
manual step (image/compose/config/migrations/rollback all ready; D12, ROADMAP §9);
**npm + PyPI publish + docs-site-at-domain + live testnet** → owner's manual step
(packages publish-ready, Python pkg + scaffolder + quickstart ready; D13, ROADMAP §10);
**capabilities live on a public testnet + recorded MCP launch demo** → owner's deploy
step (5 schema'd caps + reference/priced nodes + flagship demo all run+tested; D14, §11).

**On-chain PAY through the agent — DONE (was the one real product gap).**
Settlement is an injectable seam (`@aleph/core`: `PayerRail`/`PayeeRail`/
`EscrowRef`), so `client.invoke`/`compose` move value over the in-memory rail OR
the on-chain EVM rail unchanged, via the contract's payer-release flow (agent
locks → node verifies lock → agent releases on verified receipt). `@aleph/settle-evm`
adds `evmPayerRail`/`evmPayeeRail`/`evmPayerRailFromEnv`; the `aleph-mcp` bin
auto-enables it from `ALEPH_EVM_*` env. Proven on anvil
(`e2e/test/settle-evm-agent.test.ts`): real ERC-20 moves through invoke + compose.

**did:pkh — DONE (closes the last two deferrals).** `did:pkh:eip155:<chain>:<addr>`
is a first-class verifiable identity (secp256k1 recovery in core, no new dep; a
`Signer` abstraction lets envelopes/manifests/attestations be signed by any
suite). A did:pkh node's payout address is DERIVED from its DID (no trusted
ext.payTo). On-chain-backed attestations are verified node-side by
`verifyAttestationOnChain` (chain read + did:pkh address binding) via
`evmAttestationVerifier`; reputation accrues from real on-chain value. Tests:
`pkh.test.ts`, `settle-evm-agent.test.ts` (pkh node), `attest-onchain.test.ts`.

**NEXT — Section 12: Protocol governance & the v1 spec freeze.** Per ROADMAP §12:
audit the manifest spec ↔ code in lockstep (every MUST has a test), publish the
conformance test-suite + vectors (reproduced by the Python SDK), formalize the
AIP process (`spec/aips/`: Draft→Review→Accepted→Final; waist-vs-layer rule +
versioning), and freeze the Envelope/Manifest/Grant wire format at **v1.0**.
(S0–S11 done; M1–M3 closed, M4 in progress — §12 completes the launch track.)

---

## 8. First moves after a clear

1. `cd /Users/corte/aleph-protocol`; skim this file + the tail of `ROADMAP.md` §5.
2. `pnpm install && pnpm -r build && node --test "e2e/test/**/*.test.ts"` — confirm green (59 pass / 1 skip).
3. Create the S5 task plan (TaskCreate), then execute lowest-id-first, committing per sub-phase, pushing, and verifying CI — exactly as §2 describes.
4. Keep this file current as state advances.
