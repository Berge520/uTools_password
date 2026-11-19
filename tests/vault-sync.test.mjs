import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEY, A, B, plainBlob, encBlob, freshVault } from './helpers.mjs'

// 用 Node 内置测试运行器验证 vault.js 同步逻辑（桩见 helpers.mjs）。
// 运行：npm test（等价于 node --import ./tests/register.mjs --test tests/vault-sync.test.mjs）

// ---- 根因 A：任何「转仅本地」路径都不得删除云端文档 ----

test('超限回退本地时保留云端副本', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: plainBlob(A) } })
  await v.initialize()
  v.addEntries([{ title: 'big', password: 'y'.repeat(950 * 1024) }])
  assert.equal(v.store.syncEnabled, false, '超限后应关闭同步')
  assert.ok(env.file && env.file.includes('big'), '新数据应写入本地文件')
  assert.ok(env.dbStore.has(KEY), '云端副本必须保留（删除会传播到所有设备）')
  assert.deepEqual(env.dbStore.get(KEY).entries, A, '云端副本应为回退前的内容')
})

test('关闭同步开关时保留云端副本', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: plainBlob(A) } })
  await v.initialize()
  const res = v.setSyncEnabled(false)
  assert.equal(res.ok, true)
  assert.equal(v.store.syncEnabled, false)
  assert.ok(env.file && env.file.includes('"a"'), '数据应迁移到本地文件')
  assert.ok(env.dbStore.has(KEY), '云端副本必须保留')
})

test('非会员/未开同步启动时不删除云端数据', async () => {
  const { env, v } = await freshVault({
    dbState: null,
    user: null,
    db: { [KEY]: plainBlob(A) },
    ls: { password_vault_sync: '1' }
  })
  await v.initialize()
  assert.equal(v.store.syncBlocked, true)
  assert.ok(env.dbStore.has(KEY), '不得把云端文档迁移删除')
  assert.deepEqual(v.store.entries, A, '应直接读取 db 中的数据')
})

// ---- 根因 C：启动等待云端拉取完成 ----

test('云端拉取进行中时初始化等待数据到达', async () => {
  const { env, v } = await freshVault({ dbState: 1, db: {} })
  setTimeout(() => {
    env.dbState = 0
    env.dbStore.set(KEY, plainBlob(A))
  }, 400)
  await v.initialize()
  assert.deepEqual(v.store.entries, A, '应等待拉取完成后读到云端数据，而非空库')
})

// ---- 根因 B：onDbPull 远程更新应用 ----

test('锁定状态下应用远程密文更新', async () => {
  const { env, v } = await freshVault({
    db: { [KEY]: encBlob('pw', A) },
    ls: { password_autolock: '0' }
  })
  await v.initialize()
  assert.equal(v.store.locked, true)
  env.dbStore.set(KEY, encBlob('pw', B))
  v.handleDbPull()
  const res = v.unlock('pw')
  assert.equal(res.ok, true)
  assert.deepEqual(v.store.entries, B, '解锁后应看到其他设备的新数据')
})

test('已解锁明文模式下应用远程更新', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: plainBlob(A) } })
  await v.initialize()
  assert.deepEqual(v.store.entries, A)
  env.dbStore.set(KEY, plainBlob(B))
  v.handleDbPull()
  assert.deepEqual(v.store.entries, B)
})

test('仅本地模式忽略远程更新', async () => {
  const { env, v } = await freshVault({
    db: { [KEY]: plainBlob(A) },
    file: JSON.stringify(plainBlob(A)),
    ls: { password_vault_sync: '0' }
  })
  await v.initialize()
  assert.equal(v.store.syncEnabled, false)
  env.dbStore.set(KEY, plainBlob(B))
  v.handleDbPull()
  assert.deepEqual(v.store.entries, A, '本地-only 模式不应被云端变化覆盖')
})

test('其他设备修改主密码后本地锁定', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: encBlob('pw', A) } })
  await v.initialize()
  assert.equal(v.unlock('pw').ok, true)
  env.dbStore.set(KEY, encBlob('other', B))
  v.handleDbPull()
  assert.equal(v.store.locked, true, '密钥不匹配时应锁定要求重新解锁')
})

// ---- 回归守卫：既有正确行为保持不变 ----

test('宽限期自动解锁后关闭同步仍保持加密', async () => {
  const { env, v } = await freshVault({
    db: { [KEY]: encBlob('pw', A) },
    ls: { password_autolock: '5' },
    session: { key: 'key-pw', expireAt: Date.now() + 60000 }
  })
  await v.initialize()
  assert.equal(v.store.locked, false, '宽限期内应自动解锁')
  const res = v.setSyncEnabled(false)
  assert.equal(res.ok, true)
  assert.ok(env.file, '数据应迁移到本地文件')
  const fileBlob = JSON.parse(env.file)
  assert.equal(fileBlob.mode, 'encrypted', '自动解锁后切同步不得把明文密码落盘')
  assert.deepEqual(JSON.parse(global.window.services.decryptDataWithKey(fileBlob, 'key-pw')).entries, A)
  assert.equal(env.dbStore.get(KEY).mode, 'encrypted', '云端副本也不得被明文覆盖')
})

test('已解锁密文模式下应用远程更新', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: encBlob('pw', A) } })
  await v.initialize()
  assert.equal(v.unlock('pw').ok, true)
  env.dbStore.set(KEY, encBlob('pw', B))
  v.handleDbPull()
  assert.equal(v.store.locked, false)
  assert.deepEqual(v.store.entries, B, '同主密码的远程密文应直接刷新')
})

test('同步开启且 db 有数据时以 db 为准并清理本地旧副本', async () => {
  const { env, v } = await freshVault({
    db: { [KEY]: plainBlob(A) },
    file: JSON.stringify(plainBlob(B)),
    ls: { password_vault_sync: '1' }
  })
  await v.initialize()
  assert.deepEqual(v.store.entries, A)
  assert.equal(env.file, null, '本地旧副本应被清理')
})

test('重新开启同步把本地数据迁回 db', async () => {
  const { env, v } = await freshVault({
    file: JSON.stringify(plainBlob(A)),
    ls: { password_vault_sync: '0' }
  })
  await v.initialize()
  assert.equal(v.store.syncEnabled, false)
  const res = v.setSyncEnabled(true)
  assert.equal(res.ok, true)
  assert.ok(env.dbStore.has(KEY), '数据应迁回 dbStorage')
  assert.deepEqual(env.dbStore.get(KEY).entries, A)
  assert.equal(env.file, null, '本地副本应清理')
})