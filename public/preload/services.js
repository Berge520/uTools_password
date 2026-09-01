const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// child_process 可能被 uTools 预加载环境禁用，先探测
let execSync = null
let execFile = null
let shellErr = ''
try {
  const cp = require('node:child_process')
  execSync = cp.execSync
  execFile = cp.execFile
} catch (e) {
  execSync = null
  execFile = null
  shellErr = 'child_process 不可用：' + (e && e.message ? e.message : e)
}

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// Windows 控制台默认 OEM 编码，中文系统是 GBK；netsh 输出需按 GBK 解码
function decodeWindows (buf) {
  try {
    if (typeof TextDecoder === 'function') return new TextDecoder('gbk').decode(buf)
  } catch (e) {}
  return buf.toString('utf8')
}

function toText (buf) {
  if (!buf) return ''
  return IS_WIN ? decodeWindows(buf) : buf.toString('utf8')
}

// 异步执行（不阻塞），返回原始 Buffer
function execFileP (file, args) {
  return new Promise((resolve) => {
    if (!execFile) {
      resolve(Buffer.alloc(0))
      return
    }
    execFile(file, args, { windowsHide: true, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? Buffer.alloc(0) : stdout)
    })
  })
}

function runShell (cmd) {
  if (!execSync) return ''
  try {
    const buf = execSync(cmd, { windowsHide: true })
    return toText(buf)
  } catch (e) {
    return ''
  }
}

function runShellDiag (cmd) {
  if (!execSync) return 'child_process 不可用'
  try {
    const buf = execSync(cmd, { windowsHide: true })
    return toText(buf)
  } catch (e) {
    return '命令执行失败：' + (e && e.message ? e.message : e)
  }
}

// ---------- Windows：netsh ----------
function listWinProfiles () {
  const out = runShell('netsh wlan show profiles')
  const names = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    const m = line.match(/^(?:所有用户配置文件|<All User Profile>)\s*:\s*(.+)$/i)
    if (m && m[1].trim()) names.push(m[1].trim())
  }
  return names
}

function getWinPassword (name) {
  const safeName = String(name || '').replace(/"/g, '')
  const out = runShell(`netsh wlan show profile name="${safeName}" key=clear`)
  const m = out.match(/关键内容\s*:\s*(.+)/) || out.match(/Key Content\s*:\s*(.+)/i)
  return m ? m[1].trim() : ''
}

async function listWifiProfilesAsync () {
  if (IS_WIN) {
    const out = toText(await execFileP('netsh', ['wlan', 'show', 'profiles']))
    const names = []
    for (const raw of out.split(/\r?\n/)) {
      const line = raw.trim()
      const m = line.match(/^(?:所有用户配置文件|<All User Profile>)\s*:\s*(.+)$/i)
      if (m && m[1].trim()) names.push(m[1].trim())
    }
    return names
  }
  if (IS_MAC) {
    const ports = toText(await execFileP('networksetup', ['-listallhardwareports']))
    const devMatch = ports.match(/Hardware Port: Wi-Fi[\s\S]*?Device:\s*(\S+)/)
    const dev = devMatch ? devMatch[1] : 'en0'
    const out = toText(await execFileP('networksetup', ['-listpreferredwirelessnetworks', dev]))
    const names = []
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || /Preferred networks on/i.test(t) || t.includes(':')) continue
      names.push(t.replace(/^\d+\.\s*/, '').trim())
    }
    return names
  }
  if (IS_LINUX) {
    const out = toText(await execFileP('nmcli', ['-t', '-f', 'NAME', 'connection', 'show']))
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

async function getWifiPasswordAsync (name) {
  const safe = String(name || '').replace(/"/g, '')
  if (IS_WIN) {
    const out = toText(await execFileP('netsh', ['wlan', 'show', 'profile', `name=${safe}`, 'key=clear']))
    const m = out.match(/关键内容\s*:\s*(.+)/) || out.match(/Key Content\s*:\s*(.+)/i)
    return m ? m[1].trim() : ''
  }
  if (IS_MAC) {
    return toText(await execFileP('security', ['find-generic-password', '-ga', safe, '-w'])).trim()
  }
  if (IS_LINUX) {
    return toText(await execFileP('nmcli', ['-s', '-g', '802-11-wireless-security.psk', 'connection', 'show', safe])).trim()
  }
  return ''
}

// ---------- macOS：networksetup + security（钥匙串）----------
function listMacProfiles () {
  const ports = runShell('networksetup -listallhardwareports')
  const devMatch = ports.match(/Hardware Port: Wi-Fi[\s\S]*?Device:\s*(\S+)/)
  const dev = devMatch ? devMatch[1] : 'en0'
  const out = runShell(`networksetup -listpreferredwirelessnetworks ${dev}`)
  const names = []
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || /Preferred networks on/i.test(t) || t.includes(':')) continue
    names.push(t.replace(/^\d+\.\s*/, '').trim())
  }
  return names
}

function getMacPassword (name) {
  const safe = String(name || '').replace(/"/g, '')
  return runShell(`security find-generic-password -ga "${safe}" -w`).trim()
}

// ---------- Linux：nmcli (NetworkManager) ----------
function listLinuxProfiles () {
  const out = runShell('nmcli -t -f NAME connection show')
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function getLinuxPassword (name) {
  const safe = String(name || '').replace(/"/g, '')
  return runShell(`nmcli -s -g 802-11-wireless-security.psk connection show "${safe}"`).trim()
}

// PBKDF2 派生 AES-256-GCM 密钥
function deriveKey(password, salt) {
  // 10 万次迭代，个人密码库足够安全且不卡顿
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
}

// 加密明文字符串，返回可直接存入 utools.dbStorage 的对象
function encryptData(plaintext, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = deriveKey(password, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    mode: 'encrypted',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    cipher: encrypted.toString('base64')
  }
}

// 解密，密码错误时抛异常
function decryptData(blob, password) {
  const salt = Buffer.from(blob.salt, 'base64')
  const iv = Buffer.from(blob.iv, 'base64')
  const authTag = Buffer.from(blob.authTag, 'base64')
  const key = deriveKey(password, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.cipher, 'base64')),
    decipher.final()
  ])
  return decrypted.toString('utf8')
}

// 使用已派生密钥加密（自动解锁场景下仍可安全写盘，保留原 salt 以保持一致）
function encryptDataWithKey(plaintext, saltBase64, keyBase64) {
  const salt = Buffer.from(saltBase64, 'base64')
  const iv = crypto.randomBytes(12)
  const key = Buffer.from(keyBase64, 'base64')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    mode: 'encrypted',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    cipher: encrypted.toString('base64')
  }
}

// 由密码+盐派生密钥并返回 base64（用于宽限期自动解锁）
function deriveKeyBase64(password, saltBase64) {
  const key = deriveKey(password, Buffer.from(saltBase64, 'base64'))
  return key.toString('base64')
}

// 直接使用已派生密钥解密（免重输密码的自动解锁）
function decryptDataWithKey(blob, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64')
  const iv = Buffer.from(blob.iv, 'base64')
  const authTag = Buffer.from(blob.authTag, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.cipher, 'base64')),
    decipher.final()
  ])
  return decrypted.toString('utf8')
}

// ---------- WebDAV 云备份（HTTP/HTTPS + Basic 认证）----------
function webdavRequest (method, url, user, pwd, body) {
  return new Promise((resolve) => {
    try {
      let u
      try {
        u = new URL(url)
      } catch (e) {
        resolve({ ok: false, error: '地址无效' })
        return
      }
      const mod = u.protocol === 'https:' ? require('node:https') : require('node:http')
      const auth = 'Basic ' + Buffer.from((user || '') + ':' + (pwd || '')).toString('base64')
      const headers = { Authorization: auth }
      if (body) {
        headers['Content-Type'] = 'application/octet-stream'
        headers['Content-Length'] = Buffer.byteLength(body)
      }
      const req = mod.request(
        u,
        { method, timeout: 20000, headers },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              data: Buffer.concat(chunks).toString('utf8')
            })
          })
        }
      )
      req.on('error', (e) => resolve({ ok: false, error: e.message }))
      req.on('timeout', () => {
        req.destroy()
        resolve({ ok: false, error: '请求超时' })
      })
      if (body) req.write(body)
      req.end()
    } catch (e) {
      resolve({ ok: false, error: e.message })
    }
  })
}

function webdavPut (url, user, pwd, text) {
  return webdavRequest('PUT', url, user, pwd, text)
}
function webdavGet (url, user, pwd) {
  return webdavRequest('GET', url, user, pwd)
}
function webdavDelete (url, user, pwd) {
  return webdavRequest('DELETE', url, user, pwd)
}

// Base32 解码（RFC 4648），忽略空白 / 等号
function base32Decode (str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(str).toUpperCase().replace(/[\s=\-]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const c of clean) {
    const idx = alphabet.indexOf(c)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

// RFC 6238 TOTP：返回当前动态码
function generateTotp (secret, period, digits, algorithm) {
  if (!secret || !period) return ''
  try {
    const key = base32Decode(secret)
    if (key.length === 0) return ''
    const counter = Math.floor(Date.now() / 1000 / period)
    const msg = Buffer.alloc(8)
    let c = counter
    for (let i = 7; i >= 0; i--) {
      msg[i] = c & 0xff
      c = Math.floor(c / 256)
    }
    const hmac = crypto.createHmac(algorithm || 'sha1', key).update(msg).digest()
    const offset = hmac[hmac.length - 1] & 0x0f
    const bin =
      ((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3]
    const code = bin % Math.pow(10, digits || 6)
    return String(code).padStart(digits || 6, '0')
  } catch (e) {
    return ''
  }
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },

  // 文本写入到指定路径（用于导出备份）
  saveTextFile (filePath, text) {
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },

  // 读取图片文件为 data URL（用于离线二维码识别）
  readImageBase64 (filePath) {
    const buf = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mime =
      {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp'
      }[ext] || 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  },

  // 文本写入到下载目录
  writeTextFile (text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },

  // 图片写入到下载目录
  writeImageFile (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },

  // AES-256-GCM 加密
  encryptData (plaintext, password) {
    return encryptData(plaintext, password)
  },

  // AES-256-GCM 解密
  decryptData (blob, password) {
    return decryptData(blob, password)
  },

  // 派生密钥（base64）用于宽限期自动解锁
  deriveKeyBase64 (password, saltBase64) {
    return deriveKeyBase64(password, saltBase64)
  },

  // 使用已派生密钥加密
  encryptDataWithKey (plaintext, saltBase64, keyBase64) {
    return encryptDataWithKey(plaintext, saltBase64, keyBase64)
  },

  // 直接使用已派生密钥解密
  decryptDataWithKey (blob, keyBase64) {
    return decryptDataWithKey(blob, keyBase64)
  },

  // ---- 会话密钥文件（宽限期自动解锁，仅本地，不同步）----
  sessionPath () {
    return path.join(window.utools.getPath('userData'), 'password_vault_session.json')
  },
  storeSession (obj) {
    const fp = path.join(window.utools.getPath('userData'), 'password_vault_session.json')
    fs.writeFileSync(fp, JSON.stringify(obj || {}), { encoding: 'utf-8' })
  },
  readSession () {
    const fp = path.join(window.utools.getPath('userData'), 'password_vault_session.json')
    try {
      return JSON.parse(fs.readFileSync(fp, { encoding: 'utf-8' }))
    } catch (e) {
      return null
    }
  },
  clearSession () {
    const fp = path.join(window.utools.getPath('userData'), 'password_vault_session.json')
    try {
      fs.unlinkSync(fp)
    } catch (e) {}
  },

  // ---- WebDAV ----
  webdavPut (url, user, pwd, text) {
    return webdavPut(url, user, pwd, text)
  },
  webdavGet (url, user, pwd) {
    return webdavGet(url, user, pwd)
  },
  webdavDelete (url, user, pwd) {
    return webdavDelete(url, user, pwd)
  },

  // 生成 TOTP 动态码
  generateTotp (secret, period, digits, algorithm) {
    return generateTotp(secret, period, digits, algorithm)
  },

  // ---- 本地文件存储（关闭云端同步时使用，不会随 uTools 同步）----
  localDataFilePath () {
    return path.join(window.utools.getPath('userData'), 'password_vault_local.json')
  },

  storeLocalData (text) {
    const fp = path.join(window.utools.getPath('userData'), 'password_vault_local.json')
    fs.writeFileSync(fp, text, { encoding: 'utf-8' })
    return fp
  },

  readLocalData () {
    const fp = path.join(window.utools.getPath('userData'), 'password_vault_local.json')
    try {
      return fs.readFileSync(fp, { encoding: 'utf-8' })
    } catch (e) {
      return ''
    }
  },

  removeLocalData () {
    const fp = path.join(window.utools.getPath('userData'), 'password_vault_local.json')
    try {
      fs.unlinkSync(fp)
    } catch (e) {}
  },

  // ---- WiFi 密码（跨平台：Windows netsh / macOS 钥匙串 / Linux nmcli）----
  async listWifiProfiles () {
    return listWifiProfilesAsync()
  },

  async getWifiPassword (name) {
    return getWifiPasswordAsync(name)
  },

  wifiPlatform () {
    return IS_WIN ? 'windows' : IS_MAC ? 'macos' : IS_LINUX ? 'linux' : 'unknown'
  },

  shellAvailable () {
    return !!execSync
  },

  shellError () {
    return shellErr || ''
  },

  // 诊断：返回 netsh 原始输出（解码后），便于排查
  wifiRaw () {
    return runShellDiag(IS_WIN ? 'netsh wlan show profiles' : 'echo not-windows')
  }
}
