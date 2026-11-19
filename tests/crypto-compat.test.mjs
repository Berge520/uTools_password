import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'

// preload 加密实现（真实 crypto，非桩）：验证迭代数升级的向后兼容。
// 每个用例重新加载模块以获得干净实例。

const require = createRequire(import.meta.url)
const PRELOAD = path.resolve(process.cwd(), 'public/preload/services.js')

global.window = { utools: { getPluginLocalDataPath: () => path.resolve(process.cwd(), '.tmp-test-data') } }

function loadPreload () {
  delete require.cache[require.resolve(PRELOAD)]
  require(PRELOAD)
  return global.window.services
}

// 用指定的迭代数按旧格式手工造一个密文 blob（模拟旧版本数据）
function legacyBlob (plaintext, password, iterations) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    mode: 'encrypted',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    cipher: enc.toString('base64')
  }
}

test('新密文记录迭代数且可正常往返解密', () => {
  const s = loadPreload()
  const blob = s.encryptData('hello 密码', 'pw')
  assert.equal(typeof blob.iter, 'number', '新密文必须记录迭代数，为将来升级做准备')
  assert.ok(blob.iter >= 100000, '迭代数不得低于旧版基线: ' + blob.iter)
  assert.equal(s.decryptData(blob, 'pw'), 'hello 密码')
  assert.throws(() => s.decryptData(blob, 'wrong'))
})

test('无迭代数字段的旧密文仍按 10 万次解密（向后兼容）', () => {
  const s = loadPreload()
  const old = legacyBlob('{"entries":[]}', 'pw', 100000)
  assert.equal(old.iter, undefined)
  assert.equal(s.decryptData(old, 'pw'), '{"entries":[]}')
})

test('迭代数不可信时拒绝解密（防降级/异常数据）', () => {
  const s = loadPreload()
  const blob = legacyBlob('x', 'pw', 100000)
  blob.iter = -1
  assert.throws(() => s.decryptData(blob, 'pw'))
  blob.iter = 0
  assert.throws(() => s.decryptData(blob, 'pw'))
  blob.iter = '100000'
  assert.throws(() => s.decryptData(blob, 'pw'), '字符串不得被当作迭代数')
  blob.iter = NaN
  assert.throws(() => s.decryptData(blob, 'pw'))
  // 超大值必须在进入 PBKDF2 前拒绝，否则解密被无限拖慢
  blob.iter = 1e12
  assert.throws(() => s.decryptData(blob, 'pw'), '迭代数超过上限应拒绝')
})

test('会话密钥派生遵循 blob 中记录的迭代数', () => {
  const s = loadPreload()
  const blob = s.encryptData('data', 'pw')
  const key = s.deriveKeyBase64('pw', blob.salt, blob.iter)
  const again = s.encryptDataWithKey('data2', blob.salt, key, blob.iter)
  assert.equal(s.decryptDataWithKey(again, key, again.iter), 'data2')
  // 用不同迭代数派生会得到不同密钥（证明 iter 真正参与派生）
  const otherIter = blob.iter === 200000 ? 150000 : 200000
  assert.notEqual(s.deriveKeyBase64('pw', blob.salt, otherIter), key)
})
