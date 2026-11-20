# mdwiki-demo

一个约 1300 行的自建知识库:**Markdown 文件为真相 + Yjs 实时协作 + git 版本**。
无数据库、无 Docker,Node 单进程 + 磁盘目录即数据。

## 快速开始

```bash
bun install        # 装依赖
npm run build      # 构建前端(自动更新 index.html 版本号)
npm start          # 启动 http://localhost:3320
# 开发模式(构建 + 启动):npm run dev
```

浏览器打开 http://localhost:3320 ,多个窗口各带 `?u=名字` 即可体验协作。

## 架构:三层职责

```
实时层   Yjs 房间(按 inode 键控) ── 多人协作,移动/改名不迁移房间
映射层   registry(inode→路径) + redirects(旧路径→新路径,内存)
持久层   磁盘文件(.md/.json/.yaml/…) + git(按路径管历史)
```

- **内存权威**:编辑先进 Yjs 文档,每 **60 秒**落盘一次;点「💾 保存」立即落盘
- **版本**:点「📷 存版本」= 强制刷盘 + `git commit`(版本里永远包含此刻内存内容)
- **移动/改名**:`fs.rename` 保 inode → 房间原地不动 → 零竞态;旧路径靠内存表 + git rename 记录跳转
- **协作断线**:锁定编辑(防本地分叉);服务重启(世代号不符)或被删文件 → 自动重载

## 关键设计决策

| 决策 | 原因 |
|---|---|
| 房间键 = inode | 移动/改名永不迁移房间,消灭"内容双写"整类事故 |
| 启动世代号(EPOCH) | 服务重启后旧客户端历史与新房间不同源,拒绝其推送(4001) |
| 断线锁编辑 | 客户端察觉断开(≤30s 静默窗口)后禁止写入,防本地分叉 |
| 删除踢连接(4002) | 否则旧标签页挂着已销毁房间继续编辑,内容写进虚空 |
| 已存在文件原地写 | tmp+rename 会换 inode,击穿房间身份 |
| 空闲 30 分钟回收房间 | 控制内存;回收前兜底落盘 |
| 无"自动恢复副本" | 会凭空产生文件让用户困惑;宁可在重载时丢弃静默窗口内的少量输入 |
| 前端依赖全部本地打包 | 曾用 CDN 加载 hljs,离线/被墙时静默失败,只读页代码块一片灰 |
| 高亮配色抽成共享 CSS | 编辑预览与只读视图同一套色板,改一处两边同步 |
| 目录结构走 SSE 推送 | 别人的新建/重命名/移动/删除,所有在线页面 ≤1s 内同步,无需手动刷新 |
| fs.watch 兜底广播 | 外部编辑器 / git pull / Agent 直接写文件也通知;用"结构指纹"去重,内容落盘不触发 |
| 移动目标只能是文件夹 | 「移动」用文件夹选择器(不是手输路径),服务端再校验一次;目标为文件/不存在一律拒绝 |
| 重命名与移动分离 | 移动 = `into:true` + 目录;改名 = 完整路径语义,两者走同一接口但校验不同 |
| 根目录 `.gitignore` 受保护 | 仓库配置,禁止移动/改名/删除(子目录同名文件不受限);界面置灰 + 服务端二次校验 |

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/files` | 递归列出文件与目录 |
| GET/POST | `/api/content` | 读/写(写穿房间,在线者实时可见) |
| GET | `/api/resolve?path=` | 路径现状 ok/moved/gone |
| POST | `/api/files` | 新建文件(body: `{name}`) |
| POST | `/api/mkdir` | 新建目录(`{path}`) |
| POST | `/api/move` | 移动(`{from,to,into:true}`,`to` 必须是已存在的文件夹,`''`=根)/ 改名(`{from,to}` 完整路径) |
| POST | `/api/delete` | 删除(`{path}`,目录递归) |
| POST | `/api/flush` | 立即落盘 |
| POST | `/api/revision` | 存版本(`{message}` → git commit) |
| GET | `/api/log?file=` | 文件历史(`git log --follow`) |
| POST | `/api/restore` | 回滚(`{file,commit}`,支持跨改名) |
| GET | `/api/epoch` | 服务世代号 |
| GET | `/api/events` | SSE 推送:目录结构变更(`create/mkdir/move/move-batch/delete/commit/fs`) |
| WS | `/ws/<路径>?epoch=` | Yjs 同步(`codemirror` 文本字段) |

## 目录结构

```
server.mjs          HTTP + WS + 房间/落盘/git/回收 + 只读视图(520 行)
src/client.js       编辑器 + 协作 + UI(938 行)
src/vendor.js       只读视图依赖打包入口(marked/DOMPurify/hljs,本地构建不依赖 CDN)
public/index.html   编辑页;public/view.html 只读页
public/code-theme.css  代码高亮配色(编辑预览与只读视图共用,保证两边一致)
scripts/build.mjs   构建两个入口 + 自动更新各页面资源版本号
notes/              数据目录(自身是一个 git 仓库)
read-view/          只读视图的游离 worktree(HEAD 快照,与 notes/ 物理隔离)
demo/               Agent 协作演示与压测脚本
```

## 已知边界

- **单进程**:房间在内存,不支持多实例横向扩展
- **大文档全量替换慢**:211KB 内容一次性 API 覆写约 2 秒(正常增量编辑无感)
- **无鉴权**:对外暴露前需加 token
- **外部编辑器**直接改文件时,内存有改动会覆盖外部修改(内存为权威)
- 崩溃窗口 ≤60 秒:浏览器持有全文,重连补推
