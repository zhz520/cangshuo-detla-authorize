/** Keep the layout viewport and the keyboard-visible viewport separate on WebViews. */
export function viewportMetrics({ width, height, visualHeight = height, visualTop = 0, scale = 1, focused = false, baseline = height }) {
  const zoomed = Math.abs(scale - 1) > 0.05
  const visibleHeight = zoomed ? height : Math.min(height, visualHeight)
  const top = zoomed ? 0 : Math.max(0, visualTop)
  const bottom = zoomed ? 0 : Math.max(0, height - visibleHeight - top)
  const keyboardOpen = focused && (bottom > 100 || baseline - visibleHeight > Math.max(100, baseline * 0.15))
  return { width: Math.min(540, width), height, visibleHeight, top, bottom, keyboardOpen }
}

let installed = false

export function installViewportAdapter() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const root = document.documentElement
  const viewport = window.visualViewport
  let frame = 0
  let baseline = window.innerHeight
  let previousWidth = window.innerWidth
  let revealTimer

  const isEditable = (element) => element && (element.matches('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea') || element.isContentEditable)
  const setPx = (element, name, value) => {
    const next = `${Math.max(0, Math.round(value * 100) / 100)}px`
    if (element.style.getPropertyValue(name) !== next) element.style.setProperty(name, next)
  }

  function update() {
    frame = 0
    const width = root.clientWidth || window.innerWidth
    const focused = isEditable(document.activeElement)
    if (Math.abs(previousWidth - width) > 80) baseline = window.innerHeight
    previousWidth = width
    if (!focused) baseline = window.innerHeight
    const metrics = viewportMetrics({
      width, height: window.innerHeight, visualHeight: viewport?.height,
      visualTop: viewport?.offsetTop, scale: viewport?.scale, focused, baseline
    })
    setPx(root, '--app-viewport-height', metrics.height)
    setPx(root, '--app-visible-height', metrics.visibleHeight)
    setPx(root, '--app-viewport-top', metrics.top)
    setPx(root, '--app-viewport-bottom', metrics.bottom)
    setPx(root, '--app-content-width', metrics.width)
    setPx(root, '--app-content-left', (width - metrics.width) / 2)
    root.dataset.keyboardOpen = String(metrics.keyboardOpen)

    // uni-app keeps cached pages mounted; each page can have a different native header.
    document.querySelectorAll('uni-page').forEach((page) => {
      const header = page.querySelector('uni-page-head .uni-page-head')
      const headerHeight = header ? header.getBoundingClientRect().height : 0
      setPx(page, '--app-page-height', metrics.height - headerHeight)
      setPx(page, '--app-visible-page-height', metrics.visibleHeight - Math.max(0, headerHeight - metrics.top))
    })
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(update)
  }

  function revealInput() {
    clearTimeout(revealTimer)
    schedule()
    revealTimer = setTimeout(() => {
      update()
      const active = document.activeElement
      if (!isEditable(active) || active.closest('.input-bar')) return
      const rect = active.getBoundingClientRect()
      const visibleBottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight)
      if (rect.bottom > visibleBottom - 16 || rect.top < (viewport?.offsetTop || 0)) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }, 320)
  }

  window.addEventListener('resize', schedule, { passive: true })
  window.addEventListener('orientationchange', () => {
    schedule()
    setTimeout(schedule, 250)
  }, { passive: true })
  window.addEventListener('pageshow', schedule)
  viewport?.addEventListener('resize', schedule, { passive: true })
  viewport?.addEventListener('scroll', schedule, { passive: true })
  document.addEventListener('focusin', revealInput)
  document.addEventListener('focusout', () => {
    schedule()
    setTimeout(schedule, 350)
  })
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  update()
}
