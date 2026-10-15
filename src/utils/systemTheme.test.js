import test from 'node:test';
import assert from 'node:assert/strict';
import {darkColor,themedDeclaration,readTheme,compileDarkRules} from './systemTheme.js';
test('keeps light as default and tolerates blocked storage',()=>{
 assert.equal(readTheme({getItem:()=>null}),'light');assert.equal(readTheme({getItem:()=> 'dark'}),'dark');assert.equal(readTheme({getItem:()=>{throw Error();}}),'light');
});
test('adapts surfaces, text and borders independently without recoloring images',()=>{
 assert.notEqual(darkColor('#ffffff','background'),'#ffffff');assert.equal(darkColor('#ffffff','foreground'),'#ffffff');
 assert.notEqual(darkColor('#102e57','foreground'),'#102e57');assert.notEqual(darkColor('#00e5ff','background'),'#00e5ff');
 assert.equal(themedDeclaration('background-image','url(photo.jpg)'),null);
 assert.ok(themedDeclaration('background-color','rgba(255,255,255,0.9)').endsWith(',0.9)'));
});
test('scopes legacy selectors and responsive rules without modifying print rules',()=>{
 const style={*[Symbol.iterator](){yield 'color';},getPropertyValue:()=> '#102e57',getPropertyPriority:()=>''};
 const css=compileDarkRules([{selectorText:'.card:is(.a,.b),.modal::before',style},{conditionText:'print',cssRules:[{selectorText:'body',style}],cssText:'@media print {}'}]);
 assert.ok(css.includes('html[data-theme="dark"] .card:is(.a,.b),html[data-theme="dark"] .modal::before'));
 assert.ok(!css.includes('@media print'));
});
test('legacy text variables and important declarations retain priority in the dark palette',()=>{
 const style={*[Symbol.iterator](){yield 'color';},getPropertyValue:()=> 'var(--copetin-spec-text)',getPropertyPriority:()=> 'important'};
 const css=compileDarkRules([{selectorText:'body',style}],()=> '#1f1f1f');
 assert.ok(css.includes('!important'));assert.ok(!css.includes('var(--copetin-spec-text)'));assert.ok(!css.includes('color:#1f1f1f'));
});
