// @aleph/store — persistence behind async repository interfaces.
// Protocol code depends on the interfaces; deployments choose a driver.

export type {
  Pointer,
  RegistryStore,
  NonceStore,
  ReputationStore,
  SettlementStore,
  Stores,
  AttestationPage,
  ReputationSummary,
} from "./interfaces";
export { REPUTATION_PAGE_SIZE } from "./interfaces";

export {
  InMemoryStores,
  InMemoryRegistryStore,
  InMemoryNonceStore,
  InMemoryReputationStore,
  InMemorySettlementStore,
} from "./memory";

export { SqliteStores } from "./sqlite";
export { PostgresStores } from "./postgres";
