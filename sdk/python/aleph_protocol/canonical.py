"""RFC 8785 (JCS) canonicalization — must reproduce @aleph/core's canonicalize
byte-for-byte. This is what makes the protocol language-independent: the signed
bytes agree across implementations."""

import json
import math


def _ser_number(n):
    # RFC 8785 §3.2.2.3 mandates the ECMAScript Number::toString algorithm.
    if isinstance(n, bool):  # bool is a subclass of int in Python
        raise ValueError("bool is not a number")
    if isinstance(n, int):
        return str(n)
    if not math.isfinite(n):
        raise ValueError("non-finite numbers are not permitted (RFC 8785)")
    if n == int(n) and abs(n) < 1e21:
        return str(int(n))  # 4.0 -> "4", matching ECMAScript
    return repr(n)


def _ser_string(s):
    # Python's json string escaping matches RFC 8785 §3.2.2.2 (short escapes,
    # lowercase \u00xx for other controls, non-ASCII as UTF-8, slash unescaped).
    return json.dumps(s, ensure_ascii=False)


def canonicalize(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _ser_number(value)
    if isinstance(value, str):
        return _ser_string(value)
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(v) for v in value) + "]"
    if isinstance(value, dict):
        # Sort keys by UTF-16 code units (NOT Python's default code-point order):
        # encode each key to UTF-16 big-endian and compare those bytes.
        keys = sorted(value.keys(), key=lambda k: k.encode("utf-16-be"))
        members = (_ser_string(k) + ":" + canonicalize(value[k]) for k in keys)
        return "{" + ",".join(members) + "}"
    raise ValueError("cannot canonicalize: " + repr(value))
