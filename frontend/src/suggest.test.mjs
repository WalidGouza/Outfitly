import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestFor} from './suggest.ts';

const p=(id,category,color,texture,style,garment,name)=>({id,category,color,texture,style,garment,name:name??`${id}`});
// A streetwear outfit with one piece pulling the wrong way (Evening heels).
const hoodie=p('h','tops','#555555','cotton','Streetwear','hoodie','Grey hoodie');
const joggers=p('j','pants','#191919','cotton','Streetwear','joggers','Black joggers');
const heels=p('s','shoes','#C8232D','leather','Evening','heels','Red heels');

test('the weakest piece gets a better replacement, with points and a reason',()=>{
 const [first]=suggestFor([hoodie,joggers,heels],'Streetwear',[hoodie,joggers,heels]);
 assert.ok(first,'expected a suggestion');
 assert.equal(first.replaces?.id,'s');
 assert.equal(first.spec.category,'shoes');
 assert.ok(['sneakers','boots'].includes(first.spec.garment), first.spec.garment);
 assert.ok(first.gain>=2);
 assert.ok(first.reason.length>10);
 assert.match(first.query,/^[a-z ]+$/);
});
test('suggestions fit the style, and men are not offered women-only pieces',()=>{
 const all=suggestFor([hoodie,joggers,heels],'Streetwear',[],'men',10);
 assert.ok(all.every(s=>!['heels','crop top','mini skirt','cropped jacket'].includes(s.spec.garment)));
 assert.ok(all.every(s=>s.spec.style==='Streetwear'));
});
test('an outfit without a layer can be offered one, and nothing already owned is suggested',()=>{
 const sneakers=p('k','shoes','#F5F5F5','leather','Streetwear','sneakers','White sneakers');
 const all=suggestFor([hoodie,joggers,heels],'Streetwear',[hoodie,joggers,heels,sneakers],'both',10);
 assert.ok(!all.some(s=>s.spec.garment==='sneakers'&&s.spec.colorName==='White'));
 assert.ok(all.every(s=>s.replaces||s.spec.category==='jackets'));
});
test('a strong outfit gets no suggestions just for the sake of it',()=>{
 const tee=p('t','tops','#F5F5F5','cotton','Streetwear','t-shirt'), jeans=p('d','pants','#2D5ABE','denim','Streetwear','jeans'), kicks=p('k','shoes','#F5F5F5','leather','Streetwear','sneakers');
 const jacket=p('c','jackets','#191919','denim','Streetwear','jacket');
 const all=suggestFor([jacket,tee,jeans,kicks],'Streetwear',[]);
 assert.ok(all.every(s=>s.gain>=2));
});
