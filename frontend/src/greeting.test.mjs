import {test} from 'node:test';
import assert from 'node:assert/strict';
import {greeting} from './greeting.ts';

const at=(h,m=0)=>greeting(new Date(2026,9,16,h,m)).title;
test('the greeting follows the time of day, switching right on the hour',()=>{
 assert.equal(at(4,59),'Hello, night owl');assert.equal(at(5),'Good morning');assert.equal(at(11,59),'Good morning');
 assert.equal(at(12),'Good afternoon');assert.equal(at(16,59),'Good afternoon');
 assert.equal(at(17),'Good evening');assert.equal(at(20,59),'Good evening');
 assert.equal(at(21),'Good night');assert.equal(at(22,59),'Good night');
 assert.equal(at(23),'Hello, night owl');assert.equal(at(0),'Hello, night owl');
});
test('every greeting comes with its own line',()=>{
 assert.equal(new Set([5,12,17,21,23].map(h=>greeting(new Date(2026,9,16,h)).sub)).size,5);
});
