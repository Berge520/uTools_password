// 测试公共桩：模拟 window.utools / window.services / localStorage。
// dbStorage 读写均深拷贝（与真实序列化语义一致），避免响应式代理原地修改污染“库”。
export const KEY = 'password_vault'
let seq = 0
let saltSeq = 0

export const A = [{ id: 'a', title: 'A' }]
export const B = [{ id: 'b', title: 'B' }]

export function plainBlob (entries, groups = []) {
  return { mode: 'plain', entries, groups }
}

// 与 services 桩加密算法配套的密文 blob（base64 模拟，仅测逻辑不测密码学）
export function encBlob (pw, entries, groups = []) {
  const cipher = Buffer.from(JSON.stringify({ entries, groups })).toString('base64')
  return { mode: 'encrypted', salt: 'salt', iv: 'iv', authTag: 'tag', cipher, pw, key: 'key-' + pw }
}

export function setupEnv (opts = {}) {
  const dbStore = new Map(Object.entries(opts.db || {}))
  const ls = new Map(Object.entries(opts.ls || {}))
  const env = {
    dbState: 'dbState' in opts ? opts.dbState : 0,
    dbStore,
    ls,
    file: opts.file ?? null,
    session: opts.session ?? null,
    removedDbKeys: [],
    dbPullCb: null
  }
  global.window = {
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: (k) => ls.delete(k)
    },
    utools: {
      getUser: () => (opts.user === undefined ? { nickname: 't', type: 'member' } : opts.user),
      db: { replicateStateFromCloud: () => env.dbState },
      dbStorage: {
        getItem: (k) => (dbStore.has(k) ? JSON.parse(JSON.stringify(dbStore.get(k))) : null),
        setItem: (k, v) => dbStore.set(k, JSON.parse(JSON.stringify(v))),
        removeItem: (k) => { env.removedDbKeys.push(k); return dbStore.delete(k) }
      },
      onDbPull: (cb) => { env.dbPullCb = cb }
    },
    services: {
      storeLocalData: (t) => { env.file = t },
      readLocalData: () => env.file ?? '',
      removeLocalData: () => { env.file = null },
      localDataFilePath: () => '/mock/password_vault_local.json',
      encryptData: (plain, pw) => ({ mode: 'encrypted', salt: 'salt-' + (++saltSeq), iv: 'iv', authTag: 'tag', cipher: Buffer.from(plain).toString('base64'), pw, key: 'key-' + pw }),
      decryptData: (blob, pw) => {
        if (blob.pw !== pw) throw new Error('bad password')
        return Buffer.from(blob.cipher, 'base64').toString('utf8')
      },
      encryptDataWithKey: (plain, salt, key) => ({ mode: 'encrypted', salt, iv: 'iv', authTag: 'tag', cipher: Buffer.from(plain).toString('base64'), key }),
      decryptDataWithKey: (blob, key) => {
        if (blob.key !== key) throw new Error('bad key')
        return Buffer.from(blob.cipher, 'base64').toString('utf8')
      },
      deriveKeyBase64: (pw) => 'key-' + pw,
      storeSession: (o) => { env.session = o },
      readSession: () => env.session,
      clearSession: () => { env.session = null }
    }
  }
  return env
}

export async function freshVault (opts) {
  const env = setupEnv(opts)
  const v = await import(`../src/store/vault.js?case=${++seq}`)
  return { env, v }
}

// WebDAV 桩：记录请求 URL，模拟远端文件表
export async function freshCloud (opts = {}) {
  const env = setupEnv(opts)
  const calls = { put: [], get: [], del: [], mkcol: [], propfind: [] }
  const remote = new Map(Object.entries(opts.remote || {}))
  Object.assign(global.window.services, {
    webdavPut: async (url, u, p, text) => {
      calls.put.push(url)
      if (opts.putFail) return { ok: false, status: opts.putFail }
      remote.set(url, text)
      return { ok: true }
    },
    webdavGet: async (url) => {
      calls.get.push(url)
      if (!remote.has(url)) return { ok: false, status: 404 }
      return { ok: true, data: remote.get(url) }
    },
    webdavDelete: async (url) => {
      calls.del.push(url)
      remote.delete(url)
      return { ok: true }
    },
    webdavMkcol: async (url) => {
      calls.mkcol.push(url)
      if (opts.mkcolStatus) return { ok: false, status: opts.mkcolStatus }
      return { ok: true }
    },
    webdavPropfind: async (url) => {
      calls.propfind.push(url)
      if (opts.propfind) return opts.propfind(url)
      return { ok: true, xml: opts.xml || '' }
    },
    sha256: (t) => 'hash-' + t.length
  })
  const c = await import(`../src/store/cloud.js?case=${++seq}`)
  return { env, c, calls, remote }
}