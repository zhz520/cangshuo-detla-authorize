import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const useSupportEntry = server => {
  server.middlewares.use((request, _response, next) => {
    const pathname=request.url?.split('?',1)[0]||''
    if(/^\/chat\/[a-z0-9][a-z0-9-]{1,47}(?:\/agent)?\/?$/.test(pathname))request.url='/support.html'+request.url.slice(pathname.length)
    next()
  })
}
export default defineConfig({
  plugins:[vue(),{name:'support-html-entry',configureServer:useSupportEntry,configurePreviewServer:useSupportEntry}],
  build:{target:'es2018',cssTarget:['chrome79','safari13'],rollupOptions:{input:{
    index:fileURLToPath(new URL('./index.html',import.meta.url)),
    support:fileURLToPath(new URL('./support.html',import.meta.url))
  }}},
  server:{host:'127.0.0.1',port:17440,strictPort:true,proxy:{'/api':'http://127.0.0.1:17441','/public':'http://127.0.0.1:17441'}}
})
