# Aleph Improvement Proposals (AIPs)

AIPs are how Aleph evolves without breaking the network. Modeled on IETF RFCs
and Ethereum EIPs.

- **Waist changes** (the `Envelope`, `Manifest`, `Grant`, the five message
  types) **require an AIP**, broad review, and a major-version bump. The thin
  waist is near-frozen on purpose (see the paper, §2.3).
- **Layer changes** (registry, settlement, reputation, transport, SDK) are
  lighter and usually do not need an AIP.

## Status flow

`Draft → Review → Accepted | Rejected → Final`

## How to propose

1. Copy `AIP-template.md` to `AIP-N-short-title.md` (pick the next free N).
2. Fill it in: motivation, specification, backward compatibility, security.
3. Open a PR. Discussion happens on the PR.
4. A maintainer moves it through the status flow.

## Index

| AIP | Title | Status |
|-----|-------|--------|
| [0](AIP-0-process.md) | The AIP process | Final |
