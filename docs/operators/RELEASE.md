# Release & rollback

## Build & publish images

Container images are built and pushed to GHCR by
`.github/workflows/release-images.yml` on a version tag (or manual dispatch):

```bash
git tag v0.3.0
git push origin v0.3.0     # → ghcr.io/leonardo-corte/aleph:v0.3.0 and :latest
```

The image is the plain `Dockerfile` — it runs anywhere a container runs (no
platform lock-in). Pin to a version tag in production; `latest` is for dev.

## Deploy order — migrations BEFORE code

Schema migrations must be **backward-compatible** and run **before** the new code
is rolled out, so the old and new versions can both run during a rollout
(zero-downtime). Aleph's store `migrate()` is `CREATE TABLE/INDEX IF NOT EXISTS`
+ additive columns — forward-only and backward-compatible by construction. The
deploy sequence:

1. Run `migrate()` (the registry/node calls it on boot when `DATABASE_URL` is
   set; for a controlled rollout, run a one-off `migrate` task first).
2. Roll out the new image (rolling/blue-green per your platform).
3. Watch `/metrics` + the error-rate and settlement-failure alerts
   (`deploy/observability/alerts.yml`).

## Rollback

Because migrations are additive and backward-compatible, **rollback is simply
redeploying the previous image tag** — the older code still reads the newer
schema. Do **not** write destructive (column-dropping) migrations without a
two-step expand/contract release; that is what keeps rollback safe.

```bash
# redeploy the previous known-good tag
deploy ghcr.io/leonardo-corte/aleph:v0.2.0
```

## Owner's manual gate

Provisioning the platform (Fly.io/Railway/Render/K8s), the managed Postgres, the
real HTTPS domain + certs, the secret store, and wiring CD to auto-deploy on a
tag are **deployment-specific owner steps** — they cannot be exercised from this
repo's CI. The image, compose stack, healthcheck, config validation, migrations,
and rollback procedure here make those steps mechanical.
