# RFC 8785 (JCS) test vectors

Official JSON Canonicalization Scheme test vectors, vendored from the reference
implementation (cyberphone/json-canonicalization), used to verify that Aleph's
`canonicalize` produces byte-for-byte RFC 8785 output. Every Aleph SDK (TS,
Python, …) MUST reproduce these.

- `input/*.json` — the input documents
- `output/*.json` — the expected canonical bytes
