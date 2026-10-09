import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidateContract2430} from './consolidate-contract-2430-receipt.mjs';
const fixture=()=>({
  "contracts": [
    {
      "id": "703612f0-454a-45d6-abf7-d4f710432c4c",
      "contractCode": "2430",
      "economicLedger": [
        {
          "id": "eco-1788784678413-cf5b54fef7493",
          "type": "deposit",
          "amountBs": 100,
          "contractAllocationBs": 50,
          "guaranteeAllocationBs": 50,
          "cashReceiptCode": "RC-12637",
          "cashMovementId": "mov-7f1fdbac-8ae8-49f0-81f5-9e958900ddb2",
          "createdAt": "2026-09-05T12:37:58.000Z"
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
      "receiptStatus": "anulado",
      "voidedAt": "2026-09-07T20:20:55.529Z",
      "voidReason": "Anulado por cobro duplicado del contrato 2430",
      "contractAllocationBs": 50,
      "guaranteeAllocationBs": 50,
      "replacementOfMovementId": null,
      "accountingTag": "contract_deposit_receipt"
    },
    {
      "id": "53a0c179-4913-4573-a7cf-c1d1670e6673",
      "receiptCode": "RC-12787",
      "amountBs": 50,
      "linkedContractId": "703612f0-454a-45d6-abf7-d4f710432c4c",
      "receiptStatus": "",
      "voidedAt": null,
      "voidReason": "",
      "contractAllocationBs": 0,
      "guaranteeAllocationBs": 0,
      "replacementOfMovementId": "mov-7f1fdbac-8ae8-49f0-81f5-9e958900ddb2",
      "accountingTag": "initial_rental_payment"
    },
    {
      "id": "53fc7251-acc5-4891-9bbe-6b453593089f",
      "receiptCode": "RC-12788",
      "amountBs": 50,
      "linkedContractId": "703612f0-454a-45d6-abf7-d4f710432c4c",
      "receiptStatus": "",
      "voidedAt": null,
      "voidReason": "",
      "contractAllocationBs": 0,
      "guaranteeAllocationBs": 0,
      "replacementOfMovementId": "mov-7f1fdbac-8ae8-49f0-81f5-9e958900ddb2",
      "accountingTag": "validated_guarantee"
    }
  ]
});
test('one receipt for the same 100 received, with 50 commercial and 50 guarantee, preserving refund and ledger',()=>{
 const s=fixture();s.cashMovements.push({id:'refund',amountBs:-50,accountingTag:'guarantee_refund'});
 const refund=structuredClone(s.cashMovements[3]);const ledger=structuredClone(s.contracts[0].economicLedger);
 consolidateContract2430(s);
 const active=s.cashMovements.filter(m=>!m.voidedAt&&m.receiptStatus!=='anulado');
 assert.equal(active.length,2);assert.equal(active.reduce((sum,m)=>sum+m.amountBs,0),50);
 assert.equal(active[0].receiptCode,'RC-12637');assert.equal(active[0].contractAllocationBs,50);assert.equal(active[0].guaranteeAllocationBs,50);
 assert.deepEqual(s.cashMovements[3],refund);assert.deepEqual(s.contracts[0].economicLedger,ledger);
 const after=structuredClone(s);assert.equal(consolidateContract2430(s).status,'already_applied');assert.deepEqual(s,after);
});
test('changed receipt aborts without changes',()=>{const s=fixture();s.cashMovements[1].amountBs=60;const before=structuredClone(s);assert.throws(()=>consolidateContract2430(s),/Sin cambios:/);assert.deepEqual(s,before);});
