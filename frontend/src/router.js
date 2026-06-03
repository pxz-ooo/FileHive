import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('./views/Dashboard.vue'),
    meta: { title: '概览' },
  },
  {
    path: '/messages',
    name: 'MessageList',
    component: () => import('./views/MessageList.vue'),
    meta: { title: '消息列表' },
  },
  {
    path: '/messages/:msgid',
    name: 'MessageDetail',
    component: () => import('./views/MessageDetail.vue'),
    meta: { title: '消息详情' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
