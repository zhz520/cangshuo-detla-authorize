import { createHash, createHmac, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { fail } from './store.mjs'
import { open, seal } from './sms.mjs'

const TENCENT_HOST = 'faceid.tencentcloudapi.com'
const TENCENT_SERVICE = 'faceid'
const TENCENT_VERSION = '2018-03-01'
const ALIYUN_HOST = 'cloudauth.aliyuncs.com'
const ALIYUN_VERSION = '2019-03-07'
const TENCENT_REGION = /^[a-z0-9-]{2,32}$/
const MODES = new Set(['ALIYUN_CLOUD_AUTH', 'TENCENT_FACEID', 'CUSTOM'])

const blocked = new BlockList()
for (const [address, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
  ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address,bits,'ipv4')
for(const [address,bits] of [['2001::',23],['2001:db8::',32],['2002::',16]]) blocked.addSubnet(address,bits,'ipv6')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::',3,'ipv6')
export function publicAddress(address, family) {
  return family === 4 ? isIP(address)===4 && !blocked.check(address,'ipv4') :
    family === 6 && isIP(address)===6 && globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6')
}

export function providerEndpoint(value) {
  if (typeof value !== 'string' || value.length>500 || /[\r\n]/.test(value)) fail('请输入有效的 HTTPS 实名核验地址')
  if (!value.trim()) return ''
  try {
    const url=new URL(value.trim())
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.port ||
        isIP(url.hostname.replace(/^\[|\]$/g,'')) || !url.hostname.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|home|test|invalid|example|onion)$/.test(url.hostname.replace(/\.$/,''))) throw new Error()
    return url.href
  } catch { fail('实名核验地址须为公网 HTTPS 域名，不带参数或端口') }
}

const optionalText = (value, label, maximum = 200) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > maximum || /[\r\n]/.test(value)) fail(label + '格式不正确')
  return value.trim()
}

const sha256 = value => createHash('sha256').update(value).digest('hex')
const hmac = (key, value, encoding) => createHmac('sha256', key).update(value).digest(encoding)

function responseJson(resolve, reject, response, chunks, size) {
  if (response.statusCode < 200 || response.statusCode >= 300 ||
      !String(response.headers['content-type']||'').toLowerCase().startsWith('application/json')) {
    response.destroy(); reject(new Error('identity_response_invalid')); return
  }
  response.on('error', reject)
  response.on('aborted', () => reject(new Error('identity_response_aborted')))
  response.on('data', chunk => {
    size += chunk.length
    if (size > 32768) response.destroy(new Error('identity_response_too_large'))
    else chunks.push(chunk)
  })
  response.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
    catch { reject(new Error('identity_response_invalid')) }
  })
}

export function postIdentityJson(endpoint, token, input, timeout = 8000) {
  return new Promise((resolve,reject)=>{
    const body=Buffer.from(JSON.stringify(input))
    const req=request(new URL(providerEndpoint(endpoint)), {
      method:'POST', agent:false, signal:AbortSignal.timeout(timeout),
      headers:{ 'content-type':'application/json', 'content-length':body.length, authorization:'Bearer '+token },
      lookup:(hostname,options,cb)=>lookup(hostname,{all:true,verbatim:true},(error,records)=>{
        if(error || !records.length || records.some(({address,family})=>!publicAddress(address,family)))
          return cb(new Error('identity_dns_not_public'))
        if(options.all) cb(null,records)
        else cb(null,records[0].address,records[0].family)
      })
    },response=>responseJson(resolve,reject,response,[],0))
    req.on('error',reject)
    req.end(body)
  })
}

export function tencentAuthorization({ secretId, secretKey, timestamp, payload }) {
  const host = TENCENT_HOST
  const contentType = 'application/json; charset=utf-8'
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${date}/${TENCENT_SERVICE}/tc3_request\n${sha256(canonicalRequest)}`
  const kDate = hmac('TC3' + secretKey, date)
  const kService = hmac(kDate, TENCENT_SERVICE)
  const kSigning = hmac(kService, 'tc3_request')
  const signature = hmac(kSigning, stringToSign, 'hex')
  return {
    date,
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${TENCENT_SERVICE}/tc3_request, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
}

export function postTencentJson({ secretId, secretKey, region, realName, idNumber, timeout = 8000 }) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000)
    const payload = JSON.stringify({ IdCard: idNumber, Name: realName })
    const { authorization } = tencentAuthorization({ secretId, secretKey, timestamp, payload })
    const body = Buffer.from(payload)
    const req = request({
      hostname: TENCENT_HOST, port: 443, path: '/', method: 'POST', agent: false, family: 4,
      timeout,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
        host: TENCENT_HOST,
        'x-tc-action': 'IdCardVerification',
        'x-tc-timestamp': String(timestamp),
        'x-tc-version': TENCENT_VERSION,
        'x-tc-region': region,
        authorization
      }
    }, response => responseJson(resolve, reject, response, [], 0))
    req.on('timeout', () => req.destroy(new Error('identity_provider_timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

export function aliyunRpcSignature({ accessKeyId, accessKeySecret, params = {}, method = 'POST',
  nonce = randomUUID(), timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }) {
  const all = {
    AccessKeyId: accessKeyId,
    Action: 'Id2MetaVerify',
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce,
    SignatureVersion: '1.0',
    Timestamp: timestamp,
    Version: ALIYUN_VERSION,
    ParamType: 'normal',
    ...params
  }
  const canonical = Object.keys(all).sort().map(key => percentEncode(key) + '=' + percentEncode(all[key])).join('&')
  const stringToSign = method + '&' + percentEncode('/') + '&' + percentEncode(canonical)
  const signature = createHmac('sha1', accessKeySecret + '&').update(stringToSign).digest('base64')
  return { body: canonical + '&Signature=' + percentEncode(signature), signature }
}

export function postAliyunJson({ accessKeyId, accessKeySecret, realName, idNumber, timeout = 8000 }) {
  return new Promise((resolve, reject) => {
    const signed = aliyunRpcSignature({ accessKeyId, accessKeySecret, params: { IdentifyNum: idNumber, UserName: realName } })
    const body = Buffer.from(signed.body)
    const req = request({
      hostname: ALIYUN_HOST, port: 443, path: '/', method: 'POST', agent: false, family: 4, timeout,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': body.length,
        host: ALIYUN_HOST
      }
    }, response => responseJson(resolve, reject, response, [], 0))
    req.on('timeout', () => req.destroy(new Error('identity_provider_timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

export function mapAliyunResult(body) {
  if (!body || typeof body !== 'object') throw new Error('identity_response_invalid')
  const code = String(body.Code ?? '')
  if (code !== '200') {
    if (/InvalidAccessKeyId|SignatureDoesNotMatch|Forbidden|Unauthorized/i.test(code + ' ' + String(body.Message || '')))
      fail('阿里云实名 AccessKey 或权限不正确，请检查 AccessKey 和信息核验服务授权', 503)
    fail('实名核验服务暂时不可用，请稍后重试', 503)
  }
  const biz = String(body.ResultObject?.BizCode ?? '')
  const reference = typeof body.RequestId === 'string' ? body.RequestId.slice(0, 128) : ''
  if (biz === '1') return { matched: true, reference }
  if (biz === '2') return { matched: false, reference }
  if (biz === '3') fail('证件库中无此身份证记录，请核对后重试', 409)
  fail('实名核验未通过，请稍后重试', 502)
}

async function verifyAliyun({ accessKeyId, accessKeySecret, realName, idNumber, timeout = 8000 }) {
  return mapAliyunResult(await postAliyunJson({ accessKeyId, accessKeySecret, realName, idNumber, timeout }))
}

export function mapTencentResult(response) {
  if (!response || typeof response !== 'object') throw new Error('identity_response_invalid')
  if (response.Error) {
    const code = String(response.Error.Code || '')
    if (code.startsWith('AuthFailure') || code.startsWith('UnauthorizedOperation'))
      fail('腾讯云实名密钥或权限不正确，请检查 SecretId、SecretKey 和接口权限', 503)
    fail('实名核验服务暂时不可用，请稍后重试', 503)
  }
  const code = String(response.Result ?? '')
  const reference = typeof response.RequestId === 'string' ? response.RequestId.slice(0, 128) : ''
  if (code === '0') return { matched: true, reference }
  if (code === '-1') return { matched: false, reference }
  if (code === '-2') fail('身份证号格式不正确', 400)
  if (code === '-3') fail('姓名格式不正确', 400)
  if (code === '-5') fail('证件库中无此身份证记录，请核对后重试', 409)
  if (['-4', '-6', '-7'].includes(code)) fail('实名核验服务暂时不可用，请稍后重试', 503)
  fail('实名核验未通过，请稍后重试', 502)
}

async function verifyTencent({ secretId, secretKey, region, realName, idNumber, timeout = 8000 }) {
  const result = await postTencentJson({ secretId, secretKey, region, realName, idNumber, timeout })
  return mapTencentResult(result?.Response)
}

export class IdentityProviderSettings {
  constructor(store, masterKey, fallback = {}) {
    this.store=store
    this.key=masterKey
    this.fallback=fallback
  }
  row() { return this.store.db.prepare('SELECT * FROM identity_provider_settings WHERE id=1').get() }
  settings() {
    const row=this.row()
    const fallbackConfigured=Boolean((this.fallback.url ?? '') && this.fallback.token)
    const mode=row?.provider || (fallbackConfigured ? 'CUSTOM' : 'ALIYUN_CLOUD_AUTH')
    const url=mode === 'TENCENT_FACEID' ? TENCENT_HOST : mode === 'ALIYUN_CLOUD_AUTH' ? ALIYUN_HOST : (row?.endpoint ?? this.fallback.url ?? '')
    const hasToken=Boolean(row ? row.token_cipher : this.fallback.token)
    const secretId=row?.secret_id || ''
    const hasSecretKey=Boolean(row?.secret_key_cipher)
    const region=row?.region || 'ap-guangzhou'
    const enabled=row ? row.enabled===1 : Boolean(url && hasToken)
    const configured=enabled && (mode === 'TENCENT_FACEID' ? Boolean(secretId && hasSecretKey) : mode === 'ALIYUN_CLOUD_AUTH' ? Boolean(secretId && hasSecretKey) : Boolean(url && hasToken))
    return { mode, url, hasToken, secretId, hasSecretKey, region, endpoint: mode === 'TENCENT_FACEID' ? TENCENT_HOST : mode === 'ALIYUN_CLOUD_AUTH' ? ALIYUN_HOST : url, enabled, configured }
  }
  save(body,actor) {
    if(typeof body.enabled!=='boolean') fail('请选择核验服务状态')
    const row=this.row()
    const mode=body.mode == null
      ? ((body.url != null || body.token != null) ? 'CUSTOM' : (row?.provider || 'ALIYUN_CLOUD_AUTH'))
      : String(body.mode).toUpperCase()
    if(!MODES.has(mode)) fail('实名服务商类型不正确')
    let endpoint=row?.endpoint ?? this.fallback.url ?? ''
    let tokenCipher=row?.token_cipher || ''
    let secretId=row?.secret_id || ''
    let secretKeyCipher=row?.secret_key_cipher || ''
    let region=row?.region || 'ap-guangzhou'
    if(mode === 'ALIYUN_CLOUD_AUTH') {
      secretId=optionalText(body.secretId ?? secretId, '阿里云 AccessKey ID', 128)
      const input=body.secretKey ?? ''
      if(typeof input!=='string'||input.length>512||/[\r\n]/.test(input)) fail('阿里云 AccessKey Secret 格式无效')
      if(input.trim()) {
        if(!this.key) fail('系统加密密钥未就绪',503)
        secretKeyCipher=seal(input.trim(),this.key)
      }
      endpoint=ALIYUN_HOST
      region=''
      if(body.enabled && (!secretId || !secretKeyCipher)) fail('启用前请填写阿里云 AccessKey ID 和 AccessKey Secret')
    } else if(mode === 'TENCENT_FACEID') {
      secretId=optionalText(body.secretId ?? secretId, '腾讯云 SecretId', 128)
      region=optionalText(body.region ?? region, '腾讯云地域', 40) || 'ap-guangzhou'
      if(!TENCENT_REGION.test(region)) fail('腾讯云地域格式不正确')
      const input=body.secretKey ?? ''
      if(typeof input!=='string'||input.length>512||/[\r\n]/.test(input)) fail('腾讯云 SecretKey 格式无效')
      if(input.trim()) {
        if(!this.key) fail('系统加密密钥未就绪',503)
        secretKeyCipher=seal(input.trim(),this.key)
      }
      endpoint=TENCENT_HOST
      if(body.enabled && (!secretId || !secretKeyCipher)) fail('启用前请填写腾讯云 SecretId 和 SecretKey')
    } else {
      endpoint=providerEndpoint(body.url ?? endpoint)
      const input=body.token??''
      if(typeof input!=='string'||input.length>512||/[\r\n]/.test(input)) fail('核验供应商令牌格式无效')
      if(input.trim()&&!endpoint) fail('保存令牌前请填写供应商地址')
      const addressChanged=this.settings().url!==endpoint
      if(addressChanged && tokenCipher && !input.trim()) fail('更换供应商地址须重新填写令牌')
      if(input.trim()) {
        if(!this.key) fail('系统加密密钥未就绪',503)
        tokenCipher=seal(input.trim(),this.key)
      }
      if(body.enabled && (!endpoint || !tokenCipher)) fail('启用前请填写核验地址和令牌')
    }
    this.store.transaction(()=>{
      this.store.db.prepare('INSERT INTO identity_provider_settings(id,provider,endpoint,token_cipher,secret_id,secret_key_cipher,region,enabled) VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,endpoint=excluded.endpoint,token_cipher=excluded.token_cipher,secret_id=excluded.secret_id,secret_key_cipher=excluded.secret_key_cipher,region=excluded.region,enabled=excluded.enabled')
        .run(mode,endpoint,tokenCipher,secretId,secretKeyCipher,region,body.enabled?1:0)
      this.store.audit(actor,'UPDATE_IDENTITY_PROVIDER','identity-provider',{mode,enabled:body.enabled,hasToken:Boolean(tokenCipher),hasSecretKey:Boolean(secretKeyCipher),region})
    })
    return this.settings()
  }
  configured() { return this.settings().configured }
  async verify({realName,idNumber}) {
    if(!this.configured()) fail('实名核验服务未配置',503)
    const row=this.row()
    if(row?.provider === 'TENCENT_FACEID') {
      let secretKey
      try { secretKey=open(row.secret_key_cipher,this.key) }
      catch { fail('腾讯云 SecretKey 无法解密',503) }
      return verifyTencent({ secretId: row.secret_id, secretKey, region: row.region || 'ap-guangzhou', realName, idNumber })
    }
    if(row?.provider === 'ALIYUN_CLOUD_AUTH') {
      let secretKey
      try { secretKey=open(row.secret_key_cipher,this.key) }
      catch { fail('阿里云 AccessKey Secret 无法解密',503) }
      return verifyAliyun({ accessKeyId: row.secret_id, accessKeySecret: secretKey, realName, idNumber })
    }
    const result=await postIdentityJson(row?.endpoint ?? this.fallback.url,row ? open(row.token_cipher,this.key) : this.fallback.token,{name:realName,idNumber})
    if(typeof result?.matched!=='boolean') throw new Error('identity_response_invalid')
    return {matched:result.matched,reference:typeof result.requestId==='string'?result.requestId.slice(0,128):''}
  }
}
