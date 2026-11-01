const tabPages = ['/pages/index/index', '/pages/category/index', '/pages/players/index', '/pages/chat/list', '/pages/mine/index']
export function bannerAction(item) {
  const value = String(item.linkValue || item.linkUrl || '').trim()
  if (!value || item.linkType === 'none') return { type: 'preview', url: item.imageUrl }
  if (item.linkType === 'product' && /^\d+$/.test(value)) return { type: 'page', url: `/pages/product/detail?id=${value}` }
  if (/^\/pages(?:-player|-cs)?\/[\w/-]+(?:\?[^\s]*)?$/.test(value)) {
    return { type: tabPages.includes(value.split('?')[0]) ? 'tab' : 'page', url: value }
  }
  if (/^https?:\/\/[^\s]+$/i.test(value)) {
    try { const url = new URL(value); if (url.hostname && !url.username && !url.password) return { type: 'external', url: url.href } } catch {}
  }
  return { type: 'invalid' }
}
