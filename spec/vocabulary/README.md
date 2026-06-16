# The capability vocabulary

A capability **key** (e.g. `data.geocode`) is a shared name so that two nodes
offering "the same thing" really match — **by identity, not prose**. This
directory is the **curated catalog** (`catalog.json`): each entry carries a
description, a risk default, reversibility, and a JSON Schema for input and
output. A node advertising a key SHOULD honour its schema so an agent can
validate input/output and rank interchangeable providers.

Well-formedness (enforced by `@aleph/core`'s `isWellFormedKey`): a dotted,
lowercase, hierarchical id — `namespace.name(.name)+`, each segment
`[a-z][a-z0-9-]*`, at least two segments.

## Proposing a new key (the AIP-style flow)

The vocabulary is **perpetual governance**: new keys are adopted by proposal,
not decree. To propose one:

1. Open a PR adding an entry to `catalog.json` with:
   - a **well-formed key** in an appropriate namespace,
   - a clear **description**,
   - a **risk** default (`low | medium | high`) and **reversibility**,
   - an **input** and **output** JSON Schema.
2. Set `status: "proposed"`. In the PR description, give the **rationale**: what
   real work it describes, why the namespace, and any safety considerations
   (e.g. network egress, cost, irreversibility).
3. Review is by maintainers + community comment. On acceptance the status moves
   `proposed → stable`. Breaking a *stable* key's schema requires a new key (or,
   for waist-level concerns, an AIP — see `spec/aips/`).

The seed keys live in code (`SEED_VOCABULARY`); the catalog here is the governed,
schema-bearing superset that nodes and agents build against.
