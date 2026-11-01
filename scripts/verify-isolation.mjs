import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFile(path.join(root, relative), 'utf8')
const normalize = value => value.replace(/\r\n/g, '\n')
const hash = value => createHash('sha256').update(normalize(value)).digest('hex')
const manifest = JSON.parse(await read('docs/clone-manifest.json'))
const themeOverrides = JSON.parse(await read('docs/theme-overrides.json'))
assert.equal(new Set(themeOverrides.map(entry => entry.path)).size, themeOverrides.length, 'Theme overrides must be unique')
for (const override of themeOverrides) {
  const original = manifest.theme_files.find(entry => entry.path === override.path)
  assert(original && override.reason, `Theme override must describe an existing baseline: ${override.path}`)
  assert.equal(override.original_sha256, original.sha256, `Original theme baseline must be retained: ${override.path}`)
}
const schema = await read('database/01-schema.sql')
const defaults = await read('database/02-defaults.sql')
assert(!/\b(?:INSERT|REPLACE|DELETE|TRUNCATE|DROP|USE)\s+(?:INTO\s+|TABLE\s+)?`?\w+/i.test(schema), 'Schema must not contain customer data or destructive operations')
const inserts = [...defaults.matchAll(/INSERT\s+INTO\s+`?(\w+)/gi)]
assert.equal(inserts.length, 19, 'Only the 19 functional defaults should be seeded')
assert(inserts.every(match => match[1] === 'sys_config'), 'Business tables must start empty')
assert.equal(hash(await read('delta_game.sql')), hash(schema + '\n' + defaults), 'Combined SQL must match the clean schema and defaults')
const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)/gi)].map(match => match[1])
assert.equal(tables.length, 38, 'All 38 business tables must be retained')
assert.equal(new Set(tables).size, tables.length)

for (const profile of ['dev', 'prod']) {
  const text = await read(`delta-game/delta-admin/src/main/resources/application-${profile}.yml`)
  for (const value of ['${DB_PASSWORD}', '${REDIS_PASSWORD}', '${AES_KEY}', '${JWT_SECRET}', 'client742_game', '17423', '17424']) {
    assert(text.includes(value), `Missing isolated setting ${value} in ${profile}`)
  }
  assert(!/kkimg\.top|lenglengyou|SMS_\d+/.test(text), 'Old customer configuration must not remain')
}
assert((await read('delta-admin-ui/src/utils/auth.js')).includes('client742_admin_token'))
assert((await read('delta-mp/utils/client-storage.js')).includes("'client742:'"))

async function inspect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (['node_modules', 'dist', 'target', '.git'].includes(entry.name)) continue
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) await inspect(relative)
    else if (/\.(js|vue)$/.test(entry.name) && entry.name !== 'client-storage.js') {
      const text = await read(relative)
      assert(!/uni\.(?:get|set|remove)StorageSync\s*\(/.test(text), `${relative} bypasses isolated storage`)
    }
  }
}
await inspect('delta-mp')

let themeChecks = 0
for (const entry of manifest.theme_files || []) {
  const text = await read(entry.path)
  const value = entry.path.endsWith('.vue')
    ? [...normalize(text).matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]).join('\n')
    : normalize(text)
  const override = themeOverrides.find(item => item.path === entry.path)
  assert.equal(hash(value), override?.sha256 || entry.sha256, `Theme changed without a recorded update: ${entry.path}`)
  themeChecks++
}
assert(themeChecks > 100, 'Original theme baseline must be present')
console.log(JSON.stringify({ passed: true, tables: tables.length, technicalDefaults: inserts.length, originalThemeFiles: themeChecks - themeOverrides.length, requestedThemeUpdates: themeOverrides.length, customerRecords: 0 }, null, 2))
