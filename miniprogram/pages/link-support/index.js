Page({
  data: {
    platforms: [
      {
        name: '小红书',
        parser: 'BugPk /api/xhs，失败时回退 /api/xhsimg',
        input: '支持笔记链接、分享文案、xhslink 短链',
        output: '标题、摘要、作者、封面、图片列表、原始链接',
      },
      {
        name: '抖音',
        parser: 'BugPk /api/douyin',
        input: '支持 douyin.com 与 v.douyin.com 分享链',
        output: '标题、摘要、作者、封面、视频地址、原始链接',
      },
      {
        name: 'B站',
        parser: 'BugPk /api/bilibili',
        input: '支持 bilibili.com 与 b23.tv 链接',
        output: '标题、摘要、作者、封面、视频地址、原始链接',
      },
      {
        name: '微信公众号',
        parser: '网页抓取 + 元信息抽取',
        input: '支持 mp.weixin.qq.com 文章链接',
        output: '标题、摘要、公众号名、封面、发布时间、原始链接',
      },
      {
        name: '通用社媒/短视频',
        parser: 'BugPk /api/short_videos',
        input: '用于未命中专用平台的分享链接兜底',
        output: '平台、标题、摘要、媒体地址、原始链接',
      },
    ],
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/index/index' })
  },
})
