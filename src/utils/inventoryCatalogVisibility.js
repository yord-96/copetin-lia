export const isInventoryCatalogItemActive = (item) => (
  Boolean(item)
  && !item.deletedAt
  && String(item.status ?? 'active').trim().toLowerCase() !== 'deleted'
);
