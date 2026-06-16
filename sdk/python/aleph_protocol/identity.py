"""did:key identity (Ed25519) — the DID *is* the public key. Matches
@aleph/core's identity.ts: multicodec prefix 0xed 0x01 + raw key, base58btc,
prefixed with 'z'."""

from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from .base58 import b58decode, b58encode

_ED25519_PREFIX = bytes([0xED, 0x01])
_DIDKEY = "did:key:z"


@dataclass
class Identity:
    did: str
    private_key: Ed25519PrivateKey


def did_from_public_key(pub: Ed25519PublicKey) -> str:
    raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
    return _DIDKEY + b58encode(_ED25519_PREFIX + raw)


def generate_identity() -> Identity:
    priv = Ed25519PrivateKey.generate()
    return Identity(did=did_from_public_key(priv.public_key()), private_key=priv)


def public_key_from_did(did: str) -> Ed25519PublicKey:
    if not did.startswith(_DIDKEY):
        raise ValueError("unsupported DID method: " + did)
    decoded = b58decode(did[len(_DIDKEY) :])
    if len(decoded) < 2 or decoded[0] != 0xED or decoded[1] != 0x01:
        raise ValueError("not an Ed25519 did:key")
    return Ed25519PublicKey.from_public_bytes(bytes(decoded[2:]))
