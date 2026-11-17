import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

test('global dialog and drawer wrappers are portaled outside animated page content', () => {
  const ui = read('authority-ui.js')
  assert.match(ui, /appendToBody:\s*attrs\.appendToBody\s*\?\?\s*true/)
  assert.match(ui, /const Dialog\s*=\s*appendOverlayToBody\(ElDialog, 'ElDialog'\)/)
  assert.match(ui, /const Drawer\s*=\s*appendOverlayToBody\(ElDrawer, 'ElDrawer'\)/)
  assert.doesNotMatch(read('style.css'), /to\s*\{\s*opacity:\s*1;\s*transform:\s*translateY\(0\);\s*\}/)
})

test('tall overlays fit the viewport, scroll only their body, and keep the footer visible', () => {
  const css = read('styles/redesign.css')
  assert.match(css, /\.el-overlay-dialog\s*\{[\s\S]*?place-items:\s*center;[\s\S]*?padding:\s*var\(--admin-dialog-gap\)\s+16px;/)
  assert.match(css, /max-height:\s*calc\(100dvh - var\(--admin-dialog-gap\) - var\(--admin-dialog-gap\)\)/)
  assert.match(css, /\.el-overlay-dialog \.el-dialog__body\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-y:\s*auto;/)
  assert.match(css, /\.el-overlay-dialog \.el-dialog__header,[\s\S]*?\.el-overlay-dialog \.el-dialog__footer\s*\{\s*flex:\s*0 0 auto;/)
})
