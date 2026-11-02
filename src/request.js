// Keep the timer active while JSON is read, including on older embedded browsers.
export async function fetchWithTimeout(url, options = {}, milliseconds = 35000, consume = response => response) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  let timer
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('请求已中断'), { name: 'AbortError' })), { once: true })
    timer = setTimeout(abort, milliseconds)
  })
  try {
    if (controller.signal.aborted) throw Object.assign(new Error('请求已中断'), { name: 'AbortError' })
    return await Promise.race([fetch(url, { ...options, signal: controller.signal }).then(consume), interrupted])
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function createApiClient({ getCsrf, onUnauthorized, getSessionVersion = () => 0, timeout = 35000 }) {
  const pending = new Map()
  return function api(url, { method = 'GET', body } = {}) {
    const sessionVersion = getSessionVersion()
    const key = JSON.stringify([sessionVersion, url, method, body])
    if (pending.has(key)) return pending.get(key)
    const headers = method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() }
    const task = fetchWithTimeout('/api' + url, {
      method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body)
    }, timeout, async response => {
      const checkSession = () => { if (sessionVersion !== getSessionVersion()) throw Object.assign(new Error('会话已变更，请重新操作'), { name: 'StaleSessionError' }) }
      checkSession()
      if (response.status === 401 && url !== '/login') onUnauthorized()
      let result
      try { result = await response.json() } catch { throw new Error('服务返回异常，请刷新或联系维护人员') }
      if (!response.ok) throw new Error(result.message || '操作失败')
      checkSession()
      return result
    }).catch(error => {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('网络连接超时或中断，请检查网络后重试')
      throw error
    }).finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
}
