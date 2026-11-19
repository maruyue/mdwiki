// agent-client.mjs —— Agent 作为协作者直连 Yjs 房间
// 用法: node agent-client.mjs <文件路径> <要说的话>
// 效果: 网页端实时看到紫色 "Agent" 光标进场、逐字输入、然后离场
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const file = process.argv[2] || '欢迎.md'
const message = process.argv[3] || 'Agent 到此一游'
const WS = 'ws://localhost:3320/ws'

const doc = new Y.Doc()
const provider = new WebsocketProvider(WS, encodeURIComponent(file), doc, { disableBc: true })

// 1. 报上身份:在线列表会出现紫色 "Agent" 徽标,光标带名字
provider.awareness.setLocalStateField('user', { name: 'Agent', color: '#8e4fd1' })

provider.on('sync', async () => {
  const ytext = doc.getText('codemirror')
  const pos = ytext.length // 从文末开始

  // 2. 光标落在文末(网页端能看到紫色光标和名字标签)
  provider.awareness.setLocalStateField('cursor', {
    anchor: Y.createRelativePositionFromTypeIndex(ytext, pos),
    head: Y.createRelativePositionFromTypeIndex(ytext, pos),
  })
  await new Promise(r => setTimeout(r, 800)) // 让在线者看清光标进场

  // 3. 逐字"打字"(字符级 CRDT 操作,与人类并发编辑自动合并)
  const line = `\n\n> 🤖 ${message} @ ${new Date().toLocaleTimeString('zh-CN')}`
  for (const ch of line) {
    ytext.insert(ytext.length, ch)
    await new Promise(r => setTimeout(r, 90)) // 25ms/字,人类肉眼可见
  }

  console.log(`✓ Agent 已写入 ${line.length} 字符到 ${file}`)
  setTimeout(() => { provider.destroy(); process.exit(0) }, 20000) // 停留3秒让光标可见,再退场
})
setTimeout(() => { console.error('连接超时'); process.exit(1) }, 20000)
