// 压测 A:并发 / 批量 / 深层嵌套(判定已修正)
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { execSync } from 'node:child_process'
const API = 'http://localhost:3320/api'
const post = (p, b) => JSON.parse(execSync(`curl -s -X POST ${API}${p} -H "Content-Type: application/json" -d '${JSON.stringify(b).replace(/'/g, "'\\''")}'`).toString())
const conn = async (file, name) => {
  const d = new Y.Doc()
  const p = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent(file), d, { disableBc: true })
  p.awareness.setLocalStateField('user', { name, color: '#e0533d' })
  await new Promise(r => p.on('sync', r))
  return { d, p }
}
// ② 10 并发 × 100 次
post('/files', { name: '压测/并发.md' })
const cs = await Promise.all(Array.from({ length: 10 }, (_, i) => conn('压测/并发.md', `C${i}`)))
for (let r = 0; r < 100; r++) cs.forEach((c, i) => c.d.getText('codemirror').insert(0, `${i}${r} `))
await new Promise(r => setTimeout(r, 4000))
const ref = cs[0].d.getText('codemirror').toString()
const same = cs.every(c => c.d.getText('codemirror').toString() === ref)
console.log(`② 10×100 并发: 全端一致 ${same ? '✓' : '✗'} | 片段 ${(ref.match(/\d\d /g) || []).length}/1000`)
cs.forEach(c => c.p.destroy())
// ③ 批量 100 文件
let t = Date.now()
for (let i = 0; i < 100; i++) post('/files', { name: `压测/批量/f${i}.md` })
console.log(`③ 建 100 文件: ${Date.now() - t}ms`)
// ④ 15 层嵌套
t = Date.now()
const deep = '压测/' + Array.from({ length: 15 }, (_, i) => `l${i}`).join('/') + '/深.md'
const rd = post('/files', { name: deep })
console.log(`④ 15 层嵌套: ${Date.now() - t}ms ${rd.ok ? '✓' : '✗'}`)
post('/delete', { path: '压测' })
console.log('清理:', execSync('ls notes/').toString().includes('压测') ? '✗ 残留' : '✓')
process.exit(0)
