// build.ts —— 运行: bun scripts/build.ts 构建前端 + 自动更新 HTML 里的资源版本号(消灭"忘改版本号拿到旧包"的人为失误)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const ENTRIES = [
  { src: 'src/client.ts', out: 'public/app.js' },     // 编辑页 SPA
  { src: 'src/vendor.ts', out: 'public/vendor.js' },  // 只读视图依赖(marked/DOMPurify/hljs)
]
for (const { src, out } of ENTRIES) {
  const r = spawnSync('bun', ['build', src, '--outfile', out, '--minify'], { stdio: 'inherit' })
  if (r.status !== 0) { console.error(`构建失败: ${src}`); process.exit(r.status || 1) }
}

const v = Date.now()
// 每个页面用到的资源都要带版本号,避免浏览器拿到旧缓存
const PAGES = [
  { file: 'public/index.html', assets: ['app.js', 'code-theme.css'] },
  { file: 'public/view.html', assets: ['vendor.js', 'code-theme.css'] },
]
for (const { file, assets } of PAGES) {
  let html = fs.readFileSync(file, 'utf8')
  for (const name of assets) {
    const re = new RegExp(name.replace(/\./g, '\\.') + '\\?v=\\d+')
    if (re.test(html)) html = html.replace(re, `${name}?v=${v}`)
    else if (html.includes(`"${name}"`)) html = html.replace(`"${name}"`, `"${name}?v=${v}"`)
    else console.warn(`⚠ ${file} 里没有引用 ${name}`)
  }
  fs.writeFileSync(file, html)
}
console.log(`✓ 构建完成,版本号 → ${v}`)
