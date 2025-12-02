import fs from 'fs';
import path from 'path';
import { GetStaticProps, InferGetStaticPropsType } from 'next';
import { useMemo, useState } from 'react';

interface RawProduct {
  title?: string;
  sku?: string;
  product_sku?: string;
  product_id?: string | number | null;
  url?: string;
  image?: string;
  price?: number;
  sale_price?: number | null;
  regular_price?: number | null;
  price_raw?: string;
  sale_price_raw?: string | null;
  regular_price_raw?: string | null;
  liquidation?: boolean;
  liquidation_price?: number | null;
  liquidation_price_raw?: string | null;
  availability?: string | null;
  store_id?: string;
  city?: string;
  [key: string]: unknown;
}

interface ProductWithStore extends RawProduct {
  storeId: string;
  storeCity: string;
  storeSlug: string;
}

interface StoreSummary {
  storeId: string;
  storeCity: string;
  storeSlug: string;
  label: string;
  productCount: number;
}

export const getStaticProps: GetStaticProps<{
  products: ProductWithStore[];
  stores: StoreSummary[];
}> = async () => {
  const outputsRoot = path.join(process.cwd(), 'outputs', 'canadiantire');
  let dirEntries: fs.Dirent[] = [];

  try {
    dirEntries = await fs.promises.readdir(outputsRoot, { withFileTypes: true });
  } catch (error) {
    console.error('Unable to read outputs/canadiantire directory', error);
    return {
      props: {
        products: [],
        stores: [],
      },
      revalidate: 60,
    };
  }

  const products: ProductWithStore[] = [];
  const storeCounts: Record<string, number> = {};

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dataPath = path.join(outputsRoot, entry.name, 'data.json');
    if (!fs.existsSync(dataPath)) {
      continue;
    }

    let rawContent: string;
    try {
      rawContent = await fs.promises.readFile(dataPath, 'utf-8');
    } catch (error) {
      console.warn(`Skipping ${entry.name} because data.json could not be read`, error);
      continue;
    }

    let storeProducts: RawProduct[];
    try {
      const parsed = JSON.parse(rawContent);
      storeProducts = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn(`Skipping ${entry.name} because data.json is invalid JSON`, error);
      continue;
    }

    if (storeProducts.length === 0) {
      continue;
    }

    const [storeIdFromSlug, ...citySegments] = entry.name.split('-');
    const fallbackStoreId = storeIdFromSlug ?? entry.name;
    const citySlug = citySegments.join('-');
    const fallbackCity = citySlug ? citySlug.replace(/-/g, ' ') : 'Unknown';

    for (const product of storeProducts) {
      const storeId = String(product.store_id ?? fallbackStoreId);
      const storeCity = String(product.city ?? fallbackCity);
      products.push({
        ...product,
        storeId,
        storeCity,
        storeSlug: entry.name,
      });
      storeCounts[entry.name] = (storeCounts[entry.name] ?? 0) + 1;
    }
  }

  products.sort((a, b) => {
    const titleA = a.title ?? '';
    const titleB = b.title ?? '';
    return titleA.localeCompare(titleB);
  });

  const stores: StoreSummary[] = Object.entries(storeCounts)
    .map(([storeSlug, productCount]) => {
      const [storeIdFromSlug, ...citySegments] = storeSlug.split('-');
      const citySlug = citySegments.join('-');
      const cityLabel = citySlug ? citySlug.replace(/-/g, ' ') : 'Unknown';
      return {
        storeId: storeIdFromSlug ?? storeSlug,
        storeCity: cityLabel,
        storeSlug,
        productCount,
        label: `${storeIdFromSlug ?? storeSlug} – ${cityLabel}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    props: {
      products,
      stores,
    },
    revalidate: 60,
  };
};

const CanadianTirePage = ({
  products,
  stores,
}: InferGetStaticPropsType<typeof getStaticProps>) => {
  const [selectedStore, setSelectedStore] = useState<string>('all');

  const visibleProducts = useMemo(() => {
    if (selectedStore === 'all') {
      return products;
    }
    return products.filter((product) => product.storeSlug === selectedStore);
  }, [products, selectedStore]);

  const selectedStoreMeta = useMemo(() => {
    if (selectedStore === 'all') {
      return null;
    }
    return stores.find((store) => store.storeSlug === selectedStore) ?? null;
  }, [selectedStore, stores]);

  return (
    <main style={{ padding: '2rem 1rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Canadian Tire Liquidation Products</h1>
        <p style={{ marginTop: '0.5rem', color: '#4b5563' }}>
          Listing {products.length.toLocaleString()} products across {stores.length}{' '}
          stores. Use the filter below to inspect a specific location.
        </p>
      </header>

      {stores.length > 0 && (
        <section style={{ marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <label htmlFor="store-filter" style={{ fontWeight: 600 }}>
            Filter by store
          </label>
          <select
            id="store-filter"
            value={selectedStore}
            onChange={(event) => setSelectedStore(event.target.value)}
            style={{ padding: '0.5rem', minWidth: '260px' }}
          >
            <option value="all">All stores</option>
            {stores.map((store) => (
              <option key={store.storeSlug} value={store.storeSlug}>
                {store.label} ({store.productCount})
              </option>
            ))}
          </select>
          <div style={{ alignSelf: 'center', color: '#4b5563' }}>
            Showing {visibleProducts.length.toLocaleString()} products
            {selectedStoreMeta ? ` from ${selectedStoreMeta.label}` : ''}.
          </div>
        </section>
      )}

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '1rem',
        }}
      >
        {visibleProducts.map((product, index) => (
          <article
            key={`${product.storeSlug}-${product.sku ?? product.product_sku ?? index}`}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '0.75rem',
              padding: '1rem',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              Store {product.storeId} · {product.storeCity}
            </div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>{product.title}</h2>
            {product.image && (
              <img
                src={product.image}
                alt={product.title ?? ''}
                style={{ width: '100%', height: '160px', objectFit: 'contain' }}
                loading="lazy"
              />
            )}
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              {product.price_raw || product.sale_price_raw || product.regular_price_raw || 'N/A'}
            </div>
            {product.url && (
              <a
                href={product.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 500 }}
              >
                View product
              </a>
            )}
            {product.availability && (
              <div style={{ fontSize: '0.85rem', color: '#4b5563' }}>{product.availability}</div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
};

export default CanadianTirePage;
