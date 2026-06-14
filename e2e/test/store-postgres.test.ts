import { test } from "node:test";
import { PostgresStores } from "@aleph/store";
import { runStoreContract } from "./store-contract.ts";

const url = process.env.DATABASE_URL;

if (!url) {
  test("[postgres] skipped (set DATABASE_URL to run)", { skip: true }, () => {
    /* no Postgres available locally; CI provides one */
  });
} else {
  // Each contract run gets a fresh, migrated, truncated database.
  runStoreContract("postgres", async () => {
    const s = await PostgresStores.connect(url);
    await s.migrate();
    // clean slate between runs
    const sql = (s as unknown as { sql: (q: TemplateStringsArray) => Promise<unknown> }).sql;
    await sql`TRUNCATE nodes, node_capabilities, attestations, seen_nonces, settlements CASCADE`;
    return s;
  });
}
