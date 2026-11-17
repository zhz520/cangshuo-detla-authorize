import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { AuthorityStore } from '../server/store.mjs'
import { SmsService } from '../server/sms.mjs'
import { createAuthorityServer } from '../server/http.mjs'
import { providerEndpoint,publicAddress,mapTencentResult,tencentAuthorization,aliyunRpcSignature,mapAliyunResult } from '../server/identity-provider-settings.mjs'

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
    assert.deepEqual(await provider.json(),{mode:'CUSTOM',url:payload.url,hasToken:true,secretId:'',hasSecretKey:false,region:'ap-guangzhou',endpoint:payload.url,enabled:true,configured:true})
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

test('Tencent FaceID keys are encrypted and result codes map to billable or rejected outcomes', async ()=>{
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'provider-test-password'})
  const sms=new SmsService(store,{masterKey:randomBytes(32).toString('base64')})
  const server=createAuthorityServer(store,{sms})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+server.address().port
  const send=(path,body,headers={})=>fetch(base+path,{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
  try {
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'provider-test-password'})})
    const cookie=login.headers.get('set-cookie').split(';')[0]
    const {csrf}=await login.json()
    const headers={cookie,'x-csrf-token':csrf}
    const payload={mode:'TENCENT_FACEID',secretId:'AKID-test-secret-id',secretKey:'tencent-secret-key',region:'ap-guangzhou',enabled:true}
    const provider=await send('/api/usage/provider',payload,headers)
    assert.equal(provider.status,200)
    assert.deepEqual(await provider.json(),{mode:'TENCENT_FACEID',url:'faceid.tencentcloudapi.com',hasToken:false,secretId:'AKID-test-secret-id',hasSecretKey:true,region:'ap-guangzhou',endpoint:'faceid.tencentcloudapi.com',enabled:true,configured:true})
    assert.notEqual(store.db.prepare('SELECT secret_key_cipher FROM identity_provider_settings').get().secret_key_cipher,'tencent-secret-key')
    assert.equal((await send('/api/usage/provider',{...payload,secretKey:''},headers)).status,200)
  } finally { await new Promise(resolve=>server.close(resolve));store.close() }
})

test('Tencent IdCardVerification result codes distinguish billed match/mismatch from unbilled errors', ()=>{
  assert.deepEqual(mapTencentResult({Result:'0',RequestId:'req-match'}),{matched:true,reference:'req-match'})
  assert.deepEqual(mapTencentResult({Result:'-1',RequestId:'req-mismatch'}),{matched:false,reference:'req-mismatch'})
  assert.throws(()=>mapTencentResult({Result:'-2'}),/身份证号格式不正确/)
  assert.throws(()=>mapTencentResult({Result:'-3'}),/姓名格式不正确/)
  assert.throws(()=>mapTencentResult({Result:'-5'}),/无此身份证记录/)
  assert.throws(()=>mapTencentResult({Result:'-4'}),/暂时不可用/)
  assert.throws(()=>mapTencentResult({Result:'-6'}),/暂时不可用/)
  assert.throws(()=>mapTencentResult({Result:'-7'}),/暂时不可用/)
  assert.throws(()=>mapTencentResult({Error:{Code:'AuthFailure.SignatureFailure'}}),/密钥或权限/)
})

test('Tencent TC3 signature matches the pinned canonical request vector', ()=>{
  const payload=JSON.stringify({IdCard:'11010519491231002X',Name:'张三'})
  const signed=tencentAuthorization({secretId:'AKID-test',secretKey:'secret-test',timestamp:1551113065,payload})
  assert.equal(signed.date,'2019-02-25')
  assert.equal(signed.authorization,'TC3-HMAC-SHA256 Credential=AKID-test/2019-02-25/faceid/tc3_request, SignedHeaders=content-type;host, Signature=78d8fb46d361b9f106e8c5f52cca687bf732cc026c478cddfa50ef7604702035')
})

test('Aliyun Id2MetaVerify signing and result mapping distinguish billed and unbilled outcomes', ()=>{
  const signed=aliyunRpcSignature({accessKeyId:'LTAI-test',accessKeySecret:'secret-test',params:{IdentifyNum:'11010519491231002X',UserName:'张三'},nonce:'nonce-test-1234',timestamp:'2026-11-17T12:00:00Z'})
  assert.equal(signed.signature,'SytHiYD37l4zaphobx+Ck2sE0Yg=')
  assert.deepEqual(mapAliyunResult({Code:'200',ResultObject:{BizCode:'1'},RequestId:'req-a'}),{matched:true,reference:'req-a'})
  assert.deepEqual(mapAliyunResult({Code:'200',ResultObject:{BizCode:'2'},RequestId:'req-b'}),{matched:false,reference:'req-b'})
  assert.throws(()=>mapAliyunResult({Code:'200',ResultObject:{BizCode:'3'}}),/无此身份证记录/)
  assert.throws(()=>mapAliyunResult({Code:'400',Message:'InvalidAccessKeyId.NotFound'}),/AccessKey/)
  assert.throws(()=>mapAliyunResult({Code:'500',Message:'service error'}),/暂时不可用/)
})

test('Aliyun Cloud Auth credentials are encrypted and redacted', async ()=>{
  const {privateKey}=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const store=new AuthorityStore({database:':memory:',privateKey,ownerUsername:'owner',ownerPassword:'provider-test-password'})
  const sms=new SmsService(store,{masterKey:randomBytes(32).toString('base64')})
  const server=createAuthorityServer(store,{sms})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+server.address().port
  const send=(path,body,headers={})=>fetch(base+path,{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
  try {
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'provider-test-password'})})
    const cookie=login.headers.get('set-cookie').split(';')[0]
    const {csrf}=await login.json()
    const headers={cookie,'x-csrf-token':csrf}
    const payload={mode:'ALIYUN_CLOUD_AUTH',secretId:'LTAI-test',secretKey:'aliyun-secret',enabled:true}
    const provider=await send('/api/usage/provider',payload,headers)
    assert.equal(provider.status,200)
    assert.deepEqual(await provider.json(),{mode:'ALIYUN_CLOUD_AUTH',url:'cloudauth.aliyuncs.com',hasToken:false,secretId:'LTAI-test',hasSecretKey:true,region:'ap-guangzhou',endpoint:'cloudauth.aliyuncs.com',enabled:true,configured:true})
    assert.notEqual(store.db.prepare('SELECT secret_key_cipher FROM identity_provider_settings').get().secret_key_cipher,'aliyun-secret')
  } finally { await new Promise(resolve=>server.close(resolve));store.close() }
})
