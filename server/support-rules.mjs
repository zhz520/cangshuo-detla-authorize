const rules = [
  ['credential_request', '疑似索要验证码或账户凭证', /(?:发给我|发一下|告诉我|提供|发送|报一下|截图).{0,16}(?:验证码|支付密码|登录密码)|(?:验证码|支付密码|登录密码).{0,16}(?:发给我|发一下|告诉我|发我|截图给我)/u],
  ['payment_redirect', '疑似引导私下转账', /(?:私下|绕过平台|不要走平台|个人账户|私人账户).{0,24}(?:转账|付款|汇款|收款)|(?:转账|付款|汇款).{0,24}(?:个人账户|私人账户|不要走平台)/u],
]

export function redactSupportExcerpt(value, limit = 240) {
  const masked = value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(/(?:https?:\/\/|www\.)[^\s<>"“”，。；！？、,;!?]+/giu, '[链接]')
    .replace(/[\w.+-]+@(?:[\w-]+\.)+[a-z]{2,}/gi, '[邮箱]')
    .replace(/(?:bearer[ \t]+)[A-Za-z0-9._~+/=-]+/gi, 'Bearer [凭证]')
    .replace(/((?:验证码|(?:登录|支付|交易)?密码|口令|授权码|token|api[ _-]?key|secret)[ \t]*(?:(?:是|为|[:=])[ \t]*)?)(?:(["'])([^"'\n]+)\2|([A-Za-z0-9][A-Za-z0-9_!@#$%^&*.+/~=-]{2,}))(?![A-Za-z0-9_])/giu, '$1[凭证]')
    .replace(/((?:姓名|真实姓名|联系人|收件人|收货人|开户名|持卡人)[ \t]*(?:(?:是|为|[:=])[ \t]*)?)([A-Za-z][A-Za-z .'-]{1,40}|[\p{Script=Han}·]{2,20})/giu, '$1[姓名]')
    .replace(/((?:地址|住址|收货地址|送货地址|家庭住址)[ \t]*(?:(?:是|为|[:=])[ \t]*)?)([^\n，。；,;]{4,80})/giu, '$1[地址]')
    .replace(/((?:身份证号?|证件号?|护照号?)[ \t]*(?:(?:是|为|[:=])[ \t]*)?)([A-Za-z0-9][A-Za-z0-9 -]{4,})/giu, '$1[证件号]')
    .replace(/((?:微信(?:号|ID)|QQ(?:号|号码)|账号|账户名|用户名)[ \t]*(?:(?:是|为|[:=])[ \t]*)?)([a-z0-9_][\w.-]{2,})/giu, '$1[账号]')
    .replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, '[IP]')
    .replace(/\+?\d(?:[ \t().-]*\d){5,}[xX]?/g, '[数字已隐藏]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[凭证]')
  return Array.from(masked).slice(0,limit).join('')
}

export function supportRisk(text, blockedDomains = []) {
  const normalized = text.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
  for (const match of normalized.matchAll(/https?:\/\/[^\s<>"“”]+/giu)) {
    try {
      const host = new URL(match[0].replace(/[，。；！？、)\]）]+$/u, '')).hostname.toLowerCase().replace(/\.$/, '')
      if (blockedDomains.some(domain => host === domain || host.endsWith('.' + domain))) return { code: 'blocked_domain', reason: '命中禁止发送的链接域名', blocked: true }
    } catch {}
  }
  const rule = rules.find(([, , pattern]) => pattern.test(normalized))
  return rule ? { code: rule[0], reason: rule[1], blocked: false } : null
}
