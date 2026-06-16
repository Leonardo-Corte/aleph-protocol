"""Domain-separated Ed25519 signing — reproduces @aleph/core's signing.ts. Every
signed object kind is signed over `<domain>\\n<RFC8785(obj)>` (UTF-8 bytes), so a
signature for one kind can never verify as another."""

import base64

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .canonical import canonicalize
from .identity import public_key_from_did

DOMAIN = {
    "envelope": "aleph/0.1:envelope",
    "grant": "aleph/0.1:grant",
    "attestation": "aleph/0.1:attestation",
    "revocation": "aleph/0.1:revocation",
    "settlement": "aleph/0.1:settlement",
    "manifest": "aleph/0.1:manifest",
}


def signed_message(domain: str, obj) -> bytes:
    """The exact bytes a signature is computed over."""
    return (domain + "\n" + canonicalize(obj)).encode("utf-8")


def _b64url_nopad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_ed25519(domain: str, obj, private_key: Ed25519PrivateKey) -> str:
    """Return the base64url (no padding) signature, matching the TS encoding."""
    return _b64url_nopad(private_key.sign(signed_message(domain, obj)))


def verify_by_did(did: str, domain: str, obj, sig_b64url: str) -> bool:
    try:
        pub = public_key_from_did(did)
        pub.verify(_b64url_decode(sig_b64url), signed_message(domain, obj))
        return True
    except (InvalidSignature, ValueError):
        return False
