// Agentic composition (the §13.5 mechanism): an agent fulfils a multi-step
// task by pulling the best function from competing nodes and orchestrating
// them into one result — paying each node for its own function (granular,
// per-function merit) and linking the receipts into one verifiable chain.

import type { Identity } from "@aleph/core";
import type { Grant } from "@aleph/core";
import type { Envelope } from "@aleph/core";
import type { PayerRail } from "@aleph/core";
import { linkTo, verifyReceiptChain, type ChainCheck } from "@aleph/core";
import { invoke } from "./client";

export interface Step {
  nodeDid: string;
  endpoint: string;
  capability: string;
  // Build this step's input from the running value produced so far.
  input: (carry: unknown) => Record<string, unknown>;
  // Extract the value to carry into the next step from this step's result.
  pick: (result: unknown) => unknown;
  grant?: Grant;
  payEur?: number;
  payeeAddress?: string; // on-chain payout address (EVM rail), from the node's Manifest
}

export interface Composition {
  value: unknown;
  receipts: Envelope[];
  chain: ChainCheck;
}

// Run the steps in order, threading a carry value through and chaining each
// receipt to the previous one. The returned chain is independently auditable.
// Generic over the rail's settlement-record type, so it composes paid steps over
// the in-memory rail OR the on-chain EVM rail unchanged.
export async function compose<S = unknown>(opts: {
  agent: Identity;
  rail?: PayerRail<S>;
  initial: unknown;
  steps: Step[];
}): Promise<Composition> {
  let carry = opts.initial;
  const receipts: Envelope[] = [];
  let prev: string[] | undefined;

  for (const step of opts.steps) {
    const { result, outcome, receipt } = await invoke<S>({
      nodeDid: step.nodeDid,
      endpoint: step.endpoint,
      capability: step.capability,
      input: step.input(carry),
      grant: step.grant,
      agent: opts.agent,
      rail: opts.rail,
      payEur: step.payEur,
      payeeAddress: step.payeeAddress,
      prev,
    });
    if (outcome !== "success") {
      throw new Error(`composition step "${step.capability}" failed: ${JSON.stringify(result)}`);
    }
    receipts.push(receipt);
    carry = step.pick(result);
    prev = [linkTo(receipt)]; // chain the next step to this receipt
  }

  return { value: carry, receipts, chain: verifyReceiptChain(receipts) };
}
