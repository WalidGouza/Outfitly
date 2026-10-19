import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interleave, localExplore, localLooks, lookKey, suggestFor} from './suggest.ts';

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
 assert.ok(!all.some(s=>s.spec.garment==='sneakers'&&s.spec.color_name==='White'));
 assert.ok(all.every(s=>s.replaces||s.spec.category==='jackets'));
});
test('a strong outfit gets no suggestions just for the sake of it',()=>{
 const tee=p('t','tops','#F5F5F5','cotton','Streetwear','t-shirt'), jeans=p('d','pants','#2D5ABE','denim','Streetwear','jeans'), kicks=p('k','shoes','#F5F5F5','leather','Streetwear','sneakers');
 const jacket=p('c','jackets','#191919','denim','Streetwear','jacket');
 const all=suggestFor([jacket,tee,jeans,kicks],'Streetwear',[]);
 assert.ok(all.every(s=>s.gain>=2));
});
test('the garment type counts: sneakers beat heels in a streetwear outfit of the same colour',async()=>{
 const {scoreLook}=await import('./colors.ts');
 const shoe=(garment)=>p('x','shoes','#F5F5F5','leather','Streetwear',garment);
 const score=(g)=>scoreLook([hoodie,joggers,shoe(g)],'Streetwear').score;
 assert.ok(score('sneakers')>score('loafers'),'sneakers over loafers');
 assert.ok(score('loafers')>score('heels'),'loafers over heels');
});
test('next buys group a piece across outfits and rank what helps most first',async()=>{
 const {localNextBuys}=await import('./suggest.ts');
 const tee=p('t','tops','#F5F5F5','cotton','Streetwear','t-shirt');
 const outfits=[{items:[hoodie,joggers,heels],style:'Streetwear',source:'saved',name:'Mine'},{items:[tee,joggers,heels],style:'Streetwear',source:'generated',name:null}];
 const buys=localNextBuys(outfits,[hoodie,joggers,heels,tee]);
 assert.ok(buys.length>0);
 assert.equal(buys[0].outfits,2);
 assert.ok(buys.every((b,i)=>i===0||b.value<=buys[i-1].value));
 const looks=buys.map(b=>`${b.spec.category}|${b.spec.color_name}|${b.spec.texture}`);
 assert.equal(new Set(looks).size,looks.length,'one garment per colour and fabric');
 assert.ok(buys[0].examples[0].after>buys[0].examples[0].before);
});

const STYLES=['Everyday','Minimal','Smart casual','Streetwear','Evening'];
test('exploration picks are varied, stable for the day and lean away from what the user wears',()=>{
 const wardrobe=[hoodie,joggers,p('x','tops','#191919','cotton','Streetwear','tee')];
 const picks=localExplore(wardrobe,'both',new Set(),'Mon Oct 19 2026',STYLES);
 assert.equal(picks.length,4);
 for(const trait of ['style','category','color_name'])assert.equal(new Set(picks.map(x=>x.spec[trait])).size,4);
 assert.ok(picks.every(x=>x.explore&&x.examples.length===0&&x.key===`${x.spec.category}|${x.spec.garment}|${x.spec.color_name}`));
 assert.ok(picks.filter(x=>x.spec.style!=='Streetwear').length>=3);
 assert.deepEqual(localExplore(wardrobe,'both',new Set(),'Mon Oct 19 2026',STYLES).map(x=>x.key),picks.map(x=>x.key));
 const again=localExplore(wardrobe,'both',new Set(picks.map(x=>x.key)),'Mon Oct 19 2026',STYLES);
 assert.ok(again.every(x=>!picks.some(y=>y.key===x.key)));
});

test('the deck mixes an exploration card in after every three improvements',()=>{
 const b=(k)=>({key:k});
 assert.deepEqual(interleave([b(1),b(2),b(3),b(4),b(5),b(6),b(7)],[b('a'),b('b'),b('c')],3).map(x=>x.key),[1,2,3,'a',4,5,6,'b',7,'c']);
 assert.deepEqual(interleave([],[b('a'),b('b')],3).map(x=>x.key),['a','b']);
});

test('whole outfits: one improved with a swap, and taken further with a second new piece',()=>{
 const looks=localLooks([{items:[hoodie,joggers,heels],style:'Streetwear',source:'saved',name:'Friday'}],[hoodie,joggers,heels]);
 const improved=looks.find(l=>l.kind==='improved');
 assert.ok(improved&&improved.pieces.length===1&&improved.gain===improved.after-improved.before&&improved.gain>=2);
 assert.deepEqual(new Set(improved.cloth_ids),new Set(['h','j','s'].filter(id=>id!==improved.pieces[0].replaces)));
 assert.equal(improved.name,'Friday');
 const further=looks.find(l=>l.kind==='new');
 assert.ok(further&&further.pieces.length===2&&further.pieces.every(p=>p.replaces!=='suggested-1'));
 assert.equal(further.key,lookKey(further.cloth_ids,further.pieces));
});
