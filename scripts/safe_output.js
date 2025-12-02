import fs from "fs-extra";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";

export const INVALID_DATA_EXIT_CODE = 42;

/**
 * Validate the scraped product list before writing it to disk.
 * Products must be an array with at least one entry, and every entry must
 * contain the required fields (title/name, regular_price, liquidation_price, url).
 *
 * @param {any} products
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateProducts(products) {
  if (!Array.isArray(products) || products.length === 0) {
    return { valid: false, reason: "products array is empty or missing" };
  }

  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    if (!product || typeof product !== "object") {
      return { valid: false, reason: `product at index ${i} is not an object` };
    }

    const hasTitle = Boolean(product.title || product.name);
    const hasRegular = product.regular_price != null;
    const hasLiquidation = product.liquidation_price != null;
    const hasUrl = typeof product.url === "string" && product.url.trim().length > 0;

    if (!hasTitle || !hasRegular || !hasLiquidation || !hasUrl) {
      return {
        valid: false,
        reason: `product ${i + 1} missing required fields (title, regular_price, liquidation_price, url)`,
      };
    }
  }

  return { valid: true };
}

async function backupIfPresent(targetPath, backupName = "data.prev.json") {
  const dir = path.dirname(targetPath);
  const backupPath = path.join(dir, backupName.replace(/\.json$/, ``));
  const backupJson = backupPath.endsWith(".json") ? backupPath : `${backupPath}.json`;

  if (await fs.pathExists(targetPath)) {
    await fs.copy(targetPath, backupJson);
    return backupJson;
  }

  return null;
}

/**
 * Safely write JSON and CSV outputs without losing a previously good file.
 *
 * @param {object} params
 * @param {string} params.outBase
 * @param {any[]} params.products
 * @param {import("csv-writer").CsvWriterParams<any>["header"]} params.csvHeaders
 * @param {string} [params.jsonFilename]
 * @param {string} [params.csvFilename]
 * @returns {Promise<{ wrote: boolean, reason?: string, backup?: string }>}
 */
export async function safeWriteOutputs({
  outBase,
  products,
  csvHeaders,
  jsonFilename = "data.json",
  csvFilename = "data.csv",
}) {
  const validation = validateProducts(products);
  if (!validation.valid) {
    return { wrote: false, reason: validation.reason };
  }

  const jsonPath = path.join(outBase, jsonFilename);
  const csvPath = path.join(outBase, csvFilename);

  await fs.ensureDir(outBase);

  const backup = await backupIfPresent(jsonPath);
  await fs.writeJson(jsonPath, products, { spaces: 2 });

  if (csvHeaders && Array.isArray(csvHeaders) && csvHeaders.length > 0) {
    const csvWriter = createObjectCsvWriter({ path: csvPath, header: csvHeaders });
    await csvWriter.writeRecords(products);
  }

  return { wrote: true, backup };
}
