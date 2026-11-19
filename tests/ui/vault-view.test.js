import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import VaultView from '../../src/views/VaultView.vue'
import { store } from '../../src/store/vault'

// 组件级测试：键盘导航与快捷键必须只在实际生效的场景触发。
// 注意：不模拟真实解锁/密码输入，仅验证列表与快捷键的接线逻辑。

class ResizeObserverStub {
  observe () {}
  disconnect () {}
}

let wrapper = null

beforeEach(() => {
  global.ResizeObserver = ResizeObserverStub
  window.utools = {
    copyText: vi.fn(() => true),
    shellOpenExternal: vi.fn(),
    setSubInput: vi.fn(() => true),
    removeSubInput: vi.fn(),
    getPath: vi.fn(() => '')
  }
  window.services = {
    clearSession: vi.fn(),
    readSession: vi.fn(() => null),
    storeSession: vi.fn()
  }
  store.locked = false
  store.secured = false
  store.groups = []
  store.initialSearch = ''
  store.entries = [
    { id: 'a', title: 'A', username: 'u1', password: 'p1', url: '', favorite: false },
    { id: 'b', title: 'B', username: 'u2', password: 'p2', url: '', favorite: false }
  ]
})

afterEach(() => {
  if (wrapper) { wrapper.unmount(); wrapper = null }
  window.utools = undefined
  window.services = undefined
})

function mountView () {
  wrapper = mount(VaultView, { attachTo: document.body })
  return wrapper
}

function pressKey (key, opts = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
}

test('↓ 从无选中状态选中第一条并高亮', async () => {
  const w = mountView()
  await nextTick()
  pressKey('ArrowDown')
  await nextTick()
  const cards = w.findAll('.card')
  expect(cards.length).toBeGreaterThan(0)
  expect(cards[0].classes()).toContain('nav-active')
})

test('↑ 在无选中状态时钳制到第一条，再次 ↓ 前进到第二条', async () => {
  const w = mountView()
  await nextTick()
  pressKey('ArrowUp')
  await nextTick()
  expect(w.findAll('.card')[0].classes()).toContain('nav-active')
  pressKey('ArrowDown')
  await nextTick()
  expect(w.findAll('.card')[1].classes()).toContain('nav-active')
})

test('输入框中的方向键不触发列表导航', async () => {
  const w = mountView()
  await nextTick()
  const input = w.find('input')
  expect(input.exists()).toBe(true)
  await input.trigger('keydown', { key: 'ArrowDown' })
  await nextTick()
  expect(w.findAll('.card.nav-active').length).toBe(0)
})

test('Ctrl+L 立即锁定', async () => {
  mountView()
  await nextTick()
  pressKey('l', { ctrlKey: true })
  expect(store.locked).toBe(true)
  expect(window.services.clearSession).toHaveBeenCalled()
})

test('Ctrl+N 打开新建表单', async () => {
  const w = mountView()
  await nextTick()
  pressKey('n', { ctrlKey: true })
  await vi.waitFor(() => {
    expect(w.find('.modal-mask').exists()).toBe(true)
  })
})

test('↓ 选中后 Enter 打开编辑弹层', async () => {
  const w = mountView()
  await nextTick()
  pressKey('ArrowDown')
  await nextTick()
  pressKey('Enter')
  await flushPromises()
  await vi.waitFor(() => {
    expect(w.find('.modal-mask').exists()).toBe(true)
  })
})
