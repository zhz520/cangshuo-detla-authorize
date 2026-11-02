import nodemailer from 'nodemailer'
import { randomUUID } from 'node:crypto'
import { fail } from './store.mjs'
import { emailAddresses, stamp } from './management.mjs'

const EVENT_STYLES = {
  TEST: { label: '邮箱配置测试', accent: '#2563eb', soft: '#eff6ff' },
  RELEASE: { label: '正式版本发布', accent: '#202328', soft: '#f2f4f7' },
  UPDATE_RESULT: { label: '客户端更新通知', accent: '#157a55', soft: '#edf9f3' },
  MAINTENANCE_REMINDER: { label: '维护期提醒', accent: '#b86a13', soft: '#fff7e8' },
  RENEWED: { label: '维护期续期', accent: '#157a55', soft: '#edf9f3' },
  ACTIVE: { label: '项目状态更新', accent: '#2563eb', soft: '#eff6ff' },
  EXPIRED: { label: '项目状态提醒', accent: '#b43b48', soft: '#fff1f2' },
  PAUSED: { label: '项目状态提醒', accent: '#6b7280', soft: '#f3f4f6' }
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))

export function renderNotificationHtml({event,subject,body,brand='沧烁授权中心'}) {
  const baseStyle=EVENT_STYLES[event]||{label:'系统通知',accent:'#536273',soft:'#f3f5f8'}
  const style=event==='UPDATE_RESULT'&&/失败|回退/.test(subject)?{label:'客户端更新异常',accent:'#b43b48',soft:'#fff1f2'}:baseStyle
  const paragraphs=String(body??'').split(/\n+/).map(value=>value.trim()).filter(Boolean).map(value=>`<p style="margin:0 0 14px;color:#3f4a59;font-size:15px;line-height:1.8">${escapeHtml(value)}</p>`).join('')
  return `<!doctype html>
<html lang="zh-CN" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f5f8;color:#202328;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f5f8">
    <tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;overflow:hidden;border:1px solid #e4e8ee;border-radius:18px;background:#ffffff;box-shadow:0 12px 34px rgba(31,42,58,.07)">
        <tr><td style="padding:24px 28px;background:#202328;color:#ffffff">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="width:42px;vertical-align:middle"><div style="width:38px;height:38px;line-height:38px;border-radius:11px;background:#ffffff;color:#202328;text-align:center;font-size:19px;font-weight:800">C</div></td>
            <td style="padding-left:13px;vertical-align:middle"><div style="font-size:16px;font-weight:700;line-height:1.35">${escapeHtml(brand)}</div><div style="margin-top:3px;color:#aeb6c2;font-size:11px;letter-spacing:1.4px">AUTOMATED NOTICE</div></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:30px 28px 8px">
          <span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${style.soft};color:${style.accent};font-size:12px;font-weight:700">${escapeHtml(style.label)}</span>
          <h1 style="margin:16px 0 20px;color:#17191c;font-size:24px;line-height:1.4;font-weight:750">${escapeHtml(subject)}</h1>
          <div style="padding:20px 22px;border:1px solid #e8ebf0;border-radius:12px;background:#fafbfc">${paragraphs||'<p style="margin:0;color:#3f4a59">请登录授权运营中心查看详情。</p>'}</div>
        </td></tr>
        <tr><td style="padding:18px 28px 26px">
          <div style="height:1px;background:#eceff3;margin-bottom:16px"></div>
          <p style="margin:0;color:#8a94a3;font-size:12px;line-height:1.7">这是由授权运营中心自动发送的业务通知，请勿直接回复。<br>如需处理，请登录授权运营中心查看相关项目与记录。</p>
        </td></tr>
      </table>
      <p style="margin:14px 0 0;color:#9ba4b1;font-size:11px">${escapeHtml(brand)} · 系统通知</p>
    </td></tr>
  </table>
</body>
</html>`
}

export class Mailer {
  constructor(store,{transportFactory=nodemailer.createTransport}={}) {this.store=store;this.db=store.db;this.factory=transportFactory;this.busy=false}
  transport(config) {
    return this.factory({host:config.host,port:config.port,secure:config.security==='TLS',requireTLS:config.security==='STARTTLS',auth:{user:config.username,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{minVersion:'TLSv1.2'}})
  }
  test(body,actor) {
    const config=this.store.management.mailSettings(true)
    if(!config.enabled)fail('请先配置并启用邮箱发信')
    const recipients=emailAddresses(body.recipients ?? body.recipient,{label:'测试收件邮箱'})
    if(!recipients.length)fail('请填写测试收件邮箱')
    const batch=randomUUID()
    for(const recipient of recipients)this.store.management.queueMail({key:'test:'+batch,event:'TEST',recipient,subject:'授权中心测试邮件',body:'邮箱发信配置测试。收到本邮件表示 SMTP 发信正常。'})
    this.store.audit(actor,'QUEUE_TEST_MAIL',recipients.join(','))
    return {queued:true,recipients}
  }
  retry(id,actor) {
    const row=this.db.prepare('SELECT status FROM mail_queue WHERE id=?').get(id)
    if(!row||!['FAILED','RETRY'].includes(row.status))fail('只有失败邮件可以重试')
    this.db.prepare("UPDATE mail_queue SET status='PENDING',attempts=0,next_attempt_at=?,last_error=NULL WHERE id=?").run(stamp(),id)
    this.store.audit(actor,'RETRY_MAIL',id);return {queued:true}
  }
  async process() {
    if(this.busy)return
    const config=this.store.management.mailSettings(true);if(!config.enabled)return
    this.busy=true;let transport
    try {
      transport=this.transport(config)
      const rows=this.db.prepare("SELECT * FROM mail_queue WHERE status IN ('PENDING','RETRY') AND next_attempt_at<=? ORDER BY created_at LIMIT 10").all(stamp())
      for(const row of rows) {
        try {
          const result=await transport.sendMail({from:{name:config.senderName,address:config.from},to:row.recipient,subject:row.subject,text:row.body,html:renderNotificationHtml({event:row.event,subject:row.subject,body:row.body,brand:config.senderName}),disableFileAccess:true,disableUrlAccess:true,messageId:`<${row.id}@cangshuo-authority>`})
          if(result.rejected?.length)throw Object.assign(new Error('rejected'),{code:'EREJECTED'})
          this.db.prepare("UPDATE mail_queue SET status='SENT',attempts=attempts+1,sent_at=?,last_error=NULL WHERE id=?").run(stamp(),row.id)
        } catch(error) {
          const attempts=row.attempts+1, safeError=/^[A-Z0-9_]{1,40}$/.test(error.code||'')?error.code:'SMTP_SEND_FAILED'
          this.db.prepare('UPDATE mail_queue SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?').run(attempts>=5?'FAILED':'RETRY',attempts,new Date(Date.now()+Math.min(3600000,60000*2**attempts)).toISOString(),safeError,row.id)
        }
      }
    } finally {try{transport?.close?.()}finally{this.busy=false}}
  }
}
