const route=/^\/chat\/([a-z0-9][a-z0-9-]{1,47})(?:\/(agent))?\/?$/.exec(location.pathname)
const showError=message=>{
  const status=document.querySelector('.support-boot')||document.getElementById('app')
  status.textContent=message
  status.setAttribute('role','alert')
}
if(route){
  import('./support-ui.js').then(({mountSupport})=>mountSupport(route[1],Boolean(route[2])))
    .catch(()=>showError('客服页面加载失败，请刷新重试。'))
}else showError('请通过正确的客服链接访问。')
