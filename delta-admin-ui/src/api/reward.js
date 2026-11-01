import request from '@/utils/request'
export const getRewardGrabSettings = () => request.get('/admin/reward-grab/settings')
export const saveRewardGrabSettings = data => request.put('/admin/reward-grab/settings',data)
export const getRewards = params => request.get('/admin/rewards',{params})
export const reverseReward = (id,reason) => request.post(`/admin/rewards/${id}/reverse`,{reason})
export const getGrabMetrics = id => request.get(`/admin/player/${id}/grab-metrics`)
