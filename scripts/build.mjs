// build.mjs —— 构建前端 + 自动更新 index.html 的版本号(消灭"忘改版本号拿到旧包"的人为失误)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const r = spawnSync('bun', ['build', 'src/client.js', '--outfile', 'public/app.js', '--minify'], { stdio: 'inherit' })
if (r.status !== 0) { console.error('构建失败'); process.exit(r.status || 1) }

const v = Date.now()
const idx = 'public/index.html'
let html = fs.readFileSync(idx, 'utf8')
if (/app\.js\?v=\d+/.test(html)) html = html.replace(/app\.js\?v=\d+/, `app.js?v=${v}`)
else if (html.includes('src="/app.js"')) html = html.replace('src="/app.js"', `src="/app.js?v=${v}"`)
fs.writeFileSync(idx, html)
console.log(`✓ 构建完成,版本号 → ${v}`)
