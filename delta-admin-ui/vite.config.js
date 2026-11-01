import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2018',
    cssTarget: ['chrome79', 'safari13']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 17420,
    strictPort: true,
    proxy: {
      '/file': { target: process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:17422', changeOrigin: true },
      '/ws': { target: process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:17422', ws: true, changeOrigin: true },
      '/api': {
        target: process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:17422/',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
