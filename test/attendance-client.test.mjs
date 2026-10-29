import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceClient } from '../public/attendance-client.js';
const token = 'w'.repeat(43);
const reply = (data, status=200) => new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('attendance writer uses fixed routes, no cookies and only explicit role/password at login', async () => {
  const calls=[];
  const client=createAttendanceClient(async(url,options)=>{calls.push({url,options});return reply(url.endsWith('/login')?{token,expiresAt:Date.now()+60000}:{ticket:'t'.repeat(43)});});
  await client.login('Test role password','kurator');
  assert.equal(client.credentials().token,token);
  await client.request('start',{course:'2',monday:'2026-10-26'});
  assert.equal(calls[0].url,'https://tkpst-api.onrender.com/api/admin/attendance/login');
  assert.deepEqual(JSON.parse(calls[0].options.body),{password:'Test role password',role:'kurator'});
  assert.equal(calls[1].options.headers.Authorization,'Bearer '+token);
  assert.equal(calls[1].options.credentials,'omit');assert.equal(calls[1].options.cache,'no-store');
  await assert.rejects(client.request('../users'),/Неизвестный/);
  await client.logout();assert.equal(client.credentials(),null);
});

test('late login and expired writer cannot restore credentials after logout',async()=>{
  let resolve;const client=createAttendanceClient(()=>new Promise(done=>resolve=done));
  const login=client.login('Test role password','starosta');client.clear();resolve(reply({token,expiresAt:Date.now()+60000}));await login;assert.equal(client.credentials(),null);
  client.restore({token,expiresAt:Date.now()-1});assert.equal(client.credentials(),null);
  client.restore({token,expiresAt:Date.now()+60000});assert.equal(client.credentials().token,token);
});
