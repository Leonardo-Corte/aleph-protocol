"""aleph-protocol — a minimal Python SDK for the Aleph agent-native web protocol.

It reproduces the wire format of the TypeScript reference (@aleph/core) byte-for-
byte — canonicalization, did:key identity, domain-separated Ed25519 signing, and
the Envelope — which is the proof that the protocol is language-independent, not
"whatever the TS code does". Plus a tiny HTTP client (resolve / invoke)."""

from .base58 import b58decode, b58encode
from .canonical import canonicalize
from .client import invoke, resolve
from .envelope import PROTOCOL_VERSION, create_envelope, verify_envelope
from .identity import (
    Identity,
    did_from_public_key,
    generate_identity,
    public_key_from_did,
)
from .signing import DOMAIN, sign_ed25519, signed_message, verify_by_did

__version__ = "0.2.0"

__all__ = [
    "__version__",
    "canonicalize",
    "b58encode",
    "b58decode",
    "Identity",
    "generate_identity",
    "did_from_public_key",
    "public_key_from_did",
    "DOMAIN",
    "signed_message",
    "sign_ed25519",
    "verify_by_did",
    "PROTOCOL_VERSION",
    "create_envelope",
    "verify_envelope",
    "resolve",
    "invoke",
]
