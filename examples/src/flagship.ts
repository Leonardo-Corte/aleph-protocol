// The flagship demonstration: an agent, given a real task, FINDs several real-
// capability nodes, RANKS them by trust, COMPOSES two of them, PAYs each, and
// ends with a verifiable RECEIPT CHAIN — the five verbs, end to end, for real.
//
// `flagshipCompose` is the agent-side logic (used by the e2e test); `main` wires
// up a local network and runs it so you can watch it: `node src/flagship.ts`.

import { resolveRanked, fetchManifest, compose, type Composition } from "@aleph/client";
import { SettlementRail, generateIdentity, type Identity } from "@aleph/core";
import { createNode } from "@aleph/node";
import { createRegistry } from "@aleph/registry";
import { referenceCapabilities } from "./capabilities.ts";

// FIND the best provider of a capability (by trust), re-verify its Manifest, and
// return where to invoke it.
async function bestProvider(registryUrl: string, capability: string, agent: Identity) {
  const ranked = await resolveRanked(registryUrl, capability, agent);
  const top = ranked[0];
  if (!top) throw new Error(`no node found for ${capability}`);
  const manifest = await fetchManifest(top.manifest, top.did); // re-verifies sig + pins DID
  const endpoint = manifest.endpoint[0];
  if (!endpoint) throw new Error(`node ${top.did} has no endpoint`);
  return { did: manifest.identity, endpoint };
}

// The task: geocode a place, then summarize a short brief about it — paying each
// node for its own function, chaining the receipts.
export async function flagshipCompose(opts: {
  registryUrl: string;
  agent: Identity;
  rail: SettlementRail;
  place: string;
  payEur?: number;
}): Promise<Composition & { geocoder: string; summarizer: string }> {
  const pay = opts.payEur ?? 1;
  const geocoder = await bestProvider(opts.registryUrl, "data.geocode", opts.agent);
  const summarizer = await bestProvider(opts.registryUrl, "text.summarize", opts.agent);

  const result = await compose({
    agent: opts.agent,
    rail: opts.rail,
    initial: { place: opts.place },
    steps: [
      {
        nodeDid: geocoder.did,
        endpoint: geocoder.endpoint,
        capability: "data.geocode",
        payEur: pay,
        input: (carry) => ({ place: (carry as { place: string }).place }),
        pick: (r) => r, // carry the {name,lat,lon} forward
      },
      {
        nodeDid: summarizer.did,
        endpoint: summarizer.endpoint,
        capability: "text.summarize",
        payEur: pay,
        input: (geo) => {
          const g = geo as { name: string; lat: number; lon: number };
          return {
            text:
              `${g.name} is a city located at latitude ${g.lat} and longitude ${g.lon}. ` +
              `It is one of the places this Aleph agent can reason about. ` +
              `An agent resolved a geocoder and a summarizer, ranked them by trust, ` +
              `and paid each node for its own function. The receipts chain into a proof.`,
            maxSentences: 2,
          };
        },
        pick: (r) => (r as { summary: string }).summary,
      },
    ],
  });
  return { ...result, geocoder: geocoder.did, summarizer: summarizer.did };
}

// --- runnable demo: wire up a local network and run the composition ---------
async function main(): Promise<void> {
  const rail = new SettlementRail();
  const registry = createRegistry({ port: 4810 });
  await registry.listen();

  const geoId = generateIdentity();
  const sumId = generateIdentity();
  const geocoder = createNode({
    identity: geoId,
    port: 4811,
    rail,
    capabilities: { "data.geocode": { priceEur: 1, ...referenceCapabilities["data.geocode"]! } },
  });
  const summarizer = createNode({
    identity: sumId,
    port: 4812,
    rail,
    capabilities: { "text.summarize": { priceEur: 1, ...referenceCapabilities["text.summarize"]! } },
  });
  await geocoder.listen();
  await summarizer.listen();
  for (const n of [geocoder, summarizer]) {
    await fetch(registry.url + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: n.manifest, manifestUrl: n.url + "/manifest" }),
    });
  }

  const agent = generateIdentity();
  rail.deposit(agent.did, 100);

  console.log("Aleph flagship — resolve → rank → compose → pay → prove\n");
  const out = await flagshipCompose({ registryUrl: registry.url, agent, rail, place: "Tokyo" });
  console.log("summary :", out.value);
  console.log("receipts:", out.receipts.length, "· chain verified:", out.chain.ok);
  console.log("paid    :", out.geocoder.slice(0, 24) + "…,", out.summarizer.slice(0, 24) + "…");

  await geocoder.close();
  await summarizer.close();
  await registry.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
