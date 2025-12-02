# Scraper cleanup summary

## Active scrapers and helpers
- `scripts/run_canadiantire_matrix.js` — orchestrates the matrix runs that back the Canadian Tire shard workflows and the CT multi-store workflow.
- `scraper_ct.js` — actual scraper invoked by the matrix runner as well as the multi-store workflow.
- `scripts/publish_canadiantire_outputs.js` — normalizes freshly scraped data before it is committed by the shard workflows.
- `scripts/publish_canadiantire_public.js` — the only scraper-related script exposed through `package.json` and still used to publish Canadian Tire data to the public site.

## Scrapers moved to `archive/unused-scrapers/`
- `archive/unused-scrapers/scrape.js` — legacy Node scraper triggered by the old `scraper-st-jerome` workflow.
- `archive/unused-scrapers/canadian_tire_scraper.py` — Playwright-based Python scraper that was superseded by the sharded jobs but still referenced by the old Saint-Jérôme workflow.
- `archive/unused-scrapers/scrape_canadiantire_liquidation.py` — earlier Python prototype that is no longer referenced anywhere.

## Workflows disabled (manual trigger only)
- `.github/workflows/scraper-st-jerome.yml` — kept for manual runs with the archived Node scraper but no longer scheduled.
- `.github/workflows/canadiantire_stjerome.yml` — legacy Python workflow, now manual-only.
