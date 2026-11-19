import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEY, plainBlob, encBlob, freshVault } from './helpers.mjs'

// 列表顺序语义：收藏项恒定在前（保存时归一化），拖拽在分区内生效、
// 跨分区时落到分区边界——与界面「收藏并置顶」的提示和落点指示器一致。

const ids = (v) => v.store.entries.map((e) => e.id)

test('加载旧数据时收藏项归拢到最前且分区内保持原相对顺序', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([
    { id: 'a', title: 'A', favorite: true },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C', favorite: true },
    { id: 'd', title: 'D' }
  ]) } })
  await v.initialize()
  assert.deepEqual(ids(v), ['a', 'c', 'b', 'd'])
})

test('新收藏条目置顶，取消收藏后不再占用顶部', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' }
  ]) } })
  await v.initialize()
  v.toggleFavorite('c')
  assert.deepEqual(ids(v), ['c', 'a', 'b'])
  v.toggleFavorite('c')
  assert.deepEqual(ids(v), ['c', 'a', 'b'], '取消收藏后位置保留在未收藏区，不再固定在顶部')
})

test('拖拽未收藏条目到收藏项之前会吸附在收藏分区之后', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([
    { id: 'f', title: 'F', favorite: true },
    { id: 'n1', title: 'N1' },
    { id: 'n2', title: 'N2' }
  ]) } })
  await v.initialize()
  v.moveEntry('n1', 'f', true)
  assert.deepEqual(ids(v), ['f', 'n1', 'n2'])
})

test('拖拽收藏条目到未收藏项之后会吸附在收藏分区末尾', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([
    { id: 'f1', title: 'F1', favorite: true },
    { id: 'f2', title: 'F2', favorite: true },
    { id: 'n', title: 'N' }
  ]) } })
  await v.initialize()
  v.moveEntry('f1', 'n', false)
  assert.deepEqual(ids(v), ['f2', 'f1', 'n'])
})

test('同一分区内拖拽按落点顺序生效', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
    { id: 'f1', title: 'F1', favorite: true },
    { id: 'f2', title: 'F2', favorite: true }
  ]) } })
  await v.initialize()
  v.moveEntry('c', 'a', true)
  assert.deepEqual(ids(v), ['f1', 'f2', 'c', 'a', 'b'])
  v.moveEntry('f2', 'f1', true)
  assert.deepEqual(ids(v), ['f2', 'f1', 'c', 'a', 'b'])
})

// 旧版插件写入/远端同步来的数据可能未归一，进入内存后也必须满足展示顺序
const SCATTERED = [
  { id: 'n', title: 'N' },
  { id: 'f', title: 'F', favorite: true }
]

test('解锁旧顺序密文后收藏项在前', async () => {
  const { v } = await freshVault({ db: { [KEY]: encBlob('pw', SCATTERED) } })
  await v.initialize()
  assert.equal(v.unlock('pw').ok, true)
  assert.deepEqual(ids(v), ['f', 'n'])
})

test('其他设备推送未归一数据后收藏项在前', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: plainBlob([{ id: 'x', title: 'X' }]) } })
  await v.initialize()
  env.dbStore.set(KEY, plainBlob(SCATTERED))
  v.handleDbPull()
  assert.deepEqual(ids(v), ['f', 'n'])
})

test('恢复明文备份后收藏项在前', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([]) } })
  await v.initialize()
  v.saveBlobFromBackup(plainBlob(SCATTERED))
  assert.deepEqual(ids(v), ['f', 'n'])
})

// ---- 分组移动的拒绝必须可反馈 ----

test('moveGroup 成环时返回 false，正常移动返回 true', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], [
    { id: 'p', name: '父', parentId: null },
    { id: 'c', name: '子', parentId: 'p' },
    { id: 'x', name: '独立', parentId: null }
  ]) } })
  await v.initialize()
  assert.equal(v.moveGroup('p', 'c', 'before'), false, '父组移到子组之前会成环')
  assert.equal(v.moveGroup('p', 'c', 'inside'), false, '父组挂到子组之下会成环')
  assert.equal(v.moveGroup('x', 'p', 'inside'), true, '正常移动应成功')
})

test('moveGroups 成环时返回 false', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], [
    { id: 'p', name: '父', parentId: null },
    { id: 'c', name: '子', parentId: 'p' }
  ]) } })
  await v.initialize()
  assert.equal(v.moveGroups(['p'], 'c'), false)
  assert.equal(v.moveGroups(['c'], 'p'), true)
})
