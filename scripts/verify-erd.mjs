import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function dockerSql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_ajumsocks",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { encoding: "utf8", input: `${sql.trim()}\n` },
  ).trim();
}

function loadLive() {
  const raw = dockerSql(`
SELECT json_build_object(
  'tables', (SELECT json_agg(relname ORDER BY relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
  'fk_count', (SELECT count(*)::int FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace),
  'enum_count', (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'),
  'fks', (
    SELECT json_agg(json_build_object('from_table', c.conrelid::regclass::text, 'def', pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text, c.conname)
    FROM pg_constraint c WHERE c.contype='f' AND c.connamespace='public'::regnamespace
  )
);
`);
  return JSON.parse(raw);
}

function inventoryTables(markdown) {
  return [...markdown.matchAll(/^## ([a-z][a-z0-9_]*)$/gm)].map((m) => m[1]);
}

function inventoryFkCount(markdown) {
  const sections = markdown.split(/^## /m).slice(1);
  let count = 0;
  for (const section of sections) {
    const fkBlock = section.split(/^Referenced By:/m)[0].split(/^Foreign Keys:/m)[1];
    if (!fkBlock) continue;
    count += fkBlock.split(/\r?\n/).filter((line) => /^\s*-\s+\S+.*→/.test(line)).length;
  }
  return count;
}

function erdEntities(markdown) {
  const publicTables = new Set();
  const external = new Set();
  const blocks = [...markdown.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const block of blocks) {
    for (const line of block.split(/\r?\n/)) {
      const quoted = line.match(/^\s*"([^"]+)"\s*\{/);
      const plain = line.match(/^\s*([a-z][a-z0-9_]*)\s*\{/);
      const name = quoted ? quoted[1] : plain ? plain[1] : null;
      if (!name) continue;
      if (name.includes(".")) external.add(name);
      else publicTables.add(name);
    }
  }
  return { publicTables: [...publicTables].sort(), external: [...external].sort() };
}

function expect(name, ok, extra = "") {
  if (!ok) throw new Error(`FAIL ${name}${extra ? `: ${extra}` : ""}`);
  console.log(`PASS ${name}`);
}

function diff(left, right) {
  const l = new Set(left);
  const r = new Set(right);
  return {
    missingInRight: [...l].filter((x) => !r.has(x)),
    extraInRight: [...r].filter((x) => !l.has(x)),
  };
}

function fkKey(fk) {
  return `${fk.from_table}|${fk.def}`;
}

function main() {
  const live = loadLive();
  const liveTables = live.tables;
  const inventoryMd = readFileSync("docs/SCHEMA_INVENTORY.md", "utf8");
  const erdMd = readFileSync("docs/ERD.md", "utf8");
  const snapshot = JSON.parse(readFileSync("scripts/schema-inventory.json", "utf8"));

  const invTables = inventoryTables(inventoryMd);
  const erd = erdEntities(erdMd);
  const invFk = inventoryFkCount(inventoryMd);

  expect("live public table count is 43", liveTables.length === 43, String(liveTables.length));
  expect("live public FK count is 101", live.fk_count === 101, String(live.fk_count));
  expect("live public enum count is 7", live.enum_count === 7, String(live.enum_count));
  expect("snapshot table count matches live", snapshot.public_table_count === liveTables.length);
  expect("snapshot fk count matches live", snapshot.public_fk_count === live.fk_count);
  expect("snapshot enum count matches live", snapshot.public_enum_count === live.enum_count);
  expect("snapshot.tables matches live tables", JSON.stringify(snapshot.tables) === JSON.stringify(liveTables));

  const liveFkKeys = live.fks.map(fkKey).sort();
  const snapFkKeys = snapshot.fks.map(fkKey).sort();
  const fkDefDiff = diff(liveFkKeys, snapFkKeys);
  expect(
    "snapshot.fks matches live FKs",
    fkDefDiff.missingInRight.length === 0 && fkDefDiff.extraInRight.length === 0,
    JSON.stringify(fkDefDiff),
  );

  const invVsLive = diff(liveTables, invTables);
  expect(
    "inventory tables == live public tables",
    invVsLive.missingInRight.length === 0 && invVsLive.extraInRight.length === 0,
    JSON.stringify(invVsLive),
  );

  const erdVsLive = diff(liveTables, erd.publicTables);
  expect(
    "ERD unique public tables == live public tables",
    erdVsLive.missingInRight.length === 0 && erdVsLive.extraInRight.length === 0,
    JSON.stringify(erdVsLive),
  );

  expect("inventory FK count == live FK count", invFk === live.fk_count, `inventory=${invFk} live=${live.fk_count}`);
  expect("auth.users is external, not a public table", erd.external.includes("auth.users") && !liveTables.includes("users"));
  expect("ERD has four domain headings", /ERD-A/.test(erdMd) && /ERD-B/.test(erdMd) && /ERD-C/.test(erdMd) && /ERD-D/.test(erdMd));
  expect(
    "current vs positions meanings differ",
    /event_inventory_current[\s\S]*confirmed physical/i.test(erdMd) && /inventory_positions[\s\S]*operational projected/i.test(erdMd),
  );
  expect("no supplier/PO/shipment tables in live schema", !liveTables.some((t) => /supplier|purchase_order|shipment/.test(t)));

  console.log(
    JSON.stringify(
      {
        public_tables: liveTables.length,
        inventory_tables: invTables.length,
        erd_public_tables: erd.publicTables.length,
        erd_external: erd.external,
        live_fks: live.fk_count,
        inventory_fks: invFk,
        enums: live.enum_count,
      },
      null,
      2,
    ),
  );
  console.log("verify:erd passed.");
}

main();
