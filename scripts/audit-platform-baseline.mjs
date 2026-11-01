import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const destination = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2] || 'D:/codeStudy/code/detla'
if (process.platform === 'win32' && !/^D:\\/i.test(destination)) throw new Error('报告须位于 D 盘项目目录')
async function inventory(root) {
  const result = new Map()
  async function walk(relative = '') {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes:true})) {
      if (entry.name.startsWith('.') || ['node_modules','dist','target','runtime','logs'].includes(entry.name)) continue
      const name = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) await walk(name)
      else if (/\.(java|vue|js|scss)$/.test(entry.name)) result.set(name, createHash('sha256').update((await readFile(path.join(root,name),'utf8')).replaceAll('\r\n','\n')).digest('hex'))
    }
  }
  await walk(); return result
}
const [before, after] = await Promise.all([inventory(source), inventory(destination)])
const result = {
  auditedAt:new Date().toISOString(), source, destination,
  sourceFiles:before.size, projectFiles:after.size,
  onlyInSource:[...before.keys()].filter(name=>!after.has(name)),
  addedToProject:[...after.keys()].filter(name=>!before.has(name)),
  changedFiles:[...before.keys()].filter(name=>after.has(name)&&before.get(name)!==after.get(name)),
  note:'仅比较源码路径及哈希，不读取运行数据与密钥；差异需逐项确认，不自动覆盖客户定制。'
}
await writeFile(path.join(destination,'docs/platform-baseline.json'), JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({sourceFiles:result.sourceFiles,projectFiles:result.projectFiles,onlyInSource:result.onlyInSource.length,addedToProject:result.addedToProject.length,changedFiles:result.changedFiles.length}))
