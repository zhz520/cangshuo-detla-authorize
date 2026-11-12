import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('payment configuration uses independent methods and contains no browser auto-detection copy', async () => {
  const ops = await read('../src/Operations.vue')
  const payments = await read('../src/PaymentSettings.vue')
  assert.match(ops, /PaymentSettings/)
  assert.doesNotMatch(ops, /paymentForms|uploadPaymentKey|payment-card/)
  assert.match(payments, /支付方式彼此独立/)
  assert.match(payments, /不依据浏览器或 User-Agent 自动切换/)
  assert.match(payments, /项目支付接入/)
  assert.match(payments, /uploadPaymentKey/)
  assert.match(payments, /上传文件/)
  assert.doesNotMatch(payments, /公众号支付（OFFICIAL）用于微信内置浏览器/)
})

test('payment fields stay focused on the selected methods', async () => {
  const {visibleConfigFields} = await import('../src/payment-methods.js')
  const provider = {
    config_schema: [
      {key: 'merchantId', required: true},
      {key: 'appId', requiredFor: ['H5', 'JSAPI', 'NATIVE', 'APP']},
      {key: 'officialAppId', requiredFor: ['OFFICIAL']},
      {key: 'h5AppName', requiredFor: ['H5']}
    ]
  }
  assert.deepEqual(visibleConfigFields(provider, ['OFFICIAL']).map(field => field.key), ['merchantId', 'officialAppId'])
  assert.deepEqual(visibleConfigFields(provider, ['H5']).map(field => field.key), ['merchantId', 'appId', 'h5AppName'])
  assert.deepEqual(visibleConfigFields(provider, []).map(field => field.key), ['merchantId'])
})

test('WeChat fields are required only by the methods that use them', async () => {
  const server = await read('../server/management.mjs')
  assert.match(server, /requiredFor:\['H5','JSAPI','NATIVE','APP'\]/)
  assert.match(server, /requiredFor:\['OFFICIAL'\]/)
  assert.match(server, /uploadPaymentKey/)
})

test('the production payment UI registers the upload component and its styles', async () => {
  const ui = await read('../src/authority-ui.js')
  assert.match(ui, /ElUpload/)
  assert.match(ui, /components\/upload\/style\/css\.mjs/)
})
