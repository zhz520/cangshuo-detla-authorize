import { onBeforeUnmount, onMounted, ref } from 'vue'

// Keep the CSS breakpoints and the drawer/chat behaviour in sync, including rotation.
export function useResponsive() {
  const compactQuery = window.matchMedia('(max-width: 1024px)')
  const narrowQuery = window.matchMedia('(max-width: 768px)')
  const isCompact = ref(compactQuery.matches)
  const isNarrow = ref(narrowQuery.matches)
  const update = () => {
    isCompact.value = compactQuery.matches
    isNarrow.value = narrowQuery.matches
  }
  const listen = (query, remove = false) => {
    // Safari 13 and older embedded WebViews only expose addListener/removeListener.
    if (query.addEventListener) query[remove ? 'removeEventListener' : 'addEventListener']('change', update)
    else query[remove ? 'removeListener' : 'addListener'](update)
  }
  onMounted(() => { update(); listen(compactQuery); listen(narrowQuery) })
  onBeforeUnmount(() => { listen(compactQuery, true); listen(narrowQuery, true) })
  return { isCompact, isNarrow }
}

export function installViewport() {
  const root = document.documentElement
  const viewport = window.visualViewport
  let frame = 0
  const update = () => {
    frame = 0
    // Pinch zoom must remain available without changing the app's layout height.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
    const height = viewport?.height || window.innerHeight
    root.style.setProperty('--app-viewport-height', `${Math.round(height)}px`)
    root.style.setProperty('--app-viewport-top', `${Math.round(viewport?.offsetTop || 0)}px`)
    const input = document.activeElement
    const editing = input?.matches('input, textarea, [contenteditable="true"]')
    const keyboardOpen = editing && window.innerHeight - height > 120
    root.toggleAttribute('data-keyboard-open', Boolean(keyboardOpen))
    if (editing && window.innerWidth <= 1024) {
      const rect = input.getBoundingClientRect()
      const top = viewport?.offsetTop || 0
      if (rect.bottom > top + height || rect.top < top) {
        input.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  document.addEventListener('focusin', schedule)
  document.addEventListener('focusout', schedule)
  update()
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', schedule)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    document.removeEventListener('focusin', schedule)
    document.removeEventListener('focusout', schedule)
  }
}
