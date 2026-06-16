"""Cross-language INTEROP: a Python agent builds + signs an INVOKE with the
aleph_protocol SDK and calls a *TypeScript* node — no shared code. Prints the
node's response as JSON: {"status": <code>, "body": <receipt-or-error>}.

Usage (driven by e2e/test/interop.test.ts):
  python3 interop_client.py <endpoint> <node_did> [--tamper]
"""

import json
import os
import sys
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sdk", "python"))
from aleph_protocol import generate_identity, create_envelope  # noqa: E402
from aleph_protocol.client import _post_json  # noqa: E402

endpoint = sys.argv[1]
node_did = sys.argv[2]
tamper = "--tamper" in sys.argv[3:]

agent = generate_identity()
env = create_envelope(agent, node_did, "INVOKE", {"capability": "math.add", "input": {"a": 2, "b": 3}})

if tamper:
    # mutate the body AFTER signing → the node's signature check must reject it
    env = dict(env)
    env["body"] = {"capability": "math.add", "input": {"a": 9, "b": 9}}

try:
    body = _post_json(endpoint, env)
    print(json.dumps({"status": 200, "body": body}))
except urllib.error.HTTPError as e:
    print(json.dumps({"status": e.code, "body": json.loads(e.read().decode("utf-8"))}))
