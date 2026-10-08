import assert from 'node:assert/strict';
import test from 'node:test';
import { repairContract2863 } from './repair-contract-2863.mjs';
import { getCashEffectiveDate } from '../src/utils/cashLedgerOrder.js';
const fixture = () => ({
  "contracts": [
    {
      "id": "ad541fe2-a135-4b2c-9263-08d231188bca",
      "contractCode": "2863",
      "rentalId": "19f5865c-7fb8-4a80-970f-da51197d2618",
      "orderCode": "OS-01507",
      "payment": {
        "paidAtApprovalBs": 235,
        "pendingBs": 207.8,
        "overpaidBs": 0,
        "prepaidAppliedBs": 0,
        "initialPaymentMethod": "efectivo",
        "initialPaymentAccount": "",
        "guaranteeStatus": "no_validado",
        "guaranteePaymentMethod": "efectivo",
        "guaranteePaymentAccount": ""
      },
      "economicLedger": [
        {
          "id": "eco-1790915260501-8d90691f71256",
          "type": "deposit",
          "amountBs": 235,
          "cashMovementId": "mov-f0548080-ded4-4cf0-9038-71486d4dbe4a",
          "cashReceiptCode": "RC-13498"
        }
      ],
      "revisionHistory": [
        {
          "updatedAt": "2026-10-02T14:26:58.372Z",
          "changes": [
            "MANTEL ARRUGADO / AZUL MARINO: 15 -> 16",
            "CAMINITO ENGOMADO MARFÍL A RAYAS: 10 -> 11"
          ]
        }
      ]
    }
  ],
  "cashMovements": [
    {
      "id": "mov-f0548080-ded4-4cf0-9038-71486d4dbe4a",
      "receiptCode": "RC-13498",
      "amountBs": 235,
      "linkedContractId": "ad541fe2-a135-4b2c-9263-08d231188bca",
      "accountingTag": "contract_deposit_receipt",
      "paymentMethod": "qr",
      "paymentAccount": "MERCANTIL",
      "receiptIssuedAt": "2026-10-01T04:27:40.000Z",
      "createdAt": "2026-10-01T04:27:40.000Z",
      "cashEffectiveDate": "2026-10-01",
      "notes": "PRIMER PAGO"
    },
    {
      "id": "cf9435d0-6f22-40df-9b7b-293f50c63b73",
      "receiptCode": "RC-13519",
      "amountBs": 235,
      "linkedContractId": "ad541fe2-a135-4b2c-9263-08d231188bca",
      "accountingTag": "initial_rental_payment",
      "paymentMethod": "efectivo",
      "paymentAccount": "",
      "receiptIssuedAt": null,
      "createdAt": "2026-10-02T14:26:58.372Z",
      "cashEffectiveDate": "2026-10-02",
      "notes": "Pago inicial registrado desde contrato 2863"
    }
  ]
});

test('2863: preserve Oct 1 QR deposit, void only Oct 2 duplicate, and remain idempotent', () => {
  const s=fixture();
  s.cashMovements.push({id:'foreign',linkedContractId:'another',amountBs:235});
  const original=structuredClone(s.cashMovements[0]);
  const ledger=structuredClone(s.contracts[0].economicLedger);
  const payment=structuredClone(s.contracts[0].payment);
  const result=repairContract2863(s,'2026-10-08T16:00:00Z');
  assert.equal(result.voidedReceipt,'RC-13519');
  assert.deepEqual(s.cashMovements[0],original);
  assert.deepEqual(s.contracts[0].economicLedger,ledger);
  assert.deepEqual(s.contracts[0].payment,payment);
  assert.equal(s.cashMovements[1].receiptStatus,'anulado');
  assert.equal(s.cashMovements[2].voidedAt,undefined);
  const active=s.cashMovements.filter(m=>m.linkedContractId===s.contracts[0].id&&!m.voidedAt);
  assert.equal(active.filter(m=>getCashEffectiveDate(m)==='2026-10-01').reduce((a,m)=>a+m.amountBs,0),235);
  assert.equal(active.filter(m=>getCashEffectiveDate(m)==='2026-10-02').length,0);
  const after=structuredClone(s);
  assert.equal(repairContract2863(s).status,'already_applied');
  assert.deepEqual(s,after);
});

test('2863: changed evidence aborts before writing', () => {
  for (const change of [s=>{s.cashMovements[0].amountBs=240;},s=>{s.cashMovements[1].notes='Cobro real';},
    s=>{s.contracts[0].economicLedger.push({type:'deposit',amountBs:235,cashMovementId:s.cashMovements[1].id});},
    s=>{s.cashMovements.push({id:'new',linkedContractId:s.contracts[0].id,amountBs:5});}]) {
    const s=fixture();change(s);const before=structuredClone(s);
    assert.throws(()=>repairContract2863(s),/Sin cambios:/);assert.deepEqual(s,before);
  }
});
