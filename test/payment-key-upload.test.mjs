import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {mkdirSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {AuthorityStore} from '../server/store.mjs'

function fixture(){
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}})
  const store=new AuthorityStore({database:':memory:',privateKey:generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'}}).privateKey,ownerUsername:'owner',ownerPassword:'Payment-key-test-password-2026'})
  const base=process.platform==='win32'?path.resolve('D:/CodexData/temp'):os.tmpdir()
  mkdirSync(base,{recursive:true})
  const directory=mkdtempSync(path.join(base,'payment-key-test-'))
  store.dataDirectory=directory
  return {store,directory,privateKey,publicKey,cleanup(){store.close();if(path.dirname(path.resolve(directory))===path.resolve(base))rmSync(directory,{recursive:true,force:true})}}
}

test('payment key uploads validate PEM content and persist private files',()=>{
  const f=fixture();try{
    const privateResult=f.store.management.uploadPaymentKey({kind:'private',filename:'apiclient_key.pem',contentBase64:Buffer.from(f.privateKey).toString('base64')},'owner')
    const publicResult=f.store.management.uploadPaymentKey({kind:'public',filename:'pub_key.pem',contentBase64:Buffer.from(f.publicKey).toString('base64')},'owner')
    assert.equal(readFileSync(privateResult.path,'utf8'),f.privateKey.trim()+'\n')
    assert.equal(readFileSync(publicResult.path,'utf8'),f.publicKey.trim()+'\n')
    if(process.platform!=='win32') assert.equal(statSync(privateResult.path).mode & 0o777,0o600)
    assert.throws(()=>f.store.management.uploadPaymentKey({kind:'private',filename:'bad.pem',contentBase64:Buffer.from('not a key').toString('base64')},'owner'),/私钥|密钥/)
    assert.throws(()=>f.store.management.uploadPaymentKey({kind:'public',filename:'toolarge.pem',contentBase64:Buffer.alloc(33000).toString('base64')},'owner'),/32KB/)
  }finally{f.cleanup()}
})
