import { createHash } from 'node:crypto'
import { compareVersions, fail, text } from './store.mjs'

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
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) throw new Error(`identity_provider_${response.status}`)
    if (!String(response.headers.get('content-type') || '').toLowerCase().includes('application/json'))
      throw new Error('identity_provider_content_type')
    const raw = await response.text()
    if (raw.length > 32768) throw new Error('identity_provider_response_too_large')
    let result
    try { result = JSON.parse(raw) } catch { throw new Error('identity_provider_response_invalid') }
    if (typeof result?.matched !== 'boolean') throw new Error('identity_provider_response_invalid')
    return { matched: result.matched, reference: typeof result.requestId === 'string' ? result.requestId.slice(0, 128) : '' }
  }
}

export class IdentityVerificationService {
  constructor(store, billing, provider, { priceCents = 100, subjectPepper = '', packages = null } = {}) {
    this.store = store
    this.billing = billing
    this.provider = provider
    this.priceCents = priceCents
    this.subjectPepper = String(subjectPepper || '')
    this.packages = packages
    this.packagePayments = null
  }

  client(body = {}, requestDomain = '') {
    const { claims, instance } = this.store.verifyClientLicense(body.license)
    const version = text(body.version, '客户端版本', 80)
    compareVersions(version, version)
    const now = Date.now()
    if (!Number.isFinite(Date.parse(claims.expiresAt)) || Date.parse(claims.expiresAt) <= now) fail('客户端授权已过期', 403)
    if (claims.notBefore && Date.parse(claims.notBefore) > now) fail('客户端授权尚未生效', 403)
    const state = this.store.db.prepare('SELECT p.status AS project_status,p.maintenance_until,p.product_id,c.status AS customer_status FROM instances i JOIN projects p ON p.id=i.project_id JOIN customers c ON c.id=i.customer_id WHERE i.id=?').get(instance.id)
    if (!state || state.customer_status !== 'ACTIVE' || state.project_status !== 'ACTIVE') fail('客户或项目已停用', 403)
    const module = this.store.db.prepare('SELECT status,min_version,product_id FROM modules WHERE id=?').get('identity_verification')
    if (!module || module.status !== 'ACTIVE' || module.product_id !== state.product_id) fail('实名认证模块未上架', 403)
    if (compareVersions(version, module.min_version || '0.0.0') < 0) fail('实名认证要求客户端 ' + module.min_version + ' 或更新版本', 409)
    const entitled = this.store.activeEntitlements(claims.instanceId).some(row => row.module_id === 'identity_verification')
    if (!entitled) fail('当前实例未开通实名认证模块', 403)
    if (!Array.isArray(claims.features) || !claims.features.includes('identity_verification')) fail('当前授权未包含实名认证，请刷新授权', 403)
    return { claims, instance, version }
  }

  account(body = {}, requestDomain = '') {
    const { instance, version } = this.client(body, requestDomain)
    const account = this.billing.accountView(instance.id)
    return {
      ...account,
      version,
      ready: this.provider.configured(),
      service: { provider: 'AUTHORITY', name: '授权中心实名核验', selectable: true },
      availablePackages: this.packages ? this.packages.availablePackages(instance.id) : []
    }
  }

  async createPackageCheckout(body = {}, baseUrl, requestDomain = '') {
    if (!this.packages || !this.packagePayments) fail('实名核验套餐购买未配置', 503)
    const { instance } = this.client(body, requestDomain)
    return this.packagePayments.createCheckout(instance.id, text(body.packageId, '套餐编号', 36), baseUrl)
  }

  async verify(body = {}, requestDomain = '') {
    if (!this.provider?.configured?.()) fail('实名核验服务未配置', 503)
    if (!this.subjectPepper) fail('实名核验服务摘要密钥未配置', 503)
    const { claims, instance, version } = this.client(body, requestDomain)
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
        return { matched, status: existing.status, billingMode: existing.billing_mode, requestedAt: existing.created_at, alreadyProcessed: true, instanceId: instance.id, version }
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
    const outcome = providerResult.matched ? 'MATCH' : 'MISMATCH'
    const request = this.billing.settle(claims.instanceId, key, outcome, true, providerResult.reference || '')
    const account = this.billing.ensure(claims.instanceId)
    return {
      matched: providerResult.matched, status: request.status, billingMode: request.billing_mode,
      requestedAt: request.created_at, alreadyProcessed: false, instanceId: instance.id, version,
      balanceCents: account.balance_cents, packageUnits: request.package_balance_id ? 1 : 0,
      chargedCents: request.package_balance_id ? 0 : request.price_cents
    }
  }
}

function domainAllowed(allowed, requestDomain) {
  const host = String(requestDomain || '').trim().toLowerCase().replace(/\.$/, '')
  const rule = String(allowed || '').trim().toLowerCase().replace(/\.$/, '')
  if (!host || !rule) return false
  if (rule === host) return true
  return rule.startsWith('*.') && host.endsWith(rule.slice(1)) && host !== rule.slice(2)
}
