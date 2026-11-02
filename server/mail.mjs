import nodemailer from 'nodemailer'
import { randomUUID } from 'node:crypto'
import { fail } from './store.mjs'
import { emailAddress, stamp } from './management.mjs'

export class Mailer {
  constructor(store,{transportFactory=nodemailer.createTransport}={}) {this.store=store;this.db=store.db;this.factory=transportFactory;this.busy=false}
  transport(config) {
    return this.factory({host:config.host,port:config.port,secure:config.security==='TLS',requireTLS:config.security==='STARTTLS',auth:{user:config.username,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{minVersion:'TLSv1.2'}})
  }
  test(body,actor) {
    const config=this.store.management.mailSettings(true)
    if(!config.enabled)fail('请先配置并启用邮箱发信')
    const recipient=emailAddress(String(body.recipient||'').trim())
    this.store.management.queueMail({key:'test:'+randomUUID(),event:'TEST',recipient,subject:'授权中心测试邮件',body:'邮箱发信配置测试。收到本邮件表示 SMTP 发信正常。'})
    this.store.audit(actor,'QUEUE_TEST_MAIL',recipient)
    return {queued:true}
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
          const result=await transport.sendMail({from:{name:config.senderName,address:config.from},to:row.recipient,subject:row.subject,text:row.body,disableFileAccess:true,disableUrlAccess:true,messageId:`<${row.id}@cangshuo-authority>`})
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
