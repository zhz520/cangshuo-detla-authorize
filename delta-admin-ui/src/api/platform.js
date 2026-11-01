import request from '@/utils/request'

export const getPlatformOverview = () => request.get('/admin/platform/overview')
export const getPlatformFeatures = () => request.get('/admin/platform/features')
export const getPlatformUpdates = () => request.get('/admin/platform/updates')
export const importPlatformLicense = envelope => request.post('/admin/platform/license/import', envelope)
export const setPlatformFeatureEnabled = (id, enabled) => request.put(`/admin/platform/features/${encodeURIComponent(id)}/enabled`, { enabled })
export const getIncomeComparison = params => request.get('/admin/platform/reports/income', { params })
