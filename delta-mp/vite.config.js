import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
  server: {
    host: '127.0.0.1',
    port: 17421,
    proxy: {
      '/file': { target: process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:17422', changeOrigin: true },
      '/ws': { target: process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:17422', ws: true, changeOrigin: true },
      '/api': { target: process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:17422', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') }
    },
    strictPort: true,
    fs: { strict: true }
  },
  build: {
    sourcemap: false,
    target: 'es2018',
    cssTarget: ['chrome79', 'safari13']
  }
})
