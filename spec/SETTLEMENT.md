# On-chain settlement (the PAY verb)

> Status: testnet design. The escrow contract and the EVM rail are implemented
> and tested (Foundry + a real-EVM anvil integration). Deployment to a public
> testnet (Base Sepolia) is the owner's manual step (see below). Mainnet is
> gated by an external audit (ROADMAP §7).

## What it is

`AlephEscrow` is a per-invocation escrow over an ERC-20 stablecoin. It is what
makes the PAY verb **trustless** and what makes settlement-backed reputation
**un-forgeable**: an `ATTEST` counts only if it references a real `SETTLE`, and
on-chain a `SETTLE` is a transaction anyone can re-read.

```
payer.lock(id, payee, amount, invokeRef, deadline)   // funds held by the contract
  ├─ payer.release(id)   -> pays the payee        (delivery acknowledged)
  └─ refund(id)          -> returns to the payer   (after deadline, or by the payee)
```

- **Reentrancy-guarded**, checks-effects-interactions, `SafeERC20`.
- **Immutable** (no proxy/upgradeability) to keep the audited surface minimal.
- A `SettlementRecord` carries the on-chain `txHash`; `EvmSettlementRail.verify()`
  re-reads the chain and confirms parties/amount/status match — no trusted signer.

## Through the agent path (one seam, two rails)

Settlement is an **injectable interface** (`@aleph/core`: `PayerRail` / `PayeeRail`
/ `EscrowRef`), so the SAME `client.invoke` and `compose` move value over the
in-memory reference rail (dev/tests) and the on-chain EVM rail (real value) with
**no change to agent or node code**. The flow is exactly the contract's
**payer-release**:

```
agent.lockEscrow()            // the agent (payer) locks — on-chain, its own tx
  → INVOKE                    // the node only VERIFIES the lock (it cannot move funds)
  → node returns RECEIPT      // signed delivery
  → agent verifies the receipt
  → agent.releaseEscrow()     // pay on VERIFIED delivery  (or refundEscrow on failure)
```

- **`@aleph/settle-evm`** provides `evmPayerRail` (approve + lock, release/refund
  with the agent key) and `evmPayeeRail` (the node reads the chain to verify the
  lock). `evmPayerRailFromEnv` builds the payer rail from `ALEPH_EVM_RPC /
  ESCROW / TOKEN / KEY / CHAIN_ID / DECIMALS`.
- **The MCP server** (`aleph-mcp`) auto-enables the EVM rail when those env vars
  are set, so a deployed agent pays priced nodes with real value; absent them it
  serves free nodes only.
- A node advertises its **on-chain payout address** in its signed Manifest
  (`ext.payTo`); the agent locks escrow to it. Binding that address to the node's
  DID is **did:pkh** territory (deferred); until then the Manifest asserts it and
  the node's `verifyLock` checks the on-chain payee matches its own address.
- **Protocol unit → token base units** is explicit via `decimals` (the fiat/token
  boundary). A reference-rail settlement is signed and attestable today; an
  on-chain-record-backed *attestation* uses the chain-verification path
  (`computeTrustAsync` + `evmSettlementVerifier`) — wired for verification, with
  node-side persistence of EVM-record-backed attestations a further step.

Proven end to end on anvil: `e2e/test/settle-evm-agent.test.ts` — an agent pays a
TypeScript node real ERC-20 through `invoke` and through a 2-step `compose`; the
tokens actually move and the receipt chain verifies.

## The honestly-open boundaries

These are declared, not hidden (they mirror the paper's premortem, §8 / §17):

1. **The fiat / oracle boundary.** The chain proves everything that happens
   *inside* it (a lock, a release, a refund). It cannot prove that the off-chain
   *world* delivered (did the node return a correct answer?) or that fiat entering
   the system is real. For now "delivery" = the node returns a signed `RECEIPT`,
   and the **deadline-refund** protects a payer from a node that stalls or
   vanishes. The on-ramp (acquiring the stablecoin) is the trusted edge: a faucet
   on testnet; a regulated on-ramp on mainnet (a legal question, ROADMAP §13).

2. **No full dispute mechanism yet.** Today a node that delivers garbage keeps
   the payment but loses reputation (the consumer attests a low rating), and the
   deadline-refund covers non-delivery. A richer mechanism — challenge windows,
   staked arbiters — is a planned AIP, **not** a launch blocker, but it is a known
   limit: release is the payer's call, so a dishonest payer could withhold release
   from an honest node. Reputation (the payer is also attested) and the
   small-per-call amounts bound the damage; staking hardens it later.

3. **Release authorization is the payer's.** The simplest safe model: the payer
   releases on satisfaction; the deadline auto-protects the payer. A payee-claim
   path (release against a payer-signed delivery acknowledgement) is a future
   refinement.

## Gas (measured, local)

From `forge test --gas-report` (illustrative; real L2 costs depend on the chain):

| Operation | ~Gas (median) |
|---|---|
| `lock` | ~175,000 (includes the ERC-20 transferFrom) |
| `release` | ~66,000 |
| `refund` | ~49,000 |
| deploy | ~628,000 |

Per-call on-chain settlement on a cheap L2 (Base) is acceptable for launch. For
high-frequency micro-payments, **payment channels / batching** (settle many
invocations in one tx) are a documented fast-follow.

## Deploying to Base Sepolia (the owner's manual step)

Requires a funded testnet key and an RPC URL. Not run from CI (no funded key).

```bash
cd contracts
forge install                       # OpenZeppelin v5.1.0
# 1. choose/point at a testnet USDC (or deploy a mock ERC-20)
# 2. deploy the escrow
forge create src/AlephEscrow.sol:AlephEscrow \
  --rpc-url "$BASE_SEPOLIA_RPC" \
  --private-key "$DEPLOYER_KEY" \
  --constructor-args "$USDC_ADDRESS" \
  --broadcast
# 3. record the deployed address in DECISIONS.md and wire it into the EVM rail config
```

After deploy, the `EvmSettlementRail` is configured with `{ chain, rpcUrl,
escrowAddress, tokenAddress, privateKey }` and used exactly as in the anvil
integration test (`e2e/test/settle-evm.test.ts`).

## Verification & audit

- Foundry tests cover lock/release/refund, every revert, a real reentrancy
  attack, double-release/refund, and a fuzz test (100% lines, 100% funcs on the
  contract). Run: `cd contracts && forge test`.
- **Before mainnet:** an external Solidity audit of `AlephEscrow.sol` is a hard
  gate (ROADMAP §7.5), plus a bug-bounty program.
