// mdwiki-demo server —— Node + 官方 y-websocket 协议层 + inode 身份架构
// 运行: node server.mjs   (端口 3320)
//
// 架构(三层):
//   实时层:Yjs 房间按 inode 键控 —— 移动/改名永不迁移房间(竞态从源头消失)
//   映射层:registry(inode→当前路径,内存)+ redirects(旧路径→新路径,内存)
//   持久层:磁盘文件 + git(按路径管历史;rename 记录即持久化改名台账)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { WebSocketServer } from 'ws'
import { createRequire } from 'node:module'
import * as encoding from 'lib0/encoding'
// 与 utils.cjs 共用同一个 CJS yjs 实例
const require = createRequire(import.meta.url)
const Y = require('yjs')
const awarenessProtocol = require('y-protocols/awareness')
const hdUtils = require('./node_modules/y-websocket/bin/utils.cjs')

const { setupWSConnection, getYDoc } = hdUtils
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3320
const NOTES = path.join(__dirname, 'notes')
fs.mkdirSync(NOTES, { recursive: true }) // 全新克隆时数据目录可能不存在
const YTEXT_KEY = 'codemirror'

// ---------- 工具 ----------
const EXTS = ['.md', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.css', '.html', '.sh', '.txt']
// 段校验:允许点文件/点目录;含 . .. .git(任意大小写)整条路径直接判非法(拒绝而非静默剥离)
// 注意 macOS/APFS 卷不区分大小写,.Git 与 .git 是同一个目录 —— 必须大小写不敏感比对
const badSeg = (s) => !s || s === '.' || s === '..' || s.toLowerCase() === '.git'
const safePath = (n) => {
  const segs = String(n || '').trim().split('/')
  if (segs.some(badSeg)) return ''
  const parts = segs.filter(Boolean)
  const last = parts.pop()
  if (!last) return ''
  if (last.startsWith('.')) return [...parts, last].join('/') // 点文件保持原名,不强加后缀
  const hasExt = EXTS.some(e => last.toLowerCase().endsWith(e))
  return [...parts, hasExt ? last : last + '.md'].join('/')
}
const safeDirPath = (n) => {
  const segs = String(n || '').trim().split('/')
  if (segs.some(badSeg)) return ''
  return segs.filter(Boolean).join('/')
}
const notePath = (n) => path.join(NOTES, n)
// 新建文件用 tmp+rename(原子);已存在文件必须原地写 —— rename 会换 inode,击穿房间身份
const writeFileInPlace = (p, content) => fs.writeFileSync(p, content)
const atomicWrite = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, p)
}
const walkNotes = (dir = NOTES, prefix = '', out = { files: [], dirs: [] }) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === '.gitkeep') continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) { out.dirs.push(rel); walkNotes(path.join(dir, e.name), rel, out) }
    else if (e.name.startsWith('.') || EXTS.some(x => e.name.toLowerCase().endsWith(x))) out.files.push(rel)
  }
  return out
}
// 启动世代号:每次进程启动生成一个;重启即变,客户端据此判断"房间历史已重建"
const EPOCH = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const gitRun = (...args) => spawnSync('git', ['-c', 'core.quotepath=false', '-C', NOTES, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const gitOut = (...args) => gitRun(...args).stdout.trim()
const inodeKeyOf = (p) => { const st = fs.statSync(p); return `${st.dev}-${st.ino}` }

// ---------- 房间:按 inode 键控 ----------
const rooms = new Map()      // inodeKey -> { doc, dirty, flushed }
const registry = new Map()   // inodeKey -> 当前路径(移动时一条赋值,房间不动)
const redirects = new Map()  // 旧路径 -> 新路径(内存;跨重启由 git rename 记录兜底)

function getRoom(inodeKey, filePath) {
  registry.set(inodeKey, filePath) // 恒以最新为准,自愈陈旧条目
  let room = rooms.get(inodeKey)
  if (room) return room
  const doc = getYDoc(inodeKey) // 官方 WSSharedDoc
  room = { doc, dirty: false, flushed: null, lastActive: Date.now() }
  rooms.set(inodeKey, room)
  const p = notePath(filePath)
  if (fs.existsSync(p) && doc.getText(YTEXT_KEY).length === 0) {
    const text = fs.readFileSync(p, 'utf8')
    if (text.length > 0) Y.transact(doc, () => doc.getText(YTEXT_KEY).insert(0, text))
    room.flushed = text
  }
  doc.on('update', () => { room.dirty = true; room.lastActive = Date.now() })
  return room
}

// ---------- 落盘(60 秒定时 + 存版本前强制全量) ----------
// force=true:忽略 dirty 标记,把所有房间与磁盘的差异写下去(commit 前调用)
function flushAll(force = false) {
  let written = 0
  for (const [inodeKey, room] of rooms) {
    if (!force && !room.dirty) continue
    const text = room.doc.getText(YTEXT_KEY).toString()
    // 注:曾有过"精确翻倍自愈"守卫(检测 text[:n/2]==text[n/2:] 时减半)。
    // 已移除 —— ①重启造成的翻倍已被"连接锁 + 世代号"从源头阻断;
    // ②该启发式会误伤合法内容(两段相同的模板/示例会被静默截断),代价大于收益。
    if (text === room.flushed) { room.dirty = false; continue }
    const filePath = registry.get(inodeKey)
    if (!filePath) continue
    try {
      const p = notePath(filePath)
      // 内存有改动时,以磁盘实际字节比对(不只看 flushed 缓存),再决定是否覆盖
      const diskNow = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
      if (diskNow !== text) {
        fs.existsSync(p) ? writeFileInPlace(p, text) : atomicWrite(p, text)
        written++
        console.log(`[flush] ${filePath} (${text.length} chars)`)
      }
      room.flushed = text
    } catch (e) {
      console.log(`[flush-retry] ${filePath}: ${e.message}`) // 撞上 rename 瞬间,下次用新路径重写
    }
    room.dirty = false
  }
  return written
}
// 落盘节奏:60 秒一次(存版本前仍强制全量刷;崩溃窗口内浏览器持有全文,重连后补推)
const FLUSH_INTERVAL = 60 * 1000
setInterval(() => flushAll(false), FLUSH_INTERVAL)

// ---------- 房间空闲回收:无人连接且长期无编辑 → 释放内存(Yjs 文档 + awareness) ----------
// 默认 30 分钟;可用 ROOM_IDLE_MS 覆盖(测试用短值)
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 30 * 60 * 1000)
const EVICT_SWEEP_MS = Math.min(5 * 60 * 1000, ROOM_IDLE_MS)
setInterval(() => {
  const now = Date.now()
  for (const [inodeKey, room] of [...rooms]) {
    if (room.doc.conns.size > 0) { room.lastActive = now; continue }   // 有人在线,保活
    if (now - room.lastActive < ROOM_IDLE_MS) continue
    const filePath = registry.get(inodeKey)
    // 回收前兜底落盘(正常情况下 60 秒定时器已写过,这里防漏)
    try {
      if (filePath) {
        const text = room.doc.getText(YTEXT_KEY).toString()
        const p = notePath(filePath)
        if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') !== text) { writeFileInPlace(p, text); console.log(`[evict-flush] ${filePath}`) }
      }
      room.doc.destroy()
    } catch (e) { console.log(`[evict] 回收失败 ${inodeKey}: ${e.message}`) }
    rooms.delete(inodeKey)
    registry.delete(inodeKey)
    console.log(`[evict] 空闲回收房间 ${filePath || inodeKey}`)
  }
}, EVICT_SWEEP_MS)

// ---------- awareness 保活 ----------
setInterval(() => {
  for (const room of rooms.values()) {
    const ids = [...room.doc.awareness.getStates().keys()]
    if (!ids.length || !room.doc.conns.size) continue
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, 1)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.doc.awareness, ids))
    const snap = encoding.toUint8Array(enc)
    for (const [conn] of room.doc.conns) conn.send(snap, { binary: true })
  }
}, 10000)

// ---------- HTTP ----------
const json = (obj, status = 200) => [status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(obj)]
const readBody = (req) => new Promise(resolve => {
  let d = ''
  req.on('data', c => (d += c))
  req.on('end', () => { try { resolve(JSON.parse(d || '{}')) } catch { resolve({}) } })
})
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

// rename 对(最新在前)。注意:带 pathspec 查旧路径时 git 只显示 D,必须全库扫 R 再自行配对
function renamePairs() {
  const r = gitRun('log', '--name-status', '--diff-filter=R', '-n', '500', '--format=%H')
  return [...r.stdout.matchAll(/^R\d+\t(.+?)\t(.+)$/gm)].map(m => [m[1].trim(), m[2].trim()])
}
// 路径现状:ok / moved(带新路径)/ gone。两级:内存表 → git rename 记录
function resolvePath(file) {
  if (!file) return { status: 'gone' }
  if (fs.existsSync(notePath(file))) return { status: 'ok' }
  if (redirects.has(file)) return { status: 'moved', to: redirects.get(file) }
  const hit = renamePairs().find(([oldP]) => oldP === file)
  if (hit) {
    const to = hit[1]
    if (fs.existsSync(notePath(to))) return { status: 'moved', to }
  }
  return { status: 'gone' }
}
// 沿 rename 链解析 commit 时刻的旧路径(a→b→c,当前是 c)
function historicalPath(commit, file, depth = 5) {
  const lsTree = gitRun('ls-tree', '--name-only', commit, '--', file)
  if (lsTree.status === 0 && lsTree.stdout.trim() === file) return file
  if (depth <= 0) return null
  for (const [oldP, newP] of renamePairs()) {
    if (newP === file) {
      const found = historicalPath(commit, oldP, depth - 1)
      if (found) return found
    }
  }
  return null
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const [status, headers, body] = await (async () => {
    try {
      if (url.pathname === '/api/files' && req.method === 'GET') {
        const w = walkNotes()
        return json({ ok: true, files: w.files.sort(), dirs: w.dirs.sort() })
      }
      if (url.pathname === '/api/resolve' && req.method === 'GET') {
        const file = safePath(url.searchParams.get('path') || '')
        return json({ ok: true, ...resolvePath(file) })
      }
      if (url.pathname === '/api/content' && req.method === 'GET') {
        const file = safePath(url.searchParams.get('path') || '')
        if (!file || !fs.existsSync(notePath(file))) return json({ ok: false, error: '不存在' }, 404)
        const room = rooms.get(inodeKeyOf(notePath(file)))
        const text = room ? room.doc.getText(YTEXT_KEY).toString() : fs.readFileSync(notePath(file), 'utf8')
        return [200, { 'Content-Type': 'text/plain; charset=utf-8' }, text]
      }
      if (url.pathname === '/api/content' && req.method === 'POST') {
        const b = await readBody(req)
        const file = safePath(b.path)
        const text = typeof b.text === 'string' ? b.text : null
        if (!file || text == null) return json({ ok: false, error: '缺少 path/text' }, 400)
        if (!fs.existsSync(notePath(file))) return json({ ok: false, error: '文件不存在' }, 404)
        // 写穿房间:服务端作为"另一个协作者"写入 → 在线者实时可见 → 下个定时周期落盘
        const room = getRoom(inodeKeyOf(notePath(file)), file)
        Y.transact(room.doc, () => {
          const t = room.doc.getText(YTEXT_KEY)
          t.delete(0, t.length)
          t.insert(0, text)
        })
        room.dirty = true
        console.log(`[api-write] ${file} (${text.length} chars)`)
        return json({ ok: true, file, chars: text.length })
      }
      if (url.pathname === '/api/files' && req.method === 'POST') {
        const b = await readBody(req)
        const name = safePath(b.name)
        if (!name) return json({ ok: false, error: '非法名称' }, 400)
        if (fs.existsSync(notePath(name))) return json({ ok: false, error: '已存在' }, 409)
        atomicWrite(notePath(name), `# ${name.replace(/\.[^.]+$/, '').split('/').pop()}\n\n`)
        return json({ ok: true, name })
      }
      if (url.pathname === '/api/mkdir' && req.method === 'POST') {
        const b = await readBody(req)
        const dir = safeDirPath(b.path)
        if (!dir) return json({ ok: false, error: '非法路径' }, 400)
        fs.mkdirSync(path.join(NOTES, dir), { recursive: true })
        if (!fs.existsSync(path.join(NOTES, dir, '.gitkeep'))) fs.writeFileSync(path.join(NOTES, dir, '.gitkeep'), '')
        return json({ ok: true, path: dir })
      }
      if (url.pathname === '/api/move' && req.method === 'POST') {
        const b = await readBody(req)
        const rawFrom = String(b.from || '').trim()
        const to = String(b.to || '').trim()
        if (!rawFrom) return json({ ok: false, error: '缺少源路径' }, 400)
        // 目录探测必须在 safePath 之前:safePath 会给无后缀名强加 .md,目录名会被改写
        const fromDir = safeDirPath(rawFrom)
        const dirSrc = fromDir ? notePath(fromDir) : null
        const isDir = !!(dirSrc && fs.existsSync(dirSrc) && fs.statSync(dirSrc).isDirectory())
        const from = isDir ? fromDir : safePath(rawFrom)
        if (!from) return json({ ok: false, error: '非法源路径' }, 400)
        const src = notePath(from)
        if (!fs.existsSync(src)) return json({ ok: false, error: '源不存在' }, 404)
        // 目标路径统一走 safePath/safeDirPath(支持点目录,拒绝 . .. .git;不再静默剥离)
        const toRel = isDir ? safeDirPath(to) : safePath(to)
        if (!toRel) return json({ ok: false, error: '非法目标路径' }, 400)
        const dst = notePath(toRel)
        if (dst !== src && fs.existsSync(dst)) return json({ ok: false, error: '目标已存在' }, 409)
        // 房间层零迁移:先记 inode,搬文件,然后一条赋值更新注册表
        let inodeKey = null
        if (!isDir) { try { inodeKey = inodeKeyOf(src) } catch {} }
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.renameSync(src, dst)
        if (isDir) {
          for (const [k, p] of [...registry]) {
            if (p === from || p.startsWith(from + '/')) {
              const np = toRel + p.slice(from.length)
              registry.set(k, np)
              redirects.set(p, np)
            }
          }
        } else if (inodeKey) {
          registry.set(inodeKey, toRel)
        }
        redirects.set(from, toRel)
        console.log(`[move] ${from} -> ${toRel}`)
        return json({ ok: true, from, to: toRel })
      }
      if (url.pathname === '/api/delete' && req.method === 'POST') {
        const b = await readBody(req)
        const rel = safeDirPath(b.path)
        if (!rel) return json({ ok: false, error: '非法路径' }, 400)
        const target = notePath(rel)
        if (!fs.existsSync(target)) return json({ ok: false, error: '不存在' }, 404)
        fs.rmSync(target, { recursive: true, force: true })
        for (const [k, p] of [...registry]) {
          if (p === rel || p.startsWith(rel + '/')) {
            const room = rooms.get(k)
            if (room) {
              // 先踢掉所有连接(4002):否则旧标签页会"挂着已销毁的房间"继续编辑,内容写进虚空
              for (const [conn] of room.doc.conns) { try { conn.close(4002, 'file-deleted') } catch {} }
              try { room.doc.destroy() } catch {}
              rooms.delete(k)
            }
            registry.delete(k)
          }
        }
        return json({ ok: true, deleted: rel })
      }
      if (url.pathname === '/api/epoch' && req.method === 'GET') {
        return json({ ok: true, epoch: EPOCH })
      }
      if (url.pathname === '/api/flush' && req.method === 'POST') {
        // 手动保存:把所有房间与磁盘的差异立即写下去(不 commit)
        const flushed = flushAll(true)
        return json({ ok: true, flushed })
      }
      if (url.pathname === '/api/revision' && req.method === 'POST') {
        const b = await readBody(req)
        const msg = String(b.message || '').trim().slice(0, 120) || `revision @ ${new Date().toLocaleString('zh-CN')}`
        // 先落盘,再提交 —— 保证版本里包含"此刻内存中的所有修改",而非最多 60 秒前的磁盘状态
        const flushed = flushAll(true)
        gitRun('add', '-A')
        const r = gitRun('commit', '-m', msg)
        if (r.status !== 0) return json({ ok: false, error: '没有变更可提交' })
        return json({ ok: true, commit: gitOut('rev-parse', '--short', 'HEAD'), message: msg, flushed })
      }
      if (url.pathname === '/api/log' && req.method === 'GET') {
        const file = safePath(url.searchParams.get('file') || '')
        const out = gitOut('log', '--follow', '--format=%h|%ai|%s', '--', file)
        const entries = out ? out.split('\n').map(l => { const [h, t, ...rest] = l.split('|'); return { h, t, s: rest.join('|') } }) : []
        return json({ ok: true, entries })
      }
      if (url.pathname === '/api/restore' && req.method === 'POST') {
        const b = await readBody(req)
        const file = safePath(b.file), commit = String(b.commit || '')
        if (!file || !/^[\w.-]+$/.test(commit)) return json({ ok: false, error: '参数错误' }, 400)
        // 跨移动回滚:先试当前路径,不行沿 rename 链找该提交时的旧名字
        let content = null
        const r0 = gitRun('show', `${commit}:${file}`)
        if (r0.status === 0) content = r0.stdout
        else {
          const old = historicalPath(commit, file)
          if (old) {
            const r1 = gitRun('show', `${commit}:${old}`)
            if (r1.status === 0) content = r1.stdout
          }
        }
        if (content == null) return json({ ok: false, error: '该版本中找不到此文件' }, 404)
        const room = getRoom(inodeKeyOf(notePath(file)), file)
        Y.transact(room.doc, () => {
          const t = room.doc.getText(YTEXT_KEY)
          t.delete(0, t.length)
          t.insert(0, content)
        })
        room.dirty = true
        return json({ ok: true, chars: content.length })
      }
      // 静态文件
      const rel = url.pathname === '/' ? '/index.html' : url.pathname
      const f = path.join(__dirname, 'public', rel)
      if (f.startsWith(path.join(__dirname, 'public')) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        return [200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }, fs.readFileSync(f)]
      }
      return [404, { 'Content-Type': 'text/plain' }, 'not found']
    } catch (e) {
      return [500, { 'Content-Type': 'application/json' }, JSON.stringify({ ok: false, error: e.message })]
    }
  })()
  res.writeHead(status, headers)
  res.end(body)
})

// ---------- WebSocket 升级:路径 → inode → 房间 ----------
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  if (!url.pathname.startsWith('/ws/')) return socket.destroy()
  const file = safePath(decodeURIComponent(url.pathname.slice(4)))
  if (!file || !fs.existsSync(notePath(file))) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n') // 客户端 resolve 流程负责跳转
    return socket.destroy()
  }
  const clientEpoch = url.searchParams.get('epoch')
  let inodeKey
  try { inodeKey = inodeKeyOf(notePath(file)) } catch { return socket.destroy() }
  wss.handleUpgrade(req, socket, head, (ws) => {
    // 世代不符 = 客户端带着"重启前"的旧历史 —— 拒绝同步(4001),由客户端丢弃本地状态重载
    // 若放行,旧历史会被当成新内容并入从磁盘重建的房间 → 两版叠加(非精确形态无法自动修复)
    if (clientEpoch && clientEpoch !== EPOCH) {
      console.log(`[epoch-reject] ${file}: 客户端世代 ${clientEpoch} ≠ 服务端 ${EPOCH}`)
      try { ws.close(4001, 'epoch-mismatch') } catch {}
      return
    }
    getRoom(inodeKey, file)
    setupWSConnection(ws, req, { docName: inodeKey, gc: true })
  })
})

server.listen(PORT, () => console.log(`mdwiki-demo(inode 身份架构) 启动: http://localhost:${PORT}  笔记目录: ${NOTES}`))
