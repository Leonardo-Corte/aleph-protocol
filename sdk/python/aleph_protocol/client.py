"""A tiny HTTP client (stdlib only): FIND at a registry and ACT on a node. The
agent signs its own Envelopes, so a TS node verifies a Python-built request with
no shared code — protocol-level interop, not just canonicalization."""

import json
import urllib.request

from .envelope import create_envelope
from .identity import Identity

_TRACE_HEADER = "x-aleph-trace"


def _post_json(url: str, obj: dict, trace: str = None) -> dict:
    headers = {"content-type": "application/json"}
    if trace:
        headers[_TRACE_HEADER] = trace
    data = json.dumps(obj).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def resolve(registry_url: str, capability: str, agent: Identity, filter: dict = None, trace: str = None):
    """Ask a registry who provides a capability. Returns the list of pointers."""
    env = create_envelope(
        agent, "did:aleph:registry", "RESOLVE", {"capability": capability, "filter": filter or {}}
    )
    out = _post_json(registry_url + "/aleph", env, trace)
    return out.get("results", [])


def invoke(
    node_did: str,
    endpoint: str,
    capability: str,
    input: dict,
    agent: Identity,
    grant: dict = None,
    trace: str = None,
) -> dict:
    """Invoke a capability on a node; returns the signed RECEIPT envelope."""
    body = {"capability": capability, "input": input}
    if grant is not None:
        body["grant"] = grant
    env = create_envelope(agent, node_did, "INVOKE", body)
    return _post_json(endpoint, env, trace)
