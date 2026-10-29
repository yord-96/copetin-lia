import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractDocumentHtml } from './webBridge.js';

export const dailyAmountsFixture = () => ({ contract: { contractCode: '3278', customerName: 'ALEJANDRA DE LA JAILLE',
  eventDate: '2026-10-29', deliveryDate: '2026-10-29', pickupDate: '2026-11-02', logisticsMode: 'recojo',
  items: [
    { itemId: 'm', itemName: 'MULETON COCTELERO', quantity: 1, unitPriceBs: 0, lineTotalBs: 0, category: 'MANTELERIA' },
    { itemId: 't', itemName: 'MANTEL LISO / REDONDO MARFIL', quantity: 1, unitPriceBs: 0, lineTotalBs: 0, category: 'MANTELERIA' },
    { itemId: 'c', itemName: 'CAPUCHON', quantity: 1, unitPriceBs: 0, lineTotalBs: 0, category: 'MANTELERIA' },
    { itemId: 'b', itemName: 'MESA COCTELERA BASE GRANDE P/4 PERSONAS', quantity: 1, unitPriceBs: 55, lineTotalBs: 55, category: 'MOBILIARIO' },
  ], pricingPlan: { mode: 'duration', days: 5, baseSubtotalBs: 55, chargeableSubtotalBs: 203.5,
    tiers: [{ fromDay: 1, toDay: 1, percent: 100 }, { fromDay: 2, toDay: 2, percent: 70 }, { fromDay: 3, toDay: 4, percent: 50 }, { fromDay: 5, toDay: 5, percent: 100 }] },
  totals: { totalBs: 203.5, itemsSubtotalBs: 203.5, guaranteeBs: 150 } }, rental: {}, deliveries: [], settings: {}, items: [], paperSize: 'oficio' });

test('duration contract and quote show matching daily percentages and actual amounts in headers and vertical totals', () => {
  for (const documentKind of ['contract', 'quote']) {
    const html = buildContractDocumentHtml({ ...dailyAmountsFixture(), documentKind }).replace(/\s|&nbsp;/g, '');
    for (const [index, [percent, amount]] of [[100,'55'],[70,'38'],[50,'27'],[50,'27'],[100,'55']].entries()) {
      const decimals = amount === '38' || amount === '27' ? '50' : '00';
      assert.match(html, new RegExp(`Dia${index+1}-${percent}%-SubtotalBs${amount}[.,]${decimals}`));
      const sidebar = new RegExp(`<span>Dia${index+1}\\(${percent}%\\)</span><strong>Bs${amount}[.,]${decimals}</strong>`, 'g');
      assert.equal([...html.matchAll(sidebar)].length, 1, 'each daily subtotal appears once in sidebar');
    }
    assert.match(html, /Bs203[.,]50/);
  }
});

test('daily schedule totals use each day own lines; simple contracts gain no daily rows', () => {
  const fixture = dailyAmountsFixture();
  fixture.contract.pricingPlan = { mode: 'daily_schedule', scheduleDays: [{ id: 'd1', label: 'Dia 1', date: '2026-10-29' }, { id: 'd2', label: 'Dia 2', date: '2026-10-30' }] };
  fixture.contract.items = [{ itemId: 'a', itemName: 'MESA', quantity: 1, lineTotalBs: 55, serviceDayId: 'd1' }, { itemId: 'b', itemName: 'SILLA', quantity: 1, lineTotalBs: 20, serviceDayId: 'd2' }];
  const html = buildContractDocumentHtml(fixture).replace(/\s|&nbsp;/g, '');
  assert.match(html, /<span>Dia1<\/span><strong>Bs55[.,]00/);
  assert.match(html, /<span>Dia2<\/span><strong>Bs20[.,]00/);
  fixture.contract.pricingPlan = { mode: 'simple' };
  assert.doesNotMatch(buildContractDocumentHtml(fixture), /rc-duration-day-row">/);
});
