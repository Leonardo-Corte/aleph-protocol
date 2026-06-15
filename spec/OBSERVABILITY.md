# Observability

> Status: implemented (ROADMAP §8, decision D11). Structured logs, Prometheus
> metrics, and trace correlation are first-class in `@aleph/transport` and wired
> into the node and registry. A network you cannot observe is one you cannot
> operate or trust.

## Principle

Start with the **four golden signals** (latency, traffic, errors, saturation)
plus the **settlement- and Sybil-specific** counters that matter for *this*
protocol. Don't over-instrument.

## Structured logging

- One **JSON object per line**: `{ ts, level, msg, service, trace, ... }`.
- **Trace correlation:** the agent stamps a trace id (`x-aleph-trace`) on resolve
  and invoke; the registry and node bind it to a per-request child logger, so one
  operation is followable end to end (agent → registry → node).
- **Secret redaction by policy:** keys matching private-key/secret/passphrase/
  token/seed/authorization are `[REDACTED]` at any depth. Signatures are public
  and kept. Never log private keys or bearer material.
- Default level is **silent**; set `ALEPH_LOG_LEVEL` (`debug|info|warn|error`) or
  inject a logger. The `Logger` interface mirrors **pino** — swap it in for
  production (async transports, sampling) behind the same call sites.

## Metrics (`GET /metrics`, Prometheus text format)

Exposed on both the node and the registry:

| metric | type | labels | meaning |
| --- | --- | --- | --- |
| `aleph_requests_total` | counter | `service` | traffic (all served requests) |
| `aleph_request_ms` | histogram | `service` | latency (the SLO source) |
| `aleph_errors_total` | counter | `code` | errors by `AlephErrorCode` |
| `aleph_invoke_total` | counter | `outcome` | INVOKE success/rejected/failure |
| `aleph_resolve_total` | counter | — | RESOLVEs served (registry) |
| `aleph_registrations_total` | counter | `first_seen` | node registrations (Sybil-flood signal) |
| `aleph_settlements_total` | counter | `status` | settlements released/refunded |

Swap the in-house registry for **prom-client** in production behind the same
call sites if you want exemplars/native histograms.

## SLOs

| SLO | target | source |
| --- | --- | --- |
| RESOLVE p99 latency | < 50 ms (warm) | `aleph_request_ms{service="registry"}` |
| INVOKE availability | > 99.5% | `1 - errors/invoke_total` |
| Settlement success | > 99% | `aleph_settlements_total{status="released"} / total` |

## Tracing

Trace correlation links agent → registry → node in the logs today (the chain leg
is the node's settlement path, logged within the same trace). For full
distributed tracing, swap the trace helpers for **OpenTelemetry** (W3C
`traceparent` propagation + spans exported to a collector) at the same seam
(`@aleph/transport`'s `TRACE_HEADER` / `traceIdFrom`).

## Alerting & dashboards

- **Prometheus alert rules:** `deploy/observability/alerts.yml` — the critical
  alerts: error-rate spike, settlement-failure spike, and abnormal registration
  rate (possible Sybil flood).
- **Grafana dashboard:** `deploy/observability/dashboard.json` — the four golden
  signals plus settlement/registration panels, bound to the metrics above.

Wire `/metrics` into a Prometheus scrape, load the alert rules, and import the
dashboard. Alert routing (PagerDuty/Slack) is deployment-specific (Section 9).
