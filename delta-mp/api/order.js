import { get, post } from './request'

/** 创建订单 */
export const createOrder = (data) => post('/order', data)
export const getOrderQuote = (params) => get('/order/quote', params, { loading: false, toast: false })

/** 订单列表 */
export const getOrderList = (params, opts = {}) => get('/order/my', params, opts)

/** 订单详情 */
export const getOrderDetail = (id) => get(`/order/${id}`)

/** 订单进度 */
export const getOrderProgress = (id) => get(`/order/${id}/progress`)

/** 确认完成 */
export const confirmOrder = (id) => post(`/order/${id}/confirm`)

/** 取消订单 */
export const cancelOrder = (id) => post(`/order/${id}/cancel`)

/** 申请换人 */
export const requestReplace = (id, data) => post(`/order/${id}/replace`, data)

/** 下单可选接单员，仅返回公开展示字段。 */
export const getAvailablePlayers = (params) => get('/order/available-players', params)

/** 指定接单员 */
export const designatePlayer = (id, playerId) => post(`/order/${id}/designate-player`, { playerId })
