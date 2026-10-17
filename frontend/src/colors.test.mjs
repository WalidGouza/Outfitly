import {test} from 'node:test';
import assert from 'node:assert/strict';
import {colorName,colorChoices,verdict,ringDash,colorScore,textureScore,scoreLook,affinity} from './colors.ts';

test('every swatch gets the same name the backend gives it',()=>{
 assert.equal(colorName('#27324A'),'Navy');assert.equal(colorName('#6b6a43'),'Olive');
 assert.equal(colorName('#fbf9f4'),'White');assert.equal(colorName('not a colour'),'Grey');
});
test('colour choices start with the detected colour and never repeat a name',()=>{
 const list=colorChoices('#27324a');
 assert.equal(list[0].name,'Navy');assert.equal(list[0].hex,'#27324a');assert.equal(list.length,5);
 assert.equal(new Set(list.map(c=>c.name)).size,5);
});
test('verdicts and the score ring',()=>{
 assert.equal(verdict(93),'Excellent match');assert.equal(verdict(85),'Strong match');assert.equal(verdict(84),'Good match');
 assert.equal(ringDash(100),'169.6 200');assert.equal(ringDash(0),'0.0 200');assert.equal(ringDash(140),'169.6 200');
});
test('sample scoring follows the backend rules',()=>{
 assert.ok(colorScore('#ff0000','#00ffff')>colorScore('#ff0000','#00ff00'));
 assert.equal(colorScore('#ffffff','#ff0000'),0.9);
 assert.ok(colorScore('#ff0000','#ff0010')>0.9);
 assert.equal(textureScore('denim','cotton'),textureScore('cotton','denim'));
 const look=scoreLook([{color:'#eeeeee',texture:'cotton',style:'Everyday'},{color:'#2e3a52',texture:'denim',style:'Everyday'},{color:'#7a5235',texture:'leather',style:'Minimal'}],'Everyday');
 assert.ok(look.score>0&&look.score<=100);assert.deepEqual(Object.keys(look.breakdown),['semantic','color','texture']);
});

test('meaning follows the style tags: one style scores high, a far style low',()=>{
 const sw=[{color:'#555555',texture:'cotton',style:'Streetwear'},{color:'#222222',texture:'cotton',style:'Streetwear'},{color:'#eeeeee',texture:'leather',style:'Streetwear'}];
 assert.equal(scoreLook(sw,'Streetwear').breakdown.semantic,100);
 assert.ok(scoreLook(sw,'Evening').breakdown.semantic<40);
 const mixed=[sw[0],{...sw[1],style:'Evening'},{...sw[2],style:'Evening'}];
 assert.ok(scoreLook(mixed,'Streetwear').breakdown.semantic<scoreLook(sw,'Streetwear').breakdown.semantic-25);
 assert.equal(affinity('Evening','Streetwear'),affinity('Streetwear','Evening'));
});
