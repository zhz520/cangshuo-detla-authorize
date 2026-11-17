import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFile(resolve(root, path), 'utf8')

test('overview start flow opens project creation and boot/icons keep the monochrome shell', async () => {
  const app = await read('src/App.vue')
  const operations = await read('src/Operations.vue')
  const css = await read('src/styles/redesign.css')

  assert.doesNotMatch(app, /@click="open\('project'\)"/)
  assert.match(app, /startProjectFlow/)
  assert.match(app, /operationsCreateRequest/)
  assert.match(app, /:create-request="operationsCreateRequest"/)
  assert.match(app, /@consume-create-request/)
  assert.match(operations, /createRequest/)
  assert.match(operations, /consume-create-request/)
  assert.match(operations, /edit\('project'\)/)
  assert.match(css, /\.boot\s*\{[^}]*background:\s*#f7f8fa/)
  assert.match(css, /\.shell \.stats \.stat-icon\s*\{[^}]*display:\s*grid/)
  assert.match(css, /\.shell \.stats \.stat-icon svg\s*\{[^}]*max-width:\s*15px/)
  assert.match(css, /\.shell \.stats \.stat-arrow\s*\{[^}]*font-size:\s*22px/)
})
