# AIP-0: The AIP process

- **Status:** Final
- **Author:** Aleph maintainers
- **Created:** 2026-06-14
- **Layer:** layer (governance)

## Summary

Defines how Aleph changes: numbered proposals, public review, and a defined bar,
with a hard distinction between near-frozen *waist* changes and lighter *layer*
changes.

## Specification

- Every change to the **thin waist** (the `Envelope`, `Manifest`, `Grant`, and
  the five message types `RESOLVE | INVOKE | RECEIPT | ATTEST | SETTLE`) MUST be
  proposed as an AIP, reviewed publicly, and ship with a **major** protocol
  version bump and updated test vectors.
- Changes to **layers** (discovery, settlement, reputation, transport, SDK
  ergonomics) SHOULD use normal PRs; an AIP is OPTIONAL unless the change is
  cross-cutting.
- Status flow: `Draft → Review → Accepted | Rejected → Final`.
- An AIP is Accepted when a maintainer, after public review with no unresolved
  blocking objections, marks it so. It becomes Final once a reference
  implementation lands.

## Backward compatibility

This is the meta-process; it introduces no wire change.

## Security considerations

The waist/layer asymmetry concentrates scrutiny where mistakes are
near-permanent (the waist) and keeps iteration cheap where they are not (layers).

## Reference implementation

This document.
