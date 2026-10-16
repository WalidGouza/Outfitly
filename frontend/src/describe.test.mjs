import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describeOutfit,describePiece} from './describe.ts';

const p=(id,category,color,texture,name,garment=null,style='Everyday')=>({id,category,color,texture,name,garment,style});
const tee=p('t','tops','#EEE7D7','cotton','Cream oxford shirt','shirt');
const chinos=p('c','pants','#1F2A4A','cotton','Navy chinos','chinos');
const loafers=p('l','shoes','#7A5235','leather','Brown suede loafers','loafers');
const red=p('r','tops','#C8232D','cotton','Red tee','t-shirt');
const green=p('g','pants','#2D8746','cotton','Green trousers','trousers');
const purple=p('pu','shoes','#6E3C8C','leather','Purple sneakers','sneakers');

test('an all-neutral outfit is described as calm and the headline follows the score',()=>{
 const d=describeOutfit([tee,chinos,loafers],92,{semantic:90,color:90,texture:80},'Smart casual');
 assert.match(d.headline,/^Excellent match/);
 assert.match(d.notes[0],/all-neutral palette/);
 assert.match(d.notes[2],/reads clearly as smart casual/);
});
test('clashing accents are named, and the best swap from the wardrobe is suggested',()=>{
 const d=describeOutfit([red,green,purple],70,{semantic:70,color:50,texture:70},'Everyday',[red,green,purple,chinos,loafers]);
 assert.match(d.headline,/pulling against it/);
 assert.ok(d.notes.some(n=>/compete for attention/.test(n)), d.notes.join(' | '));
 assert.match(d.tip,/^Try your (navy chinos|brown suede loafers) instead of the/);
});
test('no tip when nothing in the wardrobe would improve it',()=>{
 assert.equal(describeOutfit([tee,chinos,loafers],92,{semantic:90,color:90,texture:80},'Everyday',[tee,chinos,loafers]).tip,null);
});
test('a piece description covers colour, fabric, weather and best matches per category',()=>{
 const d=describePiece(chinos,[tee,red,chinos,loafers,purple]);
 assert.equal(d.summary,'Navy cotton chinos, everyday style.');
 assert.match(d.paragraphs[0],/neutral/);
 assert.match(d.paragraphs[1],/Cotton/);
 assert.deepEqual(d.goesWith.map(x=>x.category),['tops','shoes']);
 assert.match(describePiece(p('k','tops','#9A9C98','knit','Grey jumper','sweater'),[]).paragraphs.at(-1),/warm/);
});
test('the swap tip never pulls an outfit out of its style',()=>{
 const smart=[p('s','tops','#EEE7D7','cotton','Oxford shirt','shirt','Smart casual'),p('c','pants','#1F2A4A','cotton','Navy chinos','chinos','Smart casual'),p('l','shoes','#7A5235','leather','Loafers','loafers','Smart casual')];
 const jeans=p('j','pants','#3E5C8C','denim','Blue jeans','jeans','Everyday');
 const tip=describeOutfit(smart,87,{semantic:90,color:90,texture:75},'Smart casual',[...smart,jeans]).tip;
 assert.ok(tip===null||!/jeans/.test(tip), tip);
});
