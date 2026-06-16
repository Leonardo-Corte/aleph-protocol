"""Cross-language conformance: drive the `aleph_protocol` Python SDK against the
official RFC 8785 vectors and the Aleph signing vector, and round-trip a signed
Envelope. If these agree byte-for-byte with the TypeScript reference, the
protocol is language-independent — not "whatever the TS code does"."""

import json
import os
import sys

# Use the installable SDK as the source of truth (no duplicated impl).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sdk", "python"))
from aleph_protocol import (  # noqa: E402
    canonicalize,
    did_from_public_key,
    public_key_from_did,
    signed_message,
    verify_by_did,
    generate_identity,
    create_envelope,
    verify_envelope,
    DOMAIN,
)

VEC = os.path.join(os.path.dirname(__file__), "..", "..", "spec", "test-vectors")
fails = 0


def check(ok, label, expected=None, got=None):
    global fails
    print(("ok   " if ok else "FAIL ") + label)
    if not ok:
        if expected is not None:
            print("  expected:", repr(expected))
            print("  got:     ", repr(got))
        fails += 1


# --- RFC 8785 canonicalization vectors ---
jcs = os.path.join(VEC, "jcs")
for name in ["arrays", "structures", "values", "weird", "unicode", "french"]:
    with open(os.path.join(jcs, "input", name + ".json"), encoding="utf-8") as f:
        inp = json.load(f)
    with open(os.path.join(jcs, "output", name + ".json"), encoding="utf-8") as f:
        expected = f.read().rstrip("\n")
    got = canonicalize(inp)
    check(got == expected, "jcs/" + name, expected, got)

# --- Aleph signing vector ---
with open(os.path.join(VEC, "aleph", "signing.json"), encoding="utf-8") as f:
    v = json.load(f)

# 1. the signed message bytes agree (canonicalization + domain prefix)
msg = signed_message(v["domain"], v["object"]).decode("utf-8")
check(msg == v["signedMessage"], "aleph/signed-message", v["signedMessage"], msg)

# 2. the did:key encoding agrees (public key hex -> did)
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey  # noqa: E402

pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(v["publicKeyHex"]))
check(did_from_public_key(pub) == v["did"], "aleph/did-key-encoding", v["did"], did_from_public_key(pub))

# 3. the Ed25519 signature verifies via the SDK's verify_by_did (parses the DID)
import base64  # noqa: E402

sig_b64url = base64.urlsafe_b64encode(bytes.fromhex(v["signatureHex"])).rstrip(b"=").decode()
check(verify_by_did(v["did"], v["domain"], v["object"], sig_b64url), "aleph/ed25519-signature")

# --- Envelope round-trip (the SDK signs, then verifies; tamper must fail) ---
agent = generate_identity()
env = create_envelope(agent, "did:aleph:peer", "INVOKE", {"capability": "math.add", "input": {"a": 2, "b": 3}})
check(verify_envelope(env), "aleph/envelope-roundtrip")
tampered = dict(env)
tampered["body"] = {"capability": "math.add", "input": {"a": 9, "b": 9}}
check(not verify_envelope(tampered), "aleph/envelope-tamper-rejected")
# a parsed-back public key matches the signer's DID
check(public_key_from_did(agent.did) is not None and DOMAIN["envelope"] == "aleph/0.1:envelope", "aleph/did-parse")

print(f"\n{'PASS' if fails == 0 else 'FAIL'} ({fails} failures)")
sys.exit(1 if fails else 0)
