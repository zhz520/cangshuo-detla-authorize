import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('payment configuration uses independent methods and contains no browser auto-detection copy', async () => {
  const ops = await read('../src/Operations.vue')
  assert.match(ops, /支付方式彼此独立/)
  assert.match(ops, /不会根据浏览器或 User-Agent 自动切换支付方式/)
  assert.match(ops, /项目开放支付方式/)
  assert.doesNotMatch(ops, /公众号支付（OFFICIAL）用于微信内置浏览器/)
})

test('WeChat fields are required only by the methods that use them', async () => {
  const server = await read('../server/management.mjs')
  assert.match(server, /requiredFor:\['H5','JSAPI','NATIVE','APP'\]/)
  assert.match(server, /requiredFor:\['OFFICIAL'\]/)
})
