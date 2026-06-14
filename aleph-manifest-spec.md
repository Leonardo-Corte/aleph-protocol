# Aleph Protocol — Wire Specification v0.1

### The Envelope, the Manifest, the Grant, and the five message types

**Status:** Normative working draft. Companion to the explanatory paper [`aleph-protocol-paper.md`](aleph-protocol-paper.md).
**Audience:** Implementers of Aleph nodes, agents, and registries.
**Implementation:** All five message types, the Manifest, the Grant, the receive-guard (replay/skew/version), schema validation, escrow settlement, settlement-backed attestations, and receipt chaining are implemented and tested in [`code/`](code/). The in-memory settlement rail and the fiat boundary are the documented next increments.

> The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119. A conforming implementation is one that satisfies every **MUST** in §2 (the thin waist). Everything else is optional and layered.

---

## 0. Conventions

- All structures are shown as JSON for readability. A conforming implementation **MAY** use any canonical serialization (JSON, CBOR) provided signatures are computed over a deterministic canonical form (§2.4).
- A **DID** is a string of the form `did:method:identifier` (W3C DID Core). The signing/verification method is resolved from the DID Document.
- A **hash** is the multibase-encoded digest of the canonical serialization of the referenced object, default algorithm SHA-256.
- A **timestamp** (`ts`) is an integer of milliseconds since the Unix epoch (UTC).
- Field tables mark each field **[waist]** (part of the minimal universal core — change is near-permanent, treat with maximum care) or **[layer]** (optional/evolvable — change is cheap).

---

## 1. Conformance levels

A node declares, in its Manifest (`conformance`), one of:

| Level | MUST implement | Restores verbs |
|---|---|---|
| **L0 — Reachable** | DID, Manifest, receive `INVOKE`, return `RECEIPT` | ACT, PROVE |
| **L1 — Discoverable** | L0 + register Manifest with ≥1 registry, answer `RESOLVE` if a registry | + FIND |
| **L2 — Accountable** | L1 + issue/accept `ATTEST` referencing `SETTLE` | + TRUST |
| **L3 — Settling** | L2 + `SETTLE` over a payment rail; honor escrow | + PAY |

L0 is the floor: a node at L0 is already a node. Levels are additive and **MAY** be adopted incrementally. An agent **MUST** degrade gracefully when interacting with a node below the level it would prefer (e.g. fall back to confirmation-by-principal when TRUST data is absent).

---

## 2. The Envelope (the thin waist)

Every Aleph message is an Envelope. This object, and the three obligations around it (have a DID, publish a Manifest, speak the Envelope), are the **entire universal core**. Nothing else is mandatory.

```json
{
  "v": "aleph/0.1",
  "from": "did:key:z6Mk...",
  "to":   "did:web:dinner.example",
  "type": "INVOKE",
  "nonce": "9f2c1a7e-...",
  "ts": 1765432100000,
  "body": { "...": "shape depends on type" },
  "sig": "z3J8...multibase-signature..."
}
```

| Field | Waist? | Req. | Type | Meaning |
|---|---|---|---|---|
| `v` | [waist] | MUST | string | Protocol version. Receivers **MUST** reject an Envelope whose major version they do not implement; **SHOULD** accept higher minors. |
| `from` | [waist] | MUST | DID | Sender identity. Signature **MUST** verify against this DID's verification method. |
| `to` | [waist] | MUST | DID | Intended recipient. A node **SHOULD** reject Envelopes not addressed to it. |
| `type` | [waist] | MUST | enum | One of `RESOLVE`, `INVOKE`, `RECEIPT`, `ATTEST`, `SETTLE`. |
| `nonce` | [waist] | MUST | string | Unique per `(from, to)`. Receivers **MUST** reject a repeated nonce within the replay window (§2.5). |
| `ts` | [waist] | MUST | int | Creation time. Receivers **MUST** reject Envelopes outside an acceptable clock skew (default ±300 s) unless an explicit validity window is present. |
| `body` | [waist] | MUST | object | Type-specific payload (§3–§7). **MAY** be empty `{}`. |
| `sig` | [waist] | MUST | string | Signature over the canonical form of all other fields (§2.4). |
| `ext` | [layer] | MAY | object | Namespaced extensions. Receivers **MUST** ignore unknown keys (forward-compatibility). |

### 2.1 Why these and only these
Each waist field exists to make the Envelope **self-contained, authentic, addressed, replay-safe, and versioned** — the minimum for a stateless signed message to be safe on an open network. There is intentionally **no session id, no connection state, no capability list** here: those would fatten the waist (violating the hourglass principle) and are pushed into `body` or into optional layers.

### 2.2 Stateless by mandate
A node **MUST NOT** require a prior handshake to process an Envelope. Each Envelope **MUST** be independently verifiable and actionable. (Rationale: packet-switched, not circuit-switched — the property that lets the protocol scale to "query the world.")

### 2.3 Extension discipline (evolvability)
New optional data **MUST** be added under `ext` with a namespaced key (e.g. `ext:"org.example.feature"`). Receivers **MUST** ignore `ext` keys they do not understand and **MUST NOT** fail because of them. The waist fields **MUST NOT** be repurposed; a breaking change requires a major `v` bump. This is the concrete mechanism of §2.3 of the paper: the layers evolve freely; the waist is near-frozen.

### 2.4 Canonical form and signing
The `sig` is computed over the deterministic canonicalization (e.g. JCS / RFC 8785) of the Envelope **excluding `sig` itself**. Verifiers **MUST** recompute the canonical form and verify against `from`'s current verification method. Signature suites are negotiated by DID method; Ed25519 is the **RECOMMENDED** default.

### 2.5 Replay protection
A receiver **MUST** maintain, per counterparty, a record of seen `(nonce)` within a sliding window of at least `2 ×` the clock-skew tolerance and **MUST** reject duplicates. This makes signed Envelopes safe to relay over any transport.

---

## 3. `RESOLVE` — FIND

Sent **to a registry node** to discover providers of a capability. Returns pointers, not full Manifests (two-stage discovery — see paper §4.1).

### 3.1 Request body
```json
{
  "capability": "restaurant.booking",
  "constraints": {
    "geo": "Milan",
    "max_price_eur": 40,
    "attributes": { "cuisine": "vegan" }
  },
  "min_reputation": 0.0,
  "limit": 20
}
```

| Field | Waist? | Req. | Meaning |
|---|---|---|---|
| `capability` | [waist] | MUST | A semantic capability identifier (§8). |
| `constraints` | [layer] | MAY | Capability-specific filter object, keyed to the capability's schema. |
| `min_reputation` | [layer] | MAY | Hint; the *requesting agent* still computes its own trust (paper §2.5). |
| `limit` | [layer] | MAY | Max pointers to return (default 20). |

### 3.2 Response body
```json
{
  "results": [
    {
      "did": "did:web:dinner.example",
      "manifest": "https://dinner.example/.well-known/aleph-manifest.json",
      "summary": "restaurant.booking · Milan · vegan-friendly",
      "reputation_pointer": "did:web:dinner.example#attestations"
    }
  ],
  "registry_sig_note": "each result entry MAY be individually signed by the listing node"
}
```

A registry **MUST** return only `did` + `manifest` location + a one-line `summary` (+ optional reputation pointer). It **MUST NOT** inline full Manifests. The agent fetches full Manifests for shortlisted candidates only. (This is the core token-saving mechanism: pull, two-stage — paper §6.1.)

### 3.3 Registry federation
Registries **SHOULD** gossip Manifest pointers to peer registries so that a `RESOLVE` to any registry yields a comparable view. No registry is authoritative; a node **MAY** list with several. Discovery is a *service to* the network, never the network itself.

---

## 4. `INVOKE` — ACT

A signed request to execute a capability, carrying a **Grant** (delegation).

### 4.1 Body
```json
{
  "capability": "restaurant.booking",
  "input": { "party": 2, "diet": "vegan", "when": "2026-06-13T20:30" },
  "grant": { "...": "see §9" },
  "payment": { "mode": "escrow", "ref": "0xabc...", "max_eur": 40 },
  "reply_to": "did:key:z6Mk..."
}
```

| Field | Waist? | Req. | Meaning |
|---|---|---|---|
| `capability` | [waist] | MUST | The capability to execute (must match one in the node's Manifest). |
| `input` | [waist] | MUST | Arguments, conforming to the capability's declared `schema`. **MAY** be an MCP tool-call payload verbatim (paper §4.2). |
| `grant` | [layer] | SHOULD | A Grant (§9). **MUST** be present and valid if the capability's `terms.required_grants` is non-empty. |
| `payment` | [layer] | MAY | Payment intent / escrow reference, required if the capability is priced. |
| `reply_to` | [layer] | MAY | DID/endpoint for the asynchronous `RECEIPT`, for long-running work. |

### 4.2 Serving-node obligations
On receiving an `INVOKE`, a node **MUST**, in order:
1. Verify the Envelope (signature, nonce, ts).
2. If `terms.required_grants` is non-empty: verify the `grant` (issuer signature, that it covers this `capability`, that `from` is the grantee, that limits/expiry are satisfied). Reject with a typed error if not.
3. If priced: verify `payment` covers `terms.pricing` (lock escrow if `mode:"escrow"`).
4. Execute.
5. Emit a `RECEIPT` (§5), and a `SETTLE` (§7) if payment was escrowed.

A node **MUST NOT** act beyond the bounds of the presented Grant. (This bounded-authority property is what makes agent action *safe to permit* — paper §4.2, §6.3.)

### 4.3 Cost / risk / reversibility
The capability's Manifest entry declares `cost`, `risk`, and `reversibility` (§8.3). An **agent SHOULD** consult these *before* sending an `INVOKE` to decide whether the action exceeds its Grant or warrants principal confirmation. This lets a "read" and a "€1,000 irreversible spend" be reasoned about structurally rather than identically.

---

## 5. `RECEIPT` — PROVE

Emitted by the serving node (and counter-signable by the caller) after an `INVOKE`. The verifiable record.

### 5.1 Body
```json
{
  "invoke_ref": "hash-of-the-INVOKE-envelope",
  "capability": "restaurant.booking",
  "result": { "confirmation": "BK-7741", "total_eur": 32 },
  "outcome": "success",
  "settle_ref": "hash-of-the-SETTLE-envelope-or-null",
  "prev": ["hash-of-prior-receipt-in-this-task"],
  "issued_by": "did:web:dinner.example"
}
```

| Field | Waist? | Req. | Meaning |
|---|---|---|---|
| `invoke_ref` | [waist] | MUST | Hash of the `INVOKE` this receipts. |
| `outcome` | [waist] | MUST | `success` \| `partial` \| `failure` \| `rejected`. Failure **MUST** be reported cleanly, not as garbled success. |
| `result` | [layer] | SHOULD | The delivered output (or a hash/pointer if large/private). |
| `settle_ref` | [layer] | MAY | Reference to the settlement, if any. |
| `prev` | [layer] | MAY | Hashes of preceding receipts → forms the provenance chain (DAG). |
| `issued_by` | [waist] | MUST | DID of the issuer (matches Envelope `from`). |

### 5.2 The chain
By populating `prev`, an agent links the receipts of a multi-step task into a tamper-evident provenance DAG. The agent hands its principal the *head* of the chain; the whole task is then independently auditable. No central logbook exists or is needed.

### 5.3 Feeding the loop
A `RECEIPT` with `outcome:"success"` and a non-null `settle_ref` is the **raw material for an `ATTEST`** (§6). This is the PROVE→TRUST loop (paper §6.2): proofs of settled, successful work become reputation.

---

## 6. `ATTEST` — TRUST

A signed statement about a counterparty's conduct. **Counts only if it references a settlement.**

### 6.1 Body
```json
{
  "subject": "did:web:dinner.example",
  "receipt_ref": "hash-of-the-receipt",
  "settle_ref": "hash-of-the-SETTLE",
  "rating": 0.96,
  "claim": "delivered as specified, on time",
  "issued_by": "did:key:z6Mk..."
}
```

| Field | Waist? | Req. | Meaning |
|---|---|---|---|
| `subject` | [waist] | MUST | DID being attested about. |
| `settle_ref` | [waist] | MUST | Reference to a settled payment. **An attestation without a valid `settle_ref` MUST be treated as zero-weight.** This is the anti-Sybil rule. |
| `receipt_ref` | [layer] | SHOULD | The receipt the attestation is about. |
| `rating` | [layer] | MAY | A scalar in [0,1]; advisory only. |
| `claim` | [layer] | MAY | Human/machine-readable statement. |
| `issued_by` | [waist] | MUST | Attesting DID. |

### 6.2 Anti-Sybil (normative)
A consuming agent computing a node's reputation **MUST** discard any attestation whose `settle_ref` does not resolve to a verifiable settlement of non-trivial value between `issued_by` and `subject`. Free attestations carry no weight. This makes mass forgery uneconomic: weight is bought with real settled value (paper §2.4).

### 6.3 Consumer-computed trust (normative)
There **MUST NOT** be a single canonical reputation score in the protocol. A node's `reputation` pointer (Manifest, §8) resolves to the **raw set of signed attestations**. Each agent **MUST** compute its own trust from these raw facts with its own weighting policy. (Prevents re-centralization around a rating authority — paper §2.5.)

---

## 7. `SETTLE` — PAY

Release of value, ideally atomic with delivery.

### 7.1 Body
```json
{
  "invoke_ref": "hash-of-the-INVOKE",
  "rail": "did:aleph:rail/escrow-v1",
  "amount": { "unit": "stable", "value": "32.00" },
  "tx": "0x...on-rail-settlement-reference",
  "status": "released"
}
```

| Field | Waist? | Req. | Meaning |
|---|---|---|---|
| `invoke_ref` | [waist] | MUST | The action being paid for. |
| `rail` | [layer] | MUST (L3) | Identifier of the settlement rail/contract. |
| `amount` | [layer] | MUST (L3) | `{unit, value}`; `unit` references the token model (§7.3). |
| `tx` | [layer] | SHOULD | On-rail reference, for public verifiability. |
| `status` | [waist] | MUST | `locked` \| `released` \| `refunded` \| `disputed`. |

### 7.2 Atomicity
Where the rail supports it, delivery (the `RECEIPT`) and `status:"released"` **SHOULD** occur in one verifiable step (escrow lock on `INVOKE` → release on delivery). This makes the action and its payment a single provable event and feeds an honest `settle_ref` to the trust loop.

### 7.3 Token model (informative)
The PAY layer is rail-agnostic. A **RECOMMENDED** design is a *dual token*: a **stable** unit for usage (priced 1:1 to value loaded; declared as a **non-refundable usage credit**, not a deposit — the legal guardrail that keeps it from being unauthorized e-money) and a **volatile** unit for capitalization, coupled **softly** (revenue-funded buy-back + voluntary conversion), never by a rigid peg. The volatile unit **MUST NOT** be marketed as a profit promise. *Use is the anchor; belief is the sail.* The honestly-declared worst case (revenue fall + mass liquidation → slow downward pressure) is mitigated by sizing the platform's own structural demand-sink, not eliminated (paper §8).

---

## 8. The Manifest

A node's machine-readable self-declaration, published at a well-known location (`/.well-known/aleph-manifest.json` for `did:web`, or resolvable from the DID Document). **The atomic unit that makes a node a node.**

```json
{
  "v": "aleph/0.1",
  "identity": "did:web:dinner.example",
  "conformance": "L3",
  "capabilities": [
    {
      "key": "restaurant.booking",
      "schema": { "input": { "...JSON Schema..." }, "output": { "..." } },
      "cost": { "unit": "stable", "value": "1.00", "model": "per-call" },
      "risk": "medium",
      "reversibility": "cancellable-until-T-2h"
    }
  ],
  "terms": {
    "pricing": "see capability.cost",
    "required_grants": ["payment.spend", "booking.create"],
    "sla": { "latency_ms": 2000, "availability": "0.99" }
  },
  "reputation": "did:web:dinner.example#attestations",
  "endpoint": ["https://dinner.example/aleph"],
  "ext": {}
}
```

| Field | Waist? | Req. | Meaning |
|---|---|---|---|
| `v` | [waist] | MUST | Manifest/protocol version. |
| `identity` | [waist] | MUST | The node's DID. |
| `conformance` | [waist] | MUST | `L0`–`L3` (§1). |
| `capabilities` | [waist] | MUST | ≥1 capability entry (§8.1–8.3). The FIND + ACT surface. |
| `terms` | [layer] | SHOULD | Pricing, required grants, SLA. The ACT + PAY surface. |
| `reputation` | [layer] | MAY | Pointer to the node's attestation set. The TRUST surface. |
| `endpoint` | [waist] | MUST | One or more reachable addresses. |
| `ext` | [layer] | MAY | Namespaced extensions; receivers ignore unknown keys. |

### 8.1 Capability entry — `key`
A semantic capability identifier: a dotted, lowercase, hierarchical string from the shared vocabulary (e.g. `restaurant.booking`, `compute.inference`, `data.geocode`). Matching is by **exact identity**, not prose. Two nodes offering `restaurant.booking` are, by definition, offering the same capability; their *quality* is differentiated by reputation, not by the agent re-reading descriptions.

### 8.2 Capability entry — `schema`
JSON Schema for `input` and `output`. An agent constructs an `INVOKE.input` to satisfy this schema; the node validates against it. This is what makes the call *typed* rather than scraped, and lets failures be clean (§5.1).

### 8.3 Capability entry — `cost`, `risk`, `reversibility`
First-class fields so an agent can reason about consequence **structurally**:
- `cost` — `{unit, value, model}` (e.g. per-call, per-token, per-result).
- `risk` — `low` \| `medium` \| `high` (advisory severity of acting wrongly).
- `reversibility` — a machine-readable statement of whether/until-when the action can be undone.

An agent **SHOULD** use these to decide whether an action falls within its Grant or requires principal confirmation. (Removes the "a read and a €1,000 spend look identical" deficit — paper §4.2.)

### 8.4 The vocabulary (governance)
The set of valid `key`s is a curated, versioned vocabulary — itself an evolving registry. New keys are proposed, reviewed, and adopted by consensus (an RFC-like process). This is a **perpetual governance task**, never "finished" — the declared price of the standard (paper §8).

---

## 9. The Grant (delegation)

A token by which a principal grants an agent **bounded** authority. Carried in `INVOKE.grant`.

```json
{
  "v": "aleph/0.1",
  "issuer": "did:key:zPRINCIPAL...",
  "grantee": "did:key:zAGENT...",
  "scope": [
    { "capability": "restaurant.booking", "limit": { "max_eur": 40, "count": 1 } },
    { "capability": "payment.spend",       "limit": { "max_eur": 40, "category": "dining" } }
  ],
  "not_after": 1765468800000,
  "delegable": false,
  "sig": "z..."
}
```

| Field | Waist? | Req. | Meaning |
|---|---|---|---|
| `issuer` | [waist] | MUST | The principal granting authority (a person, org, or a parent agent). |
| `grantee` | [waist] | MUST | The agent receiving it. `INVOKE.from` **MUST** equal this. |
| `scope` | [waist] | MUST | List of `{capability, limit}` — the precise edges of permission. |
| `not_after` | [waist] | MUST | Expiry. A node **MUST** reject an expired Grant. |
| `delegable` | [layer] | MAY | Whether the grantee may sub-delegate (default `false`). |
| `sig` | [waist] | MUST | Issuer's signature over the Grant. |

### 9.1 Verification (normative)
A serving node **MUST** verify, for the requested capability: (a) `issuer.sig` is valid; (b) `grantee` == `INVOKE.from`; (c) the capability is in `scope` and the action satisfies its `limit`; (d) `now < not_after`. If any fails, the node **MUST** reject with `outcome:"rejected"` and a typed reason. **Bounded authority is a hard gate, not a hint.**

### 9.2 Why this is the safety unlock
The Grant is the difference between "the agent has my keys" (dangerous) and "the agent may do exactly this much" (safe). It is the single mechanism that lets a human delegate to an agent *without* all-or-nothing exposure, and therefore the precondition for autonomous action (paper §6.3). Identity is *who* the agent is; the Grant is *what it may do right now*.

---

## 10. Minimal conformance summary

A minimal (L0) node, in full, is:

1. A **DID** with a resolvable verification method.
2. A published **Manifest** with `v`, `identity`, `conformance:"L0"`, ≥1 `capability` (key + schema), and an `endpoint`.
3. The ability to **receive an `INVOKE`** (verify Envelope, validate input against schema, execute) and **return a signed `RECEIPT`**.

That is the entire mandatory surface. Everything else — registries, attestations, settlement, grants, IoT, DAO governance — is opt-in and layered on top, and may be added, versioned, and replaced without touching this floor.

---

*Normative working draft v0.1. Deliberately minimal and expected to evolve: the waist is treated as near-frozen and changed only by major-version bump; layers and `ext` evolve freely. Companion explanatory paper: `aleph-protocol-paper.md`.*
