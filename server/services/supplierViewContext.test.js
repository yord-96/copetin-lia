import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSupplierViewContext} from './supplierViewContext.js';
test('supplier view carries linked contract references and catalog prices without commercial history or images',()=>{
 const state={contracts:[{id:'used',contractCode:'2835',rentalId:'r',items:[{private:'large'}],economicLedger:[{amountBs:999}]},{id:'unrelated',items:[]},{id:'deleted',deletedAt:'today'}],items:[{id:'i',name:'Vaso',category:'Vajilla',rentalPriceBs:5,photo:'large-image-data',stockMovements:[{large:true}]},{id:'removed',deletedAt:'today'}]};
 const result=buildSupplierViewContext(state,[{sourceContractId:'used'},{sourceContractId:'deleted'}]);
 assert.deepEqual(result.contractReferences,[{id:'used',contractCode:'2835',rentalId:'r'}]);
 assert.equal(result.catalogItems.length,1);assert.equal(result.catalogItems[0].rentalPriceBs,5);
 assert.ok(!JSON.stringify(result).includes('large'));assert.ok(!JSON.stringify(result).includes('economicLedger'));
});
