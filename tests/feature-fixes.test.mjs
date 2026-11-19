import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEY, A, B, plainBlob, encBlob, freshVault, freshCloud } from './helpers.mjs'
import { parseBrowserCsv } from '../src/utils/browserCsv.js'
import { parseOtpauth, toOtpauthUri } from '../src/utils/totp.js'

// ---- 分组移动防成环 ----

test('moveGroup before/after 不得把父组移入其子孙造成环', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], [
    { id: 'p', name: '父', parentId: null },
    { id: 'c', name: '子', parentId: 'p' }
  ]) } })
  await v.initialize()
  v.moveGroup('p', 'c', 'before')
  const flat = v.flattenGroups(v.store.groups)
  assert.equal(flat.length, 2, '成环会导致分组从树上消失')
})

test('moveGroups 目标为被移分组的子孙时不得成环', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], [
    { id: 'p', name: '父', parentId: null },
    { id: 'c', name: '子', parentId: 'p' }
  ]) } })
  await v.initialize()
  v.moveGroups(['p'], 'c')
  assert.equal(v.flattenGroups(v.store.groups).length, 2)
})

test('已有环状数据时 collectGroupIds 不死循环', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], [
    { id: 'x', name: 'X', parentId: 'y' },
    { id: 'y', name: 'Y', parentId: 'x' }
  ]) } })
  await v.initialize()
  const list = v.getScopeEntries('x')
  assert.ok(Array.isArray(list))
})

// 历史环数据（旧版拖拽可产生）不可见但仍在库中，可被选为移动/删除目标
const CYCLIC = [
  { id: 'x', name: 'X', parentId: 'y' },
  { id: 'y', name: 'Y', parentId: 'x' },
  { id: 'z', name: 'Z', parentId: null }
]

test('已有环状数据时 moveGroup 不死循环', { timeout: 5000 }, async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], CYCLIC) } })
  await v.initialize()
  v.moveGroup('z', 'x', 'before')
  assert.ok(v.store.groups.length >= 2)
})

test('已有环状数据时 moveGroups 不死循环', { timeout: 5000 }, async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], CYCLIC) } })
  await v.initialize()
  v.moveGroups(['z'], 'x')
  assert.ok(v.store.groups.length >= 2)
})

test('已有环状数据时 deleteGroups 不死循环', { timeout: 5000 }, async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob([], CYCLIC) } })
  await v.initialize()
  v.deleteGroups(['x', 'y'])
  assert.ok(v.store.groups.some((g) => g.id === 'z'), '无关分组应保留')
})

// ---- 条目更新 ----

test('updateEntry 对不存在的条目返回 false', async () => {
  const { v } = await freshVault({ db: { [KEY]: plainBlob(A) } })
  await v.initialize()
  assert.equal(v.updateEntry('nope', { title: 'x' }), false)
  assert.equal(v.updateEntry('a', { title: 'x' }), true)
})

// ---- 主密码修改 ----

test('修改主密码必须换新 salt 且新旧密码行为正确', async () => {
  const { v } = await freshVault({ db: { [KEY]: encBlob('pw', A) } })
  await v.initialize()
  assert.equal(v.unlock('pw').ok, true)
  const oldSalt = v.getBackupBlob().salt
  const res = v.changeMasterPassword('pw', 'new')
  assert.equal(res.ok, true)
  const blob = v.getBackupBlob()
  assert.notEqual(blob.salt, oldSalt, '改密必须生成新 salt')
  assert.equal(blob.pw, 'new', '密文必须用新密码加密')
  v.lock()
  assert.equal(v.unlock('new').ok, true, '新密码应可解锁')
  v.lock()
  assert.equal(v.unlock('pw').ok, false, '旧密码应失效')
})

test('改密派生密钥失败时不得留下新 salt + 旧密钥的混合状态', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: encBlob('pw', A) } })
  await v.initialize()
  assert.equal(v.unlock('pw').ok, true)
  const oldSalt = v.getBackupBlob().salt
  const orig = global.window.services.deriveKeyBase64
  global.window.services.deriveKeyBase64 = () => { throw new Error('derive fail') }
  const res = v.changeMasterPassword('pw', 'new')
  global.window.services.deriveKeyBase64 = orig
  assert.equal(res.ok, false)
  assert.equal(v.getBackupBlob().salt, oldSalt, '失败后 blob 必须保持原样')
  // 失败后继续编辑：落盘必须仍能被旧密钥解开（不是新 salt + 旧密钥的混合体）
  v.addEntries([{ title: 't', password: 'p' }])
  assert.equal(v.getBackupBlob().salt, oldSalt, '后续保存不得混用新 salt')
  const dbBlob = env.dbStore.get(KEY)
  assert.equal(dbBlob.salt, oldSalt)
  const plain = JSON.parse(global.window.services.decryptDataWithKey(dbBlob, 'key-pw'))
  assert.equal(plain.entries.length, 2, '旧密钥应仍能解开全部数据')
})

// ---- 锁定态不得把空库/明文写盘 ----

test('会话过期后切同步不得用残留密钥把空库加密落盘', async () => {
  const { env, v } = await freshVault({
    db: { [KEY]: encBlob('pw', A) },
    ls: { password_autolock: '5' },
    session: { key: 'key-pw', expireAt: Date.now() + 60000 }
  })
  await v.initialize()
  assert.equal(v.store.locked, false, '宽限期内自动解锁')
  // 会话过期后重进插件：应保持锁定，且内存密钥不得继续可用
  env.session = { key: 'key-pw', expireAt: Date.now() - 1000 }
  await v.initialize()
  assert.equal(v.store.locked, true, '会话已过期应保持锁定')
  const res = v.setSyncEnabled(false)
  assert.equal(res.ok, true)
  const fileBlob = JSON.parse(env.file)
  assert.equal(fileBlob.mode, 'encrypted')
  assert.deepEqual(JSON.parse(global.window.services.decryptDataWithKey(fileBlob, 'key-pw')).entries, A, '落盘的必须是原密文数据而非空库')
})

// ---- 导入 ----

test('importJson 为缺 id 的条目补 id', async () => {
  const { v } = await freshVault({})
  await v.initialize()
  v.importJson(JSON.stringify({ entries: [{ title: 'x', password: 'p' }, { title: 'y', password: 'q' }] }))
  const ids = v.store.entries.map((e) => e.id)
  assert.ok(ids.every((id) => typeof id === 'string' && id), '每条都应有 id')
  assert.equal(new Set(ids).size, 2, 'id 不得重复')
  v.deleteEntry(ids[0])
  assert.equal(v.store.entries.length, 1, '按 id 删除只删一条')
})

test('importMerge 保留文件分组层级', async () => {
  const { v } = await freshVault({})
  await v.initialize()
  v.importMerge(JSON.stringify({
    groups: [{ id: 'p', name: '父', parentId: null }, { id: 'c', name: '子', parentId: 'p' }],
    entries: [{ title: 'e', password: 'p', groupId: 'c' }]
  }))
  const parent = v.store.groups.find((g) => g.name === '父')
  const child = v.store.groups.find((g) => g.name === '子')
  assert.ok(parent && child)
  assert.equal(child.parentId, parent.id, '子分组应挂在父分组下')
  assert.equal(v.store.entries[0].groupId, child.id)
})

test('importMerge 保留收藏/WiFi 字段且重复导入去重', async () => {
  const { v } = await freshVault({})
  await v.initialize()
  const file = JSON.stringify({ entries: [{ title: 'e', username: 'u', password: 'p', url: '', favorite: true, isWifi: true, wifiType: 'WPA', wifiHidden: false }] })
  v.importMerge(file)
  v.importMerge(file)
  assert.equal(v.store.entries.length, 1, '重复导入同一文件不应翻倍')
  const e = v.store.entries[0]
  assert.equal(e.favorite, true)
  assert.equal(e.isWifi, true)
  assert.equal(e.wifiType, 'WPA')
})

// ---- 恢复备份清理旧密钥 ----

test('saveBlobFromBackup 恢复明文时清理会话与内存密钥', async () => {
  const { env, v } = await freshVault({ db: { [KEY]: encBlob('pw', A) } })
  await v.initialize()
  assert.equal(v.unlock('pw').ok, true)
  assert.ok(env.session, '解锁后会话存在')
  v.saveBlobFromBackup(plainBlob(B))
  assert.equal(env.session, null, '恢复明文后会话应清理')
  assert.equal(v.store.secured, false)
})

// ---- CSV 导入 ----

test('浏览器 CSV 导入不得 trim 密码首尾空格', () => {
  const rows = parseBrowserCsv('name,url,username,password\na,http://x,u, pw \n')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].password, ' pw ', '密码必须原样保留')
  assert.equal(rows[0].title, 'a')
})

test('CSV 字段中间的裸引号不应进入引号态', () => {
  const rows = parseBrowserCsv('name,url,username,password\na,b"are,u,p\nnext,url2,u2,p2\n')
  assert.equal(rows.length, 2, '畸形引号不得把后续行吞并')
  assert.equal(rows[1].title, 'next')
})

// ---- TOTP URI 重组 ----

test('toOtpauthUri 保留 period/digits/algorithm', () => {
  const otp = { secret: 'JBSWY3DPEHPK3PXP', period: 60, digits: 8, algorithm: 'sha256', issuer: 'I', account: 'a' }
  const parsed = parseOtpauth(toOtpauthUri(otp))
  assert.ok(parsed)
  assert.equal(parsed.period, 60)
  assert.equal(parsed.digits, 8)
  assert.equal(parsed.algorithm, 'sha256')
  assert.equal(parsed.secret, otp.secret)
})

test('otpauth URI 多次往返后 account/issuer 不漂移', () => {
  const otp = { secret: 'JBSWY3DPEHPK3PXP', period: 30, digits: 6, algorithm: 'sha1', issuer: 'GitHub', account: 'me@example.com' }
  let cur = toOtpauthUri(otp)
  for (let i = 0; i < 3; i++) cur = toOtpauthUri(parseOtpauth(cur))
  const parsed = parseOtpauth(cur)
  assert.equal(parsed.issuer, 'GitHub')
  assert.equal(parsed.account, 'me@example.com')
})

// ---- 云端拉取等待期间的解锁 ----

test('云端拉取等待期间解锁不得误报主密码错误', { timeout: 15000 }, async () => {
  const { env, v } = await freshVault({ db: { [KEY]: encBlob('pw', A) }, ls: { password_autolock: '0' } })
  await v.initialize()
  assert.equal(v.store.locked, true)
  // 重进插件：云端仍在拉取，初始化挂起等待
  env.dbState = 1
  const timer = setTimeout(() => { env.dbState = 0 }, 500)
  const p = v.initialize()
  const res = v.unlock('pw')
  assert.equal(res.ok, false)
  assert.ok(!/主密码错误/.test(v.store.unlockError), '等待数据期间不得误报密码错误: ' + v.store.unlockError)
  await p
  clearTimeout(timer)
  assert.equal(v.unlock('pw').ok, true, '拉取完成后应能正常解锁')
})

// ---- WebDAV ----

test('测试连接不得覆盖/删除默认文件名上的旧版备份', async () => {
  const { c, remote } = await freshCloud({})
  c.cloud.url = 'https://dav.example.com'
  c.cloud.path = ''
  c.cloud.fileName = 'password-vault-backup.json'
  const legacyUrl = 'https://dav.example.com/password-vault-backup.json'
  remote.set(legacyUrl, 'LEGACY-BACKUP')
  const r = await c.testConnection()
  assert.equal(r.ok, true)
  assert.equal(remote.get(legacyUrl), 'LEGACY-BACKUP', '旧版备份必须原样保留')
})

test('MKCOL 返回 403 时测试连接应报错而非继续', async () => {
  const { c } = await freshCloud({ mkcolStatus: 403 })
  c.cloud.url = 'https://dav.example.com'
  c.cloud.path = 'sub'
  const r = await c.testConnection()
  assert.equal(r.ok, false, '权限错误不得被当作目录已存在')
})

test('WebDAV 路径与文件名中的特殊字符必须 URL 编码', async () => {
  const { c, calls } = await freshCloud({ xml: '<d:href>/my%20dir/backup.json</d:href>' })
  c.cloud.url = 'https://dav.example.com'
  c.cloud.path = 'my dir'
  c.cloud.fileName = 'backup.json'
  await c.listRemoteBackups()
  assert.ok(calls.propfind[0].includes('my%20dir'), '目录路径需编码: ' + calls.propfind[0])
  await c.previewRemote('a#b.json')
  assert.ok(calls.get[0].includes('a%23b.json'), '文件名需编码: ' + calls.get[0])
})