import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getSiteConfig } from '@/api/config'

export const useSiteStore = defineStore('site', () => {
  const siteName = ref('斜阳电竞')
  const subtitle = ref('专业游戏平台')
  const logo = ref('/static/images/742-logo.jpg')
  const adminTitle = ref('斜阳电竞管理后台')
  /** 接单员端抽佣比例（百分比，如 10 表示 10%），由接口 /system/config/site 返回 player_commission_rate */
  const playerCommissionRate = ref(0)
  /** 打手入驻押金开关 */
  const depositRequired = ref(true)
  /** 后台微信支付总开关 */
  const wxPayEnabled = ref(false)
  /** 公告是否在浏览器刷新后再次展示 */
  const noticePopupEveryVisit = ref(false)
  const techSupportText = ref('斜阳电竞提供技术支持')
  const techSupportUrl = ref('')
  let pendingConfigRequest = null
  let noticePopupShownThisSession = false

  /** 完整平台名称（用于协议等文案） */
  const fullName = computed(() => siteName.value + '平台')

  async function fetchSiteConfig() {
    if (pendingConfigRequest) return pendingConfigRequest
    pendingConfigRequest = (async () => {
      try {
        const res = await getSiteConfig()
        const data = res.data || {}
        if (data.site_name) siteName.value = data.site_name
        if (data.site_subtitle) subtitle.value = data.site_subtitle
        if (data.site_logo) logo.value = data.site_logo
        if (data.site_admin_title) adminTitle.value = data.site_admin_title
        if (data.player_commission_rate !== undefined && data.player_commission_rate !== null) {
          playerCommissionRate.value = Number(data.player_commission_rate) || 0
        }
        if (data.player_deposit_required !== undefined) {
          depositRequired.value = data.player_deposit_required === 'true'
        }
        if (data.wx_pay_enabled !== undefined) {
          wxPayEnabled.value = data.wx_pay_enabled === 'true'
        }
        if (data.notice_popup_every_visit !== undefined) {
          noticePopupEveryVisit.value = data.notice_popup_every_visit === 'true'
        }
        if (data.tech_support_text !== undefined) {
          techSupportText.value = String(data.tech_support_text || '').trim() || '斜阳电竞提供技术支持'
        }
        if (data.tech_support_url !== undefined) {
          techSupportUrl.value = String(data.tech_support_url || '').trim()
        }
      } catch (e) {
        console.warn('[SiteStore] fetch site config failed', e)
      } finally {
        pendingConfigRequest = null
      }
    })()
    return pendingConfigRequest
  }

  function hasShownNoticePopupThisSession() {
    return noticePopupShownThisSession
  }

  function markNoticePopupShownThisSession() {
    noticePopupShownThisSession = true
  }

  return { siteName, subtitle, logo, adminTitle, playerCommissionRate, depositRequired, wxPayEnabled, noticePopupEveryVisit, techSupportText, techSupportUrl, fullName, fetchSiteConfig, hasShownNoticePopupThisSession, markNoticePopupShownThisSession }
})
