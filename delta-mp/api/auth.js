import { get, post } from './request'
export const getLoginCaptcha = () => get('/user/auth/captcha', {}, { auth: false, loading: false })
export const sendLoginCode = (data) => post('/user/auth/sms-code', data, { auth: false })

/** 用户微信登录 */
export const userLogin = (code, phoneCode) => post('/user/auth/login', { code, phoneCode }, { auth: false })

/** H5 手机号验证码登录 */
export const h5Login = (data) => post('/user/auth/h5-login', data, { auth: false })
export const setupUserPassword = data => post('/user/auth/set-password',data,{auth:false})
export const userPasswordLogin = data => post('/user/auth/password-login',data,{auth:false})

/** 用户切换到打手端：携带 user_token，返回 player_token（每次切换都需重新获取） */
export const switchToPlayerToken = () => post('/user/auth/switch-to-player', {}, { role: 'user', loading: true })
