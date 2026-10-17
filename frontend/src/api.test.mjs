import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveApiUrl, requestJson} from './api.ts';
import {validTheme,resolvedTheme} from './theme.ts';
test('local proxy defaults and trailing slash normalization',()=>{
 assert.equal(resolveApiUrl(),'/api');assert.equal(resolveApiUrl('http://localhost:8000/'),'http://localhost:8000');
});
test('Supabase project URLs cannot masquerade as FastAPI',()=>{
 assert.throws(()=>resolveApiUrl('https://project.supabase.co'),/FastAPI/);
 assert.throws(()=>resolveApiUrl('postgresql://user:secret@db.example.com/app'),/HTTP/);
 assert.throws(()=>resolveApiUrl('https://user:secret@example.com'),/credentials/);
});
test('transport failure explains backend, CORS, and HTTPS checks',async()=>{
 await assert.rejects(()=>requestJson('/api/auth/register',{},async()=>{throw new TypeError('Failed to fetch')}),/Cannot reach the Python API/);
});
test('non-JSON proxy failures do not become JSON parse errors',async()=>{
 await assert.rejects(()=>requestJson('/api/auth/register',{},async()=>new Response('',{status:502})),/proxy could not reach FastAPI/);
});
test('API errors and validation details are preserved',async()=>{
 await assert.rejects(()=>requestJson('/api/auth/register',{},async()=>Response.json({detail:'Email already registered'},{status:409})),/Email already registered/);
 await assert.rejects(()=>requestJson('/api/auth/register',{},async()=>Response.json({detail:[{loc:['body','password'],msg:'Too short'}]},{status:422})),/password: Too short/);
 assert.deepEqual(await requestJson('/api/auth/register',{},async()=>Response.json({token:'sample'})),{token:'sample'});
});
test('theme preference and OS fallback',()=>{
 assert.equal(validTheme('garbage'),'system');assert.equal(validTheme('dark'),'dark');
 assert.equal(resolvedTheme('system',true),'dark');assert.equal(resolvedTheme('system',false),'light');
 assert.equal(resolvedTheme('light',true),'light');assert.equal(resolvedTheme('dark',false),'dark');
});
test('cancelled requests preserve abort errors instead of connectivity messages',async()=>{
 const controller=new AbortController();controller.abort();
 const cancellation=new DOMException('Request cancelled','AbortError');
 await assert.rejects(()=>requestJson('/api/wardrobes/demo/clothes',{signal:controller.signal},async()=>{throw cancellation}),error=>error===cancellation);
});
test('production errors are friendly and never name the API, its host or settings',async()=>{
 const technical=/API|FastAPI|VITE_|FRONTEND_ORIGINS|proxy|Supabase|localhost|http|500|502/i;
 const prod=(t)=>requestJson('https://api.example.com/wardrobes',{},t,'prod');
 const cases=[
  async()=>{throw new TypeError('Failed to fetch')},
  async()=>new Response('<html>Bad gateway</html>',{status:502}),
  async()=>new Response('Traceback (most recent call last)',{status:500}),
  async()=>Response.json({detail:[{loc:['body','password'],msg:'String should have at least 10 characters'}]},{status:422}),
  async()=>Response.json({},{status:500}),
 ];
 for(const transport of cases) await assert.rejects(()=>prod(transport),e=>{assert.doesNotMatch(e.message,technical,e.message);return true;});
 // Messages the backend already wrote for users pass through unchanged.
 await assert.rejects(()=>prod(async()=>Response.json({detail:'Email or password incorrect'},{status:401})),/Email or password incorrect/);
});
test('development errors keep the setup details',async()=>{
 await assert.rejects(()=>requestJson('/api/wardrobes',{},async()=>{throw new TypeError('x')},'dev'),/FastAPI/);
 await assert.rejects(()=>requestJson('/api/wardrobes',{},async()=>new Response('Traceback (most recent call last)',{status:500}),'dev'),/backend terminal/);
});
