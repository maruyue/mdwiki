import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { execSync } from 'node:child_process'
const API = 'http://localhost:3320/api'
const PID = execSync('lsof -ti tcp:3320 -sTCP:LISTEN').toString().trim().split('\n')[0]
const rss = () => +execSync(`ps -o rss= -p ${PID}`).toString().trim() / 1024
execSync(`curl -s -X POST ${API}/files -H "Content-Type: application/json" -d '{"name":"回收测试.md"}' > /dev/null`)
await new Promise(r => setTimeout(r, 900))
console.log('建文件后 RSS:', rss().toFixed(0), 'MB')
// 连接 → 写入 → 断开
const d = new Y.Doc()
const p = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent('回收测试.md'), d, { disableBc: true })
await new Promise(r => p.on('sync', r))
d.getText('codemirror').insert(0, '回收前内容 KEEP\n')
await new Promise(r => setTimeout(r, 800))
p.destroy(); d.destroy()
console.log('已断开,等待空闲回收(阈值 3 秒,扫描周期 3 秒)…')
await new Promise(r => setTimeout(r, 9000))
const log = execSync('tail -20 server.log').toString()
console.log('回收日志:', /\[evict\]/.test(log) ? '✓ 出现 [evict]' : '✗ 未出现')
console.log('回收到内容是否落盘:', execSync('cat notes/回收测试.md').toString().includes('KEEP') ? '✓ 内容保留' : '✗ 丢失')
execSync(`curl -s -X POST ${API}/delete -H "Content-Type: application/json" -d '{"path":"回收测试.md"}'`)
process.exit(0)
