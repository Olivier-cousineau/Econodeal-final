import asyncio
import json
import csv
import re
from pathlib import Path
from typing import Optional, List, Dict

from playwright.async_api import async_playwright, Page

START_URL = "https://www.canadiantire.ca/fr/promotions/liquidation.html"
OUT_JSON = "data/canadiantire_liquidation.json"
OUT_CSV = "data/canadiantire_liquidation.csv"
MAX_PAGES = 30  # sécurité pour éviter une boucle infinie

PRICE_RE = re.compile(r"(\d+[.,]\d{2})")

def parse_price(txt: Optional[str]) -> Optional[float]:
    if not txt:
        return None
    clean = txt.replace("\u202f", " ").replace("\xa0", " ").replace("\u00a0", " ")
    m = PRICE_RE.search(clean)
    return float(m.group(1).replace(",", ".")) if m else None

async def get_product_data(card) -> Dict:
    # Titre (plusieurs variantes possibles)
    name = (await card.locator(
        "[data-testid='product-summary-name'], a[title], h3, h2"
    ).first.text_content() or "").strip()

    # Lien produit (absolutiser si relatif)
    link_el = card.locator("a[href*='/p/'], a[href*='/produit/'], a[href]")
    href = await link_el.first.get_attribute("href")
    if href and href.startswith("/"):
        href = "https://www.canadiantire.ca" + href

    # Image (lazy-load + srcset)
    img = card.locator("img").first
    image_url = await img.get_attribute("src") \
        or await img.get_attribute("data-src") \
        or await img.get_attribute("data-lazy")
    if not image_url:
        srcset = await img.get_attribute("srcset")
        if srcset:
            # prendre la dernière (généralement la plus grande)
            image_url = srcset.split(",")[-1].strip().split(" ")[0]

    # Prix (sélecteurs tolérants)
    regular_txt = await card.locator(
        "[data-testid='was-price'], .price_was, .was-price, [class*='was']"
    ).first.text_content() or ""

    sale_txt = await card.locator(
        "[data-testid='sale-price'], .price_sale, .sale-price, [class*='sale']"
    ).first.text_content() or ""

    # Fallback: bloc prix générique
    if not sale_txt:
        sale_txt = await card.locator(
            "[data-testid='product-price'], .price__value, .product-price"
        ).first.text_content() or ""

    regular_price = parse_price(regular_txt)
    sale_price = parse_price(sale_txt)

    # Si on n'a pas clairement was/sale, inférer via tous les nombres
    if regular_price is None and sale_price is not None:
        all_txt = (await card.text_content() or "")
        nums = [float(x.replace(",", ".")) for x in PRICE_RE.findall(all_txt)]
        if len(nums) >= 2:
            regular_price, sale_price = max(nums), min(nums)

    # Disponibilité (si visible)
    availability = (await card.locator(
        "[data-testid='availability'], .availability, [class*='availability']"
    ).first.text_content() or "").strip()

    return {
        "name": name,
        "image": image_url,
        "regular_price": regular_price,
        "sale_price": sale_price,
        "availability": availability,
        "link": href,
    }

async def scrape_page(page: Page) -> List[Dict]:
    # Plusieurs variantes d’item produit
    product_selector = (
        "li[data-testid='product-grids'], "
        "li[data-testid='product-grid'], "
        "[data-testid='product-card'], "
        "li[class*='product']"
    )
    await page.wait_for_selector(product_selector, timeout=60_000)

    # Scroll pour images lazy
    for _ in range(6):
        await page.mouse.wheel(0, 2200)
        await page.wait_for_timeout(250)

    cards = page.locator(product_selector)
    count = await cards.count()
    results = []
    for i in range(count):
        card = cards.nth(i)
        data = await get_product_data(card)
        if data["name"] and (data["sale_price"] is not None or data["regular_price"] is not None):
            results.append(data)
    return results

async def goto_next_page(page: Page) -> bool:
    """
    Essaie de cliquer sur le bouton 'suivant'.
    Retourne True si la prochaine page est chargée, sinon False.
    """
    # Variantes courantes pour le chevron suivant
    selectors = [
        "a[data-testid='chevron->']:not(.pagination_chevron--disabled)",
        "a[aria-label='Suivant']:not([aria-disabled='true'])",
        "button[aria-label='Suivant']:not([disabled])",
        "a.pagination_chevron:not(.pagination_chevron--disabled)"
    ]
    for sel in selectors:
        if await page.locator(sel).first.is_visible():
            await page.locator(sel).first.click()
            # Attendre que la grille se réaffiche sur la nouvelle page
            await page.wait_for_load_state("networkidle")
            return True
    return False

async def run():
    Path("data").mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(locale="fr-CA")
        page = await context.new_page()

        await page.goto(START_URL, timeout=120_000)
        all_rows: List[Dict] = []

        for page_idx in range(1, MAX_PAGES + 1):
            page_rows = await scrape_page(page)
            all_rows.extend(page_rows)
            print(f"[Page {page_idx}] +{len(page_rows)} produits, total = {len(all_rows)}")

            # Tente la page suivante, sinon on arrête
            moved = await goto_next_page(page)
            if not moved:
                break

        # JSON
        with open(OUT_JSON, "w", encoding="utf-8") as f:
            json.dump(all_rows, f, ensure_ascii=False, indent=2)

        # CSV
        with open(OUT_CSV, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(
                f,
                fieldnames=["name", "image", "regular_price", "sale_price", "availability", "link"]
            )
            w.writeheader()
            w.writerows(all_rows)

        print(f"✅ Fini: {len(all_rows)} produits")
        print(f"- JSON: {OUT_JSON}")
        print(f"- CSV : {OUT_CSV}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
