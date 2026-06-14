# Security Policy

Aleph is a protocol that will, at maturity, move value and trust between
mutually-distrusting parties. Security is the product. We take disclosures
seriously and ask that you do too.

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion for a security
vulnerability.** Public disclosure before a fix puts users at risk.

Instead, report it privately through one of:

- **GitHub private vulnerability reporting** — the preferred channel:
  [Report a vulnerability](https://github.com/Leonardo-Corte/aleph-protocol/security/advisories/new)
  (Security → Advisories → Report a vulnerability).
- If that is unavailable, open a minimal issue titled "security contact request"
  asking a maintainer to reach you privately — **without any vulnerability
  details** — and we will establish a private channel.

Please include, where possible:

- the affected package and version (or commit),
- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- any suggested remediation.

## Scope

In scope: the protocol core (`@aleph/core`) — canonicalization, signatures,
replay/nonce handling, grant verification; the settlement and reputation logic;
the node and registry runtimes; and (when present) the on-chain contracts.

Out of scope (for now): the in-memory reference settlement rail used in
development, and known/declared limitations documented in the paper (the
fiat/oracle boundary, full dispute resolution, Sybil resistance at scale).

## Our commitment

- We will acknowledge a valid report promptly and keep you informed.
- We will work on a fix and coordinate a disclosure timeline with you.
- We will credit reporters who wish to be credited.

## Before mainnet

A formal external audit of the protocol core and the settlement contracts, plus
a public bug-bounty program, are gating requirements before any real value is
handled. See the roadmap, §7 and §13.
