// SQLite has no ADD COLUMN IF NOT EXISTS; keep upgrades and restarts idempotent.
export function ensureIdentityPackagePaymentOpenid(db) {
  if (!db.prepare('PRAGMA table_info(identity_package_payments)').all().some(row => row.name === 'openid')) {
    db.exec('ALTER TABLE identity_package_payments ADD COLUMN openid TEXT')
  }
}
