#!/usr/bin/env node
// scripts/publish_canadiantire_public.js
// Copie tous les data.json de outputs/canadiantire/* vers public/canadiantire/*.json
// Exemple :
//   outputs/canadiantire/271-st-jerome-qc/data.json
// → public/canadiantire/271-st-jerome-qc.json

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Racines à partir du repo (scripts/ → ..)
const outputsRoot = path.join(__dirname, "..", "outputs", "canadiantire");
const publicRoot = path.join(__dirname, "..", "public", "canadiantire");

async function main() {
  console.log("📦 Publication des JSON Canadian Tire vers public/…");
  await fs.ensureDir(publicRoot);

  let entries;
  try {
    entries = await fs.readdir(outputsRoot, { withFileTypes: true });
  } catch (err) {
    console.error("❌ Impossible de lire", outputsRoot, "-", err.message);
    process.exit(1);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const storeSlug = entry.name; // ex: "271-st-jerome-qc"
    const src = path.join(outputsRoot, storeSlug, "data.json");
    const dest = path.join(publicRoot, `${storeSlug}.json`);

    const exists = await fs.pathExists(src);
    if (!exists) {
      console.log(`⚠️  ${storeSlug} : pas de data.json, on saute.`);
      continue;
    }

    try {
      const raw = await fs.readFile(src, "utf-8");

      // Vérifie que le JSON est valide (pour éviter de publier un fichier corrompu)
      JSON.parse(raw);

      await fs.writeFile(dest, raw);
      console.log(`✅ Copié ${src} → ${dest}`);
    } catch (err) {
      console.warn(`❌ Erreur pour ${storeSlug}: ${err.message}`);
    }
  }

  console.log("✨ Publication Canadian Tire vers public/ terminée.");
}

main().catch((err) => {
  console.error("❌ Erreur dans publish_canadiantire_public:", err);
  process.exit(1);
});
