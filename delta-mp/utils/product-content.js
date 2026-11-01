const allowedTags = new Set(['P', 'DIV', 'SPAN', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'IMG', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH'])
const dangerousTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'SVG', 'MATH', 'TEMPLATE', 'VIDEO', 'AUDIO'])
const safeColor = value => /^(#[a-f\d]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]{1,20})$/i.test(value)
const styleRules = {
  'font-size': value => /^(?:1[0-9]|[2-6][0-9]|7[0-2])px$/.test(value),
  color: safeColor,
  'background-color': safeColor,
  'font-weight': value => /^(normal|bold|[1-9]00)$/.test(value),
  'font-style': value => /^(normal|italic)$/.test(value),
  'text-decoration': value => /^(none|underline|line-through|underline line-through)$/.test(value),
  'text-align': value => /^(left|center|right|justify)$/.test(value),
  'line-height': value => /^(1|1\.5|1\.6|1\.8|2|2\.5|3)$/.test(value)
}

function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeUrl(value, image) {
  const source = String(value || '').trim()
  if (!source || /[\u0000-\u001f]/.test(source)) return ''
  if (/^https?:\/\/[^\s]+$/i.test(source)) return source
  if (image && /^\/file\/[\w/.-]+$/.test(source)) return source
  if (!image && /^\/pages(?:-player|-cs)?\/[\w/?=&%.-]+$/.test(source)) return source
  return ''
}

function cleanStyle(value) {
  const safe = []
  String(value || '').split(';').forEach(rule => {
    const index = rule.indexOf(':')
    if (index < 1) return
    const name = rule.slice(0, index).trim().toLowerCase()
    const current = rule.slice(index + 1).trim()
    if (styleRules[name]?.(current)) safe.push(`${name}: ${current}`)
  })
  return safe.join('; ')
}

export function productDescriptionHtml(value) {
  const source = String(value || '').trim()
  if (!source) return ''
  if (!/<[a-z][\s\S]*>/i.test(source)) return escapeText(source).replace(/\r?\n/g, '<br>')
  // Mini-program rich-text does not execute HTML scripts; H5 uses the allowlist below.
  if (typeof DOMParser === 'undefined') return source
  const document = new DOMParser().parseFromString(source, 'text/html')
  const nodes = [...document.body.querySelectorAll('*')].reverse()
  for (let element of nodes) {
    if (!document.body.contains(element)) continue
    if (dangerousTags.has(element.tagName)) {
      element.remove()
      continue
    }
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes)
      continue
    }
    const style = cleanStyle(element.getAttribute('style'))
    const hrefValue = element.getAttribute('href')
    const srcValue = element.getAttribute('src')
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name)
    if (style) element.setAttribute('style', style)
    if (element.tagName === 'A') {
      const href = safeUrl(hrefValue, false)
      if (href) {
        element.setAttribute('href', href)
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noopener noreferrer')
      }
    }
    if (element.tagName === 'IMG') {
      const src = safeUrl(srcValue, true)
      if (src) {
        element.setAttribute('src', src)
        element.setAttribute('loading', 'lazy')
        element.setAttribute('decoding', 'async')
      } else element.remove()
    }
  }
  return document.body.innerHTML
}
