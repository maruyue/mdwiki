// mdwiki-demo 前端:CodeMirror + Yjs 协作 + 实时预览
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting, LanguageDescription } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import YAML from 'yaml'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import hljs from 'highlight.js/lib/core'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsJs from 'highlight.js/lib/languages/javascript'
import hljsPy from 'highlight.js/lib/languages/python'
import hljsCss from 'highlight.js/lib/languages/css'
import hljsXml from 'highlight.js/lib/languages/xml'
import hljsYaml from 'highlight.js/lib/languages/yaml'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsTs from 'highlight.js/lib/languages/typescript'

// 编辑器内嵌语言(markdown 围栏代码块高亮)。load 必须返回 Promise<LanguageSupport>
const CODE_LANGS = [
  LanguageDescription.of({ name: 'json', alias: ['json'], extensions: ['json'], load: async () => json() }),
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'node'], extensions: ['js', 'jsx'], load: async () => javascript() }),
  LanguageDescription.of({ name: 'typescript', alias: ['ts', 'tsx'], extensions: ['ts', 'tsx'], load: async () => javascript({ typescript: true }) }),
  LanguageDescription.of({ name: 'python', alias: ['py'], extensions: ['py'], load: async () => python() }),
  LanguageDescription.of({ name: 'css', extensions: ['css'], load: async () => css() }),
  LanguageDescription.of({ name: 'html', alias: ['xml', 'svg'], extensions: ['html'], load: async () => html() }),
]

// 按文件扩展名选择编辑器语言
const extOf = (f) => (f.match(/\.([a-z0-9]+)$/i)?.[1] || 'md').toLowerCase()
function langForFile(file) {
  switch (extOf(file)) {
    case 'json': return [json()]
    case 'yaml': case 'yml': return [yaml()]
    case 'js': case 'jsx': return [javascript()]
    case 'ts': case 'tsx': return [javascript({ typescript: true })]
    case 'py': return [python()]
    case 'css': return [css()]
    case 'html': return [html()]
    case 'sh': case 'txt': return [EditorView.lineWrapping] // 纯文本:无语言语义,不做 markdown 误高亮
    default: return [markdown({ codeLanguages: CODE_LANGS }), EditorView.lineWrapping]
  }
}
// 格式化(当前仅 json/yaml);结果直接显示在按钮右侧,不弹对话框
function fmtMsg(text, ok) {
  const el = document.getElementById('fmt-status')
  if (!el) return
  el.textContent = text
  el.className = ok ? 'fmt-ok' : 'fmt-err'
  clearTimeout(fmtMsg._t)
  fmtMsg._t = setTimeout(() => { el.textContent = ''; el.className = '' }, ok ? 2500 : 8000)
}
function formatDoc() {
  if (connLocked) { fmtMsg('连接已断开,无法编辑', false); return }
  const file = currentFile()
  const text = view.state.doc.toString()
  try {
    let out = null
    if (extOf(file) === 'json') out = JSON.stringify(JSON.parse(text), null, 2) + '\n'
    else if (extOf(file) === 'yaml' || extOf(file) === 'yml') out = YAML.stringify(YAML.parse(text))
    else { fmtMsg('暂不支持该格式(支持 json / yaml)', false); return }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } })
    view.focus()
    fmtMsg('✓ 已格式化', true)
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0] // 解析错误只显示第一行
    fmtMsg('格式化失败:' + msg, false)
  }
}

// 预览侧 highlight.js
hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('javascript', hljsJs)
hljs.registerLanguage('python', hljsPy)
hljs.registerLanguage('css', hljsCss)
hljs.registerLanguage('xml', hljsXml)
hljs.registerLanguage('yaml', hljsYaml)
hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('typescript', hljsTs)
function highlightPreview() {
  document.querySelectorAll('#preview pre code').forEach(el => {
    if (!el.dataset.hl) { try { hljs.highlightElement(el) } catch { /* 未知语言保持原样 */ } el.dataset.hl = '1' }
  })
}

// ---------- VSCode 风格主题:Dark+ / Light+(行距 1.75) ----------
const MONO = '"SF Mono", Menlo, Monaco, "Cascadia Code", Consolas, "Courier New", monospace'
const cmTheme = (fg, bg, caret, selBg, activeLine, gutterFg, foldBg, tooltip) => EditorView.theme({
  '&': { color: fg, backgroundColor: bg },
  '.cm-content': { fontFamily: MONO, fontSize: '14px', lineHeight: '1.75', padding: '14px 4px' },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: caret, borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: selBg },
  '.cm-activeLine': { backgroundColor: activeLine },
  '.cm-gutters': { backgroundColor: bg, color: gutterFg, border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: activeLine, color: fg },
  '.cm-foldPlaceholder': { backgroundColor: foldBg, border: 'none', color: gutterFg },
  '.cm-selectionMatch': { backgroundColor: foldBg },
  '.cm-tooltip': { backgroundColor: tooltip, border: '1px solid var(--border2)', color: 'var(--fg)' },
})
const mdStyle = (heading, strong, emphasis, strike, mono, link, quote) => HighlightStyle.define([
  { tag: tags.heading1, color: heading, fontWeight: '700', fontSize: '1.25em' },
  { tag: tags.heading2, color: heading, fontWeight: '700', fontSize: '1.12em' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700', color: strong },
  { tag: tags.emphasis, fontStyle: 'italic', color: emphasis },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: strike },
  { tag: tags.monospace, color: mono },
  { tag: tags.link, color: link },
  { tag: tags.url, color: mono },
  { tag: tags.quote, color: quote },
  { tag: tags.contentSeparator, color: quote },
  { tag: tags.processingInstruction, color: quote },
])
// 通用代码 token 色板(json/yaml/js/py 等共享:字符串/数字/布尔/属性名/关键字)
const codeStyle = (str, num, bool, prop, kw, comment) => HighlightStyle.define([
  { tag: [tags.string, tags.special(tags.string)], color: str },
  { tag: tags.number, color: num },
  { tag: [tags.bool, tags.null], color: bool },
  { tag: tags.propertyName, color: prop },
  { tag: [tags.keyword, tags.moduleKeyword, tags.operator], color: kw },
  { tag: [tags.lineComment, tags.blockComment], color: comment, fontStyle: 'italic' },
])
const themeExt = {
  dark: [cmTheme('#d4d4d4', '#1e1e1e', '#aeafad', '#264f78', 'rgba(255,255,255,0.045)', '#6e7681', '#37373d', '#252526'),
         syntaxHighlighting(mdStyle('#569cd6', '#e8e8e8', '#d7ba7d', '#808080', '#ce9178', '#4daafc', '#6a9955')),
         syntaxHighlighting(codeStyle('#ce9178', '#b5cea8', '#569cd6', '#9cdcfe', '#c586c0', '#6a9955'))],
  light: [cmTheme('#333333', '#ffffff', '#000000', '#add6ff', 'rgba(0,0,0,0.05)', '#999999', '#e8e8e8', '#f8f8f8'),
          syntaxHighlighting(mdStyle('#0451a5', '#000000', '#333333', '#888888', '#a31515', '#0451a5', '#008000')),
          syntaxHighlighting(codeStyle('#a31515', '#098658', '#0000ff', '#0451a5', '#af00db', '#008000'))],
}
const themeComp = new Compartment()
let themeMode = localStorage.getItem('mdwiki-theme') || 'dark'

function applyTheme(mode) {
  themeMode = mode
  localStorage.setItem('mdwiki-theme', mode)
  document.body.className = mode
  document.getElementById('btn-theme').textContent = mode === 'dark' ? '🌙' : '☀️'
  if (view) view.dispatch({ effects: themeComp.reconfigure(themeExt[mode]) })
}
document.getElementById('btn-theme').onclick = () => applyTheme(themeMode === 'dark' ? 'light' : 'dark')
import { markdown } from '@codemirror/lang-markdown'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// ---------- 用户身份:?u= 指定 > 标签页固定(sessionStorage,刷新不变) > 随机 ----------
const COLORS = ['#e0533d', '#3d7fe0', '#3db86a', '#c47a1e', '#8e4fd1']
const params = new URLSearchParams(location.search)
let uname = params.get('u')
if (!uname) {
  uname = sessionStorage.getItem('mdwiki-user')
  if (!uname) {
    uname = '用户' + Math.floor(Math.random() * 90 + 10)
    sessionStorage.setItem('mdwiki-user', uname)
  }
}
const ucolor = COLORS[[...uname].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]

// ---------- DOM ----------
const $fileList = document.getElementById('file-list')
const $editor = document.getElementById('editor')
const $preview = document.getElementById('preview')
const $curFile = document.getElementById('cur-file')
const $online = document.getElementById('online')
const $btnNew = document.getElementById('btn-new')
const $btnRev = document.getElementById('btn-revision')
const $btnLog = document.getElementById('btn-log')

// ---------- 连接锁:断线(服务宕/网络差)期间禁止编辑,避免产生本地分叉 ----------
const readonlyComp = new Compartment()
const READONLY_EXT = [EditorState.readOnly.of(true), EditorView.editable.of(false)]
let connLocked = true // 初始未连接,先锁
function setConnLocked(locked) {
  connLocked = locked
  const banner = document.getElementById('conn-banner')
  const col = document.getElementById('editor-col')
  if (banner) banner.style.display = locked ? 'block' : 'none'
  if (col) col.classList.toggle('locked', locked)
  if (view) view.dispatch({ effects: readonlyComp.reconfigure(locked ? READONLY_EXT : []) })
}

// ---------- 编辑动作(HedgeDoc 风格工具栏,无上传能力) ----------
const wrapSel = (b, a = b) => {
  if (connLocked) return
  const { from, to } = view.state.selection.main
  const sel = view.state.sliceDoc(from, to)
  view.dispatch({ changes: { from, to, insert: b + sel + a }, selection: { anchor: from + b.length, head: to + b.length } })
  view.focus()
}
const eachSelectedLine = (fn) => {
  if (connLocked) return
  const { state } = view
  const changes = []
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from), last = state.doc.lineAt(range.to)
    for (let n = first.number; n <= last.number; n++) fn(state.doc.line(n), changes)
  }
  view.dispatch({ changes })
  view.focus()
}
const linePrefix = (p) => eachSelectedLine((line, ch) =>
  line.text.startsWith(p) ? ch.push({ from: line.from, to: line.from + p.length, insert: '' })
                          : ch.push({ from: line.from, insert: p }))
const setHeading = (lv) => {
  const pref = '#'.repeat(lv) + ' '
  eachSelectedLine((line, ch) => {
    const m = line.text.match(/^#{1,6}\s+/)
    const base = m ? line.text.slice(m[0].length) : line.text
    ch.push({ from: line.from, to: line.to, insert: line.text.startsWith(pref) ? base : pref + base })
  })
}
const insertAtCursor = (text) => {
  if (connLocked) return
  const pos = view.state.selection.main.head
  view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } })
  view.focus()
}
const insertCodeBlock = () => insertAtCursor('\n```\n\n```\n')
const insertTable = () => insertAtCursor('\n| 列1 | 列2 | 列3 |\n|---|---|---|\n| 内容 | 内容 | 内容 |\n')

// ---------- Font Awesome 图标(内联 SVG,currentColor 随主题) ----------
const ICONS = {
  'bold': { vb: '0 0 384 512', d: 'M32 32C14.3 32 0 46.3 0 64S14.3 96 32 96l32 0 0 320-32 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l224 0c70.7 0 128-57.3 128-128 0-46.5-24.8-87.3-62-109.7 18.7-22.3 30-51 30-82.3 0-70.7-57.3-128-128-128L32 32zM288 160c0 35.3-28.7 64-64 64l-96 0 0-128 96 0c35.3 0 64 28.7 64 64zM128 416l0-128 128 0c35.3 0 64 28.7 64 64s-28.7 64-64 64l-128 0z' },
  'italic': { vb: '0 0 384 512', d: 'M128 64c0-17.7 14.3-32 32-32l192 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-58.7 0-133.3 320 64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 480c-17.7 0-32-14.3-32-32s14.3-32 32-32l58.7 0 133.3-320-64 0c-17.7 0-32-14.3-32-32z' },
  'strikethrough': { vb: '0 0 512 512', d: 'M96 157.5C96 88.2 152.2 32 221.5 32L368 32c17.7 0 32 14.3 32 32s-14.3 32-32 32L221.5 96c-34 0-61.5 27.5-61.5 61.5 0 31 23.1 57.2 53.9 61l44.1 5.5 222 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l83.1 0C103 204.6 96 181.8 96 157.5zM349.2 336l65.5 0c.9 6.1 1.4 12.2 1.4 18.5 0 69.3-56.2 125.5-125.5 125.5L144 480c-17.7 0-32-14.3-32-32s14.3-32 32-32l146.5 0c34 0 61.5-27.5 61.5-61.5 0-6.4-1-12.7-2.8-18.5z' },
  'heading': { vb: '0 0 448 512', d: 'M0 64C0 46.3 14.3 32 32 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-16 0 0 112 224 0 0-112-16 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-16 0 0 320 16 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-96 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l16 0 0-144-224 0 0 144 16 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-96 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l16 0 0-320-16 0C14.3 96 0 81.7 0 64z' },
  'code': { vb: '0 0 576 512', d: 'M360.8 1.2c-17-4.9-34.7 5-39.6 22l-128 448c-4.9 17 5 34.7 22 39.6s34.7-5 39.6-22l128-448c4.9-17-5-34.7-22-39.6zm64.6 136.1c-12.5 12.5-12.5 32.8 0 45.3l73.4 73.4-73.4 73.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l96-96c12.5-12.5 12.5-32.8 0-45.3l-96-96c-12.5-12.5-32.8-12.5-45.3 0zm-274.7 0c-12.5-12.5-32.8-12.5-45.3 0l-96 96c-12.5 12.5-12.5 32.8 0 45.3l96 96c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 150.6 182.6c12.5-12.5 12.5-32.8 0-45.3z' },
  'terminal': { vb: '0 0 512 512', d: 'M9.4 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L146.7 256 9.4 118.6zM224 384l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32z' },
  'quote-left': { vb: '0 0 448 512', d: 'M0 216C0 149.7 53.7 96 120 96l8 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-8 0c-30.9 0-56 25.1-56 56l0 8 64 0c35.3 0 64 28.7 64 64l0 64c0 35.3-28.7 64-64 64l-64 0c-35.3 0-64-28.7-64-64L0 216zm256 0c0-66.3 53.7-120 120-120l8 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-8 0c-30.9 0-56 25.1-56 56l0 8 64 0c35.3 0 64 28.7 64 64l0 64c0 35.3-28.7 64-64 64l-64 0c-35.3 0-64-28.7-64-64l0-136z' },
  'list-ul': { vb: '0 0 512 512', d: 'M48 144a48 48 0 1 0 0-96 48 48 0 1 0 0 96zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L192 64zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-288 0zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-288 0zM48 464a48 48 0 1 0 0-96 48 48 0 1 0 0 96zM96 256a48 48 0 1 0 -96 0 48 48 0 1 0 96 0z' },
  'list-ol': { vb: '0 0 512 512', d: 'M0 72C0 58.8 10.7 48 24 48l48 0c13.3 0 24 10.7 24 24l0 104 24 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-96 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l24 0 0-80-24 0C10.7 96 0 85.3 0 72zM30.4 301.2C41.8 292.6 55.7 288 70 288l4.9 0c33.7 0 61.1 27.4 61.1 61.1 0 19.6-9.4 37.9-25.2 49.4l-24 17.5 33.2 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-90.7 0C13.1 464 0 450.9 0 434.7 0 425.3 4.5 416.5 12.1 411l70.5-51.3c3.4-2.5 5.4-6.4 5.4-10.6 0-7.2-5.9-13.1-13.1-13.1L70 336c-3.9 0-7.7 1.3-10.8 3.6L38.4 355.2c-10.6 8-25.6 5.8-33.6-4.8S-1 324.8 9.6 316.8l20.8-15.6zM224 64l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32zm0 160l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32zm0 160l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32z' },
  'check-square': { vb: '0 0 448 512', d: 'M384 32c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96C0 60.7 28.7 32 64 32l320 0zM342 145.7c-10.7-7.8-25.7-5.4-33.5 5.3L189.1 315.2 137 263.1c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l72 72c5 5 11.9 7.5 18.8 7s13.4-4.1 17.5-9.8L347.3 179.2c7.8-10.7 5.4-25.7-5.3-33.5z' },
  'link': { vb: '0 0 576 512', d: 'M419.5 96c-16.6 0-32.7 4.5-46.8 12.7-15.8-16-34.2-29.4-54.5-39.5 28.2-24 64.1-37.2 101.3-37.2 86.4 0 156.5 70 156.5 156.5 0 41.5-16.5 81.3-45.8 110.6l-71.1 71.1c-29.3 29.3-69.1 45.8-110.6 45.8-86.4 0-156.5-70-156.5-156.5 0-1.5 0-3 .1-4.5 .5-17.7 15.2-31.6 32.9-31.1s31.6 15.2 31.1 32.9c0 .9 0 1.8 0 2.6 0 51.1 41.4 92.5 92.5 92.5 24.5 0 48-9.7 65.4-27.1l71.1-71.1c17.3-17.3 27.1-40.9 27.1-65.4 0-51.1-41.4-92.5-92.5-92.5zM275.2 173.3c-1.9-.8-3.8-1.9-5.5-3.1-12.6-6.5-27-10.2-42.1-10.2-24.5 0-48 9.7-65.4 27.1L91.1 258.2c-17.3 17.3-27.1 40.9-27.1 65.4 0 51.1 41.4 92.5 92.5 92.5 16.5 0 32.6-4.4 46.7-12.6 15.8 16 34.2 29.4 54.6 39.5-28.2 23.9-64 37.2-101.3 37.2-86.4 0-156.5-70-156.5-156.5 0-41.5 16.5-81.3 45.8-110.6l71.1-71.1c29.3-29.3 69.1-45.8 110.6-45.8 86.6 0 156.5 70.6 156.5 156.9 0 1.3 0 2.6 0 3.9-.4 17.7-15.1 31.6-32.8 31.2s-31.6-15.1-31.2-32.8c0-.8 0-1.5 0-2.3 0-33.7-18-63.3-44.8-79.6z' },
  'file-alt': { vb: '0 0 384 512', d: 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM120 256c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0zm0 96c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0z' },
  'table': { vb: '0 0 448 512', d: 'M384 32c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64l-320 0-6.5-.3C25.2 476.4 0 449.1 0 416L0 96C0 60.7 28.7 32 64 32l320 0zM64 320l0 96 128 0 0-96-128 0zm192 0l0 96 128 0 0-96-128 0zM64 256l128 0 0-96-128 0 0 96zm192 0l128 0 0-96-128 0 0 96z' },
  'minus': { vb: '0 0 448 512', d: 'M0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32z' },
  'wand-magic-sparkles': { vb: '0 0 576 512', d: 'M263.4-27L278.2 9.8 315 24.6c3 1.2 5 4.2 5 7.4s-2 6.2-5 7.4L278.2 54.2 263.4 91c-1.2 3-4.2 5-7.4 5s-6.2-2-7.4-5L233.8 54.2 197 39.4c-3-1.2-5-4.2-5-7.4s2-6.2 5-7.4L233.8 9.8 248.6-27c1.2-3 4.2-5 7.4-5s6.2 2 7.4 5zM110.7 41.7l21.5 50.1 50.1 21.5c5.9 2.5 9.7 8.3 9.7 14.7s-3.8 12.2-9.7 14.7l-50.1 21.5-21.5 50.1c-2.5 5.9-8.3 9.7-14.7 9.7s-12.2-3.8-14.7-9.7L59.8 164.2 9.7 142.7C3.8 140.2 0 134.4 0 128s3.8-12.2 9.7-14.7L59.8 91.8 81.3 41.7C83.8 35.8 89.6 32 96 32s12.2 3.8 14.7 9.7zM464 304c6.4 0 12.2 3.8 14.7 9.7l21.5 50.1 50.1 21.5c5.9 2.5 9.7 8.3 9.7 14.7s-3.8 12.2-9.7 14.7l-50.1 21.5-21.5 50.1c-2.5 5.9-8.3 9.7-14.7 9.7s-12.2-3.8-14.7-9.7l-21.5-50.1-50.1-21.5c-5.9-2.5-9.7-8.3-9.7-14.7s3.8-12.2 9.7-14.7l50.1-21.5 21.5-50.1c2.5-5.9 8.3-9.7 14.7-9.7zM460 0c11 0 21.6 4.4 29.5 12.2l42.3 42.3C539.6 62.4 544 73 544 84s-4.4 21.6-12.2 29.5l-88.2 88.2-101.3-101.3 88.2-88.2C438.4 4.4 449 0 460 0zM44.2 398.5L308.4 134.3 409.7 235.6 145.5 499.8C137.6 507.6 127 512 116 512s-21.6-4.4-29.5-12.2L44.2 457.5C36.4 449.6 32 439 32 428s4.4-21.6 12.2-29.5z' },
  'right-left': { vb: '0 0 512 512', d: 'M502.6 150.6l-96 96c-9.2 9.2-22.9 11.9-34.9 6.9S352 236.9 352 224l0-64-320 0c-17.7 0-32-14.3-32-32S14.3 96 32 96l320 0 0-64c0-12.9 7.8-24.6 19.8-29.6s25.7-2.2 34.9 6.9l96 96c12.5 12.5 12.5 32.8 0 45.3zm-397.3 352l-96-96c-12.5-12.5-12.5-32.8 0-45.3l96-96c9.2-9.2 22.9-11.9 34.9-6.9S160 275.1 160 288l0 64 320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-320 0 0 64c0 12.9-7.8 24.6-19.8 29.6s-25.7 2.2-34.9-6.9z' },
  'folder-plus': { vb: '0 0 512 512', d: 'M512 384c0 35.3-28.7 64-64 64L64 448c-35.3 0-64-28.7-64-64L0 96C0 60.7 28.7 32 64 32l138.7 0c13.8 0 27.3 4.5 38.4 12.8l38.4 28.8c5.5 4.2 12.3 6.4 19.2 6.4L448 80c35.3 0 64 28.7 64 64l0 240zM256 160c-13.3 0-24 10.7-24 24l0 48-48 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l48 0 0 48c0 13.3 10.7 24 24 24s24-10.7 24-24l0-48 48 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-48 0 0-48c0-13.3-10.7-24-24-24z' },
  'ellipsis': { vb: '0 0 448 512', d: 'M0 256a56 56 0 1 1 112 0 56 56 0 1 1 -112 0zm168 0a56 56 0 1 1 112 0 56 56 0 1 1 -112 0zm224-56a56 56 0 1 1 0 112 56 56 0 1 1 0-112z' },
  'trash-can': { vb: '0 0 448 512', d: 'M136.7 5.9C141.1-7.2 153.3-16 167.1-16l113.9 0c13.8 0 26 8.8 30.4 21.9L320 32 416 32c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 8.7-26.1zM32 144l384 0 0 304c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-304zm88 64c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24z' },
  'pen-to-square': { vb: '0 0 512 512', d: 'M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0L368 46.1 465.9 144 490.3 119.6c21.9-21.9 21.9-57.3 0-79.2L471.6 21.7zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5L432 177.9 334.1 80 172.4 241.7zM96 64C43 64 0 107 0 160L0 416c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7-14.3 32-32 32L96 448c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L96 64z' },
  'folder': { vb: '0 0 512 512', d: 'M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z' },
  'folder-open': { vb: '0 0 576 512', d: 'M56 225.6L32.4 296.2 32.4 96c0-35.3 28.7-64 64-64l138.7 0c13.8 0 27.3 4.5 38.4 12.8l38.4 28.8c5.5 4.2 12.3 6.4 19.2 6.4l117.3 0c35.3 0 64 28.7 64 64l0 16-365.4 0c-41.3 0-78 26.4-91.1 65.6zM477.8 448L99 448c-32.8 0-55.9-32.1-45.5-63.2l48-144C108 221.2 126.4 208 147 208l378.8 0c32.8 0 55.9 32.1 45.5 63.2l-48 144c-6.5 19.6-24.9 32.8-45.5 32.8z' },
  'file-lines': { vb: '0 0 384 512', d: 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM120 256c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0zm0 96c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0z' },
}

const svgIcon = (name) => {
  const i = ICONS[name]
  if (!i) return ''
  return `<svg viewBox="${i.vb}" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="${i.d}"/></svg>`
}

const TOOLBAR = [
  { icon: 'bold', title: '粗体 ⌘B', act: () => wrapSel('**') },
  { icon: 'italic', title: '斜体 ⌘I', act: () => wrapSel('*') },
  { icon: 'strikethrough', title: '删除线', act: () => wrapSel('~~') },
  { sep: 1 },
  { icon: 'heading', lvl: '1', title: '一级标题', act: () => setHeading(1) }, { icon: 'heading', lvl: '2', title: '二级标题', act: () => setHeading(2) }, { icon: 'heading', lvl: '3', title: '三级标题', act: () => setHeading(3) },
  { sep: 1 },
  { icon: 'code', title: '行内代码', act: () => wrapSel('`') },
  { icon: 'terminal', title: '代码块', act: insertCodeBlock },
  { icon: 'quote-left', title: '引用', act: () => linePrefix('> ') },
  { sep: 1 },
  { icon: 'list-ul', title: '无序列表', act: () => linePrefix('- ') },
  { icon: 'list-ol', title: '有序列表', act: () => linePrefix('1. ') },
  { sep: 1 },
  { icon: 'link', title: '插入链接(笔记 / 外部 URL)', act: function () { openLinkMenu(this) } },
  { icon: 'minus', title: '分隔线', act: () => insertAtCursor('\n\n---\n\n') },
  { icon: 'table', title: '表格', act: insertTable },
  { sep: 1 },
  { icon: 'wand-magic-sparkles', title: '格式化(json/yaml)', act: formatDoc, fmt: true },
]
{
  const bar = document.getElementById('toolbar')
  for (const b of TOOLBAR) {
    if (b.sep) { const s = document.createElement('span'); s.className = 'tb-sep tb-md'; bar.appendChild(s); continue }
    const btn = document.createElement('button')
    btn.title = b.title || ''
    btn.className = b.fmt ? 'tb-format' : 'tb-md'
    btn.innerHTML = svgIcon(b.icon) + (b.lvl ? `<sup class="h-lvl">${b.lvl}</sup>` : '') + (b.fmt ? '<span class="tb-label">格式化</span>' : '')
    btn.onclick = b.act
    bar.appendChild(btn)
  }
  const status = document.createElement('span')
  status.id = 'fmt-status'
  bar.appendChild(status)
}

// ---------- 笔记链接菜单(工具栏 🔗:笔记内链 + 外部 URL) ----------
let filesCache = []
let dirsCache = []   // 目录列表(移动目标选择器用)
// 根目录的 .gitignore 是仓库配置:不可移动/改名/删除(子目录里的同名文件不受限)
const isProtectedPath = (p) => p === '.gitignore'
function openLinkMenu(anchorBtn) {
  const menu = openMenu(anchorBtn, {
    left: r => Math.max(8, r.left - 130),
    build: (menu) => {
      const input = document.createElement('input')
      input.placeholder = '过滤笔记…'
      const list = document.createElement('div')
      list.className = 'note-menu-list'
      const renderList = (q) => {
        const ql = q.toLowerCase()
        list.innerHTML = ''
        filesCache.filter(f => f.toLowerCase().includes(ql)).slice(0, 30).forEach(f => {
          menuItem(list, {
            icon: 'file-alt',
            label: f.replace(/\.md$/, ''),
            title: f,
            onClick: () => insertAtCursor(`[${f.replace(/\.md$/, '')}](#${f})`), // 内链用真实文件名
          })
        })
        if (!list.children.length) list.innerHTML = '<div class="note-menu-empty">无匹配</div>'
      }
      input.oninput = () => renderList(input.value)
      renderList('')
      const divider = document.createElement('div')
      divider.className = 'tb-sep'
      divider.style.cssText = 'height:1px;background:var(--border2);margin:6px 0'
      const extRow = document.createElement('div')
      extRow.style.cssText = 'display:flex;gap:4px'
      const extInput = document.createElement('input')
      extInput.placeholder = 'https:// 外部链接'
      extInput.style.flex = '1'
      const extBtn = document.createElement('button')
      extBtn.textContent = '插入'
      extBtn.style.cssText = 'background:var(--btn);color:var(--fg);border:1px solid var(--border2);border-radius:5px;padding:3px 10px;cursor:pointer;font-size:12px'
      extBtn.onclick = () => {
        const url = extInput.value.trim()
        if (!url) return
        const { from, to } = view.state.selection.main
        const text = view.state.sliceDoc(from, to) || url
        view.dispatch({ changes: { from, to, insert: `[${text}](${url})` } })
        view.focus()
        closeNoteMenu()
      }
      extRow.append(extInput, extBtn)
      menu.append(input, list, divider, extRow)
    },
  })
  const [input, extInput] = menu.querySelectorAll('input')
  input.focus()
  input.onkeydown = extInput.onkeydown = (e) => { if (e.key === 'Escape') closeNoteMenu() }
}
// 关闭菜单时必须同时摘掉"点外部关闭"的 document 监听,否则监听器会永久累积:
// 之后任何一次点击都会被旧菜单的监听器当成"点在外面",把新打开的菜单立刻关掉
// (表现:从菜单里点「移动」→ 文件夹选择器一闪就没,2026-11-20 实测)
let menuDocListener = null
function closeNoteMenu() {
  document.getElementById('note-menu')?.remove()
  if (menuDocListener) { document.removeEventListener('click', menuDocListener, true); menuDocListener = null }
}

// ---------- 菜单工具:三处下拉菜单共用同一骨架(定位/外点关闭/条目) ----------
function openMenu(anchor, { left, build }) {
  closeNoteMenu()
  const menu = document.createElement('div')
  menu.id = 'note-menu'
  build(menu)
  const rect = anchor.getBoundingClientRect()
  menu.style.left = left(rect) + 'px'
  menu.style.top = (rect.bottom + 6) + 'px'
  document.body.appendChild(menu)
  // 捕获阶段判断,先于菜单项自己的 click:点条目时不会误关,点外部立即关闭
  menuDocListener = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor) closeNoteMenu()
  }
  setTimeout(() => {
    if (document.getElementById('note-menu') === menu) document.addEventListener('click', menuDocListener, true)
  }, 0)
  return menu
}
function menuItem(container, { icon, label, danger, title, onClick }) {
  const el = document.createElement('div')
  el.className = 'note-menu-item' + (danger ? ' menu-danger' : '')
  el.innerHTML = (icon ? svgIcon(icon) + ' ' : '') + label
  if (title) el.title = title
  el.onclick = async () => { closeNoteMenu(); await onClick() }
  container.appendChild(el)
  return el
}

// 服务端重启(世代变更):本地历史已作废 → 直接丢弃并重载,拉取服务端最新内容
// 不生成任何"恢复副本"文件(避免用户困惑);静默窗口内的少量未同步编辑按设计放弃
let epochHandling = false
function handleEpochMismatch() {
  if (epochHandling) return
  epochHandling = true
  const b = document.getElementById('conn-banner')
  if (b) {
    b.textContent = '服务已重启 —— 正在重新加载最新内容…'
    b.style.display = 'block'
  }
  setTimeout(() => location.reload(), 700)
}

// ---------- 状态 ----------
let view = null, provider = null, scrollAbort = null
const currentFile = () => decodeURIComponent(location.hash.slice(1)) || '欢迎.md'

// ---------- 文件列表(目录树) + 拖拽 ----------
const closedDirs = new Set() // 默认全部展开,点过的收起
const selection = new Set()  // 多选:完整路径集合
let dragItems = []           // 本次拖拽的源(单选或框选)

// 拖拽入口:写在 render 循环外,由各 row 触发
function setupDrag(rowEl, path, isDir) {
  if (isProtectedPath(path)) { rowEl.draggable = false; return }  // 受保护文件不可拖走
  rowEl.draggable = true
  rowEl.addEventListener('dragstart', (e) => {
    // 没有加入多选 → 拖的就是它自己
    if (!selection.has(path)) { selection.clear(); selection.add(path); renderSelection() }
    dragItems = [...selection].filter(p => !isProtectedPath(p)).map(p => ({
      from: p,
      isDir: !filesCache.includes(p), // 不在文件列表 → 目录
    }))
    e.dataTransfer.setData('text/plain', JSON.stringify(dragItems))
    e.dataTransfer.effectAllowed = 'move'
    rowEl.classList.add('dragging')
  })
  rowEl.addEventListener('dragend', () => { rowEl.classList.remove('dragging'); clearDropHint() })
}

// 放置目标:目录行(移入)与根区域(移到根)
// 注意:根区域是常驻元素,必须"只绑一次",否则每次 refreshFiles 都会叠加一层 drop 监听
// → 一次拖放触发 N 次移动,后 N-1 次报「不存在」并弹窗(2026-11-20 实测事故)
let rootZoneBound = false
function setupDropZone(el, targetDir) {
  if (el === $fileList) {
    if (rootZoneBound) return
    rootZoneBound = true
  }
  el.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation() // 防止父容器也高亮
    e.dataTransfer.dropEffect = 'move'
    el.classList.add('drop-target')
  })
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'))
  el.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation() // 目录行的 drop 不能冒泡到 file-list(否则双重移动:目录+根)
    el.classList.remove('drop-target')
    // 优先用模块级 dragItems(dragstart 时设置,保证多选完整);
    // dataTransfer.getData 在某些浏览器/场景下可能返回空或不完整
    let items = (dragItems && dragItems.length > 0) ? dragItems : []
    if (!items.length) {
      try { items = JSON.parse(e.dataTransfer.getData('text/plain')) || [] } catch {}
    }
    if (!items.length) return
    const dest = targetDir === '' ? '' : targetDir
    // 目标目录本身在拖拽集合中 → 无效
    if (items.some(it => it.from === dest)) return
    dragItems = []   // 先清,防止重复触发(事件冒泡/快速连点)时重复提交
    const r = await (await fetch('/api/move-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, to: dest }),
    })).json()
    if (!r.ok) toast(r.results?.find(x => !x.ok)?.error || '移动失败', 'err')
    selection.clear()
    refreshFiles()
    // 当前打开的文件被移走 → 跳新路径
    const cur = currentFile()
    const moved = (r.results || []).find(x => x.ok && (x.from === cur || cur.startsWith(x.from + '/')))
    if (moved) { location.hash = '#' + encodeURIComponent(moved.to + cur.slice(moved.from.length)); openFile() }
  })
}

function clearDropHint() { document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')) }
// 全局兜底:任何拖拽结束都清掉残留高亮(只注册一次)
document.addEventListener('dragend', () => { document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging')); clearDropHint() })

// 轻提示:替代 alert(模态框会打断操作,且拖拽场景下会连环弹)
let toastEl = null, toastTimer = null, lastToast = { msg: '', at: 0 }
function toast(msg, kind = 'ok') {
  const now = Date.now()
  if (msg === lastToast.msg && now - lastToast.at < 800) return   // 相同消息去重
  lastToast = { msg, at: now }
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.id = 'toast'
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = msg
  toastEl.className = 'show ' + kind
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.className = '' }, 2600)
}
function renderSelection() {
  document.querySelectorAll('#sidebar .tree-row').forEach(row => {
    row.classList.toggle('selected', selection.has(row.dataset.path))
  })
}
async function refreshFiles() {
  const r = await (await fetch('/api/files')).json()
  filesCache = r.files || []
  dirsCache = r.dirs || []
  const root = {}
  for (const d of r.dirs || []) { // 空目录也要出现在树上:每一段都建节点并记录完整路径
    let node = root
    let acc = ''
    for (const p of d.split('/')) {
      acc = acc ? acc + '/' + p : p
      node = (node[p] ??= {})
      node.__path = acc
    }
  }
  for (const f of r.files) {
    const parts = f.replace(/\.md$/, '').split('/')
    let node = root
    parts.forEach((p, i) => {
      if (i === parts.length - 1) (node.__files ??= []).push({ name: p, full: f })
      else { node = (node[p] ??= {}); node.__path ??= p }
    })
  }
  const render = (node, depth) => {
    const frag = document.createDocumentFragment()
    for (const [k, child] of Object.entries(node).filter(([k]) => k !== '__files' && k !== '__hasDir' && k !== '__path')) {
      const open = !closedDirs.has(k)
      const d = document.createElement('div')
      d.className = 'dir tree-row'
      d.dataset.path = child.__path || k
      d.style.paddingLeft = (10 + depth * 13) + 'px'
      const label = document.createElement('span')
      label.className = 'tree-label'
      const hasKids = Object.keys(child).some(x => !x.startsWith('__')) || (child.__files?.length > 0)
      label.innerHTML = (hasKids ? `<span class="chev">${open ? '▾' : '▸'}</span>` : '<span class="chev-placeholder"></span>')
        + svgIcon(open ? 'folder-open' : 'folder') + ' ' + k
      d.appendChild(label)
      const mv = document.createElement('button')
      mv.className = 'row-menu-btn'
      mv.title = '操作'
      mv.innerHTML = svgIcon('ellipsis')
      mv.onclick = (e) => { e.stopPropagation(); openRowMenu(mv, child.__path || k, true) }
      d.appendChild(mv)
      d.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) { // 多选(目录也可拖)
          selection.has(d.dataset.path) ? selection.delete(d.dataset.path) : selection.add(d.dataset.path)
          renderSelection(); return
        }
        closedDirs.has(k) ? closedDirs.delete(k) : closedDirs.add(k); refreshFiles()
      }
      setupDrag(d, d.dataset.path, true)
      setupDropZone(d, d.dataset.path) // 目录行 = 放置目标(移入该目录)
      frag.appendChild(d)
      if (open) frag.appendChild(render(child, depth + 1))
    }
    for (const f of node.__files ?? []) {
      const row = document.createElement('div')
      row.className = 'tree-row'
      row.dataset.path = f.full
      row.style.paddingLeft = (26 + depth * 13) + 'px'
      const a = document.createElement('a')
      a.href = '#' + encodeURIComponent(f.full)
      const extCls = 'f-' + (f.full.match(/\.([a-z0-9]+)$/i)?.[1] || 'md').toLowerCase()
      a.innerHTML = svgIcon('file-lines') + '<span class="' + extCls + '">' + f.name + '</span>'
      a.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); return }
        setTimeout(refreshFiles, 0)
      }
      row.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); selection.has(f.full) ? selection.delete(f.full) : selection.add(f.full); renderSelection() }
      }
      // 注:不在这里 preventDefault(mousedown 的 preventDefault 会阻止原生 HTML5 拖拽启动!)
      // 文字选中干扰已用 CSS user-select:none 解决
      if (f.full === currentFile()) row.classList.add('active')
      a.onclick = () => setTimeout(refreshFiles, 0)
      const mv = document.createElement('button')
      mv.className = 'row-menu-btn'
      mv.title = '操作'
      mv.innerHTML = svgIcon('ellipsis')
      mv.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openRowMenu(mv, f.full, false) }
      setupDrag(row, f.full, false)
      // 文件行不是放置目标:拦住冒泡,否则会被根区域当成"移到根"(且旧代码会连环弹「不存在」)
      row.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'none' })
      row.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation() })
      row.appendChild(a)
      row.appendChild(mv)
      frag.appendChild(row)
    }
    return frag
  }
  $fileList.innerHTML = ''
  $fileList.appendChild(render(root, 0))
  setupDropZone($fileList, '') // 列表空白区 = 移到根(内部只绑一次)
  renderSelection()
}

// ---------- 打开文件:重建 Yjs 房间 ----------
async function resolvePath(file) {
  try {
    return await (await fetch('/api/resolve?path=' + encodeURIComponent(file))).json()
  } catch { return { status: 'offline' } }
}
async function openFile() {
  const file = currentFile()
  // 路径可能已被移动/删除:先解析,该跳转跳转
  const res = await resolvePath(file)
  if (res.status === 'moved') { location.hash = '#' + encodeURIComponent(res.to); return }
  if (res.status === 'gone') {
    const fallback = filesCache.find(f => f.endsWith('.md')) || filesCache[0]
    // 无 hash 的隐式默认文件缺失:静默换第一个文件;显式打开的文件没了才提示
    if (!location.hash || !fallback) { if (fallback) location.hash = '#' + encodeURIComponent(fallback); return }
    toast('文件不存在(可能被移动或删除):' + file, 'err')
    location.hash = '#' + encodeURIComponent(fallback)
    return
  }

  $curFile.textContent = file
  applyFileUi(file)
  teardownEditor()

  const ydoc = await createCollab(file)
  mountEditor(file, ydoc)
  bindPresence(provider)
  bindScrollSync()
  bindPreview(file, ydoc)
}

// 按文件类型切换工具栏与预览窗格(md 工具 / 仅格式化 / 全收起)
function applyFileUi(file) {
  const ext = extOf(file)
  const isFmt = ext === 'json' || ext === 'yaml' || ext === 'yml'
  $preview.style.display = ext === 'md' ? '' : 'none'
  document.getElementById('toolbar').style.display = (ext === 'md' || isFmt) ? '' : 'none'
  document.querySelectorAll('#toolbar .tb-md').forEach(el => el.style.display = ext === 'md' ? '' : 'none')
  const fmtBtn = document.querySelector('#toolbar .tb-format')
  if (fmtBtn) fmtBtn.style.display = isFmt ? '' : 'none'
}

// 销毁上一次的编辑器 / 连接 / 滚动监听
function teardownEditor() {
  if (view) { view.destroy(); view = null }
  if (provider) { provider.destroy(); provider = null }
  if (scrollAbort) { scrollAbort.abort(); scrollAbort = null }
}

// 建立协作连接:世代号握手 + 连接锁 + 关闭码处理(4001 重启 / 4002 删除 / 普通断线)
async function createCollab(file) {
  const ydoc = new Y.Doc()
  let epoch = ''
  try { epoch = (await (await fetch('/api/epoch')).json()).epoch || '' } catch {}
  provider = new WebsocketProvider(`ws://${location.host}/ws`, encodeURIComponent(file) + (epoch ? '?epoch=' + epoch : ''), ydoc)
  provider.awareness.setLocalStateField('user', { name: uname, color: ucolor })
  const onStatus = ({ status }) => setConnLocked(status !== 'connected')
  provider.on('status', onStatus)
  provider.on('sync', () => setConnLocked(false))
  onStatus({ status: provider.wsconnected ? 'connected' : 'connecting' })
  provider.on('connection-close', (ev) => {
    if (ev && ev.code === 4001) { handleEpochMismatch(); return }   // 服务重启过:丢弃本地状态重载
    if (ev && ev.code === 4002) { setTimeout(() => location.reload(), 300); return } // 文件被删:重载回首页
    // 普通断线:6 秒仍连不上则查路径状态(文件可能被移动/删除)
    setTimeout(async () => {
      if (!provider.wsconnected) {
        const r = await resolvePath(file)
        if (r.status === 'moved') location.hash = '#' + encodeURIComponent(r.to)
        else if (r.status === 'gone') { toast('此文件已被删除:' + file, 'err'); location.hash = '#' + encodeURIComponent('欢迎.md') }
      }
    }, 6000)
  })
  return ydoc
}

// 挂载 CodeMirror:主题 / 语言 / 只读舱(连接锁) / 快捷键 / 协作绑定
function mountEditor(file, ydoc) {
  const ytext = ydoc.getText('codemirror')
  // 不依赖焦点的光标广播:插件只在编辑器聚焦时上报,导致失焦窗口的光标永远不可见
  const sendCursor = () => {
    if (!view) return
    const sel = view.state.selection.main
    provider.awareness.setLocalStateField('cursor', {
      anchor: Y.createRelativePositionFromTypeIndex(ytext, sel.anchor),
      head: Y.createRelativePositionFromTypeIndex(ytext, sel.head),
    })
  }
  view = new EditorView({
    extensions: [basicSetup, themeComp.of(themeExt[themeMode]), readonlyComp.of(connLocked ? READONLY_EXT : []),
      ...langForFile(file),
      keymap.of([
        { key: 'Mod-b', preventDefault: true, run: () => (wrapSel('**'), true) },
        { key: 'Mod-i', preventDefault: true, run: () => (wrapSel('*'), true) },
        { key: 'Mod-s', preventDefault: true, run: () => (saveRevision(), true) },
      ]),
      EditorView.updateListener.of(u => { if (u.selectionSet || u.docChanged) sendCursor() }),
      yCollab(ytext, provider.awareness)],
    parent: $editor,
  })
  setTimeout(sendCursor, 400) // 初始光标(即使窗口未聚焦)
}

// 在线用户徽标
function bindPresence(prov) {
  const renderOnline = () => {
    const users = [...prov.awareness.getStates().values()].map(s => s.user).filter(Boolean)
    const seen = new Map()
    users.forEach(u => seen.set(u.name, u.color))
    $online.innerHTML = [...seen].map(([n, c]) =>
      `<span class="badge" style="border-color:${c};color:${c}">${n}</span>`).join(' ')
  }
  prov.awareness.on('change', renderOnline)
  renderOnline()
}

// 双栏滚动同步:双向比例同步;时间戳防抖切断反馈环(不依赖 rAF,后台页不被节流卡死)
function bindScrollSync() {
  if (scrollAbort) scrollAbort.abort()
  scrollAbort = new AbortController()
  const { signal } = scrollAbort
  let lastSync = 0
  const link = (src, dst) => () => {
    const now = Date.now()
    if (now - lastSync < 80) return // 我刚被程序同步过,这是回声,忽略
    lastSync = now
    const denom = src.scrollHeight - src.clientHeight
    const ratio = denom > 0 ? src.scrollTop / denom : 0
    const dstDenom = dst.scrollHeight - dst.clientHeight
    if (dstDenom > 0) dst.scrollTop = ratio * dstDenom
  }
  const scroller = view.scrollDOM
  scroller.addEventListener('scroll', link(scroller, $preview), { passive: true, signal })
  $preview.addEventListener('scroll', link($preview, scroller), { passive: true, signal })
}

// 预览渲染:markdown 排版 + [TOC] + 代码高亮;非 md 不渲染
function bindPreview(file, ydoc) {
  const ytext = ydoc.getText('codemirror')
  let timer
  const buildToc = (md) => {
    const out = []
    const walk = toks => toks.forEach(t => {
      if (t.type === 'heading') out.push('  '.repeat(Math.max(0, t.depth - 1)) + `- ${t.text}`)
      if (t.tokens) walk(t.tokens)
    })
    walk(marked.lexer(md))
    return out.join('\n') || '*(无标题,无法生成目录)*'
  }
  const render = () => {
    if (extOf(file) !== 'md') return
    let md = ytext.toString()
    if (/^\[TOC\]$/m.test(md)) md = md.replace(/^\[TOC\]$/gm, buildToc(md))
    $preview.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: true }))
    highlightPreview()
    // 站外链接新窗口打开
    document.querySelectorAll('#preview a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener' })
  }
  ydoc.on('update', () => { clearTimeout(timer); timer = setTimeout(render, 200) })
  render()
}

// ---------- 按钮 ----------
$btnNew.onclick = () => {
  openMenu($btnNew, {
    left: r => Math.max(8, r.left),
    build: (menu) => {
      menuItem(menu, { icon: 'file-alt', label: '新文件', onClick: async () => {
        const name = prompt('新文件路径(可含目录,如 架构/设计.md):')
        if (!name) return
        const r = await (await fetch('/api/files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })).json()
        if (r.ok) { location.hash = '#' + encodeURIComponent(r.name); refreshFiles(); openFile() }
        else toast(r.error, 'err')
      } })
      menuItem(menu, { icon: 'folder-plus', label: '新目录', onClick: async () => {
        const p = prompt('目录路径(可嵌套,如 架构/网关):')
        if (!p) return
        const r = await (await fetch('/api/mkdir', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p }),
        })).json()
        if (r.ok) refreshFiles(); else toast(r.error, 'err')
      } })
    },
  })
}

// 移动核心(from→to),成功后当前文件跟随跳转
// into=true 表示 to 是"目标文件夹"('' = 根目录);否则 to 是最终完整路径(重命名用)
async function moveTo(from, to, isDir, into = false) {
  const r = await (await fetch('/api/move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, into }),
  })).json()
  if (!r.ok) { toast(r.error, 'err'); return false }
  refreshFiles()
  const cur = currentFile()
  if (isDir ? (cur === from || cur.startsWith(from + '/')) : cur === from) {
    location.hash = '#' + encodeURIComponent(isDir ? r.to + cur.slice(from.length) : r.to)
    openFile()
  }
  return true
}

// 「移动」= 选一个文件夹(目标只能是文件夹,不接受手输路径)
function moveItem(anchorBtn, from, isDir) {
  const parentOf = (p) => p.split('/').slice(0, -1).join('')
  const curParent = parentOf(from)
  openedFolderPicker(anchorBtn, { from, isDir, curParent })
}

function openedFolderPicker(anchorBtn, { from, isDir, curParent }) {
  // 目录本身及其子目录不能作为目标(移入自身会破坏树形结构)
  const blocked = (d) => isDir && (d === from || d.startsWith(from + '/'))
  openMenu(anchorBtn, {
    left: r => Math.min(window.innerWidth - 250, Math.max(8, r.left - 150)),
    build: (menu) => {
      const head = document.createElement('div')
      head.className = 'note-menu-empty'
      head.style.textAlign = 'left'
      head.textContent = '移动到文件夹:'
      menu.appendChild(head)
      const input = document.createElement('input')
      input.placeholder = '过滤文件夹…'
      const list = document.createElement('div')
      list.className = 'note-menu-list'
      const renderList = (q) => {
        const ql = q.trim().toLowerCase()
        list.innerHTML = ''
        const all = [''].concat(dirsCache.filter(d => !blocked(d)))
        const rows = all.filter(d => {
          const label = d === '' ? '根目录' : d
          return !ql || label.toLowerCase().includes(ql)
        })
        rows.forEach(d => {
          const depth = d === '' ? 0 : d.split('/').length - 1
          const isCur = d === curParent
          const el = menuItem(list, {
            icon: d === '' ? 'folder-open' : 'folder',
            label: d === '' ? '根目录(顶层)' : d.split('/').pop(),
            title: isCur ? '就是当前所在位置' : d || '根目录',
            onClick: () => { if (!isCur) moveTo(from, d, isDir, true) },
          })
          el.style.paddingLeft = (10 + depth * 14) + 'px'
          if (isCur) { el.style.opacity = '.45'; el.style.cursor = 'default' }
        })
        if (!rows.length) list.innerHTML = '<div class="note-menu-empty">没有可用的文件夹</div>'
      }
      input.oninput = () => renderList(input.value)
      renderList('')
      menu.appendChild(input)
      menu.appendChild(list)
    },
  })
}
async function renameItem(path, isDir) {
  const oldName = path.split('/').pop()
  const newName = prompt('重命名(只改名字,目录不变):', isDir ? oldName : oldName.replace(/\.[^.]+$/, ''))
  if (!newName || newName === oldName) return
  const parent = path.split('/').slice(0, -1).join('/')
  let target = newName
  if (!isDir && !/\.[a-z0-9]+$/i.test(newName)) target += '.' + (path.match(/\.([^.]+)$/)?.[1] || 'md') // 没写后缀则保留原后缀
  await moveTo(path, parent ? parent + '/' + target : target, isDir)
}
async function deleteItem(path, isDir) {
  if (!confirm(`确定删除 ${path} ?` + (isDir ? '\n目录将递归删除!' : ''))) return
  const r = await (await fetch('/api/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })).json()
  if (!r.ok) { toast(r.error, 'err'); return }
  const cur = currentFile()
  if (cur === path || cur.startsWith(path + '/')) { location.hash = '#' + encodeURIComponent('欢迎.md'); openFile() }
  refreshFiles()
}
// 行操作菜单:移动 / 重命名 / 删除
function openRowMenu(anchorBtn, path, isDir) {
  const locked = isProtectedPath(path)   // 根目录 .gitignore:仓库配置,禁止移动/改名/删除
  const guard = (fn) => () => { if (locked) { toast('根目录 .gitignore 是仓库配置,不能修改', 'err'); return } fn() }
  openMenu(anchorBtn, {
    left: r => Math.min(window.innerWidth - 200, Math.max(8, r.left - 150)),
    build: (menu) => {
      menuItem(menu, { icon: 'right-left', label: '移动', onClick: guard(() => moveItem(anchorBtn, path, isDir)) })
      menuItem(menu, { icon: 'pen-to-square', label: '重命名', onClick: guard(() => renameItem(path, isDir)) })
      menuItem(menu, { icon: 'trash-can', label: '删除', danger: true, onClick: guard(() => deleteItem(path, isDir)) })
      if (locked) {
        const note = document.createElement('div')
        note.className = 'note-menu-empty'
        note.textContent = '· 根目录 .gitignore 受保护 ·'
        menu.appendChild(note)
      }
    },
  })
}

// 手动保存:立即落盘(不 commit);按钮短暂反馈
async function saveToDisk() {
  const btn = document.getElementById('btn-save')
  const orig = btn.textContent
  try {
    const r = await (await fetch('/api/flush', { method: 'POST' })).json()
    btn.textContent = r.ok ? (r.flushed > 0 ? `✓ 已保存 ${r.flushed} 篇` : '✓ 已是最新') : '✗ 失败'
  } catch { btn.textContent = '✗ 失败' }
  setTimeout(() => { btn.textContent = orig }, 1500)
}
document.getElementById('btn-save').onclick = saveToDisk

async function saveRevision() {
  const msg = prompt('版本说明(可留空):', '')
  if (msg === null) return false
  const r = await (await fetch('/api/revision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  })).json()
  alert(r.ok ? `已提交版本 ${r.commit}\n${r.message}` : r.error)
  return !!r.ok
}
$btnRev.onclick = saveRevision

$btnLog.onclick = async () => {
  const r = await (await fetch('/api/log?file=' + encodeURIComponent(currentFile()))).json()
  if (!r.entries.length) { alert('此文件还没有版本'); return }
  const text = r.entries.map(e => `${e.h}  ${e.t}  ${e.s}`).join('\n')
  const commit = prompt(`历史版本(点取消关闭):\n${text}\n\n要恢复到哪条?粘贴 commit 短哈希:`)
  if (!commit) return
  const res = await (await fetch('/api/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: currentFile(), commit: commit.trim() }),
  })).json()
  alert(res.ok ? `已恢复 (${res.chars} 字符),稍后自动写回文件(可点💾保存立即落盘)` : res.error)
}

// ---------- 编辑/预览 分隔条拖拽 ----------
{
  const splitter = document.getElementById('splitter')
  const editorCol = document.getElementById('editor-col')
  const preview = document.getElementById('preview')
  if (splitter && editorCol && preview) {
    // 恢复上次比例
    const saved = localStorage.getItem('mdwiki-split')
    if (saved) {
      const [e, p] = saved.split(',').map(Number)
      if (e > 0 && p > 0) { editorCol.style.flex = String(e); preview.style.flex = String(p) }
    }
    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault()
      splitter.classList.add('active')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const startX = e.clientX
      const startEW = editorCol.getBoundingClientRect().width
      const startPW = preview.getBoundingClientRect().width
      const total = startEW + startPW
      const MIN_E = 150, MIN_P = 100   // 两侧最小宽度:拖到头就停住,任何一侧都不会被挤没
      const onMove = (ev) => {
        let eW = startEW + (ev.clientX - startX)
        eW = Math.min(Math.max(eW, MIN_E), Math.max(MIN_E, total - MIN_P))
        const pW = total - eW
        // 用 flex 数值(而不是 px)保持弹性
        editorCol.style.flex = String(+(eW / total).toFixed(3))
        preview.style.flex = String(+(pW / total).toFixed(3))
      }
      const onUp = () => {
        splitter.classList.remove('active')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        localStorage.setItem('mdwiki-split', editorCol.style.flex + ',' + preview.style.flex)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
    // 双击恢复默认 1:1
    splitter.addEventListener('dblclick', () => {
      editorCol.style.flex = '1'
      preview.style.flex = '1'
      localStorage.removeItem('mdwiki-split')
    })
  }
}

// ---------- 启动 ----------
const IS_VIEW_MODE = location.pathname.startsWith('/view/')

if (IS_VIEW_MODE) ; else {
  window.addEventListener('hashchange', () => { refreshFiles(); openFile() })
  applyTheme(themeMode)
  // 先拿到文件列表再开文件:默认文件缺失时的回退依赖 filesCache 已就绪
  ;(async () => { await refreshFiles(); openFile() })()
  bindTreeEvents()
}

// ---------- 目录结构实时同步(别人的新建/移动/删除) ----------
function bindTreeEvents() {
  let timer = null
  const es = new EventSource('/api/events')
  es.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.type !== 'tree') return
    // 合并短时间内的多次变更,避免拖拽批量移动时反复重建
    clearTimeout(timer)
    timer = setTimeout(() => {
      refreshFiles()
      // 自己正打开的文件可能被移动/删除:静默跟随(openFile 内部会 resolve 并跳转)
      resolvePath(currentFile()).then(r => { if (r.status !== 'ok') openFile() }).catch(() => {})
    }, 250)
  }
  // EventSource 自带重连;断网恢复后第一次 onopen 补一次全量刷新
  es.onerror = () => {}
  es.onopen = () => { if (filesCache.length) refreshFiles() }
}

// 只读模式单独用 async IIFE(顶层 if 不能直接用 await)
if (IS_VIEW_MODE) (async () => {
  document.getElementById('sidebar').style.display = 'none'
  document.getElementById('editor-col').style.display = 'none'
  document.getElementById('splitter').style.display = 'none'
  document.getElementById('btn-new').style.display = 'none'
  document.getElementById('btn-save').style.display = 'none'
  document.getElementById('btn-revision').style.display = 'none'
  document.getElementById('btn-log').style.display = 'none'
  document.getElementById('online').style.display = 'none'
  const pv = document.getElementById('preview')
  pv.style.display = ''
  pv.style.maxWidth = '52rem'
  pv.style.margin = '0 auto'
  pv.style.padding = '40px 32px'
  pv.style.width = '100%'
  document.title = decodeURIComponent(location.pathname.slice(6)) + ' - mdwiki'
  applyTheme(themeMode)
  // 拉取内容并渲染(不建 WebSocket,纯静态渲染)
  const file = decodeURIComponent(location.pathname.slice(6))
  try {
    const text = await (await fetch('/api/content?path=' + encodeURIComponent(file))).text()
    let md = text
    if (/^\[TOC\]$/m.test(md)) {
      const tocLines = []
      const walkToc = (toks) => toks.forEach(t => {
        if (t.type === 'heading') tocLines.push('  '.repeat(Math.max(0, t.depth - 1)) + '- ' + t.text)
        if (t.tokens) walkToc(t.tokens)
      })
      walkToc(marked.lexer(md))
      md = md.replace(/^\[TOC\]$/gm, tocLines.join('\n'))
    }
    pv.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: true }))
    highlightPreview()
    pv.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener' })
    // 内链跳转到对应的只读视图
    pv.querySelectorAll('a[href^="#"]').forEach(a => {
      const href = a.getAttribute('href').slice(1)
      if (href) a.href = '/view/' + href
    })
  } catch (e) {
    pv.innerHTML = '<p style="color:#e0533d;text-align:center;margin-top:40vh">加载失败:' + e.message + '</p>'
  }
})()
