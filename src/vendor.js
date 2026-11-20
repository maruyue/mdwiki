// 只读视图(/view)的第三方依赖:本地打包,不依赖 CDN(离线/内网可用)
// 语言集合与编辑器预览保持一致,保证两边高亮行为相同
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsJs from 'highlight.js/lib/languages/javascript'
import hljsPy from 'highlight.js/lib/languages/python'
import hljsCss from 'highlight.js/lib/languages/css'
import hljsXml from 'highlight.js/lib/languages/xml'
import hljsYaml from 'highlight.js/lib/languages/yaml'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsTs from 'highlight.js/lib/languages/typescript'

hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('javascript', hljsJs)
hljs.registerLanguage('python', hljsPy)
hljs.registerLanguage('css', hljsCss)
hljs.registerLanguage('xml', hljsXml)
hljs.registerLanguage('yaml', hljsYaml)
hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('typescript', hljsTs)

window.marked = marked
window.DOMPurify = DOMPurify
window.hljs = hljs
