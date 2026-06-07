Page({
  data: {
    url: '',
    platform: '外部内容',
  },

  onLoad(options) {
    const decoded = decodeURIComponent(options.url || '')
    const platform = decodeURIComponent(options.platform || '外部内容')
    if (!/^https:\/\//i.test(decoded)) {
      wx.showToast({ title: '链接无效', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    wx.setNavigationBarTitle({ title: `来源：${platform}` })
    this.setData({ url: decoded, platform })
  },
})
