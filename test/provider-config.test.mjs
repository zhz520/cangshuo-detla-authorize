import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { SmsService } from '../server/sms.mjs'
import { createAuthorityServer } from '../server/http.mjs'
import { providerEndpoint,publicAddress } from '../server/identity-provider-settings.mjs'

test('external identity endpoints must use a public TLS destination', ()=>{
  for(const url of ['http://provider.example.org','https://127.0.0.1','https://metadata.internal/v1','https://192.168.1.1','https://provider.example.org/v1?token=test','https://provider.example.org:8080/v1']) assert.throws(()=>providerEndpoint(url))
  assert.equal(providerEndpoint('https://provider.example.org/v1'), 'https://provider.example.org/v1')
  for(const ip of ['0.0.0.0','10.0.1.1','127.0.0.1','169.254.169.254','192.168.0.1','100.64.1.1']) assert.equal(publicAddress(ip,4),false)
  for(const ip of ['::1','::ffff:127.0.0.1','fd00::1','2001:db8::1','2002::1']) assert.equal(publicAddress(ip,6),false)
})

test('saved provider and receipt credentials are encrypted, redacted and require an administrator', async ()=>{
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'provider-test-password'})
  const sms=new SmsService(store,{masterKey:randomBytes(32).toString('base64')})
  const server=createAuthorityServer(store,{sms})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+server.address().port
  const token=randomBytes(32).toString('hex'), receiptKey=randomBytes(32).toString('hex')
  const payload={enabled:true,url:'https://provider.example.org/verify',token}
  const send=(path,body,headers={})=>fetch(base+path,{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
  try {
    assert.equal((await send('/api/usage/provider',payload)).status,401)
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'provider-test-password'})})
    assert.equal(login.status,200)
    const cookie=login.headers.get('set-cookie').split(';')[0]
    const {csrf}=await login.json()
    assert.equal((await send('/api/usage/provider',payload,{cookie})).status,403)
    const headers={cookie,'x-csrf-token':csrf}
    const provider=await send('/api/usage/provider',payload,headers)
    assert.equal(provider.status,200)
    assert.deepEqual(await provider.json(),{url:payload.url,enabled:true,hasToken:true,configured:true})
    assert.equal((await send('/api/usage/provider',{...payload,url:'https://other.example.org/verify',token:''},headers)).status,400)
    const s=await send('/api/sms/settings',{enabled:true,accessKeyId:'fake-id',accessKeySecret:'fake-secret',defaultSignName:'测试',receiptKey},headers)
    assert.equal(s.status,200)
    assert.equal((await s.json()).receiptConfigured,true)
    const fresh=await fetch(base+'/api/sms/settings',{headers:{cookie}})
    assert.doesNotMatch(await fresh.text(),new RegExp(receiptKey+'|fake-secret'))
    assert.notEqual(store.db.prepare('SELECT token_cipher FROM identity_provider_settings').get().token_cipher,token)
    assert.notEqual(store.db.prepare('SELECT receipt_secret_cipher FROM sms_provider_settings').get().receipt_secret_cipher,receiptKey)
  } finally { await new Promise(resolve=>server.close(resolve));store.close() }
})
