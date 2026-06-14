// Agentic composition (the §13.5 mechanism): an agent fulfils a multi-step
// task by pulling the best function from competing nodes and orchestrating
// them into one result — paying each node for its own function (granular,
// per-function merit) and linking the receipts into one verifiable chain.

import type { Identity } from "../core/identity.ts";
import type { Grant } from "../core/grant.ts";
import type { Envelope } from "../core/envelope.ts";
import type { SettlementRail } from "../settle/rail.ts";
import { invoke } from "./client.ts";
import { linkTo, verifyReceiptChain, type ChainCheck } from "../trust/chain.ts";

export type Step = {
  nodeDid: string;
  endpoint: string;
  capability: string;
  // Build this step's input from the running value produced so far.
  input: (carry: unknown) => Record<string, unknown>;
  // Extract the value to carry into the next step from this step's result.
  pick: (result: unknown) => unknown;
  grant?: Grant;
  payEur?: number;
};

export type Composition = {
  value: unknown;
  receipts: Envelope[];
  chain: ChainCheck;
};

// Run the steps in order, threading a carry value through and chaining each
// receipt to the previous one. The returned chain is independently auditable.
export async function compose(opts: {
  agent: Identity;
  rail?: SettlementRail;
  initial: unknown;
  steps: Step[];
}): Promise<Composition> {
  let carry = opts.initial;
  const receipts: Envelope[] = [];
  let prev: string[] | undefined;

  for (const step of opts.steps) {
    const { result, outcome, receipt } = await invoke({
      nodeDid: step.nodeDid,
      endpoint: step.endpoint,
      capability: step.capability,
      input: step.input(carry),
      grant: step.grant,
      agent: opts.agent,
      rail: opts.rail,
      payEur: step.payEur,
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
