"""The Envelope — the universal signed message between two DIDs. Reproduces
@aleph/core's envelope.ts: the unsigned envelope is signed over the `envelope`
domain; `from` is the signer's DID."""

import time
import uuid

from .identity import Identity
from .signing import DOMAIN, sign_ed25519, verify_by_did

PROTOCOL_VERSION = "aleph/0.1"

# RESOLVE / INVOKE / RECEIPT / ATTEST / SETTLE
EnvelopeType = str


def create_envelope(
    sender: Identity,
    to: str,
    type: EnvelopeType,
    body: dict,
    *,
    nonce: str = None,
    ts: int = None,
) -> dict:
    env = {
        "v": PROTOCOL_VERSION,
        "from": sender.did,
        "to": to,
        "type": type,
        "nonce": nonce or str(uuid.uuid4()),
        "ts": ts if ts is not None else int(time.time() * 1000),
        "body": body,
    }
    env["sig"] = sign_ed25519(DOMAIN["envelope"], env, sender.private_key)
    return env


def verify_envelope(env: dict) -> bool:
    if "sig" not in env or not env["sig"]:
        return False
    unsigned = {k: v for k, v in env.items() if k != "sig"}
    return verify_by_did(env["from"], DOMAIN["envelope"], unsigned, env["sig"])
