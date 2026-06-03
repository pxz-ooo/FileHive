Page({
  data: {
    url: '',
  },

  onLoad(options) {
    const decoded = decodeURIComponent(options.url || '')
    this.setData({ url: decoded })
  },
})
