import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAttendancePayment, buildAttendancePaymentSlip } from './attendancePaymentSlip.js';

const person = { name: 'FLOR FERRUFINO', minutes: 3802, workedDays: 11, pending: 1, issues: 0 };
const draft = { mode: 'hourly', hourRate: '10', extraHours: '2', extraRate: '15', bonus: '50', advances: '100', discounts: '5', paid: '', position: 'Operativo', representative: 'Representante', date: '2026-11-18', notes: '' };
test('pays exact minutes and separates overtime without counting it twice', () => {
  const totals = calculateAttendancePayment(person, draft);
  assert.equal(totals.regularMinutes, 3682);
  assert.equal(totals.salary, 613.67);
  assert.equal(totals.extras, 30);
  assert.equal(totals.net, 588.67);
  assert.equal(totals.paid, null);
});
test('fixed period salary is explicit and validates payment amounts', () => {
  assert.equal(calculateAttendancePayment(person, { ...draft, mode: 'fixed', salary: '1000' }).net, 975);
  for (const change of [{ hourRate: '' }, { hourRate: '-1' }, { extraHours: '64' }, { paid: '9999' }, { advances: '9999' }, { salary: 'NaN', mode: 'fixed' }]) {
    assert.throws(() => calculateAttendancePayment(person, { ...draft, ...change }));
  }
  assert.throws(() => calculateAttendancePayment(null, draft));
});
test('both copies share the same period, reference and totals; escapes entered text', () => {
  const html = buildAttendancePaymentSlip({ person: { ...person, name: '<script>bad</script>' }, draft, filters: { dateFrom: '2026-11-01', dateTo: '2026-11-18' }, reference: 'BP-TEST' });
  assert.equal((html.match(/class="slip"/g) || []).length, 2);
  assert.equal((html.match(/BP-TEST/g) || []).length, 2);
  assert.ok(html.includes('size:letter'));
  assert.ok(html.includes('COPIA DEL TRABAJADOR') && html.includes('COPIA DE LA EMPRESA'));
  assert.ok(html.includes('01/11/2026 al 18/11/2026'));
  assert.ok(html.includes('63:22 h'));
  assert.equal(html.includes('<script>'), false);
  assert.throws(() => buildAttendancePaymentSlip({ person, draft: { ...draft, representative: '' }, filters: {}, reference: '' }));
});
