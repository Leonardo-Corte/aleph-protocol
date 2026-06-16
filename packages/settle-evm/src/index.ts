// @aleph/settle-evm — the on-chain settlement rail (AlephEscrow via viem).
export {
  EvmSettlementRail,
  escrowIdFor,
  evmSettlementVerifier,
  type EvmSettlementRecord,
  type EvmRailConfig,
} from "./rail";
export { deployEscrow } from "./deploy";
export { alephEscrowAbi, alephEscrowBytecode } from "./abi";
export {
  evmPayerRail,
  evmPayeeRail,
  evmPayerRailFromEnv,
  evmAttestationVerifier,
  type EvmRailUnit,
} from "./payments-adapter";
