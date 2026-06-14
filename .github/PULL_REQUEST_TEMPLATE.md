## What & why

<!-- What does this change and why? Link the issue or AIP. -->

## Checklist

- [ ] `pnpm -r typecheck` passes (strict, no `@ts-ignore`)
- [ ] `pnpm exec eslint` and `prettier --check` pass
- [ ] `pnpm -r build` succeeds
- [ ] `pnpm test` is green; new behavior has tests (security gates have negative tests)
- [ ] Added a changeset (`pnpm changeset`) for user-facing changes
- [ ] If this changes the thin waist (wire format), it is backed by an AIP
- [ ] `@aleph/core` remains I/O-free
