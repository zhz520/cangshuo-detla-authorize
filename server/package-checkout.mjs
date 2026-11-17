import { randomUUID } from 'node:crypto'
import { checkoutPath, officialCheckoutScene } from './checkout-scene.mjs'
import { fail } from './store.mjs'

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function packageMethods(providerMethods, projectMethods, payments) {
  const provider = JSON.parse(providerMethods || '[]')
  const project = JSON.parse(projectMethods || '[]')
  const methods = ['OFFICIAL', 'NATIVE'].filter(method => provider.includes(method) && project.includes(method))
  if (methods.length) payments.ensureMethodsConfigured(payments.wechatConfig(true), methods)
  return methods
}

export function packageOfficialContext(service, token) {
  const context = service.context(token)
  if (context.summary.status !== 'UNPAID') fail('套餐已付款或不可支付，请返回收款页查单', 409)
  if (!context.summary.methods.includes('OFFICIAL')) fail('当前套餐未启用公众号支付', 503)
  return context
}

export function validatePackageNotification(transaction, payment, config) {
  const appId = payment.method === 'OFFICIAL' ? config.officialAppId : (config.appId || config.officialAppId)
  if (transaction.mchid !== config.merchantId || !appId || transaction.appid !== appId) {
    fail('微信支付通知商户或 AppID 不匹配', 409)
  }
  const tradeType = payment.method === 'OFFICIAL' ? 'JSAPI' : 'NATIVE'
  if ((transaction.trade_type || payment.method === 'OFFICIAL') && transaction.trade_type !== tradeType) {
    fail('微信支付通知交易类型不匹配', 409)
  }
  if (payment.method === 'OFFICIAL' && transaction.payer?.openid !== payment.openid) {
    fail('微信支付通知付款人不匹配', 409)
  }
  if (transaction.amount?.total !== payment.order_amount || payment.amount_cents !== payment.order_amount ||
      (transaction.amount?.currency && transaction.amount.currency !== 'CNY')) fail('微信支付通知金额不匹配', 409)
}

export async function prepayPackageOfficial(service, token, openid, kind, label) {
  const context = packageOfficialContext(service, token)
  const { payments, store } = service
  const config = payments.wechatConfig(true)
  // kind is internal only: sms and identity call this helper with constant values.
  const table = kind === 'sms' ? 'sms_package_payments' : 'identity_package_payments'
  const select = store.db.prepare(`SELECT * FROM ${table} WHERE package_order_id=?`)
  const payment = store.transaction(() => {
    if (context.payment) return context.payment
    const number = (kind === 'sms' ? 'SMSPKG' : 'IDPKG') + randomUUID().replaceAll('-', '').slice(0, 26)
    store.db.prepare(`INSERT INTO ${table}(id,package_order_id,out_trade_no,method,openid,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(package_order_id) DO NOTHING`)
      .run(randomUUID(), context.row.order_id, number, 'OFFICIAL', openid, context.row.amount_cents, 'UNPAID', new Date().toISOString())
    return select.get(context.row.order_id)
  })
  if (payment.method !== 'OFFICIAL') fail('该套餐已有其他支付单，请返回原支付页', 409)
  if (payment.openid !== openid) fail('请使用首次发起支付的微信账号完成支付', 409)
  if (payment.status === 'PAID') fail('套餐已付款，请返回收款页查单', 409)
  if (payment.prepay_id) return payments.jsapiParams(config.officialAppId, payment.prepay_id, config.privateKey)
  return payments.oncePerPrepay(payment.out_trade_no, async () => {
    const data = await payments.wechatRequest('POST', '/v3/pay/transactions/jsapi', {
      appid: config.officialAppId,
      mchid: config.merchantId,
      description: (label + ' · ' + context.summary.packageName).slice(0, 120),
      out_trade_no: payment.out_trade_no,
      notify_url: config.notifyUrl,
      amount: { total: payment.amount_cents, currency: 'CNY' },
      payer: { openid }
    })
    if (!data.prepay_id) fail('微信支付未返回预支付编号', 502)
    const updated = store.db.prepare(`UPDATE ${table} SET prepay_id=?,status='PREPAY' WHERE id=? AND status IN ('UNPAID','PREPAY')`)
      .run(data.prepay_id, payment.id)
    if (!updated.changes) fail('套餐已付款，请返回收款页查单', 409)
    return payments.jsapiParams(config.officialAppId, data.prepay_id, config.privateKey)
  })
}

export async function renderPackageCheckout(service, token, request, baseUrl, kind) {
  const payments = service.payments
  const title = kind === 'sms' ? '短信套餐收款' : '实名核验套餐收款'
  let context
  try { context = service.context(token) } catch (error) { return payments.renderMessage(error.message || '套餐支付链接无效') }
  const { summary, payment } = context
  const granted = summary.status === 'GRANTED'
  const scene = officialCheckoutScene(token, kind, request, summary.status)
  const scanQr = value => payments.qr.toString(value, { type: 'svg', margin: 4, width: 280, color: { dark: '#111827', light: '#ffffff' } })
  let paymentBox = '', autoPay = ''
  if (!granted) {
    if (summary.status === 'PAID' || scene.awaitingConfirmation) {
      paymentBox = '<p>正在确认支付结果，请勿重复付款。</p>'
    } else {
      if (!summary.paymentReady) return payments.renderMessage('授权中心尚未启用可用于套餐购买的微信支付方式')
      if (payment && !summary.methods.includes(payment.method)) return payments.renderMessage('此套餐原支付通道已停用，请联系维护人员查单')
      try {
        if (summary.methods.includes('OFFICIAL') && (!payment || payment.method === 'OFFICIAL')) {
          paymentBox = scene.mobileWechat ? scene.payMarkup : `<div class="scan">${await scanQr(new URL(checkoutPath(token, kind), payments.wechatConfig(true).origin || baseUrl).href)}${scene.payMarkup}</div>`
          autoPay = scene.autoPayScript
        } else {
          const native = await service.prepay(token)
          if (!native?.codeUrl) return payments.renderMessage('正在确认套餐支付状态，请刷新收款页')
          paymentBox = `<div class="scan">${await scanQr(native.codeUrl)}<p>使用手机微信扫一扫完成支付</p></div>`
        }
      } catch (error) { return payments.renderMessage(error.message || '微信支付暂不可用') }
    }
  }
  const count = kind === 'sms' ? summary.messageCount + ' 条' : summary.verificationCount + ' 次'
  const statusUrl = '/api/checkout/' + kind + '-package/' + encodeURIComponent(token)
  const script = granted ? '' : `<script>${autoPay}const poll=async()=>{try{const r=await fetch(${JSON.stringify(statusUrl)},{cache:'no-store'});if(r.status===404||r.status===410){document.querySelector('.message').textContent='支付链接已失效，请返回后台查询套餐状态。';return}if(r.ok&&(await r.json()).status==='GRANTED'){location.replace(${JSON.stringify(checkoutPath(token, kind) + '?paid=1')});return}}catch{}setTimeout(poll,3000)};setTimeout(poll,3000);</script>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${payments.css()}</style></head><body><main><h1>${granted ? '支付成功，套餐已发放' : title}</h1><section class="order"><div><span>套餐</span><strong>${esc(summary.packageName)}</strong></div><div><span>客户</span><strong>${esc(summary.customerName)} · ${esc(summary.projectName)}</strong></div><div><span>支付金额</span><strong class="price">¥${(summary.amountCents / 100).toFixed(2)}</strong></div><div><span>套餐额度</span><strong>${esc(count)}</strong></div></section><section class="pay-box">${paymentBox}</section><p class="message">${granted ? '请返回客户后台刷新服务页面。' : '支付确认后，套餐自动发放。'}</p></main>${script}</body></html>`
}
