# Run your own Aleph node or registry

> The network is the set of **nodes**, not any registry. Running your own is what
> makes Aleph decentralized in practice, not just in theory. This guide gets a
> node (or a registry) online and discoverable.

## Minimum hardware

- **Node:** 1 vCPU, 512 MB RAM, a few GB disk. Stateless if you don't persist
  reputation; small Postgres/SQLite otherwise.
- **Registry:** 1–2 vCPU, 1–2 GB RAM, plus **Postgres** (managed is easiest).
- **Network:** a public hostname with **valid TLS** (required for `did:web` and
  for agents to reach you). Terminate TLS at a reverse proxy (Caddy/Traefik/your
  platform) in front of the container.

## The one image, two roles

Both the registry and a node run from the same image (`@aleph/cli`); the
**command** selects the role. Configuration is by environment variable
(validated at startup — a bad value fails fast):

| env | meaning | default |
| --- | --- | --- |
| `PORT` | listen port | 4000 |
| `HOST` | bind address (`0.0.0.0` in a container) | 127.0.0.1 |
| `PUBLIC_URL` | external base URL advertised in the Manifest / reported url | — |
| `DATABASE_URL` | Postgres DSN; absent ⇒ in-memory (dev only) | — |
| `PEERS` | comma-separated registry peers to federate with | — |
| `ALEPH_LOG_LEVEL` | `debug\|info\|warn\|error\|silent` | info |

**Secrets** (`DATABASE_URL`, RPC keys, signing keys) come from your platform's
secret store as env vars — never committed. CI runs a secret scan; add
[gitleaks](https://github.com/gitleaks/gitleaks) for deeper coverage.

## Local full stack (one command)

```bash
docker compose up        # registry + node + Postgres
# registry → http://localhost:4000   node → http://localhost:4100
curl http://localhost:4000/healthz
curl http://localhost:4100/healthz
```

## Run a node against a public registry

```bash
docker run --rm -p 4100:4100 \
  -e HOST=0.0.0.0 -e PORT=4100 \
  -e PUBLIC_URL=https://node.example.org \
  ghcr.io/leonardo-corte/aleph:latest \
  node packages/cli/dist/cli.js node --registry https://registry.example.org
```

The node signs its Manifest, registers at the registry, and is then
discoverable. Verify:

```bash
# from anywhere
node packages/cli/dist/cli.js resolve math.add --registry https://registry.example.org
```

## Run (and federate) a registry

```bash
docker run --rm -p 4000:4000 \
  -e HOST=0.0.0.0 -e PORT=4000 \
  -e DATABASE_URL=postgres://user:pass@db/aleph \
  -e PUBLIC_URL=https://registry.example.org \
  -e PEERS=https://other-registry.example.org \
  ghcr.io/leonardo-corte/aleph:latest
```

With `PEERS` set, the registry gossips new registrations and **reconciles** the
rest via anti-entropy (`GET /since`), so a registry that was offline catches up.
Registries are replicating indexes, not authorities — they re-verify every
Manifest before indexing. See `spec/REGISTRY.md`.

## Observability

- `GET /metrics` — Prometheus text format (scrape it).
- `GET /healthz` — liveness/readiness (the container HEALTHCHECK target).
- Structured JSON logs (set `ALEPH_LOG_LEVEL=info`); see `spec/OBSERVABILITY.md`
  for the alert rules and Grafana dashboard under `deploy/observability/`.

## Backup & restore

State lives in Postgres (registry index, reputation, nonces, settlement history).
Back it up with your platform's managed snapshots or `pg_dump`:

```bash
pg_dump "$DATABASE_URL" > aleph-$(date +%F).sql      # backup
psql "$DATABASE_URL" < aleph-2026-06-15.sql           # restore
```

A node's **identity key** is its name on the network — back it up securely
(encrypted keystore; see `aleph keygen` and `spec`/key management). Losing it
means losing the node's accrued reputation.

## Upgrades & rollback

See [`docs/operators/RELEASE.md`](./RELEASE.md): migrations run **before** the new
code (backward-compatible for zero-downtime), and rollback is redeploying the
previous image tag.
