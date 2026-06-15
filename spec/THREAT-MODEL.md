# Threat model

> Aleph moves trust and (eventually) money between mutually-distrusting parties
> over the open internet. Security is not a feature here; it is the product. This
> document enumerates adversaries and the mitigation that defends against each —
> **with the exact code and test that enforces it. A threat with no linked test
> is an open hole.**

## Scope

The protocol surface: the thin waist (DID + Envelope + Manifest + Grant), the
reputation layer, the settlement rail + escrow contract, the registry, and the
agent SDK. Out of scope: the security of a node's own capability implementation,
the host OS/TLS termination, and the fiat on-ramp (an honestly-open boundary,
see `SETTLEMENT.md`).

## Adversaries & mitigations

| Threat | Vector | Mitigation | Enforcing code | Test |
|---|---|---|---|---|
| **Impersonation** | forge a signature / claim another DID | every message verified against the DID's public key (Ed25519 / secp256k1) | `packages/core/src/signing.ts`, `identity.ts` (`verifyByDid`) | `e2e/test/core.test.ts`, `secp256k1.test.ts` |
| **Replay / clock skew / bad version** | resend a captured envelope; stale/future timestamp; unknown version | per-(DID,nonce) store + timestamp skew window + version check; persisted so it survives restart | `packages/core/src/replay.ts`, `envelope.ts` (`verifyReceived`); `@aleph/store` nonces | `e2e/test/hardening.test.ts`, `store-*.test.ts`, `persistence.test.ts` |
| **Message confusion** | reuse a RECEIPT signature as an INVOKE (or any cross-type) | domain-separated signing: each kind signs `<domain>\n<JCS>` | `packages/core/src/signing.ts` (`DOMAIN`) | `e2e/test/domain-separation.test.ts` |
| **Canonicalization mismatch** | exploit JSON ambiguity to make one bytes verify as another | RFC 8785 (JCS) strict canonicalization, byte-exact vectors | `packages/core/src/canonical.ts` | `e2e/test/canonical.test.ts` |
| **Sybil / wash-trust** | self-deal to manufacture reputation | attestations must be settlement-backed; trust is diversity-weighted + decayed, consumer-computed | `packages/core/src/trust/attest.ts` | `e2e/test/reputation-scale.test.ts`, `trust.test.ts` |
| **Forged reputation** | fabricate a settlement reference | on-chain verification hook re-reads the chain; a fake reference earns zero | `packages/core/src/trust/attest.ts` (`computeTrustAsync`), `@aleph/settle-evm` (`evmSettlementVerifier`) | `e2e/test/settle-evm.test.ts`, `trust.test.ts` |
| **Escrow theft** | reentrancy / double-release | immutable escrow, `ReentrancyGuard` + checks-effects-interactions + `SafeERC20` | `contracts/src/AlephEscrow.sol` | `contracts/test/AlephEscrow.t.sol`, `Reentrancy.t.sol` |
| **Funds locked forever** | counterparty vanishes | deadline auto-refund; payee may refund early | `contracts/src/AlephEscrow.sol`, `packages/settle-evm/src/rail.ts` | `contracts/test/AlephEscrow.t.sol`, `e2e/test/settle-evm.test.ts` |
| **Over-spend by an agent** | agent pays more than authorized | bounded Grant: capability-scoped `max_eur` enforced jointly with the escrow amount | `packages/core/src/grant.ts`, `packages/node/src/node.ts` | `e2e/test/grant.test.ts` |
| **Privilege escalation via delegation** | a sub-agent widens its grant | sub-grant ⊆ parent (scope/limit/expiry), depth-bounded, chain re-verified to the root | `packages/core/src/grant.ts` (`createSubGrant`, `verifyGrant`) | `e2e/test/grant.test.ts` |
| **DoS** | flood / oversized / pathological payload | per-IP + per-DID token-bucket rate limit; 1 MB body cap; structural complexity caps; slow-loris timeouts + connection cap | `packages/transport/src/http.ts` (`RateLimiter`, `readJson`, `hardenServer`), `packages/core/src/complexity.ts` | `e2e/test/security.test.ts` |
| **Manifest tampering** | serve a forged/substituted Manifest | Manifest is self-signed; the agent re-verifies signature + pins the resolved DID; the registry re-verifies before indexing | `packages/core/src/manifest.ts`, `packages/client/src/client.ts` (`fetchManifest`), `packages/registry/src/registry.ts` | `e2e/test/network.test.ts` |
| **Key theft** | steal a private key at rest | encrypted keystore (scrypt + AES-GCM); key rotation with validity windows | `packages/core/src/keystore.ts`, `keyring.ts` | `e2e/test/keystore.test.ts` |
| **Malicious capability output** | node returns harmful/garbage content | output is untrusted: validate against the declared output schema; gate high-risk/irreversible capabilities behind principal confirmation | `packages/client/src/client.ts` (`verifyOutput`, `requiresConfirmation`) | `e2e/test/agent-safety.test.ts` |
| **Registry censorship** | a registry hides a node | no authority: federated (gossip + anti-entropy), agents may query several and merge | `packages/registry/src/registry.ts` | `e2e/test/network.test.ts` |

## Residual risk & honest limits

- **Sybil resistance is an arms race**, not solved. Diversity weighting makes it
  *economically irrational* at expected scale; staking/slashing is a planned AIP
  (see `REPUTATION.md`, decision D8).
- **The fiat on-ramp** cannot be proven on-chain — an honestly-open boundary
  (`SETTLEMENT.md`).
- **did:pkh** (binding an on-chain address to a DID) is deferred; until it lands,
  EVM-backed attestations are verified for settlement authenticity but DID-level
  issuer-matching stays on the reference rail.

## The external audit (gate to mainnet)

The threat model and the gate-tests above are required **even for testnet**.
Before any **mainnet** (real value), the following are non-negotiable and are the
**owner's gate** (not automatable here):

- [ ] Independent audit of the **core crypto & protocol** (canonicalization,
  domain separation, replay, key management).
- [ ] Independent **Solidity audit** of `AlephEscrow.sol`.
- [ ] Freeze audited code, publish the report, fix findings, re-review criticals.
- [ ] Stand up a **bug bounty** before mainnet.

Until these pass, the deployment posture stays **testnet-first** (decision D7).
