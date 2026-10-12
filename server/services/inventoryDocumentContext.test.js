import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverInventoryDocumentRental } from './inventoryDocumentContext.js';
test('recovers inventory document lines from the full linked contract without changing storage', () => {
  const rental = {id:'r',contractId:'c',_summaryOnly:true,operational:{inventoryStatus:'pendiente'}};
  const contract = {id:'c',rentalId:'r',items:[{itemId:'i',itemName:'Vaso',quantity:12}],services:[]};
  const before = structuredClone(rental);
  const result = recoverInventoryDocumentRental(rental,contract);
  assert.equal(result._summaryOnly,false);
  assert.equal(result.items[0].quantity,12);
  assert.equal(result.items[0].name,'Vaso');
  assert.deepEqual(rental,before);
  assert.deepEqual(result.operational,rental.operational);
});
test('does not accept missing lines, partial contracts or another contract', () => {
  const rental = {id:'r',contractId:'c',_summaryOnly:true};
  for (const contract of [null,{id:'c',rentalId:'r',items:[]},{id:'c',rentalId:'r',_summaryOnly:true,items:[{itemId:'i',itemName:'Vaso',quantity:1}]},{id:'other',rentalId:'r',items:[{itemId:'i',itemName:'Vaso',quantity:1}]}]) {
    assert.equal(recoverInventoryDocumentRental(rental,contract),rental);
  }
});
