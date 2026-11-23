import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAvailabilityReport } from './availabilityReport.js';

test('availability report prints every filtered product and every confirmed/tentative contract without changing amounts', () => {
  const entries = Array.from({ length: 35 }, (_, index) => ({
    row: { item: { name: `Producto ${index + 1}`, sku: `SKU-${index + 1}` }, totalStock: 672, hardReservedQty: 669, projectedAvailable: 3, softReservedQty: 10 },
    commitments: [
      { contractCode: `CONFIRMADO-${index + 1}`, orderCode: `OS-${index + 1}`, customerName: 'CLIENTE <UNO>', eventDate: '2026-12-12', deliveryDate: '2026-12-11', pickupDate: '2026-12-13', quantity: 669, commitmentTone: 'confirmed', address: 'Av. & Salón' },
      { quoteCode: `TENTATIVA-${index + 1}`, type: 'cotizacion', clientId: 'c', eventDate: '2026-12-12', quantity: 10, commitmentTone: 'tentative' },
    ],
  }));
  const before = JSON.stringify(entries);
  const html = buildAvailabilityReport({ entries, dateFrom: '2026-12-12', dateTo: '2026-12-13', filters: ['Búsqueda: cojin marfil'], clients: [{ id: 'c', name: 'Cliente de respaldo', address: 'DIRECCIÓN CLIENTE' }] });
  assert.equal((html.match(/class="product"/g) || []).length, 35);
  assert.match(html, /CONFIRMADO-35/);
  assert.match(html, /TENTATIVA-35/);
  assert.match(html, /CLIENTE &lt;UNO&gt;/);
  assert.match(html, /Av\. &amp; Salón/);
  assert.match(html, /DIRECCIÓN CLIENTE/);
  assert.match(html, /Comprometido <b>669/);
  assert.match(html, /Disponible <b>3/);
  assert.match(html, /11\/12\/2026/);
  assert.match(html, /13\/12\/2026/);
  assert.match(html, /Búsqueda: cojin marfil/);
  assert.equal(JSON.stringify(entries), before);
});

test('unreserved products and virtual combos explain the absence of detailed contracts', () => {
  const html = buildAvailabilityReport({ entries: [
    { row: { item: { name: 'Libre' }, totalStock: 15, projectedAvailable: 15 }, commitments: [] },
    { row: { item: { name: 'Combo', isCombo: true }, totalStock: 10, projectedAvailable: 5 }, commitments: [] },
  ], dateFrom: '2026-12-12', dateTo: '2026-12-13' });
  assert.match(html, /Sin contratos ni reservas registrados/);
  assert.match(html, /se calcula a partir de sus componentes/);
  assert.match(html, /size:Letter portrait/);
  assert.match(html, /font:10pt/);
  assert.match(html, /table-header-group/);
});
