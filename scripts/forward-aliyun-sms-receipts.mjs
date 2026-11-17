// Read a batch from a trusted Aliyun SMS report queue consumer on stdin.
// The consumer must acknowledge its queue message only after this exits 0.
import { createHmac } from 'node:crypto'

async function main() {
  const url = new URL('/api/sms/receipts/aliyun', process.env.AUTHORITY_SMS_RECEIPT_ORIGIN || '')
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('回执目标必须是 HTTPS 授权中心')
  const rawKey = (process.env.AUTHORITY_SMS_RECEIPT_KEY || '').trim()
  const key = Buffer.from(rawKey, /^[a-f0-9]{64}$/i.test(rawKey) ? 'hex' : 'base64')
  if (key.length !== 32) throw new Error('回执签名密钥未配置')
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    raw += chunk
    if (Buffer.byteLength(raw) > 512 * 1024) throw new Error('回执批次过大')
  }
  const parsed = JSON.parse(raw)
  const items = Array.isArray(parsed) ? parsed : [parsed]
  const reports = items.filter(item => item && typeof item.success === 'boolean' &&
      /^[0-9a-f-]{36}$/.test(String(item.out_id)) && item.biz_id)
    .map(item => ({ success: item.success, out_id: String(item.out_id), biz_id: String(item.biz_id) }))
  for (let start = 0; start < reports.length; start += 100) {
    const body = JSON.stringify({ reports: reports.slice(start, start + 100) })
    const timestamp = String(Date.now())
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', 'x-sms-receipt-timestamp': timestamp,
        'x-sms-receipt-signature': createHmac('sha256', key).update(timestamp + '\n' + body).digest('hex') },
      body })
    if (!response.ok) throw new Error('回执转发返回 HTTP ' + response.status)
    await response.arrayBuffer()
  }
}

main().catch(error => { console.error('回执转发失败：' + (error instanceof SyntaxError ? '输入 JSON 无效' : error.message)); process.exitCode = 1 })
