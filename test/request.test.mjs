import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, fetchWithTimeout } from '../src/request.js'

test('request deadline includes a stalled response body and retry releases the pending request', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++;return {ok:true,status:200,json:()=>new Promise(()=>{})} })
  const api=createApiClient({getCsrf:()=>'',onUnauthorized:()=>{},timeout:25})
  await assert.rejects(api('/data'),/超时或中断/)
  await assert.rejects(api('/data'),/超时或中断/)
  assert.equal(calls,2)
})

test('concurrent identical writes are coalesced and retain same-origin credentials and CSRF', async t => {
  let calls=0,complete
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.equal(url,'/api/customers');assert.equal(options.credentials,'same-origin');assert.equal(options.headers['X-CSRF-Token'],'csrf-test')
    assert.deepEqual(JSON.parse(options.body),{id:'demo'})
    return new Promise(resolve=>complete=()=>resolve(new Response('{"id":"demo"}')))
  })
  const api=createApiClient({getCsrf:()=>'csrf-test',onUnauthorized:()=>{}})
  const first=api('/customers',{method:'POST',body:{id:'demo'}}),second=api('/customers',{method:'POST',body:{id:'demo'}})
  assert.equal(first,second);assert.equal(calls,1);complete();assert.deepEqual(await first,{id:'demo'})
})

test('unauthorized responses clear the session even when an intermediary returns HTML', async t => {
  let cleared=0
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>Unauthorized</html>',{status:401}))
  const api=createApiClient({getCsrf:()=>'',onUnauthorized:()=>cleared++})
  await assert.rejects(api('/data'),/服务返回异常/);assert.equal(cleared,1)
  await assert.rejects(api('/login',{method:'POST',body:{}}));assert.equal(cleared,1)
})

test('external cancellation still aborts the underlying fetch', async t => {
  const controller=new AbortController()
  let signal
  t.mock.method(globalThis,'fetch',async(url,options)=>{signal=options.signal;return new Promise(()=>{})})
  const result=fetchWithTimeout('/api/data',{signal:controller.signal},1000)
  controller.abort();await assert.rejects(result,{name:'AbortError'});assert.equal(signal.aborted,true)
})

test('late responses from an old session cannot clear or populate a newer session', async t => {
  let session=0,clear=0,complete
  t.mock.method(globalThis,'fetch',async()=>new Promise(resolve=>complete=resolve))
  const api=createApiClient({getCsrf:()=>'',getSessionVersion:()=>session,onUnauthorized:()=>clear++})
  const first=api('/data');session++;complete(new Response('{}',{status:401}))
  await assert.rejects(first,{name:'StaleSessionError'});assert.equal(clear,0)
  const second=api('/data');session++;complete(new Response('{"private":"old-session"}'))
  await assert.rejects(second,{name:'StaleSessionError'});assert.equal(clear,0)
})
