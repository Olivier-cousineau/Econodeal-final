#!/usr/bin/env node
// @ts-check
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const OUTPUTS_DIR = path.join(repoRoot, 'outputs', 'canadiantire');
const TARGET_DIR = path.join(repoRoot, 'data', 'canadian-tire');
const AVAILABILITY_PATH = path.join(TARGET_DIR, 'stores_with_data.json');

function canonicalizeSlug(value){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toNumber(value){
  if(typeof value === 'number'){
    return Number.isFinite(value) ? value : null;
  }
  if(typeof value === 'string'){
    const normalized = value
      .replace(/[^0-9,.-]/g, '')
      .replace(/,(?=\d{2}\b)/g, '.')
      .replace(/\.(?=.*\.)/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickFirstNumber(...candidates){
  for(const candidate of candidates){
    const value = toNumber(candidate);
    if(value !== null && value !== undefined){
      return value;
    }
  }
  return null;
}

function normalizeItems(data, defaults){
  if(!Array.isArray(data)) return [];
  return data.map(item => {
    if(!item || typeof item !== 'object') return null;
    const regular = pickFirstNumber(
      item.regular,
      item.regular_price,
      item.regularPrice,
      item.original_price,
      item.originalPrice,
      item.price_before,
      item.priceBefore,
      item.list_price,
      item.listPrice,
      item.price
    );
    const sale = pickFirstNumber(
      item.sale,
      item.sale_price,
      item.salePrice,
      item.discount_price,
      item.discountPrice,
      item.liquidation_price,
      item.offer_price,
      item.offerPrice,
      item.deal_price,
      item.dealPrice,
      item.price_now,
      item.priceNow,
      item.current_price,
      item.currentPrice,
      item.price
    );
    let price = regular;
    let salePrice = sale;
    if(price === null && salePrice !== null){
      price = salePrice;
    }
    if(salePrice === null && price !== null){
      salePrice = price;
    }
    if(price !== null && salePrice !== null && salePrice > price){
      const temp = salePrice;
      salePrice = price;
      price = temp;
    }
    const title = String(item.title ?? item.name ?? item.product_name ?? '').trim();
    const image = item.image ?? item.image_url ?? item.imageUrl ?? '';
    const url = item.url ?? item.link ?? item.product_link ?? '';
    if(!title || !url){
      return null;
    }
    return {
      title,
      image,
      price,
      salePrice,
      store: 'Canadian Tire',
      city: defaults.city,
      branch: defaults.label,
      url,
      sku: item.sku ?? item.product_sku ?? item.product_id ?? '',
      availability: item.availability ?? item.stock_message ?? ''
    };
  }).filter(Boolean);
}

function readJson(filePath){
  try{
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }catch{
    return null;
  }
}

function writeJson(filePath, data){
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

if(!fs.existsSync(OUTPUTS_DIR)){
  console.error(`❌ Outputs directory not found: ${OUTPUTS_DIR}`);
  process.exit(1);
}
fs.mkdirSync(TARGET_DIR, { recursive: true });

const availabilityMap = new Map();
if(fs.existsSync(AVAILABILITY_PATH)){
  const existing = readJson(AVAILABILITY_PATH);
  if(Array.isArray(existing)){
    existing.forEach(entry => {
      if(!entry) return;
      const slug = canonicalizeSlug(entry.slug ?? entry);
      const storeNumber = String(entry.storeNumber ?? entry.store ?? entry.id ?? '').trim();
      if(slug){
        availabilityMap.set(storeNumber || slug, { storeNumber, slug });
      }
    });
  }
}

const entries = fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true });
let updatedStores = 0;
for(const entry of entries){
  if(!entry.isDirectory()) continue;
  const dirName = entry.name;
  const [storeNumberRaw, ...slugParts] = dirName.split('-');
  if(!storeNumberRaw || slugParts.length === 0) continue;
  const storeNumber = storeNumberRaw.trim();
  const slug = canonicalizeSlug(slugParts.join('-'));
  if(!slug){
    continue;
  }
  const sourcePath = path.join(OUTPUTS_DIR, dirName, 'data.json');
  if(!fs.existsSync(sourcePath)){
    continue;
  }
  const rawData = readJson(sourcePath);
  if(!Array.isArray(rawData)){
    continue;
  }
  const city = rawData.find(item => item?.city)?.city || slug.replace(/-/g, ' ');
  const defaults = { city: String(city || '').trim(), label: String(city || '').trim() };
  const normalized = normalizeItems(rawData, defaults);
  if(!normalized.length){
    continue;
  }
  const targetPath = path.join(TARGET_DIR, `${slug}.json`);
  writeJson(targetPath, normalized);
  availabilityMap.set(storeNumber || slug, { storeNumber, slug });
  updatedStores += 1;
  console.log(`✅ Published ${normalized.length} produits pour ${dirName}`);
}

const existingJsonFiles = fs.readdirSync(TARGET_DIR, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .filter(name => name.endsWith('.json') && !['branches.json', 'stores_with_data.json'].includes(name));

for(const fileName of existingJsonFiles){
  const slug = canonicalizeSlug(fileName.replace(/\.json$/i, ''));
  if(!slug) continue;
  const alreadyTracked = Array.from(availabilityMap.values()).some(entry => entry.slug === slug);
  if(!alreadyTracked){
    availabilityMap.set(slug, { storeNumber: '', slug });
  }
}

const availabilityList = Array.from(availabilityMap.values())
  .filter(entry => entry && entry.slug)
  .map(entry => ({
    storeNumber: entry.storeNumber || '',
    slug: entry.slug
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug));

writeJson(AVAILABILITY_PATH, availabilityList);
console.log(`\n💾 Mise à jour de ${availabilityList.length} magasin(s) dans ${AVAILABILITY_PATH}`);
console.log(`🏁 ${updatedStores} magasin(s) générés à partir des sorties Playwright.`);
