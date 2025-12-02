#!/usr/bin/env node
// @ts-check
/**
 * Run the Canadian Tire scraper for every store listed in a matrix file
 * and commit the resulting JSON for each city as soon as it is generated.
 *
 * Usage:
 *   node scripts/run_canadiantire_matrix.js [--file data/canadian-tire/branches.json]
 *                                           [--stores 271,649]
 *                                           [--limit 5]
 *                                           [--maxPages 80]
 *                                           [--dry-run]
 *                                           [--publish] [--skip-publish]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import minimist from "minimist";
import slugify from "slugify";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

const args = minimist(process.argv.slice(2), {
  string: ["file", "stores", "maxPages"],
  boolean: ["dry-run", "dryRun", "continue", "publish"],
  alias: { dryRun: "dry-run" },
});

function availableParallelism() {
  if (typeof os.availableParallelism === "function") {
    return os.availableParallelism();
  }
  const cpus = os.cpus?.();
  return Array.isArray(cpus) && cpus.length ? cpus.length : 1;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: options.stdio ?? "inherit",
      env: { ...process.env, ...options.env },
    });

    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });

    child.on("error", (error) => {
      console.error(`❌ Failed to start ${command}:`, error);
      resolve({ code: 1, error });
    });
  });
}

function parseBooleanArg(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
  }
  return defaultValue;
}

function parseNumeric(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const storesFile = args.file || path.join("data", "canadian-tire", "branches.json");
if (!fs.existsSync(storesFile)) {
  console.error(`❌ Stores file not found: ${storesFile}`);
  process.exit(1);
}

/**
 * @typedef {{ id: string, name?: string, city?: string }} Store
 */
const raw = JSON.parse(fs.readFileSync(storesFile, "utf8"));
let stores = Array.isArray(raw) ? raw : raw?.stores || [];
const storeIndexMap = new WeakMap();
stores.forEach((store, index) => {
  storeIndexMap.set(store, index);
});

if (!Array.isArray(stores) || stores.length === 0) {
  console.error(`❌ No stores found inside ${storesFile}`);
  process.exit(1);
}

const filterIds = (args.stores || "")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);
if (filterIds.length) {
  const wanted = new Set(filterIds);
  stores = stores.filter((store) => wanted.has(String(store.id)));
  if (!stores.length) {
    console.error(`❌ None of the requested stores (${filterIds.join(", ")}) were found.`);
    process.exit(1);
  }
}

const limit = Number(args.limit ?? args.count ?? args.n ?? 0);
if (Number.isFinite(limit) && limit > 0) {
  stores = stores.slice(0, limit);
}

const shardIndexInput = parseNumeric(
  args.shard ?? args.shardIndex ?? args["shard-index"]
);
const shardTotalInput = parseNumeric(
  args.shards ?? args.shardTotal ?? args["shard-total"]
);
if (shardIndexInput !== null) {
  const shardTotal = Math.max(1, Math.floor(shardTotalInput ?? 7));
  const shardIndex = Math.floor(shardIndexInput);
  if (!Number.isFinite(shardIndex) || shardIndex < 1 || shardIndex > shardTotal) {
    console.error(
      `❌ Invalid shard index ${shardIndexInput}. Expected a value between 1 and ${shardTotal}.`
    );
    process.exit(1);
  }

  const filteredStores = stores.filter((store) => {
    const originalIndex = storeIndexMap.get(store);
    return typeof originalIndex === "number"
      ? originalIndex % shardTotal === shardIndex - 1
      : false;
  });

  console.log(`Running shard ${shardIndex}/${shardTotal} with ${filteredStores.length} stores`);

  if (!filteredStores.length) {
    console.error("❌ No stores left after applying shard filter.");
    process.exit(1);
  }

  stores = filteredStores;
}

const dryRun = parseBooleanArg(args["dry-run"] ?? args.dryRun, false);
const continueOnError = parseBooleanArg(args.continue ?? args["continue-on-error"], false);

const skipPublishArg = args["skip-publish"] ?? args.skipPublish ?? args["no-publish"];
let shouldPublish = true;
if (args.publish !== undefined) {
  shouldPublish = parseBooleanArg(args.publish, true);
} else if (skipPublishArg !== undefined) {
  shouldPublish = !parseBooleanArg(skipPublishArg, false);
}

const extraScraperArgs = [];
if (args.maxPages) {
  extraScraperArgs.push("--maxPages", String(args.maxPages));
}
if (parseBooleanArg(args.headful, false)) {
  extraScraperArgs.push("--headful");
}
const passthrough = [
  { key: "include-regular-price", flag: "--include-regular-price" },
  { key: "includeRegularPrice", flag: "--includeRegularPrice" },
  { key: "include-liquidation-price", flag: "--include-liquidation-price" },
  { key: "includeLiquidationPrice", flag: "--includeLiquidationPrice" },
];
for (const { key, flag } of passthrough) {
  if (key in args) {
    extraScraperArgs.push(flag, String(args[key]));
  }
}

const scraperEntry = path.join(repoRoot, "scraper_ct.js");
const publishScript = path.join(repoRoot, "scripts", "publish_canadiantire_outputs.js");
const statusMap = new Map();
const publishedSlugs = [];
let gitQueue = Promise.resolve();

function runWithGitLock(task) {
  const next = gitQueue.then(() => task());
  gitQueue = next.catch(() => {});
  return next;
}

function storeLabel(store) {
  return store.city || store.name || "(inconnu)";
}

function getStatusKey(store, index) {
  return store.id ? String(store.id) : `idx-${index}`;
}

function setStatus(store, index, status, details = "") {
  const entry = {
    id: store.id ? String(store.id) : "?",
    city: storeLabel(store),
    status,
    details,
  };
  statusMap.set(getStatusKey(store, index), entry);
  return entry;
}

function getStatuses() {
  return stores.map((store, index) =>
    statusMap.get(getStatusKey(store, index)) ?? {
      id: store.id ? String(store.id) : "?",
      city: storeLabel(store),
      status: "pending",
      details: "",
    }
  );
}

async function summarizeStatuses(runResult) {
  const entries = getStatuses();
  const lines = [
    "## Canadian Tire shard summary",
    "",
    `Total stores: ${entries.length}`,
    "",
    "| # | Store ID | Ville | Statut | Détails |",
    "| - | - | - | - | - |",
  ];

  entries.forEach((entry, idx) => {
    lines.push(
      `| ${idx + 1} | ${entry.id} | ${entry.city || "(inconnu)"} | ${entry.status} | ${
        entry.details || ""
      } |`
    );
  });

  const summary = lines.join("\n");
  console.log(`\n${summary}\n`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, `${summary}\n`);
  }

  if (runResult) {
    const statusFile = path.join(repoRoot, "outputs", "canadiantire", "shard-status.json");
    try {
      fs.mkdirSync(path.dirname(statusFile), { recursive: true });
      const payload = {
        generatedAt: new Date().toISOString(),
        stores: entries,
        failedTwice: runResult.failedTwiceStores?.map((store) => ({
          id: store.id ?? "?",
          city: storeLabel(store),
        })),
        retriedAndSucceeded: runResult.retrySucceededStores?.map((store) => ({
          id: store.id ?? "?",
          city: storeLabel(store),
        })),
      };
      fs.writeFileSync(statusFile, JSON.stringify(payload, null, 2));
      console.log(`📝 Shard status written to ${statusFile}`);
    } catch (error) {
      console.error("⚠️ Failed to write shard status file:", error);
    }
  }
}

const maxConcurrentArg = parseNumeric(
  args["max-concurrent"] ??
    args.maxConcurrent ??
    args.parallel ??
    args.concurrency ??
    process.env.CT_MAX_CONCURRENT
);
const defaultParallelism = availableParallelism();
const maxConcurrent = Math.max(
  1,
  Math.min(stores.length, maxConcurrentArg ?? defaultParallelism)
);

/**
 * @param {Store} store
 * @param {number} index
 * @param {{ allowFailFast?: boolean; attempt?: number }} [options]
 */
async function processStore(store, index, options = {}) {
  const { allowFailFast = true, attempt = 1 } = options;
  const cityLabel = storeLabel(store);
  if (!store.id || !cityLabel) {
    console.warn(`⚠️ Skipping invalid store entry: ${JSON.stringify(store)}`);
    setStatus(store, index, "skipped", "missing id or city");
    return { success: true };
  }

  console.log("\n==============================");
  console.log(`🏬 Scraping store ${store.id} – ${cityLabel}`);

  const scraperArgs = [
    scraperEntry,
    "--store",
    String(store.id),
    "--city",
    cityLabel,
    ...extraScraperArgs,
  ];

  if (dryRun) {
    console.log(`(dry-run) node ${scraperArgs.join(" ")}`);
    setStatus(store, index, "skipped", "dry-run");
    return { success: true };
  }

  const scrape = await runCommand("node", scraperArgs);
  if (scrape.code !== 0) {
    const message = `scraper exited with code ${scrape.code} (attempt ${attempt})`;
    console.error(`❌ Scraper failed for store ${store.id}: ${message}`);
    setStatus(store, index, attempt > 1 ? "failed_twice" : "failed", message);
    if (allowFailFast && !continueOnError) {
      throw new Error(message);
    }
    return { success: false };
  }

  const slug = slugify(cityLabel, { lower: true, strict: true }) || "default";
  const storePath = path.join("outputs", "canadiantire", `${store.id}-${slug}`);
  const jsonPath = path.join(storePath, "data.json");

  if (!fs.existsSync(jsonPath)) {
    const message = `data.json not found at ${jsonPath}`;
    console.warn(`⚠️ ${message}`);
    setStatus(store, index, "skipped", message);
    return { success: false };
  }

  let rows = "?";
  try {
    const content = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    rows = Array.isArray(content) ? String(content.length) : rows;
  } catch {
    rows = "?";
  }

  const gitOutcome = await runWithGitLock(async () => {
    console.log(`💾 Committing ${jsonPath}`);
    const gitAdd = await runCommand("git", ["add", jsonPath]);
    if (gitAdd.code !== 0) {
      return { stage: "add", code: gitAdd.code };
    }
    const commitMsg = `Canadian Tire: ${cityLabel} (${store.id}) – ${rows} produits`;
    const gitCommit = await runCommand("git", ["commit", "-m", commitMsg]);
    return { stage: "commit", code: gitCommit.code };
  });

  if (gitOutcome.stage === "add" && gitOutcome.code !== 0) {
    const message = `git add failed for ${jsonPath}`;
    console.error(`❌ ${message}`);
    setStatus(store, index, "failed", message);
    if (allowFailFast && !continueOnError) {
      throw new Error(message);
    }
    return { success: false };
  }

  if (gitOutcome.stage === "commit" && gitOutcome.code !== 0 && gitOutcome.code !== 1) {
    const message = `git commit failed for ${cityLabel}`;
    console.error(`❌ ${message}`);
    setStatus(store, index, "failed", message);
    if (allowFailFast && !continueOnError) {
      throw new Error(message);
    }
    return { success: false };
  }

  if (gitOutcome.stage === "commit" && gitOutcome.code === 1) {
    console.warn(`⚠️ git commit skipped for ${cityLabel} (store ${store.id})`);
    setStatus(store, index, "skipped", "nothing to commit");
    return { success: true };
  }

  const details = attempt > 1 ? `${rows} produits (after retry)` : `${rows} produits`;
  setStatus(store, index, "committed", details);
  publishedSlugs.push(slug || "default");
  return { success: true };
}

async function runAllStores() {
  console.log(`📦 Stores file: ${storesFile}`);
  console.log(`🧮 ${stores.length} store(s) to scrape`);
  if (dryRun)
    console.log("⚠️ Dry run mode: scrapes will be skipped, commits will not be created");
  if (!shouldPublish)
    console.log("ℹ️ Publication to data/canadian-tire disabled (--skip-publish)");
  console.log("\n📋 Stores in this shard:");
  stores.forEach((store, idx) => {
    console.log(`  ${idx + 1}. ${store.id ?? "?"} – ${storeLabel(store)}`);
  });
  console.log(`\n🚀 Running up to ${maxConcurrent} scraper(s) in parallel`);

  let cursor = 0;
  /** @type {{ store: Store; index: number }[]} */
  const failedStores = [];

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= stores.length) break;
      const store = stores[index];
      try {
        const result = await processStore(store, index, { allowFailFast: false, attempt: 1 });
        if (!result.success) {
          failedStores.push({ store, index });
        }
      } catch (error) {
        throw error;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, maxConcurrent) }, () => worker());
  try {
    await Promise.all(workers);
  } catch (error) {
    throw error;
  }

  /** @type {Store[]} */
  const retrySucceededStores = [];
  /** @type {Store[]} */
  const failedTwiceStores = [];

  if (failedStores.length > 0) {
    console.log("\n🔁 Starting retry pass for failed stores...");
    for (const { store, index } of failedStores) {
      console.log(`\n➡️ Retry attempt for store ${store.id} – ${storeLabel(store)}`);
      const retryResult = await processStore(store, index, { allowFailFast: false, attempt: 2 });
      if (retryResult.success) {
        retrySucceededStores.push(store);
      } else {
        failedTwiceStores.push(store);
        const warningLabel = `${store.id ?? "?"} (${storeLabel(store)})`;
        console.warn(
          `⚠️ Store ${warningLabel} failed twice – marking as permanently failed but allowing shard to succeed.`
        );
        setStatus(store, index, "failed_twice", "failed twice – accepted");
      }
    }
  }

  const succeededFirstPass = stores.length - failedStores.length;
  console.log("\n📊 Canadian Tire shard results:");
  console.log(`  ✅ Succeeded on first pass: ${succeededFirstPass}`);
  console.log(`  🔁 Failed once then succeeded on retry: ${retrySucceededStores.length}`);
  console.log(`  ⚠️ Failed twice (accepted): ${failedTwiceStores.length}`);

  return { failedStores, retrySucceededStores, failedTwiceStores };
}

async function publishDatasets() {
  if (!shouldPublish || dryRun || !publishedSlugs.length) {
    return;
  }

  console.log("\n📤 Publishing normalized Canadian Tire feeds...");
  const publish = await runCommand("node", [publishScript]);
  if (publish.code !== 0) {
    console.error("❌ Failed to publish Canadian Tire datasets");
    if (!continueOnError) {
      throw new Error("publish failed");
    }
    return;
  }

  const uniqueSlugs = Array.from(new Set(publishedSlugs));
  const candidates = new Set(
    uniqueSlugs.map((slug) => path.join("data", "canadian-tire", `${slug}.json`))
  );
  candidates.add(path.join("data", "canadian-tire", "stores_with_data.json"));

  const existingFiles = Array.from(candidates).filter((relativePath) =>
    fs.existsSync(path.join(repoRoot, relativePath))
  );

  if (!existingFiles.length) {
    return;
  }

  const gitAdd = await runCommand("git", ["add", ...existingFiles]);
  if (gitAdd.code !== 0) {
    console.error("❌ git add failed while staging published datasets");
    if (!continueOnError) {
      throw new Error("git add failed for published datasets");
    }
    return;
  }

  const publishMsg =
    uniqueSlugs.length === 1
      ? `Canadian Tire: publish dataset for ${uniqueSlugs[0]}`
      : `Canadian Tire: publish datasets for ${uniqueSlugs.length} stores`;
  const gitCommit = await runCommand("git", ["commit", "-m", publishMsg]);
  if (gitCommit.code !== 0 && gitCommit.code !== 1) {
    console.error("❌ git commit failed for published datasets");
    if (!continueOnError) {
      throw new Error("git commit failed for published datasets");
    }
  }
}

async function main() {
  let runResult = null;
  try {
    runResult = await runAllStores();
    await publishDatasets();
    console.log("\n✅ Done");
  } finally {
    try {
      await summarizeStatuses(runResult);
    } catch (error) {
      console.error("⚠️ Failed to write summary:", error);
    }
  }
}

await main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
