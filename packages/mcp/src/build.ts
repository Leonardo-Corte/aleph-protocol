// Aleph as an MCP server: how an agent actually *uses* Aleph. Any MCP-capable
// agent (Claude Desktop, Claude Code, …) gains tools to cross the five verbs —
// FIND (ranked by trust), ACT+PAY (with a bounded grant, paying priced nodes via
// a settlement rail), PROVE (the signed receipt is verified, the output checked
// against its declared schema), and TRUST (write reputation after a paid call).
//
// IMPORTANT: never write to stdout here — stdout is the JSON-RPC channel.

import {
  resolveRanked,
  fetchManifest,
  invoke,
  attest,
  verifyOutput,
  requiresConfirmation,
} from "@aleph/client";
import { generateIdentity, createGrant, type Identity, type SettlementRail } from "@aleph/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface AlephServerOptions {
  registryUrl?: string;
  agent?: Identity; // the agent's identity (and, in v0, its own principal)
  rail?: SettlementRail; // inject to PAY priced nodes; absent ⇒ free nodes only
}

function jsonContent(obj: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }], isError };
}

// Build the Aleph MCP server. Pure + injectable so it is testable in-process
// (link an MCP client over an in-memory transport) and configurable for deploy.
export function buildAlephServer(opts: AlephServerOptions = {}): McpServer {
  const agent = opts.agent ?? generateIdentity();
  const registryDefault = opts.registryUrl ?? process.env.ALEPH_REGISTRY ?? "http://127.0.0.1:4000";
  const rail = opts.rail;
  const server = new McpServer({ name: "aleph", version: "0.2.0" });

  // FIND — ranked by consumer-computed trust (diversity-weighted, decayed).
  server.registerTool(
    "aleph_resolve",
    {
      title: "Aleph · find nodes, ranked by trust (FIND + TRUST)",
      description:
        "Ask the Aleph registry which nodes provide a capability, RANKED BY TRUST (reputation from real, settlement-backed custom). Returns pointers: did, summary, price, and trust score. Pull-not-push: fetch a full manifest only for a candidate you choose.",
      inputSchema: {
        capability: z.string().describe("semantic capability key, e.g. 'data.geocode'"),
        registryUrl: z.string().optional().describe("registry base URL (defaults to $ALEPH_REGISTRY)"),
      },
    },
    async ({ capability, registryUrl }) => {
      const ranked = await resolveRanked(registryUrl ?? registryDefault, capability, agent);
      return jsonContent(
        ranked.map((p) => ({
          did: p.did,
          summary: p.summary,
          price: p.price ?? 0,
          trust: p.trust,
          attestations: p.attestations,
        })),
      );
    },
  );

  // ACT + PAY + PROVE — pick the most-trusted node, re-verify its Manifest, gate
  // dangerous capabilities behind confirmation, pay if priced, verify the output
  // against the declared schema, and (optionally) attest the outcome.
  server.registerTool(
    "aleph_invoke",
    {
      title: "Aleph · act on the best node (ACT + PAY + PROVE)",
      description:
        "Resolve + rank by trust, invoke the most-trusted node with a bounded grant, PAY it if priced, verify the signed receipt AND the output against its declared schema, and return the result with proof. High-risk/irreversible capabilities require confirm:true. Set `rate` (0..1) to write a settlement-backed attestation after a successful paid call.",
      inputSchema: {
        capability: z.string().describe("semantic capability key"),
        input: z.record(z.string(), z.any()).describe("arguments, e.g. { place: 'Tokyo' }"),
        maxEur: z.number().optional().describe("spending limit (bounds the grant and the price you'll pay)"),
        confirm: z.boolean().optional().describe("required true to run a high-risk/irreversible capability"),
        rate: z.number().min(0).max(1).optional().describe("if set, attest this rating after a paid success"),
        registryUrl: z.string().optional(),
      },
    },
    async ({ capability, input, maxEur, confirm, rate, registryUrl }) => {
      const reg = registryUrl ?? registryDefault;
      const ranked = await resolveRanked(reg, capability, agent);
      const top = ranked[0];
      if (!top) return jsonContent({ error: `No Aleph node found for "${capability}".` }, true);

      const manifest = await fetchManifest(top.manifest, top.did); // re-verify sig + pin DID
      const endpoint = manifest.endpoint[0];
      if (!endpoint) return jsonContent({ error: `Node for "${capability}" has no endpoint.` }, true);
      const cap = manifest.capabilities.find((c) => c.key === capability);

      // agent-side safety: gate high-risk / irreversible capabilities
      if (cap && requiresConfirmation(cap) && !confirm) {
        return jsonContent(
          {
            needs_confirmation: true,
            capability,
            risk: cap.risk,
            reversibility: cap.reversibility,
            reason: "high-risk or irreversible — re-call with confirm:true to proceed",
          },
          true,
        );
      }

      // PAY: priced nodes require a settlement rail
      const price = cap?.cost ? Number(cap.cost.value) : 0;
      if (price > 0 && !rail) {
        return jsonContent(
          { error: `Node is priced (${price}); this MCP server has no settlement rail configured.` },
          true,
        );
      }
      if (maxEur !== undefined && price > maxEur) {
        return jsonContent({ error: `Price ${price} exceeds your maxEur ${maxEur}.` }, true);
      }

      const grant = createGrant(
        {
          issuer: agent.did,
          grantee: agent.did,
          scope: [{ capability, limit: maxEur !== undefined ? { max_eur: maxEur } : {} }],
          not_after: Date.now() + 300_000,
        },
        agent.privateKey,
      );
      const { result, outcome, receipt, settlement } = await invoke({
        nodeDid: manifest.identity,
        endpoint,
        capability,
        input: input as Record<string, unknown>,
        grant,
        agent,
        rail,
        payEur: price > 0 ? price : undefined,
      });

      // PROVE: the output is untrusted content — verify it against the schema
      const outputVerified = cap ? verifyOutput(cap, result) : { ok: true };

      // TRUST (write): a settlement-backed attestation, if the agent rated it
      let attested = false;
      if (rate !== undefined && outcome === "success" && settlement && manifest.reputation) {
        await attest({
          agent,
          subjectDid: manifest.identity,
          reputationUrl: manifest.reputation,
          settlement,
          rating: rate,
        });
        attested = true;
      }

      return jsonContent({
        outcome,
        result,
        output_verified: outputVerified.ok,
        output_reason: outputVerified.ok ? undefined : outputVerified.reason,
        trust: top.trust,
        paid: price,
        receipt_signed_by: receipt.from,
        invoke_ref: receipt.body.invoke_ref,
        attested,
      });
    },
  );

  return server;
}
