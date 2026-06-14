"""Cross-language conformance: verify the Python canonicalize against the
official RFC 8785 vectors, and verify an Aleph Ed25519 signing vector. This
proves the protocol is language-independent — the signed bytes and signatures
agree across implementations."""
import json
import sys
import os
from aleph_jcs import canonicalize

VEC = os.path.join(os.path.dirname(__file__), "..", "..", "spec", "test-vectors")
fails = 0

# --- RFC 8785 canonicalization vectors ---
jcs = os.path.join(VEC, "jcs")
for name in ["arrays", "structures", "values", "weird", "unicode", "french"]:
    with open(os.path.join(jcs, "input", name + ".json"), encoding="utf-8") as f:
        inp = json.load(f)
    with open(os.path.join(jcs, "output", name + ".json"), encoding="utf-8") as f:
        expected = f.read().rstrip("\n")
    got = canonicalize(inp)
    ok = got == expected
    print(("ok   " if ok else "FAIL ") + "jcs/" + name)
    if not ok:
        print("  expected:", expected); print("  got:     ", got); fails += 1

# --- Aleph signing vector ---
with open(os.path.join(VEC, "aleph", "signing.json"), encoding="utf-8") as f:
    v = json.load(f)

# 1. the signed message agrees byte-for-byte (canonicalization + domain prefix)
msg = v["domain"] + "\n" + canonicalize(v["object"])
ok = msg == v["signedMessage"]
print(("ok   " if ok else "FAIL ") + "aleph/signed-message")
if not ok:
    print("  expected:", repr(v["signedMessage"])); print("  got:     ", repr(msg)); fails += 1

# 2. the Ed25519 signature verifies (requires `cryptography`; skipped if absent)
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.exceptions import InvalidSignature
    pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(v["publicKeyHex"]))
    try:
        pub.verify(bytes.fromhex(v["signatureHex"]), msg.encode("utf-8"))
        print("ok   aleph/ed25519-signature")
    except InvalidSignature:
        print("FAIL aleph/ed25519-signature (signature did not verify)"); fails += 1
except ImportError:
    print("skip aleph/ed25519-signature (install `cryptography` to run)")

print(f"\n{'PASS' if fails == 0 else 'FAIL'} ({fails} failures)")
sys.exit(1 if fails else 0)
