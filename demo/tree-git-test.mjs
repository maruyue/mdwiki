// 目录树 + git + 在线编辑 组合测试
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
const API = 'http://localhost:3320/api'
const post = (p, b) => JSON.parse(execSync(`curl -s -X POST ${API}${p} -H "Content-Type: application/json" -d '${JSON.stringify(b).replace(/'/g, "'\\''")}'`).toString())
const getJ = (p) => JSON.parse(execSync(`curl -s "${API}${p}"`).toString())
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const flush = () => execSync(`curl -s -X POST ${API}/flush > /dev/null`)
const conn = async (file) => {
  const d = new Y.Doc()
  const p = new WebsocketProvider('ws://localhost:3320/ws', encodeURIComponent(file), d, { disableBc: true })
  await new Promise(r => p.on('sync', r))
  return { d, p }
}
const pass = (n, ok, extra = '') => console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' | ' + extra : ''}`)

// ============ A. 目录树(无编辑器) ============
console.log('\n--- A. 目录树基础 ---')
post('/mkdir', { path: '验证/子目录' })
pass('A1 建嵌套目录', existsSync('notes/验证/子目录'))

post('/files', { name: '验证/a.md' })
post('/content', { path: '验证/a.md', text: 'AAA 内容\n' })
flush(); await wait(400)
pass('A2 建文件+写内容', readFileSync('notes/验证/a.md', 'utf8').includes('AAA'))

let r = post('/move', { from: '验证/a.md', to: '验证/子目录/a2.md' })
pass('A3 移动文件', r.ok && existsSync('notes/验证/子目录/a2.md') && !existsSync('notes/验证/a.md'))

r = post('/move', { from: '验证/子目录/a2.md', to: '验证/子目录/b.txt' })
flush(); await wait(400)
pass('A4 重命名(改后缀)', r.ok && existsSync('notes/验证/子目录/b.txt') && readFileSync('notes/验证/子目录/b.txt', 'utf8').includes('AAA'))

post('/files', { name: '验证/冲突目标.md' })
r = post('/move', { from: '验证/子目录/b.txt', to: '验证/冲突目标.md' })
pass('A5 目标已存在 → 拒绝', !r.ok && r.error.includes('已存在'))

// 移动到不存在的目录 → 自动建
r = post('/move', { from: '验证/子目录/b.txt', to: '验证/自动创建/深/b.txt' })
pass('A6 移动到不存在目录(自动创建)', r.ok && existsSync('notes/验证/自动创建/深/b.txt'), JSON.stringify(r))

const rj = getJ(`/resolve?path=${encodeURIComponent('验证/a.md')}`)
pass('A7 旧路径 resolve → moved', rj.status === 'moved' && rj.to === '验证/子目录/a2.md')

// ============ B. 在线编辑 + 移动/重命名 ============
console.log('\n--- B. 在线编辑中移动/重命名 ---')
post('/files', { name: '验证/在线.md' })
const c1 = await conn('验证/在线.md')
c1.d.getText('codemirror').delete(0, c1.d.getText('codemirror').length)
c1.d.getText('codemirror').insert(0, 'BEFORE-MOVE\n')
await wait(600)
post('/move', { from: '验证/在线.md', to: '验证/子目录/在线2.md' })
c1.d.getText('codemirror').insert(c1.d.getText('codemirror').length, 'AFTER-MOVE\n')
await wait(1200)
execSync(`curl -s -X POST ${API}/flush > /dev/null`); await wait(500)
const b1 = readFileSync('notes/验证/子目录/在线2.md', 'utf8')
pass('B1 移动中继续编辑:内容跟到新路径', b1.includes('BEFORE-MOVE') && b1.includes('AFTER-MOVE'), JSON.stringify(b1))
pass('B2 旧路径未复活', !existsSync('notes/验证/在线.md'))

// 重命名时编辑
post('/move', { from: '验证/子目录/在线2.md', to: '验证/子目录/在线3.md' })
c1.d.getText('codemirror').insert(0, 'AFTER-RENAME\n')
await wait(1200); execSync(`curl -s -X POST ${API}/flush > /dev/null`); await wait(500)
const b3 = readFileSync('notes/验证/子目录/在线3.md', 'utf8')
pass('B3 重命名中继续编辑', b3.includes('AFTER-RENAME') && b3.includes('BEFORE-MOVE'))

// ============ C. git 版本 + 恢复(在线时) ============
console.log('\n--- C. git 版本与恢复 ---')
post('/revision', { message: 'T1 初始' })
const h1 = JSON.parse(execSync(`curl -s "${API}/log?file=${encodeURIComponent('验证/子目录/在线3.md')}"`).toString())
pass('C1 存版本后历史可见', h1.entries.length >= 1, `${h1.entries.length} 条`)

c1.d.getText('codemirror').insert(0, 'V2-ADDED\n')
await wait(800)
post('/revision', { message: 'T2 第二次' })
const h2 = JSON.parse(execSync(`curl -s "${API}/log?file=${encodeURIComponent('验证/子目录/在线3.md')}"`).toString())
pass('C2 两次版本都在', h2.entries.length >= 2)

// 恢复 T1(在线):编辑器应实时变回去
const t1commit = h2.entries.find(e => e.s.includes('T1')).h
r = post('/restore', { file: '验证/子目录/在线3.md', commit: t1commit })
await wait(1200)
const memAfterRestore = c1.d.getText('codemirror').toString()
pass('C3 恢复 T1:在线编辑器实时同步', r.ok && !memAfterRestore.includes('V2-ADDED') && memAfterRestore.includes('BEFORE-MOVE'))

// 跨改名的恢复:改成新名字后恢复旧版本
post('/move', { from: '验证/子目录/在线3.md', to: '验证/子目录/在线4.md' })
post('/revision', { message: 'T3 改名后' })
r = post('/restore', { file: '验证/子目录/在线4.md', commit: t1commit })
pass('C4 跨改名恢复到旧版本', r.ok, r.error || '')

// ============ D. 删除(在线) ============
console.log('\n--- D. 删除 ---')
r = post('/delete', { path: '验证/子目录/在线4.md' })
await wait(800)
pass('D1 删除被在线编辑的文件', r.ok && !existsSync('notes/验证/子目录/在线4.md'))
// 客户端连接应被 4002 踢掉(检查 provider 是否仍在���
await wait(500)
pass('D2 删除后客户端连接被关闭', c1.p.wsconnected === false || c1.p.shouldConnect === false, `wsconnected=${c1.p.wsconnected}`)
c1.p.destroy()

// ============ E. 空提交 & 目录删除 ============
console.log('\n--- E. 边界 ---')
post('/revision', { message: '测试收尾提交' })   // 先清掉前面操作产生的未提交变更
r = post('/revision', {})
pass('E1 空提交被拒(干净树)', !r.ok && r.error.includes('没有变更'), JSON.stringify(r))
r = post('/delete', { path: '验证' })
pass('E2 目录递归删除', r.ok && !existsSync('notes/验证'))

console.log('\n测试结束')
process.exit(0)
