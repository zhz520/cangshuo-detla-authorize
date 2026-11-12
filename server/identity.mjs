import { createHash } from 'node:crypto'
import { fail, text } from './store.mjs'

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

export function validateIdNumber(value) {
  const id = String(value || '').trim().toUpperCase()
  if (!/^[1-9][0-9]{16}[0-9X]$/.test(id)) fail('请输入有效的18位身份证号码')
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * ID_WEIGHTS[i]
  if (id[17] !== ID_CHECK_CODES[sum % 11]) fail('身份证号码校验失败')
  return id
}

export class HttpIdentityProvider {
  constructor({ url, token, timeoutMs = 8000 } = {}) {
    this.url = String(url || '').trim()
    this.token = String(token || '').trim()
    this.timeoutMs = timeoutMs
    if (this.url) {
      const parsed = new URL(this.url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('实名服务地址必须为 HTTPS')
    }
  }

  configured() { return Boolean(this.url && this.token) }

  async verify({ realName, idNumber }) {
    if (!this.configured()) fail('实名核验服务未配置', 503)
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ name: realName, idNumber }),
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) throw new Error(`identity_provider_${response.status}`)
    const result = await response.json()
    if (typeof result?.matched !== 'boolean') throw new Error('identity_provider_response_invalid')
    return { matched: result.matched, reference: typeof result.requestId === 'string' ? result.requestId.slice(0, 128) : '' }
  }
}

export class IdentityVerificationService {
  constructor(store, billing, provider, { priceCents = 100, subjectPepper = '' } = {}) {
    this.store = store
    this.billing = billing
    this.provider = provider
    this.priceCents = priceCents
    this.subjectPepper = String(subjectPepper || '')
  }

  async verify(body = {}) {
    if (!this.provider?.configured?.()) fail('实名核验服务未配置', 503)
    if (!this.subjectPepper) fail('实名核验服务摘要密钥未配置', 503)
    if (!Number.isSafeInteger(this.priceCents) || this.priceCents <= 0) fail('实名核验价格未配置', 503)
    const { claims, instance } = this.store.verifyClientLicense(body.license)
    const version = text(body.version, '客户端版本', 80)
    const entitled = this.store.activeEntitlements(claims.instanceId).some(row => row.module_id === 'identity_verification')
    if (!entitled) fail('当前实例未开通实名认证模块', 403)
    const realName = text(body.realName, '真实姓名', 64).trim()
    if (!/^[\p{Script=Han}A-Za-z·. ]{2,32}$/u.test(realName)) fail('真实姓名格式不正确')
    const idNumber = validateIdNumber(body.idNumber)
    const key = text(body.idempotencyKey, '幂等键', 128)
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail('幂等键格式不正确')
    const subjectHash = createHash('sha256').update(`${this.subjectPepper}:${realName}:${idNumber}`).digest('hex')
    const reservation = this.billing.reserve(claims.instanceId, key, subjectHash, this.priceCents)
    if (!reservation.created) {
      const existing = reservation.request
      if (existing.status === 'CHARGED') {
        const matched = String(existing.result || '').startsWith('MATCH')
        return { matched, status: existing.status, requestedAt: existing.created_at, alreadyProcessed: true, instanceId: instance.id, version }
      }
      if (existing.status === 'RESERVED') fail('实名核验正在处理中，请稍后重试', 409)
      fail('实名核验请求状态异常', 409)
    }
    let providerResult
    try {
      providerResult = await this.provider.verify({ realName, idNumber })
    } catch (error) {
      this.billing.settle(claims.instanceId, key, 'PROVIDER_ERROR', false)
      console.error('identity_provider_failed', error?.name || 'Error')
      fail('实名核验服务暂时不可用，请稍后重试', 502)
    }
    const outcome = providerResult.matched ? `MATCH${providerResult.reference ? ':' + providerResult.reference : ''}` : `MISMATCH${providerResult.reference ? ':' + providerResult.reference : ''}`
    const request = this.billing.settle(claims.instanceId, key, outcome, true)
    const account = this.billing.ensure(claims.instanceId)
    return { matched: providerResult.matched, status: request.status, requestedAt: request.created_at, alreadyProcessed: false, instanceId: instance.id, version, balanceCents: account.balance_cents }
  }
}
