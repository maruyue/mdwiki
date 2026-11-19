// 房间泄漏测试:打开 200 个文件各 2 秒后全部关闭,观察服务内存
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { execSync } from 'node:child_process'
const API = 'http://localhost:3320/api'
const PID = execSync('lsof -ti tcp:3320 -sTCP:LISTEN').toString().trim().split('\n')[0]
const rss = () => +execSync(`ps -o rss= -p ${PID}`).toString().trim() / 1024

console.log('起始 RSS:', rss().toFixed(0), 'MB')
// 建 200 个文件,每个 5KB
const content = 'x'.repeat(5000)
for (let i = 0; i < 200; i++) {
  execSync(`curl -s -X POST ${API}/files -H "Content-Type: application/json" -d '{"name":"泄漏测试/f${i}.md"}' > /dev/null`)
  execSync(`curl -s -X POST ${API}/content -H "Content-Type: application/json" -d '{"path":"泄漏测试/f${i}.md","text":"${content}"}' > /dev/null`)
}
const afterCreate = rss()
console.log('建 200×5KB 文件后:', afterCreate.toFixed(0), 'MB')

// 逐个打开连接再关闭(每个房间会被载入内存)
for (let i = 0; i < 200; i++) {
  const d = new Y.Doc()
  const p = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent(`泄漏测试/f${i}.md`), d, { disableBc: true })
  await new Promise(r => p.on('sync', r))
  p.destroy()
  d.destroy()
}
await new Promise(r => setTimeout(r, 1500))
const afterOpen = rss()
console.log('全部打开并断开后:', afterOpen.toFixed(0), 'MB')

// 等 5 秒看是否回收
await new Promise(r => setTimeout(r, 5000))
console.log('再等 5 秒:', rss().toFixed(0), 'MB')

// 清理文件再观察
execSync(`curl -s -X POST ${API}/delete -H "Content-Type: application/json" -d '{"path":"泄漏测试"}'`)
await new Promise(r => setTimeout(r, 1500))
console.log('删除全部文件后:', rss().toFixed(0), 'MB')
process.exit(0)
