#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scraper Canadian Tire – liquidation pour un magasin spécifique.

- Force un magasin (ID) afin d'obtenir les prix locaux.
- Parcourt les pages de la section "liquidation" et extrait les cartes produits.
- Normalise les champs (prix régulier, prix liquidation, disponibilité, etc.).
- Exporte au format JSON, CSV et génère un rapport HTML.
"""

from __future__ import annotations

import argparse
import asyncio
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import pandas as pd
from playwright.async_api import Browser, BrowserContext, Locator, Page, async_playwright

START_URL = "https://www.canadiantire.ca/fr/promotions/liquidation.html"
STORE_URL_TEMPLATE = "https://www.canadiantire.ca/fr/store-details/{province}/{slug}-{store_id}.html"
PRODUCT_SELECTORS = (
    "li[data-testid='product-grids']",
    "li[data-testid='product-grid']",
    "[data-testid='product-card']",
    "li[class*='product']",
)
PRICE_RE = re.compile(r"(\d+[.,]\d{2})")


@dataclass
class Product:
    name: str
    brand: Optional[str]
    url: str
    image_url: Optional[str]
    sku: Optional[str]
    category: str
    regular_price: Optional[float]
    sale_price: Optional[float]
    availability: Optional[str]
    tags: List[str]
    rating: Optional[float]
    reviews: Optional[int]

    def to_dict(self) -> dict:
        data = {
            "name": self.name,
            "brand": self.brand,
            "url": self.url,
            "image_url": self.image_url,
            "sku": self.sku,
            "category": self.category,
            "regular_price": self.regular_price,
            "sale_price": self.sale_price,
            "availability": self.availability,
            "tags": ", ".join(t for t in self.tags if t),
            "rating": self.rating,
            "reviews": self.reviews,
        }
        if self.regular_price and self.sale_price:
            if self.regular_price > 0 and self.sale_price <= self.regular_price:
                discount = 1 - (self.sale_price / self.regular_price)
                data["discount_pct"] = round(discount * 100)
        return data


def parse_price(text: Optional[str]) -> Optional[float]:
    if not text:
        return None
    clean = text.replace("\u202f", " ").replace("\xa0", " ").replace("\u00a0", " ")
    match = PRICE_RE.search(clean)
    if not match:
        return None
    value = match.group(1).replace(",", ".")
    try:
        return float(value)
    except ValueError:
        return None

def clean_money(s: str | None) -> str | None:
    if not s:
        return None
    s = s.replace("\xa0", " ").replace("\u202f", " ").strip()
    match = re.search(r"(\d[\d\s.,]*)(?:\s*\$)?", s)
    return match.group(1).replace(" ", "") if match else s


async def extract_product(card: Locator) -> dict:
    title = await card.locator("[id^='title__promolisting-']").first.text_content()
    if not title:
        title = await card.locator(".nl-product-card__title").first.text_content()
    title = title.strip() if title else None

    price_sale = await card.locator("span[data-testid='priceTotal'], .nl-price--total").first.text_content()
    price_was = await card.locator(
        ".nl-price__was s, .nl-price__was, .nl-price--was, .nl-price__change s"
    ).first.text_content()

    price_sale = clean_money(price_sale)
    price_original = clean_money(price_was)

    img_el = card.locator(".nl-product-card__image-wrap img").first
    img_src = await img_el.get_attribute("src")
    if not img_src:
        img_src = await img_el.get_attribute("data-src")

    availability = await card.locator(
        ".nl-product-card__availability-message"
    ).first.text_content()
    availability = availability.strip() if availability else None

    sku = await card.locator(".nl-product__code").first.text_content()
    sku = sku.strip().lstrip("#") if sku else None

    badges: List[str] = []
    if await card.locator(".nl-plp-badges").count():
        badges_text = await card.locator(".nl-plp-badges").all_inner_texts()
        badges = [b.strip() for b in badges_text if b.strip()]

    link = None
    title_anchor = card.locator("[id^='title__promolisting-']").locator("xpath=ancestor::a[1]")
    if await title_anchor.count():
        link = await title_anchor.first.get_attribute("href")
    if not link:
        link = await card.locator("a[href*='/p/'], a[href*='/product/']").first.get_attribute("href")
    if link and link.startswith("/"):
        link = "https://www.canadiantire.ca" + link

    return {
        "name": title,
        "price_sale": price_sale,
        "price_original": price_original,
        "image": img_src,
        "availability": availability,
        "sku": sku,
        "badges": badges,
        "link": link,
    }


async def scrape_listing(page: Page) -> List[dict]:
    await page.wait_for_selector("li[data-testid='product-grids']", timeout=60_000)
    await page.wait_for_selector("span[data-testid='priceTotal']", timeout=60_000)
    cards = page.locator("li[data-testid='product-grids']")
    count = await cards.count()
    results: List[dict] = []
    for i in range(count):
        card = cards.nth(i)
        try:
            results.append(await extract_product(card))
        except Exception:
            continue
    return results


def listing_to_product(data: dict, category: str) -> Optional[Product]:
    name = (data.get("name") or "").strip()
    link = data.get("link")
    if not name or not link:
        return None

    sale_price = parse_price(data.get("price_sale"))
    regular_price = parse_price(data.get("price_original"))
    availability = data.get("availability") or None
    sku = data.get("sku") or None
    image = data.get("image") or None
    raw_tags = data.get("badges") or []
    tags = [t for t in raw_tags if t]

    return Product(
        name=name,
        brand=None,
        url=link,
        image_url=image,
        sku=sku,
        category=category,
        regular_price=regular_price,
        sale_price=sale_price,
        availability=availability,
        tags=tags,
        rating=None,
        reviews=None,
    )


async def accept_banners(page: Page) -> None:
    selectors = [
        "button:has-text('Accepter')",
        'button:has-text("J\'accepte")',
        "button:has-text('Tout accepter')",
        "button:has-text('Accept all')",
        "button:has-text('Accept All')",
        "button:has-text('OK')",
    ]
    for selector in selectors:
        loc = page.locator(selector)
        if await loc.count() > 0 and await loc.first.is_enabled():
            try:
                await loc.first.click()
                await page.wait_for_timeout(500)
            except Exception:
                continue


async def ensure_store(context: BrowserContext, store_id: str, store_slug: str, province: str) -> None:
    page = await context.new_page()
    try:
        await page.goto(
            STORE_URL_TEMPLATE.format(province=province, slug=store_slug, store_id=store_id),
            wait_until="domcontentloaded",
            timeout=120_000,
        )
        await accept_banners(page)
        selectors = [
            "button:has-text('Choisir ce magasin')",
            "button:has-text('Sélectionner ce magasin')",
            "button:has-text('Mon magasin')",
            "button:has-text('Définir comme magasin')",
            "button:has-text('Set as My Store')",
            "[data-testid='set-my-store']",
        ]
        for selector in selectors:
            loc = page.locator(selector)
            if await loc.count() > 0 and await loc.first.is_enabled():
                try:
                    await loc.first.click()
                    await page.wait_for_timeout(1500)
                    break
                except Exception:
                    continue
    finally:
        await page.close()


async def goto_next_page(page: Page) -> bool:
    selectors = [
        "a[data-testid='chevron->']:not(.pagination_chevron--disabled)",
        "a[aria-label='Suivant']:not([aria-disabled='true'])",
        "button[aria-label='Suivant']:not([disabled])",
        "a.pagination_chevron:not(.pagination_chevron--disabled)",
    ]
    for selector in selectors:
        loc = page.locator(selector)
        if await loc.count() > 0 and await loc.first.is_enabled():
            try:
                await loc.first.click()
                await page.wait_for_load_state("domcontentloaded")
                await page.wait_for_selector("li[data-testid='product-grids']", timeout=60_000)
                await page.wait_for_selector("span[data-testid='priceTotal']", timeout=60_000)
                return True
            except Exception:
                continue
    return False


async def scrape_liquidation(
    browser: Browser,
    store_id: str,
    store_slug: str,
    province: str,
    start_url: str,
    category_label: str,
    max_pages: int,
) -> List[Product]:
    context = await browser.new_context(locale="fr-CA")
    await context.add_cookies(
        [
            {
                "name": name,
                "value": store_id,
                "domain": ".canadiantire.ca",
                "path": "/",
            }
            for name in ("preferredStoreId", "storeId", "preferredStore")
        ]
    )
    await context.add_init_script(
        """
        localStorage.setItem('preferredStoreId', '%(store)s');
        localStorage.setItem('storeId', '%(store)s');
        sessionStorage.setItem('preferredStoreId', '%(store)s');
        """ % {"store": store_id}
    )

    await ensure_store(context, store_id, store_slug, province)

    page = await context.new_page()
    await page.goto(start_url, wait_until="domcontentloaded", timeout=120_000)
    await accept_banners(page)

    all_products: List[Product] = []
    for page_idx in range(1, max_pages + 1):
        listings = await scrape_listing(page)
        page_products = []
        for data in listings:
            product = listing_to_product(data, category_label)
            if product:
                page_products.append(product)
        all_products.extend(page_products)
        moved = await goto_next_page(page)
        if not moved:
            break

    await context.close()
    return all_products


def render_html(df: pd.DataFrame, out_html: Path, store_name: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    rows = []
    for _, row in df.iterrows():
        img_html = ""
        if isinstance(row.get("image_url"), str) and row["image_url"]:
            img_html = (
                f"<img src=\"{row['image_url']}\" alt=\"\" "
                "style=\"width:80px;height:auto;object-fit:contain;border:1px solid #eee\" />"
            )
        tags_html = ""
        if row.get("tags"):
            tags_html = "<br>" + " ".join(
                f"<span style='font-size:11px;padding:2px 6px;border-radius:6px;border:1px solid #ccc'>{t}</span>"
                for t in str(row["tags"]).split(", ")
                if t
            )
        discount_html = ""
        if pd.notna(row.get("discount_pct")):
            discount_html = (
                f"<span style='font-weight:600;color:#0a58ca;margin-left:6px'>"
                f"-{int(row['discount_pct'])}%</span>"
            )
        rating_html = ""
        if pd.notna(row.get("rating")):
            rating_html = f"<div style='color:#444;font-size:12px'>★ {row['rating']:.1f}"
            if pd.notna(row.get("reviews")):
                rating_html += f" ({int(row['reviews'])})"
            rating_html += "</div>"
        availability_html = ""
        if isinstance(row.get("availability"), str) and row["availability"]:
            availability_html = (
                f"<div style='font-size:12px;color:#444'>{row['availability']}</div>"
            )

        rows.append(
            f"""
        <tr>
          <td>{img_html}</td>
          <td>
            <a href="{row['url']}" target="_blank" style="text-decoration:none;color:#0a58ca">{row['name']}</a><br>
            <small>{row.get('brand') or ''}</small><br>
            <small>{row.get('sku') or ''}</small>
            {tags_html}
            {rating_html}
            {availability_html}
          </td>
          <td>{row.get('category') or ''}</td>
          <td>{f"$ {row['regular_price']:.2f}" if pd.notna(row.get('regular_price')) else ''}</td>
          <td><strong>{f"$ {row['sale_price']:.2f}" if pd.notna(row.get('sale_price')) else ''}</strong>{discount_html}</td>
        </tr>
        """
        )

    html = f"""<!doctype html>
<html lang=\"fr\">
<meta charset=\"utf-8\"/>
<title>Liquidations – {store_name}</title>
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>
<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\"><link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap\" rel=\"stylesheet\">
<style>
 body{{font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;margin:24px}}
 h1{{margin:0 0 8px 0}}
 table{{width:100%;border-collapse:collapse;margin-top:12px}}
 th,td{{border-bottom:1px solid #eee;padding:10px;text-align:left;vertical-align:top}}
 th{{background:#fafafa;font-weight:600}}
 .meta{{color:#666;font-size:12px}}
</style>
<h1>Liquidations – {store_name}</h1>
<div class=\"meta\">Total produits : {len(df)} • Généré le {ts}.<br>Affiche: image, prix régulier, prix liquidation, % de rabais.</div>
<table>
  <thead><tr><th>Image</th><th>Produit</th><th>Catégorie</th><th>Prix régulier</th><th>Prix liquidation</th></tr></thead>
  <tbody>
    {''.join(rows)}
  </tbody>
</table>
</html>"""
    out_html.write_text(html, encoding="utf-8")


def build_dataframe(products: List[Product]) -> pd.DataFrame:
    if not products:
        return pd.DataFrame(
            columns=[
                "name",
                "brand",
                "url",
                "image_url",
                "sku",
                "category",
                "regular_price",
                "sale_price",
                "availability",
                "tags",
                "rating",
                "reviews",
                "discount_pct",
            ]
        )

    rows = []
    for product in products:
        rows.append(product.to_dict())
    df = pd.DataFrame(rows).drop_duplicates(subset=["url"]).reset_index(drop=True)
    return df


async def main_async(args: argparse.Namespace) -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        products = await scrape_liquidation(
            browser=browser,
            store_id=args.store_id,
            store_slug=args.store_slug,
            province=args.store_province,
            start_url=args.start_url,
            category_label=args.category_label,
            max_pages=args.max_pages,
        )
        await browser.close()

    df = build_dataframe(products)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.json:
        Path(args.json).write_text(
            df.to_json(orient="records", force_ascii=False, indent=2),
            encoding="utf-8",
        )
    if args.csv:
        df.to_csv(args.csv, index=False, encoding="utf-8")
    if args.html:
        render_html(df, Path(args.html), store_name=args.store_name)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scraper Canadian Tire liquidation par magasin")
    parser.add_argument("--store-id", default="271")
    parser.add_argument("--store-name", default="Canadian Tire Saint-Jérôme")
    parser.add_argument("--store-slug", default="saint-jerome")
    parser.add_argument("--store-province", default="qc")
    parser.add_argument("--start-url", default=START_URL)
    parser.add_argument("--category-label", default="Liquidation")
    parser.add_argument("--max-pages", type=int, default=40)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--json")
    parser.add_argument("--csv")
    parser.add_argument("--html")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
