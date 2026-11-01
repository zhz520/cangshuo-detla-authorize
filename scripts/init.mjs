import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
const root = path.resolve('.')
if (process.platform === 'win32' && !/^D:\\/i.test(root)) throw new Error('项目与生成文件必须保存在 D 盘')
const directory = path.resolve(process.env.DATA_DIR || '.local'), config = path.resolve(process.env.AUTHORITY_ENV_FILE || '.env.local')
for (const target of [config, path.join(directory, 'license-private.pem')]) { try { await access(target); throw new Error('初始化文件已存在，拒绝覆盖密钥或登录配置') } catch (error) { if (error.code !== 'ENOENT') throw error } }
await mkdir(directory, { recursive: true })
const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
await writeFile(path.join(directory, 'license-private.pem'), keys.privateKey, { flag: 'wx', mode: 0o600 })
await writeFile(path.join(directory, 'license-public.pem'), keys.publicKey, { flag: 'wx', mode: 0o644 })
await writeFile(config, `HOST=127.0.0.1\nPORT=17441\nDATA_DIR=${directory.replaceAll('\\', '/')}\nAUTHORITY_PRIVATE_KEY=${path.join(directory,'license-private.pem').replaceAll('\\','/')}\nOWNER_USERNAME=admin\nOWNER_PASSWORD=Aa1${randomBytes(24).toString('base64url')}\nCOOKIE_SECURE=false\n`, { flag: 'wx', mode: 0o600 })
console.log(`初始化完成。登录信息保存在 ${config}；密码和私钥未输出。`)
