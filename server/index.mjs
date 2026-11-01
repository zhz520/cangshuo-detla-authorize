import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AuthorityStore } from './store.mjs'
import { createAuthorityServer } from './http.mjs'

const envPath = process.env.AUTHORITY_ENV_FILE || '.env.local'
try { process.loadEnvFile(envPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
const data = path.resolve(process.env.DATA_DIR || '.local')
const store = new AuthorityStore({ database: path.join(data, 'authority.sqlite'), privateKey: readFileSync(process.env.AUTHORITY_PRIVATE_KEY || path.join(data, 'license-private.pem'), 'utf8'), ownerUsername: process.env.OWNER_USERNAME, ownerPassword: process.env.OWNER_PASSWORD })
const allowedOrigins = String(process.env.AUTHORITY_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
const server = createAuthorityServer(store, { secureCookie: process.env.COOKIE_SECURE === 'true', staticDirectory: path.resolve('dist'), allowedOrigins })
server.listen(Number(process.env.PORT || 17441), process.env.HOST || '127.0.0.1', () => console.log(`授权运营后台已启动：${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 17441}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0) }))
