import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{useEffect} from 'react';
import {create,act} from 'react-test-renderer';
import {useWardrobeCatalog} from './useWardrobeCatalog.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
function harness(load){
 let latest;const requests=[];
 function Probe({token}){
  const catalog=useWardrobeCatalog(token,load);latest=catalog;
  useEffect(()=>{if(catalog.ready&&catalog.selected){requests.push({token,path:`/wardrobes/${catalog.selected}/clothes`});requests.push({token,path:`/wardrobes/${catalog.selected}/outfits`});}},[token,catalog.ready,catalog.selected]);
  return null;
 }
 return {Probe,requests,get latest(){return latest}};
}
test('sign-in waits for real wardrobe IDs before loading details',async()=>{
 const result=deferred();const h=harness(()=>result.promise);let root;
 await act(async()=>{root=create(React.createElement(h.Probe,{token:''}))});
 assert.equal(h.latest.selected,'demo');
 await act(async()=>root.update(React.createElement(h.Probe,{token:'alice-token'})));
 assert.equal(h.latest.selected,'');assert.equal(h.latest.ready,false);assert.deepEqual(h.requests,[]);
 await act(async()=>result.resolve([{id:'alice-wardrobe',name:'Everyday'}]));
 assert.deepEqual(h.requests.map(r=>r.path),['/wardrobes/alice-wardrobe/clothes','/wardrobes/alice-wardrobe/outfits']);
 await act(async()=>root.unmount());
});
test('restored authenticated sessions do not start with demo data',async()=>{
 const result=deferred();const h=harness(()=>result.promise);let root;
 await act(async()=>{root=create(React.createElement(h.Probe,{token:'restored-token'}))});
 assert.deepEqual(h.latest.wardrobes,[]);assert.equal(h.latest.selected,'');assert.deepEqual(h.requests,[]);
 await act(async()=>result.resolve([{id:'real-id',name:'Work'}]));
 assert.ok(h.requests.every(r=>r.path.includes('/real-id/')));
 await act(async()=>root.unmount());
});
test('new account tokens cannot be paired with previous account wardrobe IDs',async()=>{
 const bob=deferred();const h=harness(token=>token==='alice'?Promise.resolve([{id:'alice-id',name:'A'}]):bob.promise);let root;
 await act(async()=>{root=create(React.createElement(h.Probe,{token:'alice'}))});
 await act(async()=>root.update(React.createElement(h.Probe,{token:'bob'})));
 assert.equal(h.latest.selected,'');assert.equal(h.latest.ready,false);assert.ok(!h.requests.some(r=>r.token==='bob'));
 await act(async()=>bob.resolve([{id:'bob-id',name:'B'}]));
 assert.ok(h.requests.filter(r=>r.token==='bob').every(r=>r.path.includes('/bob-id/')));
 await act(async()=>root.unmount());
});
test('late old-account failures cannot replace current state or errors',async()=>{
 const old=deferred();let oldSignal;
 const h=harness((token,signal)=>{if(token==='old'){oldSignal=signal;return old.promise}return Promise.resolve([{id:'new-id',name:'New'}])});let root;
 await act(async()=>{root=create(React.createElement(h.Probe,{token:'old'}))});
 await act(async()=>root.update(React.createElement(h.Probe,{token:'new'})));
 assert.equal(oldSignal.aborted,true);
 await act(async()=>old.reject(new Error('Wardrobe not found')));
 assert.equal(h.latest.error,'');assert.equal(h.latest.selected,'new-id');
 await act(async()=>root.unmount());
});
test('sign-out ignores a late private catalog response',async()=>{
 const pending=deferred();const h=harness(()=>pending.promise);let root;
 await act(async()=>{root=create(React.createElement(h.Probe,{token:'alice'}))});
 await act(async()=>root.update(React.createElement(h.Probe,{token:''})));
 await act(async()=>pending.resolve([{id:'private-id',name:'Private'}]));
 assert.equal(h.latest.selected,'demo');assert.equal(h.latest.ready,false);assert.deepEqual(h.requests,[]);
 await act(async()=>root.unmount());
});
test('empty and failed catalogs never request wardrobe details',async()=>{
 const h=harness(token=>token==='empty'?Promise.resolve([]):Promise.reject(new Error('Catalog unavailable')));let root;
 await act(async()=>{root=create(React.createElement(h.Probe,{token:'empty'}))});
 assert.equal(h.latest.selected,'');assert.deepEqual(h.requests,[]);
 await act(async()=>root.update(React.createElement(h.Probe,{token:'broken'})));
 assert.equal(h.latest.error,'Catalog unavailable');assert.equal(h.latest.ready,false);assert.deepEqual(h.requests,[]);
 await act(async()=>root.unmount());
});
