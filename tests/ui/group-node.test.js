import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import GroupNode from '../../src/components/GroupNode.vue'
import { store } from '../../src/store/vault'
import { dnd, clearDrag } from '../../src/store/dnd'
import { toast } from '../../src/utils/toast'

// 分组拖拽成环：必须拒绝并给出明确提示，且数据不变

let wrapper = null

beforeEach(() => {
  window.utools = {
    dbStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    db: { replicateStateFromCloud: () => 0 },
    getUser: () => null
  }
  window.services = {
    storeLocalData: vi.fn(),
    readLocalData: () => '',
    removeLocalData: vi.fn()
  }
  store.secured = false
  store.locked = false
  store.syncEnabled = false
  store.entries = []
  store.groups = [
    { id: 'p', name: '父', parentId: null },
    { id: 'c', name: '子', parentId: 'p' }
  ]
  toast.message = ''
  clearDrag()
})

afterEach(() => {
  if (wrapper) { wrapper.unmount(); wrapper = null }
  clearDrag()
})

test('把父分组拖进自己的子分组：拒绝并提示，数据不变', async () => {
  wrapper = mount(GroupNode, { props: { group: store.groups[1], depth: 1 } })
  dnd.type = 'group'
  dnd.id = 'p'
  dnd.mode = 'inside'
  await wrapper.find('.gnode').trigger('drop')
  expect(toast.message).toBe('不能把分组移动到它自己的子分组里')
  expect(store.groups.find((g) => g.id === 'p').parentId).toBe(null)
  expect(store.groups.find((g) => g.id === 'c').parentId).toBe('p')
})

test('正常拖拽到其它分组：提示已调整', async () => {
  store.groups.push({ id: 'x', name: '独立', parentId: null })
  // 落点分组是 c，被拖拽的是 x
  wrapper = mount(GroupNode, { props: { group: store.groups[1], depth: 0 } })
  dnd.type = 'group'
  dnd.id = 'x'
  dnd.mode = 'inside'
  await wrapper.find('.gnode').trigger('drop')
  expect(toast.message).toBe('已调整分组')
  expect(store.groups.find((g) => g.id === 'x').parentId).toBe('c')
})
