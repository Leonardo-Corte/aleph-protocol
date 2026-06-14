# The Aleph Protocol

### A thin-waist protocol for an agent-native web: how machines find, trust, act, pay, and prove

**Working draft · v0.1**
Status: Foundational paper (explanatory, non-normative). The normative wire format lives in [`aleph-manifest-spec.md`](aleph-manifest-spec.md).

> *"A network is not its cables. A network is the language its nodes agree to speak. We are not building the cables of the agentic web — they already exist. We are writing the language."*

---

## A note on the name

**Aleph** is a *working codename*, not a commitment. The protocol's identity is an evolvable layer, not part of its thin universal core — and, per the design principle stated in §2.3, anything that is not the thin waist may be changed cheaply later. The name is taken from **ℵ**, the symbol for the infinity of sets: infinitely many instances generated from one finite rule — which is exactly how a single protocol core instantiates an unbounded network of nodes (the *class → instance* generator of the ESO corpus). It echoes, too, Borges' *Aleph*: the one point in space that contains all other points — the thin waist through which every interaction passes. *(In candour: an unrelated project, Aleph.im, already uses the name in the decentralized-storage space. Since the name is an evolvable layer and not the waist, this is a cheap thing to change later if it ever matters.)*

---

## Abstract

The web was built for humans: documents to read with eyes, buttons to press with hands. Software agents — programs that act on a person's behalf — are **blind and mute** in it. To use a service, an agent must either rely on a hand-written integration, be told an API exists, or scrape a page meant for human eyes and guess. As a result, agents today can *read* the web but cannot reliably **find**, **trust**, **act**, **pay**, or **prove** within it. These five missing verbs are the gap between an agent that narrates and an agent that does.

The Aleph Protocol defines the minimum set of guarantees that let an agent cross all five verbs **without a human in the loop and without a central authority gatekeeping any of them**. It does this not by building a new network — the transport (the internet) and the action format (MCP) already exist — but by defining a *thin universal waist*: a single signed, addressed **Envelope** exchanged between two cryptographic identities, carrying one of five message types. Everything rich — discovery registries, reputation, settlement, fine-grained delegation, the physical world of IoT — lives in **optional layers above the waist**, where no universal agreement is required.

This paper states the problem (§1), the design principles (§2), the architecture (§3), the five verbs in detail (§4), the identity and self-description model (§5), the self-sustaining trust loop that is the protocol's economic heart (§6), what is universal versus optional (§7), the open problems we do **not** claim to have solved (§8), the relationship to existing work (§9), and the minimal build order (§10).

The protocol does not aim to be perfect. No network protocol in history launched perfect, and aiming for perfection before launch is the canonical way to never launch. It aims to be **minimal and evolvable**: small enough that little can be wrong, and versioned so that what is wrong can be fixed without breaking the network.

---

# 1. The problem: agents are blind and mute in a web built for hands

Consider the lived experience of an agent asked to do something real — *"book a vegan dinner tonight under €40."* Today, the agent has three options, all bad:

1. **A hand-written integration** exists for one specific restaurant API. Works, but someone wrote it by hand, for that one service, and it breaks when the service changes.
2. **The agent is told** an API exists and is given credentials. Now it has *all-or-nothing* access — full power, no bounds — which is exactly why humans are right to be afraid to let it act.
3. **The agent scrapes** a web page designed for a human clicking. It burns 5,000–50,000 tokens of navigation, banners, and markup through its context to extract the 200 tokens that are the actual data, then guesses where the "book" button is.

Underneath these three bad options sit five concrete deficits. We name them as the five verbs the protocol must restore:

| Verb | What the agent cannot do today |
|---|---|
| **FIND** | Ask *"who can do X?"* and get a machine answer. It must guess from human-facing pages. |
| **TRUST** | Know, verifiably, whether a service did well the previous 4,000 times. Brand reputation does not reach a machine. |
| **ACT** | *Do* a thing — not just read it — with authority bounded to exactly what its principal allowed. |
| **PAY** | Settle and receive value at machine speed, in micro-amounts, without a human-facing form. |
| **PROVE** | Hand its principal a verifiable record of what it did, step by step. |

The deepest single cause beneath all five: the web's interfaces are **eager, prose-based, and document-shaped** — they push everything at the agent ahead of time, described in human language, wrapped in documents — while an agent reasons in the opposite shape: **lazy, structured, data-shaped**, pulling exactly what it needs at the moment of need. Every inefficiency examined in §6.1 is a symptom of this one mismatch.

The consequence is not merely cost. It is that the agent **cannot act autonomously and safely**, and so it defers every decision back to the human — which collapses the entire promise of agents. An agent that must ask permission at every step is a slower human, not a faster one.

---

# 2. Design principles

Five principles govern every decision in this protocol. They are stated up front because each later choice is derivable from them.

## 2.1 The thin waist (the hourglass)

The internet works because its universal layer — IP — is deliberately *tiny*. IP defines only addresses and a packet format. All richness lives **above** (HTTP, mail, video, agents) and **below** (fibre, radio, satellite), where universal agreement is *not* required. The shape is an hourglass: a narrow waist that everyone adopts, fat freedom at both ends.

Aleph takes this as law. **What every node must adopt is made as small as possible.** The waist is one object — a signed, addressed Envelope — and three obligations (have an identity, publish a self-description, speak the Envelope). Discovery, reputation, payment, delegation, and the physical world are all *above* the waist, opt-in. You win a network not by making more things universal, but by making *fewer* things universal.

## 2.2 Pull, not push (just-in-time, not ahead-of-time)

An agent reasons in the shape *need → seek → evaluate → act → record*. The protocol must deliver capability, data, trust, and proof **at the moment of need**, never eagerly ahead of time. A node is *discovered when wanted*, its full description *fetched only if it is a candidate*, its capabilities *invoked one at a time*. This single inversion — eager-to-lazy — is the largest source of efficiency in the protocol (§6.1).

## 2.3 Minimal and evolvable, not perfect

No protocol is ever finished. IP builds *imperfection in on purpose* (packets may be lost; reliability is added above, by TCP). ARPANET's first message crashed mid-word. TCP/IP was retrofitted onto a live ARPANET years after launch. The governance documents of the internet are literally called *Requests for Comments*. Aleph therefore does not pursue perfection; it pursues two achievable properties that substitute for it:

- **Minimality** — the smaller the universal core, the less can be wrong, and the smaller the blast radius of any mistake.
- **Evolvability** — every object carries a `version`; every structure has clean extension points; old and new nodes must coexist.

A corollary — the **asymmetry of mistakes**: an error in the thin waist is near-permanent (IPv4's short addresses took *decades* to begin fixing), while an error in an optional layer is cheap and forkable. Therefore concentrate all care on the tiny waist; stay relaxed and experimental everywhere else.

## 2.4 Trust is minted by settlement, not declared

Reputation that is free to create is free to forge: ten thousand fake nodes can praise one another at zero cost (the Sybil attack). Aleph makes the unit of trust — an **attestation** — *count only when it references a settled economic event* (§4.4, §6.2). Trust that costs a real payment to mint cannot be forged at scale. This binds the TRUST layer to the PAY layer by design: the thing that makes reputation believable is that it was expensive to produce.

## 2.5 Trust is computed by the consumer, never dictated by the provider

There is no single central reputation score. A node's reputation *is* the set of raw, signed attestations bound to its identity. Each agent **downloads the raw facts and computes its own trust**, with its own weighting. You do not trust someone else's score; you trust signed facts and judge them yourself. This is what keeps the network from re-centralizing around a rating authority.

---

# 3. Architecture overview

## 3.1 The Envelope — the universal core

Everything in Aleph is one object: a signed, addressed Envelope between two identities.

```
Envelope
├── from   : DID         — who is speaking (a self-owned cryptographic identity)
├── to     : DID         — who is addressed
├── type   : RESOLVE | INVOKE | RECEIPT | ATTEST | SETTLE
├── body   : { ... }     — contents; shape depends on `type`
├── nonce  : unique value — replay protection
├── ts     : timestamp
└── sig    : signature   — proves the Envelope is authentic and unaltered
```

This is the "IP packet" of the agentic web. It is **stateless** (each Envelope is self-contained, like a packet — not a held-open session), **signed by default** (identity and integrity come free), and carries exactly **five `type`s — one per verb**. All richness lives in `body`, where universal agreement is not needed.

The choice of *stateless message* over *stateful session* is deliberate and consequential: sessions (the telephone model — hold the line open) do not scale to "query the world"; self-contained signed messages (the packet model) do. Aleph is packet-switched, not circuit-switched.

## 3.2 The five verbs as five message types

| Verb | `type` | One-line function |
|---|---|---|
| FIND | `RESOLVE` | Ask a registry *"who provides capability C under these constraints?"* → pointers to Manifests. |
| ACT | `INVOKE` | A signed request to execute a capability, carrying a scoped delegation (a **Grant**). |
| PROVE | `RECEIPT` | A signed record of what was requested, delivered, and paid — chained to prior receipts. |
| TRUST | `ATTEST` | A signed statement about a counterparty's conduct, valid only if it references a `SETTLE`. |
| PAY | `SETTLE` | Release of value, ideally atomic with delivery, via escrow. |

## 3.3 The layering

```
   OPTIONAL LAYERS  (opt-in — the richness — NOT universal)
   ┌────────────────────────────────────────────────────────┐
   │  Discovery registries · Computed reputation · Settlement │
   │  rails · Rich delegation · IoT bridges · ESO/DAO nodes   │
   └────────────────────────────────────────────────────────┘
   ════════ THE THIN WAIST  (universal — mandatory) ════════
        DID  +  Manifest  +  signed Envelope (5 types)
   ═════════════════════════════════════════════════════════
   ┌────────────────────────────────────────────────────────┐
   │  Transports: HTTP, P2P, message queues — anything       │  (free, below)
   └────────────────────────────────────────────────────────┘
```

To merely *exist and be callable*, a node needs three things: a DID, a published Manifest, and the ability to receive an `INVOKE` and return a `RECEIPT`. To participate in reputation, payment, or the physical world, it opts into the layers above. Mandatory floor, optional ceiling.

---

# 4. The five verbs in detail

Each verb is presented as: **what** it is, **why** it is shaped this way (traced to a principle and to a deficit in §1), and **how** it works on the wire.

## 4.1 FIND — `RESOLVE`

**What.** An agent sends a `RESOLVE` Envelope to a registry node, asking *"who provides capability `C` with these constraints?"* The registry returns a list of **pointers** — DIDs plus Manifest locations plus a one-line capability summary — **not** the full Manifests. The agent then fetches the full Manifest only for the candidates it shortlists.

**Why.** This is principle 2.2 (pull, not push) made concrete, and it directly removes the largest deficit in §1 (the agent must guess from human pages) and the largest cost in §6.1 (the eager catalog). The two-stage shape — *pointers first, full Manifest only for candidates* — exists so the agent never loads into its context the description of a capability it will not use.

Registries are **federated**, not a single company: many registry nodes that gossip and synchronize, like the DNS root system. A `RESOLVE` may be sent to any of them. No registry is the network; the registries *serve* the network.

**How.** Capabilities are named by **semantic capability identifiers** — shared keys such as `restaurant.booking` or `compute.inference` — not by free prose. This is what lets `restaurant.booking` on node A mean *identically* `restaurant.booking` on node B: the agent matches by identity, not by reading and inferring synonyms (removing the reconciliation cost of §6.1). The shared vocabulary is a curated, evolving registry of its own — a permanent governance task (§8), the price of the standard.

## 4.2 ACT — `INVOKE`

**What.** A signed request to execute a declared capability with given inputs. Crucially, it carries a **Grant**: a delegation token, signed by the agent's *principal* (the human or organization it acts for), stating *"agent X may perform {capability, limits, expiry}."* The serving node verifies the Grant **before** acting.

**Why.** This restores the ACT verb and resolves the all-or-nothing deficit of §1. The Grant is **bounded authority**: the agent is not given the keys to everything, it is given a signed permission with precise edges — *"may spend ≤ €40 on category dining, expires midnight."* This is the single feature that makes an agent *safe to let act*, which is the precondition for autonomy (§6.3).

The Manifest also declares each capability's **cost, risk, and reversibility** as first-class fields. This lets the agent reason structurally about whether a given action needs to fall back to its principal for confirmation, instead of treating a read and a €1,000 spend as identical.

**How — and the relationship to MCP.** The payload of an `INVOKE` — *"run this capability with these parameters"* — may **be, verbatim, an MCP tool call.** Aleph does not replace MCP; it *wraps* it. MCP becomes the payload format of the single ACT verb, placed inside a signed, addressed, Grant-bearing Envelope, with the four missing verbs (FIND, TRUST, PAY, PROVE) built around it. An existing MCP server becomes a Aleph node by gaining a DID, a Manifest, and the ability to emit a `RECEIPT`. Nothing is thrown away.

## 4.3 PROVE — `RECEIPT`

**What.** Every `INVOKE`→result emits a `RECEIPT` Envelope: signed by both parties, recording *what was requested, what was delivered, what was paid, when,* and a **reference to the preceding receipts** in the task. A chain of five services produces five linked receipts — the verifiable provenance of the whole task.

**Why.** This restores the PROVE verb. The agent can hand its principal a *pointer to a signed chain*, not a re-narration from memory (removing the proof-reconstruction cost of §6.1). And — see §6 — the receipt of today is the raw material of the reputation of tomorrow.

**How.** Receipts are content-addressed and chained: each references the hash of the prior receipt, forming a tamper-evident provenance DAG. The chain is the audit trail; no central logbook is required.

## 4.4 TRUST — `ATTEST`

**What.** After an interaction, a counterparty may issue an `ATTEST` Envelope: a signed statement — *"DID X performed task Y, outcome Z, rating R"* — bound to X's identity. A node's reputation **is** the accumulated set of such attestations.

**Why.** This restores the TRUST verb. But the design's whole integrity rests on principle 2.4: **an `ATTEST` counts only if it references a real `SETTLE`** (a completed payment). This is the anti-Sybil mechanism. Free attestations are worthless; only attestations minted by real, paid economic events accumulate weight — and minting many of those costs real money, which is exactly what makes mass forgery uneconomic.

And per principle 2.5, attestations are **raw signed facts**, not a central score. The consuming agent downloads them and computes trust itself, with its own weighting. There is no rating authority to capture.

**How.** Attestations are Verifiable Credentials (W3C VC) bound to the subject's DID, each carrying a reference to the settlement Envelope that justifies it. An agent fetching a node's reputation retrieves the VC set, verifies each signature and each settlement reference, discards the unbacked ones, and computes a local trust score.

## 4.5 PAY — `SETTLE`

**What.** The release of value, ideally **atomic with delivery**. The canonical pattern: an `INVOKE` locks funds in an escrow contract → the node delivers → a `SETTLE` releases the funds, in the same verifiable step as the delivered result.

**Why.** This restores the PAY verb (machine-speed, micro-amount, no human form) and — through principle 2.4 — is what gives the TRUST layer its anti-Sybil property. Payment is not only how value moves; it is how trust is *minted honestly*.

**How.** Settlement runs on a smart-contract rail with micro-payment support (payment channels or a rollup for speed and cost). This is the natural home for a **dual-token** design: a *stable* unit for usage (priced 1:1 to real value loaded), and a *volatile* unit for capitalization — coupled *softly* (via revenue-funded buy-back and voluntary conversion), never by a rigid peg, because a rigid peg is the fuse that detonates the system when confidence falls. (See §8 for the honestly-declared worst case.)

---

# 5. Identity and the Manifest

## 5.1 Identity: the DID, not the wallet

A node's — and a person's — identity is a **DID (Decentralized Identifier)**: a self-owned cryptographic identifier, issued by no authority. It is critical to separate three things that the current web3 mistakenly fuses:

- The **DID** *identifies* (a public pointer; by itself it reveals nothing about you).
- The **wallet** *custodies* the keys that prove the DID is yours (a vault, not your face).
- The **private database** *contains* your real data — and stays with you (on your device, or encrypted). You release **Verifiable Credentials** selectively — *proofs* of facts — without exposing the underlying data.

This makes the *experience* "one identity that works everywhere, press a button to sign in" — like a single sign-on — while the *topology* is the opposite of a central login provider: no Google in the middle, identity proven by your own keys. Single sign-on **without** a central authority of sign-on. "You are your profile, and you decide what to share" — made technically true.

## 5.2 The Manifest: the atomic unit of the network

A node exists in the network by publishing a **Manifest**: a machine-readable self-declaration. It is the smallest object that makes a node a node. It carries five things, one per verb:

```
Manifest
├── identity     : DID                          (FIND / who I am)
├── capabilities : [ {key, schema, cost,        (FIND + ACT / what I do, how to call me,
│                      risk, reversibility} ]              what it costs, how dangerous, how undoable)
├── terms        : {pricing, required_grants,    (ACT + PAY / my price, what permission I need,
│                    sla}                                   what I promise)
├── reputation   : pointer to attestation set    (TRUST / where my verifiable record lives)
└── endpoint     : address(es) to reach me        (the connection point)
```

The genius of this single object is that it makes all five verbs possible at once: you FIND it (identity + capabilities), you TRUST it (reputation), you know how to ACT and with what permission (capabilities + terms), you know what to PAY (terms), and every call against it produces a signed RECEIPT. **A node that publishes a valid Manifest *is* a node.** Everything else is infrastructure around this.

The full normative field-by-field specification of the Manifest and the Envelope is the companion document, [`aleph-manifest-spec.md`](aleph-manifest-spec.md).

---

# 6. The self-sustaining trust loop (the economic heart)

## 6.1 Where the savings come from

The protocol's efficiency is not a bag of tricks. It is one inversion — eager-to-lazy, document-to-data — applied at six points where tokens die today. With illustrative orders of magnitude:

1. **The eager catalog.** Today every connected tool's full description is loaded into the agent's context up front: ~20 servers × ~30 tools × ~150 tokens ≈ **~90,000 tokens spent before any work**, of which ~2 tools are used. → `RESOLVE` (pull, two-stage) loads one capability when needed: **~90,000 → ~300**. The single largest saving, and structural.
2. **Reading human pages.** Scraping HTML burns 5,000–50,000 tokens to extract ~200 of data. → A capability returns *structured data*, not the document wrapping it: **document → data**.
3. **Cold start every session.** Re-deriving who the principal is and what is allowed, every time. → A compact signed **Grant** carries it: **re-derivation → portable artifact**.
4. **Reconciling synonyms.** Reasoning in prose about whether "book" = "reserve." → Shared semantic keys: match by identity, not by reading: **prose → structure**.
5. **Trust deliberation without data.** Searching and reading reviews to judge a service — or, usually, punting to the human. → Compact signed attestations, computed locally: **cheap, and it does not interrupt the human**.
6. **Proof reconstruction.** Re-narrating a multi-step task from memory. → A pointer to a signed receipt chain: **re-narration → proof**.

In a realistic task this is roughly an *order-of-magnitude* reduction, because entire masses that cross the context for nothing today are removed — not a marginal 10%.

## 6.2 The loop: proof becomes reputation

The deepest structural property is that verbs PROVE and TRUST form a closed loop. **Today's `RECEIPT`s are tomorrow's `ATTEST`s.** Every signed proof of "did this well" accumulates into the trust by which other agents will choose this node next. The system **generates its own trust from its own activity** — no authority assigns scores; settled, proven facts sediment into reputation. And because attestations count only when backed by a `SETTLE` (§4.4), the loop is self-defending against Sybil: PAY → PROVE → TRUST is an arc that holds itself up, and the cost of payment is exactly what makes the trust expensive to forge.

This is the *self-sustaining substrate* at the level of the protocol: the more the network is used, the more trustworthy it becomes, the more it is used.

## 6.3 The real prize is not tokens — it is autonomy

Cost reduction is the *measurable shadow* of a larger thing: the protocol has stopped fighting the agent's reasoning shape, and has *concentrated its context* — delivering only the relevant capability, data, and trust at the moment of need. This has three compounding effects:

1. **Cost collapses** (the tokens above). Visible.
2. **Reasoning improves.** A clean context is not only cheaper, it is *more accurate*: less noise, less drift, fewer errors. 90,000 tokens of unused menu do not merely cost — they *distract*.
3. **Autonomy unlocks** — the actual prize. The reason an agent defers decisions to the human today is that it lacks the structured data (TRUST) to decide safely. With all five verbs present, it can **close the loop without stopping to ask.** The gain is not "the same task, fewer tokens"; it is **"tasks it could not safely do at all."** The agent goes from a parrot asking permission at every step to an actor that executes and brings back the receipt.

The honest cost of this is stated as a premortem in §8.

---

# 7. What is universal, and what is optional

**Universal (the thin waist — every node MUST):**
- own a **DID**;
- publish a **Manifest**;
- speak the **Envelope** (the five message types, signed).

**Optional (layers — opt-in):**
- run or query a **discovery registry**;
- issue and consume **attestations** (reputation);
- settle via a **payment rail** (and any token design);
- accept **rich Grants** (fine-grained delegation);
- bridge **physical nodes** (IoT) — which are, architecturally, simply more nodes that publish Manifests and expose capabilities; the physical world extends the *node* layer, it is not a new layer;
- adopt a **DAO** governance for a node's rules and value — appropriate for the *expansion phase* of a mature node, not for the *product phase* where a single architect must move fast (a node voted on at every step is the human bottleneck multiplied by its voters).

**What "we" — the protocol authors — own:** the Envelope schema, the five message-type bodies, the Manifest schema, the semantic-capability vocabulary's governance, the Grant format, and the receipt/attestation format — plus a **reference implementation** proving they work. We do **not** build the nodes, the agents, the registries, or the services. This is the RFC-plus-first-IMP model of 1969: write the specification *and* build the first thing that runs it, then step aside and let the network grow on merit. Whoever writes the language defines the world without owning it.

---

# 8. Open problems (the premortem)

A document that closes all its objections is lying about at least one. These are declared open.

- **The Sybil / reputation hard core.** §2.4 binds trust to settlement, which raises the cost of forgery — but does not reduce it to zero, and does not by itself solve identity-farming at the fiat boundary. The robustness of the whole TRUST layer rests here. This is the genuinely hard problem and the most valuable place to attack, *precisely because it is unsolved*.
- **The oracle / fiat boundary.** The chain proves everything that happens *inside* it (receipts, settlements). It cannot prove, by itself, that a fact in the real world is true — that the compute was actually delivered, that the off-chain money is really there. Every "trustless" system still rests on one "trusted" point: the on-ramp. This is declared, not hidden.
- **The two-sided bootstrap (chicken-and-egg).** A two-sided network (capability providers / interrogating agents) is worth nothing until both sides reach critical mass — and neither arrives without the other. This is the problem *every* network in history had to solve first. The known weapon: **be your own first guaranteed customer** — your agents consume your nodes from day zero, so the demand side exists before the market does.
- **Semantic vocabulary governance.** Shared capability keys (§4.1) work only if a curated, evolving vocabulary exists. This is never "finished"; it is governed forever. The price of the standard.

These four are *different in kind* and must be treated differently: the round-trip and signing overheads of an earlier draft are **accepted costs** (not solved — paid, because the benefit dwarfs them); the registry is a **task** (the first deliverable, §10); the vocabulary is **perpetual governance**; and only the Sybil, oracle, and bootstrap items are **genuinely open problems**. Conflating these categories is itself an architectural error.

---

# 9. Relationship to existing work

Aleph invents almost nothing. Its claim is the *coherence of the synthesis*, not the originality of the parts — the value is in the song, not the notes.

- **MCP (Model Context Protocol)** — solves the ACT verb and half of FIND (a node declaring its capabilities). It is point-to-point: it works when the agent *already knows* which server to connect to. Aleph wraps MCP as the `INVOKE` payload and adds the four missing verbs and the *discovery* of unknown nodes. Wrap, not replace.
- **A2A (Agent2Agent)** — an independent effort at agent-to-agent interoperability, whose **Agent Card** is a close cousin of the Manifest. That two independent designs converged on "a node publishes a machine-readable self-declaration" is *convergence evidence* that the atomic unit is right. A2A, like MCP, lacks decentralized identity, settlement-backed reputation, and payment. The position is still open.
- **DID / Verifiable Credentials (W3C)** — the identity and attestation substrate Aleph builds on directly.
- **Smart contracts / blockchain** — the substrate for PAY and PROVE. Used here *for what it is genuinely good at* — non-falsifiable record, settlement without a bank — not as dogma. Note the inversion the ESO corpus identifies: the blockchain is awkward for humans but ideal for regulating a system run by agents — *its right user is the agentic system itself.* What "failed" for humans may be exactly right for machines; the missing actor was the agent, which has only now matured.

Aleph's distinctive contribution is the two pieces no one has filled on a decentralized base: **the registry that lets an agent find an unknown node**, and **the bounded Grant that lets an agent act safely.** Those two are the open position.

---

# 10. Build order: the minimum viable protocol (the 1969 move)

Do not build all five layers at once — that is the error of trying to ship complete ARPANET on day one. The minimal protocol that is already useful and bootstraps itself:

1. **Manifest + a thin registry + receipts.** A node can declare itself, an agent can find and call it, and the interaction leaves a signed proof. (Verbs FIND, ACT-minimal, PROVE.) No payment, no rich delegation yet.
2. **The "LO" of 1969:** one agent that reads a Manifest, calls a node, and obtains a signed `RECEIPT`. Two nodes speaking the new language. That is already the four-node network — alive, small, real.
3. From there, **discover — do not design in advance** — how agents actually trust and compose. The killer application of the protocol, like email on ARPANET, will be visible only after it is switched on.

The registry is the multiplier of everything else and therefore the first concrete deliverable. Without it, the protocol is theory.

---

# Glossary

- **Aleph Protocol** — a thin-waist protocol letting agents find, trust, act, pay, and prove, on a decentralized base. (Codename; evolvable.)
- **The five verbs** — FIND, TRUST, ACT, PAY, PROVE: the capabilities an agent lacks today and the protocol restores.
- **Envelope** — the universal core object: a signed, addressed, stateless message between two DIDs, carrying one of five message types.
- **Manifest** — a node's machine-readable self-declaration; the atomic unit that makes a node a node.
- **DID (Decentralized Identifier)** — a self-owned cryptographic identity, issued by no authority; identifies, but reveals nothing by itself.
- **Grant** — a delegation token signed by a principal, granting an agent bounded authority (capability, limits, expiry).
- **RESOLVE / INVOKE / RECEIPT / ATTEST / SETTLE** — the five Envelope types, one per verb.
- **Semantic capability identifier** — a shared key (e.g. `compute.inference`) naming a capability by identity, not prose.
- **Attestation** — a signed statement about a counterparty's conduct; counts only when it references a settled payment (anti-Sybil).
- **The thin waist** — the minimal universal core (DID + Manifest + Envelope); the narrow point of the hourglass.
- **The trust loop** — RECEIPTs become ATTESTs: the network generates its own trust from its own settled activity.
- **The asymmetry of mistakes** — errors in the waist are near-permanent; errors in layers are cheap and forkable; therefore concentrate care on the waist.

---

*Working draft v0.1. This is a foundational, explanatory paper. It is deliberately imperfect and expected to change: when reality contradicts a page, the page changes. The normative wire format is specified in `aleph-manifest-spec.md`.*
