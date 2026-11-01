import { clientStorage } from '@/utils/client-storage'
/**
 * Token 存取管理
 * - user_token：用户端专用
 * - player_token：接单员端专用，从用户端切换到接单员端时调用 switch-to-player 获取并保存
 * - cs_token：仅客服端
 * 每次切换到接单员端都需重新获取 player_token
 */

const USER_TOKEN_KEY = 'user_token'
const PLAYER_TOKEN_KEY = 'player_token'
const CS_TOKEN_KEY = 'cs_token'

// ========== 用户 Token ==========
export function getUserToken() {
  return clientStorage.get(USER_TOKEN_KEY) || ''
}

export function setUserToken(token) {
  clientStorage.set(USER_TOKEN_KEY, token)
}

export function removeUserToken() {
  clientStorage.remove(USER_TOKEN_KEY)
}

// ========== 接单员 Token（切换接单员端时获取并保存） ==========
export function getPlayerToken() {
  return clientStorage.get(PLAYER_TOKEN_KEY) || ''
}

export function setPlayerToken(token) {
  clientStorage.set(PLAYER_TOKEN_KEY, token)
}

export function removePlayerToken() {
  clientStorage.remove(PLAYER_TOKEN_KEY)
}

// ========== 客服Token ==========
const CS_INFO_KEY = 'cs_info'

export function getCsToken() {
  return clientStorage.get(CS_TOKEN_KEY) || ''
}

export function setCsToken(token) {
  clientStorage.set(CS_TOKEN_KEY, token)
}

export function getCsInfo() {
  return clientStorage.get(CS_INFO_KEY) || null
}

export function setCsInfo(info) {
  clientStorage.set(CS_INFO_KEY, info)
}

export function removeCsToken() {
  clientStorage.remove(CS_TOKEN_KEY)
  clientStorage.remove(CS_INFO_KEY)
}

// ========== 按角色取 token ==========
export function getTokenByRole(role) {
  if (role === 'cs') return getCsToken()
  if (role === 'player') return getPlayerToken()
  return getUserToken()
}

// ========== 清除全部token ==========
export function clearAllTokens() {
  removeUserToken()
  removePlayerToken()
  removeCsToken()
}
