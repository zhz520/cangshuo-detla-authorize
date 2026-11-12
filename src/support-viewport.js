export function fitSupportViewport(element, { beforeResize = () => false, afterResize = () => {} } = {}) {
  const viewport=window.visualViewport
  let frame=0,lastHeight=-1,lastTop=-1,active=true
  const update=()=>{
    frame=0
    if(!active)return
    if(viewport&&Math.abs(viewport.scale-1)>0.02)return
    const height=Math.floor(Math.min(viewport?.height||window.innerHeight,window.innerHeight))
    const top=Math.max(0,Math.round(viewport?.offsetTop||0))
    if(height<100||(lastHeight===height&&lastTop===top))return
    const keepEnd=beforeResize()
    element.style.setProperty('--support-height',height+'px')
    element.style.setProperty('--support-top',top+'px')
    element.classList.toggle('support-compact',height<460)
    lastHeight=height;lastTop=top
    afterResize(keepEnd)
  }
  const schedule=()=>{if(!frame&&active)frame=requestAnimationFrame(update)}
  window.addEventListener('resize',schedule)
  window.addEventListener('pageshow',schedule)
  viewport?.addEventListener('resize',schedule)
  viewport?.addEventListener('scroll',schedule)
  update()
  return ()=>{
    active=false;cancelAnimationFrame(frame)
    window.removeEventListener('resize',schedule)
    window.removeEventListener('pageshow',schedule)
    viewport?.removeEventListener('resize',schedule)
    viewport?.removeEventListener('scroll',schedule)
  }
}
