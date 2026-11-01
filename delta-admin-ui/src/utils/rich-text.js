import DOMPurify from 'dompurify'

const sizes = { 1: '12px', 2: '14px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' }
const color = value => /^(#[a-f\d]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]{1,20})$/i.test(value)
const allowedStyles = {
  'font-size': value => /^(?:1[0-9]|[2-6][0-9]|7[0-2])px$/.test(value),
  color,
  'background-color': color,
  'font-weight': value => /^(normal|bold|[1-9]00)$/.test(value),
  'font-style': value => /^(normal|italic)$/.test(value),
  'text-decoration': value => /^(none|underline|line-through|underline line-through)$/.test(value),
  'text-align': value => /^(left|center|right|justify)$/.test(value),
  'line-height': value => /^(1|1\.5|1\.6|1\.8|2|2\.5|3)$/.test(value)
}

export function sanitizeRichText(html) {
  const fragment = DOMPurify.sanitize(html || '', {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'div', 'span', 'font', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'color', 'size', 'width', 'height', 'colspan', 'rowspan'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/file\/)/i
  })
  fragment.querySelectorAll('*').forEach(element => {
    if (element.tagName === 'FONT') {
      const span = document.createElement('span')
      span.setAttribute('style', element.getAttribute('style') || '')
      if (sizes[element.getAttribute('size')]) span.style.fontSize = sizes[element.getAttribute('size')]
      if (color(element.getAttribute('color') || '')) span.style.color = element.getAttribute('color')
      span.append(...element.childNodes)
      element.replaceWith(span)
      element = span
    }
    const safe = []
    for (const [property, validate] of Object.entries(allowedStyles)) {
      const value = element.style.getPropertyValue(property).trim()
      if (validate(value)) safe.push(`${property}: ${value}`)
    }
    element.removeAttribute('style'); element.removeAttribute('color'); element.removeAttribute('size')
    if (safe.length) element.setAttribute('style', safe.join('; '))
    if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer')
    if (element.tagName === 'IMG') {
      if (!/^(?:https?:\/\/|\/file\/)/i.test(element.getAttribute('src') || '')) element.removeAttribute('src')
      element.setAttribute('loading', 'lazy'); element.setAttribute('decoding', 'async')
      element.removeAttribute('width'); element.removeAttribute('height')
    }
  })
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}
