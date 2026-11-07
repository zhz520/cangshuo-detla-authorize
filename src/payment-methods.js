export const PAYMENT_METHODS = Object.freeze(['H5', 'JSAPI', 'OFFICIAL', 'NATIVE', 'APP'])

export const PAYMENT_METHOD_LABELS = Object.freeze({
  H5: 'H5 网页支付',
  JSAPI: '小程序支付（JSAPI）',
  OFFICIAL: '公众号支付（JSAPI）',
  NATIVE: 'Native 扫码支付',
  APP: 'App 支付'
})

export const PAYMENT_METHOD_DESCRIPTIONS = Object.freeze({
  H5: '手机或电脑浏览器打开微信支付',
  JSAPI: '微信小程序内直接调起支付',
  OFFICIAL: '微信公众号网页内支付',
  NATIVE: '电脑浏览器展示收款二维码',
  APP: '原生 App 内调起支付'
})

export function visibleConfigFields(provider, methods = []) {
  const selected = new Set(methods)
  return (provider?.config_schema || []).filter(field =>
    field.required || !Array.isArray(field.requiredFor) || field.requiredFor.length === 0
    || field.requiredFor.some(method => selected.has(method))
  )
}
