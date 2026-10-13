import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveApiUrl} from './api.ts';

test('dev supports the local Vite proxy',()=>{
 assert.equal(resolveApiUrl(undefined,'dev'),'/api');
 assert.equal(resolveApiUrl('http://127.0.0.1:8000','dev'),'http://127.0.0.1:8000');
});
test('prod requires an explicit HTTPS API address',()=>{
 assert.equal(resolveApiUrl('https://api.example.com/','prod'),'https://api.example.com');
 for(const url of [undefined,'/api','http://api.example.com','https://localhost','https://127.0.0.1','https://[::1]','https://api.example.com?token=secret','https://api.example.com#fragment'])
   assert.throws(()=>resolveApiUrl(url,'prod'),/APP_ENV=prod/);
});
