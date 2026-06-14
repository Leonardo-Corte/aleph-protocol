import { InMemoryStores } from "@aleph/store";
import { runStoreContract } from "./store-contract.ts";

runStoreContract("memory", async () => {
  const s = new InMemoryStores();
  await s.migrate();
  return s;
});
