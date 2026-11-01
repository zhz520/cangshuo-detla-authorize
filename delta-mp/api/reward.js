import { get, post } from './request'
export const getRewardOptions = id => get(`/order/${id}/reward`, {}, { role:'user', loading:false })
export const payReward = (id,data) => post(`/order/${id}/reward`,data,{role:'user'})
export const getRewardableOrders = playerId => get('/user/rewards/eligible-orders',{playerId},{role:'user',loading:false})
