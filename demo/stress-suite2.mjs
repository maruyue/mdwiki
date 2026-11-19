import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
const API = 'http://localhost:3320/api'
const post = (p, b) => JSON.parse(execSync(`curl -s -X POST ${API}${p} -H "Content-Type: application/json" -d '${JSON.stringify(b).replace(/'/g, "'\\''")}'`).toString())
const flush = () => execSync(`curl -s -X POST ${API}/flush`)
const conn = async (file, name = 'c') => {
  const d = new Y.Doc()
  const p = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent(file), d, { disableBc: true })
  p.awareness.setLocalStateField('user', { name, color: '#e0533d' })
  await new Promise(r => p.on('sync', r))
  return { d, p }
}

// ① 大文件:强制刷盘后比对
post('/files', { name: '压测/大文件.md' })
const c1 = await conn('压测/大文件.md')
const big = '# 大文件\n\n' + '压测内容段落,中英混排 mixed content.\n'.repeat(8000)
const t0 = Date.now(); c1.d.getText('codemirror').delete(0, c1.d.getText('codemirror').length); c1.d.getText('codemirror').insert(0, big)
await new Promise(r => setTimeout(r, 1500)); flush(); await new Promise(r => setTimeout(r, 600))
const d1 = readFileSync('notes/压测/大文件.md', 'utf8')
console.log(`① 大文件 ${(big.length/1024).toFixed(0)}KB: 内存插入→广播 ${Date.now()-t0}ms | 刷盘后一致 ${d1 === big ? '✓' : '✗'}`)
c1.p.destroy()

// ⑤ 2000 次插入:按模板+操作数精确核算
post('/files', { name: '压测/速率.md' })
const c5 = await conn('压测/速率.md')
const base = c5.d.getText('codemirror').toString()
for (let i = 0; i < 2000; i++) c5.d.getText('codemirror').insert(i, 'x')
await new Promise(r => setTimeout(r, 1200)); flush(); await new Promise(r => setTimeout(r, 600))
const d5 = readFileSync('notes/压测/速率.md', 'utf8')
const ok5 = d5.length === base.length + 2000 && (d5.match(/x/g) || []).length === 2000
console.log(`⑤ 2000 次插入: 磁盘 ${d5.length} 字符(期望 ${base.length}+2000) ${ok5 ? '✓' : '✗'}`)
c5.p.destroy()

// ⑦ 快速生命周期:建→写→移→改名→删 ×30
let cycleOk = 0
for (let i = 0; i < 30; i++) {
  const n = `压测/循环/c${i}.md`
  const r1 = post('/files', { name: n })
  const r2 = post('/content', { path: `压测/循环/c${i}.md`, text: `cycle-${i}` })
  const r3 = post('/move', { from: `压测/循环/c${i}.md`, to: `压测/循环/d${i}.md` })
  const r4 = post('/move', { from: `压测/循环/d${i}.md`, to: `压测/循环/e${i}.txt` })
  const r5 = post('/delete', { path: `压测/循环/e${i}.txt` })
  if (r1.ok && r2.ok && r3.ok && r4.ok && r5.ok) cycleOk++
}
await new Promise(r => setTimeout(r, 500))
console.log(`⑦ 快速生命周期 ×30: ${cycleOk}/30 全步成功 ${cycleOk === 30 ? '✓' : '✗'} | 残留 ${existsSync('notes/压测/循环') && readFileSync ? '' : ''}`)

// ⑧ HTTP 并发(200 个并行列表请求)
const t8 = Date.now()
execSync(`seq 200 | xargs -P 20 -I{} curl -s -o /dev/null http://localhost:3320/api/files`)
console.log(`⑧ 200 并行 HTTP 列表: ${Date.now()-t8}ms`)

// ⑨ 编辑中移动文件(内容是否跟随,旧路径是否复活)
post('/files', { name: '压测/编辑中移动.md' })
const c9 = await conn('压测/编辑中移动.md')
c9.d.getText('codemirror').delete(0, c9.d.getText('codemirror').length)
c9.d.getText('codemirror').insert(0, '移动前的内容「KEEP-ME」\n')
await new Promise(r => setTimeout(r, 600))
const mv = post('/move', { from: '压测/编辑中移动.md', to: '压测/子目录/编辑中移动.md' })
c9.d.getText('codemirror').insert(0, '移动后追加「ALSO-KEEP」\n')
await new Promise(r => setTimeout(r, 800)); flush(); await new Promise(r => setTimeout(r, 600))
const nd = readFileSync('notes/压测/子目录/编辑中移动.md', 'utf8')
const oldAlive = existsSync('notes/压测/编辑中移动.md')
console.log(`⑨ 编辑中移动: 新路径含两段内容 ${nd.includes('KEEP-ME') && nd.includes('ALSO-KEEP') ? '✓' : '✗'} | 旧路径复活 ${oldAlive ? '✗' : '✓ 无'}`)
c9.p.destroy()

// 清理
post('/delete', { path: '压测' })
await new Promise(r => setTimeout(r, 600))
console.log(`清理: ${existsSync('notes/压测') ? '✗ 残留' : '✓'}`)
process.exit(0)
