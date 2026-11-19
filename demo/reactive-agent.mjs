// reactive-agent.mjs —— 反应式 Agent:监听 @agent 指令,秒级回应,记录各段耗时
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent('欢迎.md'), doc, { disableBc: true })
provider.awareness.setLocalStateField('user', { name: '快反Agent', color: '#e0533d' })

let timer = null, triggerAt = 0
provider.on('sync', () => {
  const ytext = doc.getText('codemirror')
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] 快反Agent 就位,等待 @agent 指令…`)
  ytext.observe(ev => {
    for (const d of ev.delta) {
      if (!d.insert || !d.insert.includes('@agent')) continue
      triggerAt = Date.now()                       // ① 检测:操作到达的瞬间
      clearTimeout(timer)
      timer = setTimeout(async () => {             // ② 防抖:等人把话说完(700ms,可调)
        const t0 = Date.now()
        const full = ytext.toString()
        const q = (full.match(/@agent[^\n]*/) || [''])[0]
        let reply
        if (/几点|时间/.test(q)) reply = `现在时刻 ${new Date().toLocaleTimeString('zh-CN')}`
        else if (/字数|多少字/.test(q)) reply = `本文档目前 ${full.length} 字符`
        else reply = `已收到:「${q.replace('@agent', '').trim() || '(空)'}」。我是规则级秒回;换成 LLM 决策,这里会多 1~5 秒`
        const t1 = Date.now()                      // ③ 决策完成
        ytext.insert(ytext.length, `\n\n🤖 ${reply}`)  // ④ 一次性写入(单操作,全端即时可见)
        const t2 = Date.now()
        console.log(`[react] 检测→开始决策 ${t0 - triggerAt}ms(含防抖${t0 - triggerAt < 750 ? '≈700' : ''}) | 决策 ${t1 - t0}ms | 写入 ${t2 - t1}ms | 说完话到看到回答共 ${t2 - triggerAt}ms`)
      }, 700)
    }
  })
})
setTimeout(() => process.exit(0), 120000)
