import { lookup } from 'node:dns'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { fail } from './store.mjs'
import { open, seal } from './sms.mjs'

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

export function postIdentityJson(endpoint, token, input, timeout = 8000) {
  return new Promise((resolve,reject)=>{
    const body=Buffer.from(JSON.stringify(input))
    const req=request(new URL(providerEndpoint(endpoint)), {
      method:'POST', agent:false,
      signal:AbortSignal.timeout(timeout),
      headers:{ 'content-type':'application/json', 'content-length':body.length, authorization:'Bearer '+token },
      lookup:(hostname,options,cb)=>lookup(hostname,{all:true,verbatim:true},(error,records)=>{
        if(error || !records.length || records.some(({address,family})=>!publicAddress(address,family)))
          return cb(new Error('identity_dns_not_public'))
        if(options.all) cb(null,records)
        else cb(null,records[0].address,records[0].family)
      })
    },response=>{
      if(response.statusCode<200 || response.statusCode>=300 ||
        !String(response.headers['content-type']||'').toLowerCase().startsWith('application/json')){
        response.destroy(); reject(new Error('identity_response_invalid')); return
      }
      let size=0
      const chunks=[]
      response.on('error',reject)
      response.on('aborted',()=>reject(new Error('identity_response_aborted')))
      response.on('data',chunk=>{
        size+=chunk.length
        if(size>32768) response.destroy(new Error('identity_response_too_large'))
        else chunks.push(chunk)
      })
      response.on('end',()=>{
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('identity_response_invalid')) }
      })
    })
    req.on('error',reject)
    req.end(body)
  })
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
    const url=row?.endpoint ?? this.fallback.url ?? ''
    const hasToken=Boolean(row ? row.token_cipher : this.fallback.token)
    const enabled=row ? row.enabled===1 : Boolean(url && hasToken)
    return { url, hasToken, enabled, configured:enabled && Boolean(url) && hasToken }
  }
  save(body,actor) {
    if(typeof body.enabled!=='boolean') fail('请选择核验服务状态')
    const row=this.row()
    const url=providerEndpoint(body.url ?? row?.endpoint ?? this.fallback.url ?? '')
    const input=body.token??''
    if(typeof input!=='string'||input.length>512||/[\r\n]/.test(input)) fail('核验供应商令牌格式无效')
    if(input.trim()&&!url) fail('保存令牌前请填写供应商地址')
    let cipher=row?.token_cipher||''
    const addressChanged=this.settings().url!==url
    if(addressChanged && cipher && !input.trim()) fail('更换供应商地址须重新填写令牌')
    const secret=input.trim()||(!row && !addressChanged ? this.fallback.token : '')
    if(secret){
      if(!this.key) fail('系统加密密钥未就绪',503)
      cipher=seal(secret,this.key)
    }
    if(body.enabled&&(!url||!cipher)) fail('启用前请填写核验地址和令牌')
    this.store.transaction(()=>{
      this.store.db.prepare('INSERT INTO identity_provider_settings(id,endpoint,token_cipher,enabled) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,token_cipher=excluded.token_cipher,enabled=excluded.enabled').run(url,cipher,body.enabled?1:0)
      this.store.audit(actor,'UPDATE_IDENTITY_PROVIDER','identity-provider',{enabled:body.enabled,hasToken:Boolean(cipher)})
    })
    return this.settings()
  }
  configured() { return this.settings().configured }
  async verify({realName,idNumber}) {
    if(!this.configured()) fail('实名核验服务未配置',503)
    const row=this.row()
    const result=await postIdentityJson(row?.endpoint ?? this.fallback.url,row ? open(row.token_cipher,this.key) : this.fallback.token,{name:realName,idNumber})
    if(typeof result?.matched!=='boolean') throw new Error('identity_response_invalid')
    return {matched:result.matched,reference:typeof result.requestId==='string'?result.requestId.slice(0,128):''}
  }
}
