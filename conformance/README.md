# Cross-language conformance

Aleph is a protocol — what gets signed must be identical across every
implementation, in any language. This directory proves it.

`python/` is an independent Python reimplementation of:
- **RFC 8785 (JCS) canonicalization** — must reproduce the official vectors in
  `spec/test-vectors/jcs/` byte-for-byte (including UTF-16 code-unit key
  ordering, where a naive port diverges from the TypeScript reference).
- **The Aleph signed message** — `<domain>\n<canonical>` — must match the
  `spec/test-vectors/aleph/signing.json` vector and **verify a TypeScript-produced
  Ed25519 signature**.

Run it:

```bash
pip install cryptography
python conformance/python/run_vectors.py
```

CI runs this on every push. If the Python and TypeScript canonical bytes ever
diverge, the build fails — that is the language-independence guarantee.
