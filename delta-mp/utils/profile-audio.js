import { getPlayerToken } from './auth'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
const MAX_AUDIO_SIZE = 10 * 1024 * 1024
const AUDIO_EXTENSION = /\.(mp3|m4a|wav|aac|ogg|webm)$/i

function readUploadResponse(status, data) {
  if (status === 401 || status === 403) throw new Error('登录已失效或无上传权限，请重新登录')
  if (status < 200 || status >= 300) throw new Error('上传失败，请稍后重试')
  let body
  try { body = typeof data === 'string' ? JSON.parse(data) : data } catch (_) {
    throw new Error('上传响应异常，请稍后重试')
  }
  if (body?.code !== 200) throw new Error(body?.msg || '上传失败')
  if (typeof body.data !== 'string' || !body.data.trim()) throw new Error('上传未返回音频地址')
  return body.data
}

export function uploadProfileAudio(file, name = 'voice.mp3') {
  const token = getPlayerToken()
  if (!token) return Promise.reject(new Error('请先登录接单员账号'))
  if (!AUDIO_EXTENSION.test(name)) return Promise.reject(new Error('请选择mp3、m4a、wav、aac、ogg或webm音频'))

  // #ifdef H5
  if (!(file instanceof Blob) || file.size === 0) return Promise.reject(new Error('音频文件为空'))
  if (file.size > MAX_AUDIO_SIZE) return Promise.reject(new Error('音频不能超过10MB'))
  // XHR 在内置浏览器中也可用，并提供统一的超时和 HTTP 状态检查。
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const form = new FormData()
    form.append('file', file, name)
    request.open('POST', BASE_URL + '/common/file/profile-audio')
    request.timeout = 60000
    request.setRequestHeader('Authorization', 'Bearer ' + token)
    request.onload = () => {
      try { resolve(readUploadResponse(request.status, request.responseText)) } catch (error) { reject(error) }
    }
    request.onerror = () => reject(new Error('上传失败，请检查网络连接'))
    request.ontimeout = () => reject(new Error('上传超时，请重试'))
    request.onabort = () => reject(new Error('上传已取消'))
    request.send(form)
  })
  // #endif
  // #ifndef H5
  if (typeof file !== 'string' || !file) return Promise.reject(new Error('音频文件不存在'))
  return new Promise((resolve, reject) => uni.uploadFile({
    url: BASE_URL + '/common/file/profile-audio',
    filePath: file,
    name: 'file',
    timeout: 60000,
    header: { Authorization: 'Bearer ' + token },
    success: result => {
      try { resolve(readUploadResponse(result.statusCode, result.data)) } catch (error) { reject(error) }
    },
    fail: () => reject(new Error('上传失败，请检查网络后重试'))
  }))
  // #endif
}
