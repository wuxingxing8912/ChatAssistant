import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

/**
 * 浏览器不能直连智谱接口：其 OPTIONS 预检不返回 CORS 响应头，
 * 而请求必须带 Authorization 和 Content-Type: application/json，两者都会触发预检，
 * 结果就是请求被浏览器拦截、fetch 直接失败（表现为“网络连接失败”）。
 *
 * 改为同源代理转发后请求不跨域，也不会触发预检。
 * 注意：代理只在 dev / preview 下存在，正式部署需由服务端提供同样的转发。
 */
const zhipuProxy = {
  '/api/zhipu': {
    target: 'https://open.bigmodel.cn/api/paas/v4',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/zhipu/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: zhipuProxy },
  preview: { proxy: zhipuProxy },
})
