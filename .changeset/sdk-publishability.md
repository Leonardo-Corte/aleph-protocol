---
"@aleph/transport": minor
---

Make @aleph/transport publishable: it is a runtime dependency of @aleph/node,
@aleph/registry, and @aleph/cli, so the published dependency graph must include
it. Adds full publish metadata (repository, homepage, provenance). Also adds a
TypeDoc API reference (`pnpm docs:api`) over the public SDK surface
(@aleph/core + @aleph/client).
