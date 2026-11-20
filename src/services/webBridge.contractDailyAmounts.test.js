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

test('two days sharing an edited date keep separate products and subtotals in the document', () => {
  const fixture = dailyAmountsFixture();
  fixture.contract.pricingPlan = { mode: 'daily_schedule', scheduleDays: [
    { id: 'd1', label: 'Dia 1', date: '2026-11-25' },
    { id: 'd9', label: 'Dia 9', date: '2026-11-25' },
  ] };
  fixture.contract.items = [
    { itemId: 'a', itemName: 'MESA', quantity: 1, lineTotalBs: 55, serviceDayId: 'd1', serviceDate: '2026-11-25' },
    { itemId: 'b', itemName: 'SILLA', quantity: 1, lineTotalBs: 20, serviceDayId: 'd9', serviceDate: '2026-11-25' },
  ];
  const html = buildContractDocumentHtml(fixture).replace(/\s|&nbsp;/g, '');
  assert.match(html, /<span>Dia1<\/span><strong>Bs55[.,]00/);
  assert.match(html, /<span>Dia9<\/span><strong>Bs20[.,]00/);
  assert.equal([...html.matchAll(/class="rc-duration-day-row"/g)].length, 2);
});

export const dailyServicesFixture = () => {
  const fixture = dailyAmountsFixture();
  fixture.contract.pricingPlan = { mode: 'daily_schedule', scheduleDays: Array.from({ length: 12 }, (_, index) => ({ id: `d${index + 1}`, label: `Dia ${index + 1}`, date: `2026-12-${String(index + 1).padStart(2, '0')}` })) };
  fixture.contract.items = fixture.contract.pricingPlan.scheduleDays.flatMap(day => [
    { itemId: 'mesa', itemName: 'MESA COCTELERA', quantity: 4, unitPriceBs: 60, lineTotalBs: 240, serviceDayId: day.id },
    { itemId: 'silla', itemName: 'SILLA COCTELERA', quantity: 3, unitPriceBs: 20, lineTotalBs: 60, serviceDayId: day.id },
  ]);
  fixture.contract.services = fixture.contract.pricingPlan.scheduleDays.map(day => ({ id: `transport-${day.id}`, name: 'TRANSPORTE', detail: `Transporte exclusivo ${day.id}`, quantity: 1, unitPriceBs: 60, serviceDayId: day.id, serviceDate: day.date }));
  fixture.contract.totals = { itemsSubtotalBs: 3600, servicesSubtotalBs: 720, subtotalBs: 4320, totalBs: 4320 };
  return fixture;
};

test('daily transports appear once inside their day and contribute to both daily summaries', () => {
  for (const documentKind of ['quote', 'contract']) {
    const html = buildContractDocumentHtml({ ...dailyServicesFixture(), documentKind });
    const table = html.match(/<table class="rc-table">([\s\S]*?)<\/table>/)[1];
    const groups = table.split('class="rc-duration-day-row"').slice(1);
    assert.equal(groups.length, 12);
    groups.forEach((group, index) => {
      assert.ok(group.includes(`Transporte exclusivo d${index + 1}<`));
      assert.equal([...group.matchAll(/SERVICIO: TRANSPORTE/g)].length, 1);
      assert.match(group, /Subtotal Bs\s*360[.,]00/);
    });
    assert.equal([...html.matchAll(/SERVICIO: TRANSPORTE/g)].length, 12);
    assert.equal([...html.matchAll(/<span>Dia \d+<\/span><strong>Bs\s*360[.,]00/g)].length, 12);
    assert.match(html, /4[.,]320[.,]00/);
  }
});

test('service-only days print and unassigned services remain outside daily subtotals', () => {
  const fixture = dailyServicesFixture();
  fixture.contract.items = [];
  fixture.contract.services.push({ name: 'SERVICIO GENERAL', quantity: 1, unitPriceBs: 10 });
  const html = buildContractDocumentHtml(fixture);
  assert.equal([...html.matchAll(/class="rc-duration-day-row"/g)].length, 12);
  assert.equal([...html.matchAll(/SERVICIO: SERVICIO GENERAL/g)].length, 1);
  assert.equal([...html.matchAll(/<span>Dia \d+<\/span><strong>Bs\s*60[.,]00/g)].length, 12);
});
