#!/usr/bin/env node
// @ts-check
/**
 * Scraper Canadian Tire - Liquidation (Playwright + enrichissement fiche produit)
 */
import { chromium } from "playwright";
import fs from "fs-extra";
import path from "path";
import axios from "axios";
import pLimit from "p-limit";
import sanitize from "sanitize-filename";
import { createObjectCsvWriter } from "csv-writer";
import minimist from "minimist";
import { fileURLToPath } from "url";

const args = minimist(process.argv.slice(2));
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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------- CLI -------------
const START_URL =
  args.url ||
  "https://www.canadiantire.ca/fr/promotions/liquidation.html?store=271";
const MAX_PAGES = Number(args.maxPages || 125);
const HEADLESS = !args.headful;
const INCLUDE_REGULAR_PRICE = parseBooleanArg(
  args["include-regular-price"] ?? args.includeRegularPrice,
  true
);
const INCLUDE_LIQUIDATION_PRICE = parseBooleanArg(
  args["include-liquidation-price"] ?? args.includeLiquidationPrice,
  true
);

// ------------- CONFIG -------------
const OUT_DIR = "./images";
const OUT_JSON = "./data.json";
const OUT_CSV = "./data.csv";
const CONCURRENCY = 5;

const SELECTORS = {
  product: [
    "li[data-testid='product-grids'] article",
    "li[data-testid='product-grids']",
    "article[data-testid='product-tile']",
    "li[data-testid^='product-grid']",
    ".product-grid__item article",
  ].join(", "),
  title: [
    "[data-testid='product-title']",
    ".product-name",
    ".pdp-link",
    "h3, h2",
  ].join(", "),
  priceSale: [
    "[data-testid='sale-price']",
    "[data-testid='product-price']",
    ".price__value, .sale-price__value, .product-price",
    ".price, .c-pricing__sale, .c-pricing__current",
    ".sale-price, .product__sale-price, .price-current",
  ].join(", "),
  priceRegular: [
    "[data-testid='reg-price']",
    "[data-testid='regular-price']",
    "[data-testid='list-price']",
    "[data-testid='was-price']",
    ".price__was, .was-price__value, .product-was-price",
    ".c-pricing__was, .price--was, .price__value--was",
    ".regular-price, .product__was-price, .price-old",
  ].join(", "),
  badge: [
    ".badge--clearance",
    ".badge--liquidation",
    ".tag--clearance",
    "[data-testid='badge-clearance']",
  ].join(", "),
  image: [
    "img[data-testid='product-image']",
    ".product-image img",
    "img",
  ].join(", "),
  link: "a[href]",
};

const PAGINATION = {
  waitForList: "ul[data-testid='product-grids'], .product-grid",
  nextSelectors: [
    "nav[aria-label='Pagination'] a[aria-label='Next']:not(.pagination_chevron--disabled)",
    "nav[aria-label='Pagination'] button[aria-label='Next']:not([disabled])",
    "a[data-testid='chevron->']:not(.pagination_chevron--disabled)",
    "button:has-text('>'):not([disabled])",
    "a.pagination_chevron:not(.pagination_chevron--disabled)",
  ],
  loadMoreBtn: [
    "button[data-testid='load-more']",
    "button:has-text('Charger plus')",
    "button:has-text('Load more')",
  ].join(", "),
};

function nextBtn(page) {
  return page.locator(PAGINATION.nextSelectors.join(", ")).first();
}

// ------------- UTILS -------------

function extractPrice(text) {
  if (!text) return null;
  const m = text.replace(/\s/g, "").match(/([0-9]+(?:[.,][0-9]{2})?)/);
  if (!m) return null;
  const norm = m[1].replace(",", ".");
  const num = Number(norm);
  return Number.isFinite(num) ? num : null;
}

async function downloadImage(url, idx, title) {
  if (!url) return null;
  await fs.ensureDir(OUT_DIR);
  let ext = ".jpg";
  try {
    const u = new URL(url);
    const guess = path.extname(u.pathname).split("?")[0];
    if (guess) ext = guess;
  } catch (_) {}
  const name =
    sanitize(`${String(idx).padStart(4, "0")}-${(title || "product").slice(0, 40)}`) +
    ext;
  const outPath = path.join(OUT_DIR, name);
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  await fs.writeFile(outPath, res.data);
  return outPath;
}

async function scrapeListOnce(page) {
  const items = await page.$$eval(SELECTORS.product, (cards, SELECTORS) => {
    const pickText = (el, sel) => {
      const n = el.querySelector(sel);
      return n ? n.textContent.trim() : "";
    };
    const pickImg = (el, sel) => {
      const n = el.querySelector(sel);
      if (!n) return null;
      for (const a of ["src", "data-src", "data-original", "data-image", "srcset"]) {
        const v = n.getAttribute(a);
        if (v) {
          if (a === "srcset" && v.includes(",")) 
            return new URL(v.split(",")[0].trim().split(" ")[0], location.href).toString();
          return new URL(v, location.href).toString();
        }
      }
      return null;
    };
    const pickHref = (el, sel) => {
      const a = el.querySelector(sel);
      return a ? new URL(a.getAttribute("href"), location.href).toString() : null;
    };

    return cards.map((el) => {
      const title = pickText(el, SELECTORS.title);
      const hasBadge = !!el.querySelector(SELECTORS.badge);
      const text = el.textContent || "";
      const liquidation =
        hasBadge ||
        /liquidation|clearance|soldes?/i.test(title) ||
        /liquidation|clearance|soldes?/i.test(text.slice(0, 400));
      const image = pickImg(el, SELECTORS.image);
      const url = pickHref(el, SELECTORS.link);

      const priceText = pickText(el, ".price");
      const salePriceText = pickText(el, ".sale-price");
      let priceSaleRaw = salePriceText || pickText(el, SELECTORS.priceSale);
      let priceRegularRaw = pickText(el, SELECTORS.priceRegular);

      if (!priceSaleRaw && priceText && salePriceText) priceSaleRaw = salePriceText;
      if (!priceRegularRaw && priceText && !salePriceText) priceRegularRaw = priceText;

      const skuAttr = el.getAttribute("data-sku");
      const skuText = (skuAttr && skuAttr.trim()) || pickText(el, ".sku");
      const quantityText = pickText(el, ".stock");

      return {
        title,
        price_sale_raw: priceSaleRaw || null,
        price_regular_raw: priceRegularRaw || null,
        price_text_raw: priceText || null,
        liquidation,
        image,
        url,
        sku: skuText || null,
        quantity: quantityText || null,
      };
    });
  }, SELECTORS);

  return items
    .map((item) => {
      const liquidationPrice = extractPrice(item.price_sale_raw || item.price_text_raw);
      const regularPrice = extractPrice(item.price_regular_raw);
      const quantity = item.quantity || null;
      const sku = item.sku || null;
      const priceRaw =
        item.price_text_raw || item.price_sale_raw || item.price_regular_raw || null;
      const price = liquidationPrice ?? regularPrice;
      const isLiquidation =
        item.liquidation ||
        (liquidationPrice != null &&
          (regularPrice == null || liquidationPrice <= regularPrice));

      return {
        title: item.title,
        price,
        price_raw: priceRaw,
        liquidation: isLiquidation,
        image: item.image,
        url: item.url,
        sale_price: liquidationPrice,
        sale_price_raw: item.price_sale_raw,
        regular_price: regularPrice,
        regular_price_raw: item.price_regular_raw,
        sku,
        quantity,
      };
    })
    .filter((p) => p.title || p.price != null || p.image);
}

async function enrichWithDetails(context, item) {
  if (!item.url) return item;
  let sku = item.sku;
  let quantity = item.quantity;
  try {
    const productPage = await context.newPage();
    await productPage.goto(item.url, { timeout: 60000, waitUntil: "domcontentloaded" });
    await productPage.waitForTimeout(1500);
    sku =
      (await productPage.locator(".ProductDetails__Sku, .sku, .spec-row:has-text('Sku')").textContent().catch(() => null)) ||
      sku;
    quantity =
      (await productPage.locator(".storeAvailableStock, .prod-availability, .stock-info")
        .textContent()
        .catch(() => null)) ||
      quantity;
    await productPage.close();
  } catch (_) {}
  return { ...item, sku, quantity };
}

async function maybeCloseStoreModal(page) {
  const selectors = [
    "button[aria-label='Fermer']",
    "button[aria-label='Close']",
    "button:has-text('Plus tard')",
    "button:has-text('Later')",
    "button:has-text('Continuer')",
    "button:has-text('Continue')",
  ];
  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      const ok = await locator.isVisible().catch(() => false);
      if (ok) {
        await locator.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    } catch {
    }
  }
}

// ------------- MAIN -------------

async function main() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ locale: "fr-CA" });
  const page = await context.newPage();

  console.log("➡️  Go to:", START_URL);

  let retries = 3;
  while (retries > 0) {
    try {
      await page.goto(START_URL, { timeout: 120000, waitUntil: "domcontentloaded" });
      break;
    } catch (e) {
      retries--;
      if (retries === 0) throw e;
      console.log("Retrying page load...");
      await page.waitForTimeout(3000);
    }
  }

  await maybeCloseStoreModal(page);

  const all = [];
  let pageCount = 0;

  while (pageCount < MAX_PAGES) {
    pageCount += 1;
    try {
      await page.waitForSelector(PAGINATION.waitForList, { timeout: 15000 });
    } catch {}

    const items = await scrapeListOnce(page);
    console.log(`✅ Page ${pageCount}: ${items.length} produits`);
    all.push(...items);

    if (pageCount % 10 === 0) await page.waitForTimeout(1500);

    const loadMore = page.locator(PAGINATION.loadMoreBtn).first();
    if (await loadMore.isVisible().catch(() => false)) {
      await Promise.all([
        loadMore.click({ delay: 30 }).catch(() => {}),
        page.waitForLoadState("domcontentloaded"),
      ]);
      await page.waitForSelector(PAGINATION.waitForList, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      continue;
    }

    const next = nextBtn(page);
    if (await next.isVisible().catch(() => false)) {
      const before = page.url();
      await next.click({ delay: 30 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded");
      await page.waitForSelector(PAGINATION.waitForList, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);

      if (page.url() === before) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(800);
      }
      continue;
    }
    break;
  }

  const limit = pLimit(CONCURRENCY);
  let idx = 0;
  const withLocalImagesAndDetails = await Promise.all(
    all.map((p) =>
      limit(async () => {
        idx += 1;
        let image_path = null;
        if (p.image) {
          try {
            image_path = await downloadImage(p.image, idx, p.title);
          } catch {
            console.warn("⚠️  image download failed:", p.image);
          }
        }
        const enriched = await enrichWithDetails(context, p);
        return { ...enriched, image_path };
      })
    )
  );

  await fs.writeJson(OUT_JSON, withLocalImagesAndDetails, { spaces: 2 });
  console.log(`💾  JSON → ${OUT_JSON}`);

  const csv = createObjectCsvWriter({
    path: OUT_CSV,
    header: [
      { id: "title", title: "title" },
      { id: "price", title: "price" },
      { id: "price_raw", title: "price_raw" },
      { id: "regular_price", title: "regular_price" },
      { id: "regular_price_raw", title: "regular_price_raw" },
      { id: "sale_price", title: "sale_price" },
      { id: "sale_price_raw", title: "sale_price_raw" },
      { id: "liquidation", title: "liquidation" },
      { id: "url", title: "url" },
      { id: "image", title: "image" },
      { id: "image_path", title: "image_path" },
      { id: "sku", title: "sku" },
      { id: "quantity", title: "quantity" },
    ],
  });
  await csv.writeRecords(withLocalImagesAndDetails);
  console.log(`📄  CSV  → ${OUT_CSV}`);

  await browser.close();
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
