const WEBVIEW_ALLOWED_HOSTS = [
  'mp.weixin.qq.com',
  'file-hive-mtf1.vercel.app',
]

// Fill these entries only after confirming the target mini program appId and path contract.
const PLATFORM_MINI_PROGRAMS = {
  小红书: null,
  抖音: null,
  B站: null,
}

function normalizeUrl(value) {
  const url = String(value || '').trim()
  return /^https:\/\//i.test(url) ? url : ''
}

function getHost(url) {
  const match = normalizeUrl(url).match(/^https:\/\/([^/:?#]+)/i)
  return match ? match[1].toLowerCase() : ''
}

function canOpenInWebView(url) {
  const host = getHost(url)
  return WEBVIEW_ALLOWED_HOSTS.some((allowedHost) => (
    host === allowedHost || host.endsWith(`.${allowedHost}`)
  ))
}

function copyLink(url, message) {
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: message || '链接已复制', icon: 'none' })
        resolve({ method: 'clipboard' })
      },
      fail: reject,
    })
  })
}

function openWebView(url, platform) {
  const params = [
    `url=${encodeURIComponent(url)}`,
    `platform=${encodeURIComponent(platform || '外部内容')}`,
  ].join('&')
  return new Promise((resolve, reject) => {
    wx.navigateTo({
      url: `/pages/webview/webview?${params}`,
      success: () => resolve({ method: 'webview' }),
      fail: reject,
    })
  })
}

function openPlatformMiniProgram(platform, sourceUrl) {
  const target = PLATFORM_MINI_PROGRAMS[platform]
  if (!target || !target.appId) return Promise.reject(new Error('platform mini program unavailable'))

  return new Promise((resolve, reject) => {
    wx.navigateToMiniProgram({
      appId: target.appId,
      path: typeof target.buildPath === 'function' ? target.buildPath(sourceUrl) : target.path,
      extraData: { sourceUrl },
      success: () => resolve({ method: 'miniProgram' }),
      fail: reject,
    })
  })
}

async function openSourceLink({ url, platform }) {
  const sourceUrl = normalizeUrl(url)
  if (!sourceUrl) throw new Error('链接无效')

  try {
    return await openPlatformMiniProgram(platform, sourceUrl)
  } catch (error) {
    // Platform mini programs require verified appIds and stable target paths.
  }

  if (canOpenInWebView(sourceUrl)) {
    try {
      return await openWebView(sourceUrl, platform)
    } catch (error) {
      // Fall through to clipboard when navigation or domain verification fails.
    }
  }

  return copyLink(sourceUrl, '链接已复制，请前往对应应用打开')
}

module.exports = {
  canOpenInWebView,
  copyLink,
  openSourceLink,
}
