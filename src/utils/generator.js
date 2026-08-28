// 使用 Crypto.getRandomValues 生成强随机密码，不依赖 Math.random
const LC = 'abcdefghijklmnopqrstuvwxyz'
const UC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()_+-=[]{};:,.<>?'
// 去除易混淆字符
const LC_SAFE = 'abcdefghjkmnpqrstuvwxyz'
const UC_SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const DIGITS_SAFE = '23456789'

function randInt (max) {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0] % max
}

function pick (str) {
  return str[randInt(str.length)]
}

/**
 * 生成密码
 * @param {Object} opts { length, lowercase, uppercase, digits, symbols, excludeAmbiguous }
 */
function generatePassword (opts = {}) {
  const length = Math.min(Math.max(parseInt(opts.length, 10) || 16, 4), 64)
  const exclude = !!opts.excludeAmbiguous

  const pools = []
  if (opts.lowercase !== false) pools.push(exclude ? LC_SAFE : LC)
  if (opts.uppercase) pools.push(exclude ? UC_SAFE : UC)
  if (opts.digits) pools.push(exclude ? DIGITS_SAFE : DIGITS)
  if (opts.symbols) pools.push(SYMBOLS)

  const all = pools.join('')
  if (!all) return ''

  const chars = []
  for (let i = 0; i < length; i++) chars.push(all[randInt(all.length)])

  // 保证每个选中的字符集至少出现一次
  for (const pool of pools) {
    if (!chars.some((c) => pool.includes(c))) {
      chars[randInt(length)] = pick(pool)
    }
  }

  return chars.join('')
}

export { generatePassword }
