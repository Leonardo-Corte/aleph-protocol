// Minimal base58btc (Bitcoin alphabet) encode/decode — zero dependencies.
// Used to render and parse did:key identifiers.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58n;

export function base58encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = "";
  while (num > 0n) {
    const rem = Number(num % BASE);
    num = num / BASE;
    out = ALPHABET[rem] + out;
  }
  return "1".repeat(zeros) + out;
}

export function base58decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array();
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  let num = 0n;
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base58 character: " + ch);
    num = num * BASE + BigInt(idx);
  }
  const tail: number[] = [];
  while (num > 0n) {
    tail.unshift(Number(num % 256n));
    num = num / 256n;
  }
  const out = new Uint8Array(zeros + tail.length);
  out.set(tail, zeros);
  return out;
}
