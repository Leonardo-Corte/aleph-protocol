# Reputation & trust (the TRUST verb)

> Status: implemented and tested (ROADMAP §5, decision D8). The default trust
> policy, decay, negative attestations, revocation, the on-chain verification
> hook, and paginated/summarised retrieval are all in `@aleph/core` +
> `@aleph/node` + `@aleph/store`. Sybil resistance is an open frontier, not a
> solved problem — see "Honest limits".

## What it is

An **attestation** is a signed statement by one party (the *issuer* / payer)
about another (the *subject* / payee), and it **only counts if it references a
real, released settlement between exactly those two parties**. Free attestations
are worthless; weight is bought with settled value, which is expensive to forge.

**Trust is computed by the consumer, never minted by the node.** A node only
stores and serves the raw attestations written about it; an agent downloads
them, verifies each, and scores them with a policy *it* controls. The protocol
ships a sane, fully-specified default; agents may override every knob.

## The default trust policy

`computeTrust(attestations, policy?, revocations?)` (and its async sibling
`computeTrustAsync`) produce an auditable `TrustScore`:

| field             | meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `reputation`      | `score × confidence` ∈ [0,1) — the single comparable ranking value |
| `score`           | diversity-weighted mean rating ∈ [0,1]                             |
| `confidence`      | `1 − exp(−W/k)` ∈ [0,1) — grows with independent, recent evidence  |
| `count`           | counted attestations (verified, deduped, non-revoked)              |
| `distinctIssuers` | distinct attesting DIDs — the diversity signal                     |
| `totalValue`      | raw settled value backing counted attestations                     |
| `weight` (W)      | Σ per-issuer weights (decayed) — the evidence mass                  |
| `perIssuer[]`     | every input exposed, so the score is independently re-derivable     |

The algorithm:

1. **Verify & dedupe.** Drop any attestation whose signature, rating range, or
   backing settlement fails; dedupe by settlement id (one payment counts once).
2. **Group by issuer.** Reputation from 100 distinct payers ≫ 100 from one.
3. **Per-issuer diminishing returns.** Each issuer contributes
   `issuerWeight(decayedValue)`, default `log(1+value)`, so **repeated business
   from the same payer saturates** — a wash-trader recycling a few counterparties
   cannot inflate trust by volume.
4. **Time-decay.** Each attestation's value is multiplied by
   `decay(age)`, default `0.5^(age / halfLife)` with a **180-day half-life**, so
   recent custom outweighs ancient.
5. **Confidence.** `confidence = 1 − exp(−W/k)`, `k = 5`. More independent,
   recent, settlement-backed evidence → higher confidence.
6. **Rank by `reputation`.** At equal rating, more **distinct + recent** custom
   ranks higher. That is the anti-Sybil signal.

Every parameter is a field on `TrustPolicy` (`issuerWeight`, `decay`,
`halfLifeMs`, `confidenceScale`, `now`); `DEFAULT_TRUST_POLICY` is the exported
source of truth.

## Negative attestations & revocation

- **Negative attestation:** a low/zero rating, backed by the same settlement.
  No new type — `rating` is constrained to `[0,1]` (0 = fully negative) and the
  value-weighted mean incorporates it honestly.
- **Revocation:** an issuer who attested in error publishes a signed
  `Revocation` referencing the attestation's signature. A revocation bites only
  when **validly signed by the same DID that issued the attestation** — a
  stranger cannot revoke someone else's attestation.

## On-chain verification

`computeTrustAsync` accepts an injected `AttestationVerifier`. The default is the
in-memory verification; an on-chain rail supplies a verifier that **re-reads the
chain**, so a **fabricated settlement reference earns zero weight**.
`@aleph/settle-evm` exports `evmSettlementVerifier(rail)` — the chain-reading
primitive (over `EvmSettlementRail.verify`). `core` stays I/O-free: the chain
reader lives in the rail package.

**On-chain-backed attestations (did:pkh).** When the attester and subject are
**did:pkh** identities (their DID IS their on-chain account), an EVM-settlement-
backed attestation is verified by `verifyAttestationOnChain`: the signature, the
rating, the **address binding** (attester DID address == on-chain payer, subject
DID address == payee), and a **chain read** confirming the escrow is real and
released. `@aleph/settle-evm`'s `evmAttestationVerifier(rail)` is the verifier a
node passes to its `/attest` endpoint (and a consumer passes to
`computeTrustAsync`). A fabricated on-chain reference is rejected by reading the
chain; reputation accrues from real on-chain value. Sync `computeTrust` ignores
on-chain settlements by design (they cannot be verified without the chain).

## Retrieval at scale

- `GET /reputation?cursor=&limit=` — keyset-paginated raw attestations
  (stable under concurrent inserts), capped at `REPUTATION_PAGE_SIZE` (100) per
  page, with an **ETag**. A re-fetch with no new attestations is a cheap **304**.
  The client follows the cursor to the end, so a node cannot hide bad history by
  truncating a page.
- `GET /reputation/summary` — an aggregate (count, distinct issuers, total
  settled value, time span) computed at the DB from indexed columns, so an agent
  can rank candidates without downloading every raw attestation. The raw set
  stays available for full, independent verification.

## Honest limits

Sybil resistance is an **arms race with no perfect solution**. The goal is to
make manufacturing trust **economically irrational at expected scale**, and to
keep the policy in the consumer's hands — *not* to claim it solved. A determined,
well-funded attacker who creates many genuinely-distinct, separately-funded
identities and moves real value through each can still accrue reputation; the
diversity weighting raises that cost from "recycle one counterparty" to "fund N
independent ones, each paying real fees." **Staking with slashing on proven
fraud** is a stronger deterrent and is documented as a **planned AIP**, not
shipped.
