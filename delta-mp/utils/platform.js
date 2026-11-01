export function isH5() {
  let result = false
  // #ifdef H5
  result = true
  // #endif
  return result
}

export function isMpWeixin() {
  let result = false
  // #ifdef MP-WEIXIN
  result = true
  // #endif
  return result
}

export function isWechatBrowser() {
  return isH5() && typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent)
}

export function isMobileBrowser() {
  if (!isH5() || typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

/** H5 payment is only supported by WeChat in a mobile browser outside WeChat. */
export function canStartH5WechatPayment() {
  if (!isH5()) return false
  let message = ''
  if (isWechatBrowser()) {
    message = '请点击右上角“…”选择“在浏览器中打开”，再使用微信支付。订单也可选择余额支付。'
  } else if (!isMobileBrowser()) {
    message = '请用手机浏览器打开本站使用微信支付。电脑端订单可选择余额支付。'
  }
  if (!message) return true
  uni.showModal({ title: '支付提示', content: message, showCancel: false, confirmText: '我知道了' })
  return false
}
