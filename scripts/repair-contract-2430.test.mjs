import test from 'node:test';
import assert from 'node:assert/strict';
import {repairContract2430} from './repair-contract-2430.mjs';
const fixture=()=>({
  "contracts": [
    {
      "id": "703612f0-454a-45d6-abf7-d4f710432c4c",
      "contractCode": "2430",
      "rentalId": "844390d8-f176-4d5a-9f40-17d9291572c3",
      "orderCode": "OS-01079",
      "economicLedger": [
        {
          "id": "eco-1788784678413-cf5b54fef7493",
          "type": "deposit",
          "amountBs": 100,
          "cashReceiptCode": "RC-12637",
          "cashMovementId": "mov-7f1fdbac-8ae8-49f0-81f5-9e958900ddb2",
          "createdAt": "2026-09-05T12:37:58.000Z",
          "contractAllocationBs": 50,
          "guaranteeAllocationBs": 50
        },
        {
          "id": "eco-1788784680915-95b4523d9e7e2",
          "type": "guarantee",
          "amountBs": 50,
          "cashReceiptCode": "",
          "cashMovementId": null,
          "createdAt": "2026-09-05T12:37:58.000Z",
          "contractAllocationBs": 0,
          "guaranteeAllocationBs": 0
        }
      ]
    }
  ],
  "cashMovements": [
    {
      "id": "mov-7f1fdbac-8ae8-49f0-81f5-9e958900ddb2",
      "receiptCode": "RC-12637",
      "amountBs": 100,
      "linkedContractId": "703612f0-454a-45d6-abf7-d4f710432c4c",
      "accountingTag": "contract_deposit_receipt",
      "receiptStatus": "anulado",
      "voidedAt": "2026-09-07T20:20:55.529Z",
      "voidReason": "Anulado por cobro duplicado del contrato 2430",
      "createdAt": "2026-09-05T12:37:58.000Z",
      "cashEffectiveDate": "2026-09-05",
      "cashLedgerSequence": 2432
    },
    {
      "id": "53a0c179-4913-4573-a7cf-c1d1670e6673",
      "receiptCode": "RC-12787",
      "amountBs": 50,
      "linkedContractId": "703612f0-454a-45d6-abf7-d4f710432c4c",
      "accountingTag": "initial_rental_payment",
      "receiptStatus": "",
      "voidedAt": null,
      "voidReason": "",
      "createdAt": "2026-09-07T12:37:17.891Z",
      "cashEffectiveDate": "2026-09-07",
      "cashLedgerSequence": 2551
    },
    {
      "id": "53fc7251-acc5-4891-9bbe-6b453593089f",
      "receiptCode": "RC-12788",
      "amountBs": 50,
      "linkedContractId": "703612f0-454a-45d6-abf7-d4f710432c4c",
      "accountingTag": "validated_guarantee",
      "receiptStatus": "",
      "voidedAt": null,
      "voidReason": "",
      "createdAt": "2026-09-07T12:37:17.891Z",
      "cashEffectiveDate": "2026-09-07",
      "cashLedgerSequence": 2552
    }
  ]
});
test('2430 repairs dates and explicit links without changing sums, refund or voided original',()=>{
 const s=fixture();const original=structuredClone(s.cashMovements[0]);const ledger=structuredClone(s.contracts[0].economicLedger);
 s.cashMovements.push({id:'refund',linkedContractId:s.contracts[0].id,amountBs:50,type:'egreso',createdAt:'2026-10-04T20:47:00Z'});
 const refund=structuredClone(s.cashMovements[3]);repairContract2430(s);
 assert.deepEqual(s.cashMovements[0],original);assert.deepEqual(s.cashMovements[3],refund);assert.deepEqual(s.contracts[0].economicLedger,ledger);
 for(const m of s.cashMovements.slice(1,3)){assert.equal(m.cashEffectiveDate,'2026-09-05');assert.equal(m.amountBs,50);assert.equal(m.replacementOfMovementId,original.id);}
 assert.equal(s.cashMovements[1].cashLedgerSequence,2551);
 const after=structuredClone(s);assert.equal(repairContract2430(s).status,'already_applied');assert.deepEqual(s,after);
});
test('2430 refuses changed receipts or deposit before mutating',()=>{
 for(const change of [s=>{s.cashMovements[1].amountBs=60;},s=>{s.contracts[0].economicLedger[0].createdAt='2026-09-06';}]) {
 const s=fixture();change(s);const before=structuredClone(s);assert.throws(()=>repairContract2430(s),/Sin cambios:/);assert.deepEqual(s,before);
 }
});
