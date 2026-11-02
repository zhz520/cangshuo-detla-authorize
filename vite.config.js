import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({ plugins: [vue()], build:{target:'es2018',cssTarget:['chrome79','safari13']}, server: { host: '127.0.0.1', port: 17440, strictPort: true, proxy: { '/api': 'http://127.0.0.1:17441', '/public': 'http://127.0.0.1:17441' } } })
