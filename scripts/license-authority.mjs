import { generateKeyPairSync, createPrivateKey, randomUUID, sign, verify, createPublicKey } from 'node:crypto'
import { readFile, mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

export const FORMAT = 'delta-license-v1'
export function issueEnvelope(privateKey, claims) {
  if (createPrivateKey(privateKey).asymmetricKeyType !== 'ed25519') throw new Error('签发密钥必须为 Ed25519')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return { format: FORMAT, payload, signature: sign(null, Buffer.from(`${FORMAT}.${payload}`), privateKey).toString('base64url') }
}
export function verifyEnvelope(publicKey, envelope) {
  return envelope.format === FORMAT && verify(null, Buffer.from(`${FORMAT}.${envelope.payload}`), createPublicKey(publicKey), Buffer.from(envelope.signature, 'base64url'))
}
function outputPath(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('请使用绝对输出路径')
  const result = path.resolve(value)
  if (process.platform === 'win32' && !/^D:\\/i.test(result)) throw new Error('输出文件必须位于 D 盘')
  return result
}
async function exclusiveWrite(target, content, mode = 0o600) {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, { flag: 'wx', mode })
}
function instant(value, label) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label}需使用带时区的 ISO 时间`)
  return new Date(value).toISOString()
}
async function main() {
  const [command, ...tokens] = process.argv.slice(2)
  if (tokens.length % 2) throw new Error('参数格式应为 --参数 值')
  const options = Object.fromEntries(Array.from({ length: tokens.length / 2 }, (_, i) => [tokens[i * 2], tokens[i * 2 + 1]]))
  if (command === 'keygen') {
    const privatePath = outputPath(options['--private-key']), publicPath = outputPath(options['--public-key'])
    if (privatePath === publicPath) throw new Error('公钥与私钥路径不能相同')
    for (const target of [privatePath, publicPath]) {
      try { await access(target); throw new Error('目标密钥文件已存在，不能覆盖') } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type:'pkcs8', format:'pem' }, publicKeyEncoding: { type:'spki', format:'pem' } })
    await exclusiveWrite(privatePath, keys.privateKey)
    await exclusiveWrite(publicPath, keys.publicKey, 0o644)
    console.log('签发密钥已生成。私钥只保留在签发端；客户系统仅配置公钥。')
    return
  }
  if (command === 'issue') {
    const customerId = options['--customer'], instanceId = options['--instance']
    if (!customerId || !/^[A-Za-z0-9_-]{1,64}$/.test(customerId)) throw new Error('客户编号不正确')
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(instanceId || '')) throw new Error('实例编号应从客户后台复制')
    const catalogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../delta-game/delta-admin/src/main/resources/platform/catalog.json')
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
    const features = (options['--features'] || '').split(',').map(value => value.trim()).filter(Boolean)
    if (!features.length || new Set(features).size !== features.length || features.some(id => !catalog.features.some(feature => feature.id === id && feature.paid))) throw new Error('只能签发目录内的付费模块，多个编号以逗号分隔')
    const issuedAt = new Date().toISOString(), notBefore = options['--not-before'] ? instant(options['--not-before'], '生效时间') : issuedAt
    if (!options['--expires']) throw new Error('必须指定 --expires ISO时间 或 --expires never')
    const expiresAt = options['--expires'] === 'never' ? null : instant(options['--expires'], '到期时间')
    if (expiresAt && (Date.parse(expiresAt) <= Date.parse(notBefore) || Date.parse(expiresAt) <= Date.now())) throw new Error('到期时间必须晚于生效时间和当前时间')
    const target = outputPath(options['--out'])
    if (!target.endsWith('.license.json')) throw new Error('授权输出文件名须以 .license.json 结尾')
    const key = await readFile(options['--private-key'], 'utf8')
    const envelope = issueEnvelope(key, { licenseId: randomUUID(), customerId, instanceId, issuedAt, notBefore, expiresAt, features })
    await exclusiveWrite(target, JSON.stringify(envelope, null, 2) + '\n')
    console.log(`授权已签发：客户 ${customerId}，模块 ${features.join(', ')}。文件内容未输出。`)
    return
  }
  throw new Error('用法：node scripts/license-authority.mjs keygen|issue，详细参数见 docs/platform-foundation.md')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.code === 'EEXIST' ? '输出文件已存在，拒绝覆盖。' : '签发失败：' + error.message); process.exitCode = 1 })
}
