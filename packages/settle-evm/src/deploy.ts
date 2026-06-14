// Deploy helpers for AlephEscrow (and a test ERC-20). Used by the anvil
// integration test and adaptable to the Base Sepolia deploy procedure.

import { createWalletClient, createPublicClient, http, type Address, type Hex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { alephEscrowAbi, alephEscrowBytecode } from "./abi";

export async function deployEscrow(opts: {
  chain: Chain;
  rpcUrl: string;
  privateKey: Hex;
  token: Address;
}): Promise<Address> {
  const account = privateKeyToAccount(opts.privateKey);
  const wallet = createWalletClient({ account, chain: opts.chain, transport: http(opts.rpcUrl) });
  const pub = createPublicClient({ chain: opts.chain, transport: http(opts.rpcUrl) });
  const hash = await wallet.deployContract({
    abi: alephEscrowAbi,
    bytecode: alephEscrowBytecode,
    args: [opts.token],
    account,
    chain: opts.chain,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("escrow deploy produced no address");
  return receipt.contractAddress;
}
