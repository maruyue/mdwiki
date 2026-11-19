import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const API = 'http://localhost:3320/api'
const F = '压测/抖动.md'
execSync(`curl -s -X POST ${API}/files -H "Content-Type: application/json" -d '{"name":"${F}"}' > /dev/null`)
await new Promise(r => setTimeout(r, 900))

// 20 个客户端,每个连接→写→断开→重连→再写,共 5 轮
let ok = 0, fail = 0
for (let round = 0; round < 5; round++) {
  const clients = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const d = new Y.Doc()
    const p = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent(F), d, { disableBc: true })
    await new Promise((res, rej) => { p.on('sync', res); setTimeout(() => rej(new Error('timeout')), 5000) }).catch(() => {})
    return { d, p }
  }))
  clients.forEach((c, i) => { try { c.d.getText('codemirror').insert(0, `R${round}C${i} `); ok++ } catch { fail++ } })
  await new Promise(r => setTimeout(r, 800))
  clients.forEach(c => c.p.destroy())   // 全部断开
  await new Promise(r => setTimeout(r, 300))
}
await new Promise(r => setTimeout(r, 2000))
execSync(`curl -s -X POST ${API}/flush > /dev/null`)
await new Promise(r => setTimeout(r, 600))
const disk = readFileSync('notes/' + F, 'utf8')
const marks = (disk.match(/R\dC\d+ /g) || []).length
console.log(`抖动测试: 5 轮 × 20 客户端 × 连接+断开 = 100 次连接 | 写入成功 ${ok}, 失败 ${fail}`)
console.log(`磁盘标记 ${marks}/100 ${marks === 100 ? '✓ 零丢失' : '✗ 丢失 ' + (100 - marks)}`)
execSync(`curl -s -X POST ${API}/delete -H "Content-Type: application/json" -d '{"path":"压测"}'`)
const rss = execSync(`ps -o rss= -p $(pgrep -f "node server.mjs")`).toString().trim()
console.log(`清理完成 | 服务 RSS ${(rss/1024).toFixed(0)}MB`)
process.exit(0)
