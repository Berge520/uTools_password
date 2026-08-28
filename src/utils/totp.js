// 解析 otpauth:// URI 或裸 Base32 密钥
// 返回 { secret, period, digits, algorithm, issuer, account }，无法识别时返回 null
export function parseOtpauth (input) {
  if (!input) return null
  const value = String(input).trim()
  if (!value) return null

  // 完整 otpauth:// URI（支持自定义协议）
  if (/^otpauth:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const params = url.searchParams
      const secret = (params.get('secret') || '').replace(/[\s=\-]/g, '').toUpperCase()
      if (!secret) return null

      const label = decodeURIComponent((url.pathname || '').replace(/^\//, ''))
      let issuer = params.get('issuer') || ''
      let account = ''
      if (label.includes(':')) {
        const i = label.indexOf(':')
        issuer = issuer || label.slice(0, i)
        account = label.slice(i + 1)
      } else {
        account = label
      }

      return {
        secret,
        period: parseInt(params.get('period') || '30', 10) || 30,
        digits: parseInt(params.get('digits') || '6', 10) || 6,
        algorithm: (params.get('algorithm') || 'SHA1').toLowerCase(),
        issuer: issuer || '',
        account: account || ''
      }
    } catch (e) {
      return null
    }
  }

  // 裸 Base32 密钥
  const secret = value.replace(/[\s=\-]/g, '').toUpperCase()
  if (!secret) return null
  return { secret, period: 30, digits: 6, algorithm: 'sha1', issuer: '', account: '' }
}

// 密钥是否看起来合法（可解码且长度合理）
export function isValidSecret (secret) {
  if (!secret) return false
  const clean = String(secret).replace(/[\s=\-]/g, '')
  if (clean.length < 8) return false
  return /^[A-Z2-7]+$/i.test(clean)
}

// 把解析结果重组为 otpauth:// URI（用于回填表单）
export function toOtpauthUri (otp, label) {
  const issuer = encodeURIComponent(otp.issuer || '')
  const secret = otp.secret || ''
  const query = `secret=${secret}&issuer=${issuer}`
  const name = label || (otp.account || otp.issuer || '')
  return `otpauth://totp/${encodeURIComponent(name)}?${query}`
}
