import test from 'node:test';
import assert from 'node:assert/strict';
import { findScheduleDayForLine, updateDraftScheduleDay } from './scheduleDayAssignment.js';

test('editing twelve quoted days preserves each item and service even on colliding dates', () => {
  const scheduleDays = Array.from({ length: 12 }, (_, index) => ({ id: `day-${index}`, label: `Dia ${index + 1}`, date: `2026-11-${String(20 + index).padStart(2, '0')}` }));
  const items = scheduleDays.flatMap(day => Array.from({ length: 5 }, (_, index) => ({ lineKey: `${day.id}-${index}`, itemId: `item-${index}`, serviceDayId: day.id, serviceDate: day.date, quantity: index + 1, unitPriceBs: 20 })));
  const services = scheduleDays.map(day => ({ id: `service-${day.id}`, serviceDayId: day.id, serviceDate: day.date, amountBs: 50 }));
  let draft = { scheduleDays, items, services };
  for (const day of scheduleDays) draft = updateDraftScheduleDay(draft, day.id, { ...day, date: '2026-11-28' });
  assert.equal(draft.items.length, 60);
  assert.equal(draft.services.length, 12);
  for (const day of scheduleDays) {
    assert.equal(draft.items.filter(line => findScheduleDayForLine(line, draft.scheduleDays).id === day.id).length, 5);
    assert.equal(draft.services.filter(line => findScheduleDayForLine(line, draft.scheduleDays).id === day.id).length, 1);
  }
  assert.deepEqual(draft.items.map(({ serviceDate, serviceDayLabel, ...line }) => { void serviceDate; void serviceDayLabel; return line; }), items.map(({ serviceDate, ...line }) => { void serviceDate; return line; }));
  assert.ok(draft.items.every(line => line.serviceDate === '2026-11-28'));
  assert.equal(items[0].serviceDate, '2026-11-20');
  // A stale date must never reassign a line with a valid day ID.
  assert.equal(findScheduleDayForLine({ serviceDayId: 'day-8', serviceDate: '2026-11-20' }, scheduleDays).id, 'day-8');
  assert.equal(findScheduleDayForLine({ serviceDate: '2026-11-20' }, scheduleDays).id, 'day-0');
});
