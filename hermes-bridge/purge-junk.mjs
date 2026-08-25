// One-off: purge dependency/build junk rows that polluted the vault mirror.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const DB_URL =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
if (!DB_URL) { console.error("no DB url"); process.exit(1); }

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false },
});
await client.connect();

const before = await client.query(`SELECT folder, count(*) FROM "VaultNode" GROUP BY folder ORDER BY 2 DESC`);
console.log("before:", before.rows);

const del = await client.query(
  `DELETE FROM "VaultNode" WHERE path LIKE $1 OR path LIKE $2 OR path LIKE $3 OR path LIKE $4 RETURNING id`,
  ["%node_modules%", "%/.next/%", "%/dist/%", "%/.venv/%"]
);
console.log(`deleted ${del.rowCount} junk rows`);

const after = await client.query(`SELECT folder, count(*) FROM "VaultNode" GROUP BY folder ORDER BY 2 DESC`);
console.log("after:", after.rows);
await client.end();
