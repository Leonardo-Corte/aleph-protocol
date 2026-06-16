"""Base58 (Bitcoin alphabet) — matches @aleph/core's base58 so did:key strings
are byte-identical across implementations."""

_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_INDEX = {c: i for i, c in enumerate(_ALPHABET)}


def b58encode(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = ""
    while n > 0:
        n, r = divmod(n, 58)
        out = _ALPHABET[r] + out
    # each leading zero byte becomes a '1'
    pad = 0
    for byte in data:
        if byte == 0:
            pad += 1
        else:
            break
    return "1" * pad + out


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        if ch not in _INDEX:
            raise ValueError("invalid base58 character: " + ch)
        n = n * 58 + _INDEX[ch]
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n > 0 else b""
    pad = 0
    for ch in s:
        if ch == "1":
            pad += 1
        else:
            break
    return b"\x00" * pad + body
