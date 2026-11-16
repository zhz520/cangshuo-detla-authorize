import { createHmac, randomUUID } from 'node:crypto'

const SMS_ENDPOINT = 'https://dysmsapi.aliyuncs.com/'
const API_VERSION = '2017-05-25'

export class SmsProviderUncertain extends Error {
  constructor(code, message = 'SMS provider result is uncertain') {
    super(message)
    this.name = 'SmsProviderUncertain'
    this.code = code
  }
}

const percentEncode = value => encodeURIComponent(String(value))
  .replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())

const aliyunTimestamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

export class AliyunSmsProvider {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl
  }

  async send({ endpoint, accessKeyId, accessKeySecret, signName, templateCode, phone, variables = {}, timeoutMs = 8000 }) {
    if (endpoint && endpoint !== 'dysmsapi.aliyuncs.com') throw new Error('SMS_ENDPOINT_INVALID')
    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) throw new Error('SMS_PROVIDER_NOT_CONFIGURED')
    const params = {
      AccessKeyId: accessKeyId,
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: phone,
      RegionId: 'cn-hangzhou',
      SignName: signName,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: randomUUID(),
      SignatureVersion: '1.0',
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify(variables || {}),
      Timestamp: aliyunTimestamp(),
      Version: API_VERSION
    }
    const canonical = Object.keys(params).sort()
      .map(key => percentEncode(key) + '=' + percentEncode(params[key]))
      .join('&')
    const stringToSign = 'POST&%2F&' + percentEncode(canonical)
    const signature = createHmac('sha1', accessKeySecret + '&')
      .update(stringToSign)
      .digest('base64')
    const body = new URLSearchParams({ ...params, Signature: signature })
    let response
    try {
      response = await this.fetchImpl(SMS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(Math.max(1000, Math.min(30000, Number(timeoutMs) || 8000)))
      })
    } catch (error) {
      throw new SmsProviderUncertain('SMS_PROVIDER_TIMEOUT', error?.message || 'provider timeout')
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new SmsProviderUncertain('SMS_PROVIDER_RESPONSE_INVALID')
    }
    const code = String(payload?.Code || '')
    if (response.ok && code.toUpperCase() === 'OK') {
      return {
        accepted: true,
        code: 'OK',
        bizId: String(payload?.BizId || ''),
        requestId: String(payload?.RequestId || '')
      }
    }
    return {
      accepted: false,
      code: code || 'SMS_PROVIDER_REJECTED',
      message: String(payload?.Message || 'provider rejected').slice(0, 200),
      requestId: String(payload?.RequestId || '')
    }
  }
}
