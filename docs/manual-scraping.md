# Manual scraping instructions

With the scheduled GitHub Actions workflows removed, scraping must be run manually from your machine.

## Prerequisites
- Node.js 18+ and npm installed
- Repository dependencies installed (`npm install`)
- A copy of `scraper_ct.js` present at the repo root (restored in this repository)

## Run the Canadian Tire matrix job locally
1. Confirm prerequisites are installed:
   ```bash
   npm install
   ```
   (Run `npx playwright install` if Playwright browsers are missing.)
2. Run the matrix runner with your desired options (examples below are safe to copy-paste). You can invoke it directly or via the npm script:
   ```bash
   # direct
   node scripts/run_canadiantire_matrix.js --file data/canadian-tire/branches.json --limit 5 --publish

   # via npm script (adds a consistent working directory)
   npm run scrape:canadiantire -- --file data/canadian-tire/branches.json --limit 5 --publish
   ```
3. Optional flags you may find useful:
   - `--stores 271,649` to target specific store IDs
   - `--maxPages 80` to limit pagination depth
   - `--dry-run` to skip writing outputs and publishing
   - `--headful` to run the scraper with a visible browser if supported

## Publishing outputs without scraping
If you already have generated JSON files under `outputs/canadiantire/`, you can publish them without re-scraping:
```bash
node scripts/publish_canadiantire_outputs.js
```

## Troubleshooting
- If the runner exits immediately with a missing scraper error, confirm `scraper_ct.js` is present or restored.
- Ensure `data/canadian-tire/branches.json` exists; adjust the `--file` flag if you use another matrix.
- For shard-based runs, use `--shard 1 --shards 7` (values can be adjusted) to split the workload.
