# Contributing to Aleph

Thank you for helping build the agent-native web. Aleph is a protocol — others
build on it — so contributions are held to a production bar: typed, tested,
linted, and small enough to review.

## Ground rules

- **The thin waist is near-frozen.** Changes to the wire format (the `Envelope`,
  `Manifest`, `Grant`, and the five message types) require an
  [AIP](spec/aips/) (Aleph Improvement Proposal) and a major-version bump.
  Changes to the *layers* (registry, settlement, reputation, transport, SDK
  ergonomics) are lighter. See [`DECISIONS.md`](DECISIONS.md).
- **A convergent objection from an opposite premise is worth more than
  agreement.** Precise attacks on the design are welcome.
- **No new "TBD".** If something is unfinished, declare it as a known limit.

## Development setup

Requirements: **Node ≥ 22** and **pnpm** (`corepack enable`).

```bash
git clone https://github.com/Leonardo-Corte/aleph-protocol
cd aleph-protocol
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm test            # via the e2e package
```

The monorepo (`packages/*`):

| Package | What it is |
|---|---|
| `@aleph/core` | the thin waist — identity, envelopes, grants, manifests, schema, vocabulary, settlement interface, trust. **No I/O.** |
| `@aleph/node` | the capability-provider runtime |
| `@aleph/registry` | the discovery service |
| `@aleph/client` | the agent-facing SDK (the target) |
| `@aleph/mcp` | Aleph exposed as an MCP server |
| `@aleph/cli` | the terminal tool |
| `@aleph/transport` | internal HTTP helpers (private) |

`e2e/` holds integration tests; `examples/` holds runnable demos.

## The quality gates (CI enforces all of these)

Before opening a PR, make sure these pass — the pre-commit hook runs format +
lint on staged files automatically:

```bash
pnpm -r typecheck                                  # strict; no @ts-ignore
pnpm exec eslint "packages/*/src/**/*.ts"          # no errors
pnpm exec prettier --check "packages/**/*.ts"      # formatted
pnpm -r build                                      # ESM + types
pnpm test                                          # all green
pnpm test:coverage                                 # above thresholds
```

- **`@aleph/core` must stay I/O-free** (no `node:http`, no `fs`) — it must run in
  any runtime. Network/disk code lives in `@aleph/transport`, `@aleph/node`, or
  `@aleph/registry`.
- New behavior needs a test. Security-relevant behavior needs a *negative* test
  (the gate must be shown to bite).

## Commits & PRs

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`). The commit messages drive the changelog.
- **Add a changeset** for any user-facing change: `pnpm changeset` and follow the
  prompts (pick the affected packages and the bump level). PRs that change
  published packages without a changeset will be flagged.
- Keep PRs focused and reviewable. Link the issue or AIP.

## Security

Do **not** open a public issue for a vulnerability. See
[`SECURITY.md`](SECURITY.md) for private disclosure.

## License

By contributing, you agree your contributions are licensed under
[Apache-2.0](LICENSE) (code) / [CC-BY-4.0](LICENSE-docs) (docs), matching the
project.
