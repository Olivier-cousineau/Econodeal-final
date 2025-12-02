// node scripts/ct_make_matrix.js --file data/canadian-tire/stores_raw.txt --shard 0 --shards 7
// Emits a JSON array that run_canadiantire_matrix.js can consume directly (id/city fields).
import fs from "fs";
import minimist from "minimist";

const args = minimist(process.argv.slice(2));
const FILE   = args.file;
const SHARDS = Number(args.shards || 7);
const SHARD  = Number(args.shard  || 0);

if (!FILE || isNaN(SHARD) || isNaN(SHARDS)) {
  console.error("Usage: ct_make_matrix.js --file <path> --shard <0..N-1> --shards <N>");
  process.exit(1);
}

const raw = fs.readFileSync(FILE, "utf8").trim().split(/\r?\n/);
const rows = raw.slice(1).map(line => {
  const [id, name, address] = line.split(/\t+/);
  return { id: String(id).trim(), city: String(name).trim(), address: String(address||"").trim() };
}).filter(r => r.id && r.city);

const shardRows = rows.filter((_, idx) => idx % SHARDS === SHARD);
const matrix = shardRows.map((row) => ({
  id: row.id,
  store: row.id,
  name: row.city,
  city: row.city,
}));

process.stdout.write(JSON.stringify(matrix));
