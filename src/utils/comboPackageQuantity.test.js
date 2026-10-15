import test from 'node:test';
import assert from 'node:assert/strict';
import {resizeComboPackage} from './comboPackageQuantity.js';
test('main quantity increases and decreases all components and the combo cost',()=>{
 const rows=[{lineKey:'main',comboId:'c',comboLineKey:'group',comboPricingRole:'price',comboQuantity:3,quantity:3,unitPriceBs:20,comboRuleIndex:0},{lineKey:'other',comboId:'c',comboLineKey:'group',comboQuantity:3,quantity:6,comboRuleIndex:1},{lineKey:'separate',comboLineKey:'another',quantity:5}];
 const next=resizeComboPackage(rows,'main',4);
 assert.deepEqual(next.map(r=>r.quantity),[4,8,5]);assert.equal(next[0].lineTotalBs,80);assert.equal(next[1].lineTotalBs,0);assert.equal(next[2],rows[2]);
 const less=resizeComboPackage(next,'main',2);assert.deepEqual(less.map(r=>r.quantity),[2,4,5]);assert.equal(less[0].lineTotalBs,40);
 assert.equal(resizeComboPackage(rows,'other',8),null);
});
test('distributed options conserve slot totals and conditional prices update once',()=>{
 const rows=[{lineKey:'a',comboId:'c',comboLineKey:'g',comboPricingRole:'price',comboQuantity:3,quantity:3,unitPriceBs:10,comboRuleIndex:0},{lineKey:'b',comboLineKey:'g',quantity:1,comboQuantity:3,comboRuleIndex:1},{lineKey:'c',comboLineKey:'g',quantity:2,comboQuantity:3,comboRuleIndex:1}];
 const next=resizeComboPackage(rows,'a',4,()=>8);assert.equal(next[0].lineTotalBs,32);assert.equal(next[1].quantity+next[2].quantity,4);
});
