import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { issueEnvelope, verifyEnvelope } from './license-authority.mjs'

test('issuer signs the exact envelope payload and rejects tampering and another issuer', () => {
  const keys = () => generateKeyPairSync('ed25519', { privateKeyEncoding: {type:'pkcs8',format:'pem'}, publicKeyEncoding: {type:'spki',format:'pem'} })
  const authority = keys(), other = keys()
  const claims = {customerId:'742', instanceId:'00000000-0000-0000-0000-000000000742', features:['advanced_income_reports']}
  const envelope = issueEnvelope(authority.privateKey, claims)
  assert(verifyEnvelope(authority.publicKey, envelope))
  assert(!verifyEnvelope(other.publicKey, envelope))
  assert(!verifyEnvelope(authority.publicKey, {...envelope, payload:Buffer.from(JSON.stringify({...claims,customerId:'743'})).toString('base64url')}))
  assert(!verifyEnvelope(authority.publicKey, {...envelope,format:'another-format'}))
  assert.deepEqual(JSON.parse(Buffer.from(envelope.payload,'base64url')), claims)
})
