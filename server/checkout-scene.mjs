// P0: only mobile WeChat invokes JSAPI. Desktop WeChat also sends MicroMessenger.
export function isMobileWechat(userAgent = '') {
  return /MicroMessenger/i.test(userAgent) &&
    !/WindowsWechat|MacWechat|WeChatWin|WeChatMac|Windows NT|X11/i.test(userAgent) &&
    /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|OpenHarmony/i.test(userAgent)
}

export function checkoutPath(token, kind = '') {
  return '/pay/' + (kind ? kind + '-package/' : '') + encodeURIComponent(token)
}

export function officialCheckoutScene(token, kind, request, payment) {
  const mobileWechat = isMobileWechat(request?.headers?.['user-agent'])
  const awaitingConfirmation = new URL(request?.url || '/', 'http://localhost').searchParams.get('paid') === '1'
  return {
    mobileWechat,
    awaitingConfirmation,
    payMarkup: awaitingConfirmation || payment === 'PAID'
      ? '<p>正在确认支付结果，请勿重复付款。</p>'
      : mobileWechat
      ? `<a class="primary" id="official-pay" href="/api/pay/wx/oauth?token=${encodeURIComponent(token)}${kind ? '&amp;kind=' + kind : ''}">微信支付</a>`
      : `<p>使用手机微信扫一扫，打开收款页完成支付</p>`,
    autoPayScript: mobileWechat && !awaitingConfirmation && payment !== 'PAID'
      ? "location.replace(document.getElementById('official-pay').href);"
      : ''
  }
}
