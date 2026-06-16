// Reference capability implementations — small, deterministic, and verifiable,
// so they exercise the protocol end to end without external services. A real
// deployment swaps the handler body for a geocoding provider / an LLM / a
// fetcher; the schema (from spec/vocabulary/catalog.json) stays the contract.
//
// Copy one of these into a `create-aleph-node` skeleton to ship a real node.

import type { JsonSchema } from "@aleph/core";

type Handler = (input: Record<string, unknown>) => { output: Record<string, unknown> };

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

export interface ReferenceCapability {
  schema: JsonSchema;
  handler: Handler;
  priceEur?: number;
  risk?: "low" | "medium" | "high";
}

// --- data.geocode: a built-in gazetteer (deterministic, offline) ------------
const GAZETTEER: Record<string, { name: string; lat: number; lon: number }> = {
  paris: { name: "Paris", lat: 48.8566, lon: 2.3522 },
  london: { name: "London", lat: 51.5074, lon: -0.1278 },
  "new york": { name: "New York", lat: 40.7128, lon: -74.006 },
  tokyo: { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
  rome: { name: "Rome", lat: 41.9028, lon: 12.4964 },
  milan: { name: "Milan", lat: 45.4642, lon: 9.19 },
  berlin: { name: "Berlin", lat: 52.52, lon: 13.405 },
  "san francisco": { name: "San Francisco", lat: 37.7749, lon: -122.4194 },
};

export const geocode: ReferenceCapability = {
  risk: "low",
  schema: {
    type: "object",
    properties: { place: { type: "string" } },
    required: ["place"],
  },
  handler: (input) => {
    const place = asString(input.place).trim().toLowerCase();
    const hit = GAZETTEER[place];
    if (!hit) throw new Error(`unknown place: ${String(input.place)}`);
    return { output: { name: hit.name, lat: hit.lat, lon: hit.lon } };
  },
};

// --- text.summarize: extractive, frequency-scored (deterministic) -----------
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 0);
}

export const summarize: ReferenceCapability = {
  risk: "low",
  schema: {
    type: "object",
    properties: { text: { type: "string" }, maxSentences: { type: "number" } },
    required: ["text"],
  },
  handler: (input) => {
    const text = asString(input.text);
    const k = Math.max(1, Math.floor(Number(input.maxSentences ?? 2)));
    const sentences = splitSentences(text);
    if (sentences.length <= k) {
      return { output: { summary: sentences.join(" "), sentences: sentences.length } };
    }
    // score each sentence by the summed frequency of its (lowercased) words
    const freq = new Map<string, number>();
    const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    for (const s of sentences) for (const w of words(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const scored = sentences.map((s, i) => {
      const ws = words(s);
      const score = ws.reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.max(1, ws.length);
      return { i, s, score };
    });
    // top-k by score, then restored to original order (a readable summary)
    const top = [...scored].sort((a, b) => b.score - a.score).slice(0, k);
    top.sort((a, b) => a.i - b.i);
    return { output: { summary: top.map((t) => t.s).join(" "), sentences: top.length } };
  },
};

// The reference capability set, keyed by vocabulary key.
export const referenceCapabilities: Record<string, ReferenceCapability> = {
  "data.geocode": geocode,
  "text.summarize": summarize,
};
