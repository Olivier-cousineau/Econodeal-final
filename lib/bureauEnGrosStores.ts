import stores from '../data/bureau-en-gros/stores.json';

export type BureauEnGrosStore = {
  id: string;
  name: string;
  address: string;
  store: string;
};

const typedStores = stores as BureauEnGrosStore[];

export function getBureauEnGrosStores(): BureauEnGrosStore[] {
  return typedStores;
}

export function getBureauEnGrosStoreById(id: string): BureauEnGrosStore | undefined {
  return typedStores.find((s) => s.id === id);
}

export function getBureauEnGrosStoreSlug(store: BureauEnGrosStore): string {
  // Même slug que dans outputs/bureauengros : "{id}-bureau-en-gros-{ville-province-avec-des-tirets}"
  const namePart = store.name
    .toLowerCase()
    .replace('bureau en gros – ', '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return `${store.id}-bureau-en-gros-${namePart}`;
}
