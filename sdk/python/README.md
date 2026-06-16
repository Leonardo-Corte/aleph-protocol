# aleph-protocol (Python)

A minimal Python SDK for the **Aleph** agent-native web protocol. It reproduces
the TypeScript reference (`@aleph/core`) wire format **byte-for-byte** —
RFC 8785 canonicalization, `did:key` identity, domain-separated Ed25519 signing,
and the Envelope — which is the proof the protocol is language-independent.

```python
from aleph_protocol import generate_identity, resolve, invoke

agent = generate_identity()
nodes = resolve("https://registry.example.org", "math.add", agent)
top = nodes[0]
receipt = invoke(top["did"], top_endpoint, "math.add", {"a": 2, "b": 3}, agent)
print(receipt["body"]["outcome"], receipt["body"]["result"])
```

The signatures a Python agent produces verify on a TypeScript node with no shared
code — see the cross-language conformance + interop tests in CI.

Requires `cryptography`. Install: `pip install aleph-protocol`.
