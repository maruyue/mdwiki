// agent-watch.mjs —— 观察员:实时打印房间里所有人的编辑与光标
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const file = process.argv[2] || '欢迎.md'
const doc = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent(file), doc, { disableBc: true })
provider.awareness.setLocalStateField('user', { name: '观察员', color: '#3db86a' })

const t = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
provider.on('sync', () => {
  console.log(`[${t()}] 已进入房间 ${file},开始监听…`)
  doc.getText('codemirror').observe(event => {
    for (const d of event.delta) {
      if (d.insert) console.log(`[${t()}] 收到插入: ${JSON.stringify(d.insert)}`)
      if (d.delete) console.log(`[${t()}] 收到删除: ${d.delete} 字符`)
    }
  })
  provider.awareness.on('change', () => {
    const users = [...provider.awareness.getStates().values()].map(s => s.user?.name).filter(Boolean)
    console.log(`[${t()}] 在线/光标变动: ${[...new Set(users)].join(', ')}`)
  })
})
setTimeout(() => { console.log(`[${t()}] 观察结束`); process.exit(0) }, 30000)
