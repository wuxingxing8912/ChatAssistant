import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'

// 只注册常用语言，避免把 Prism 全量语法包打进产物。
// 顺序需保证被依赖的语法先注册：markup → javascript → jsx/typescript → tsx
const languages = {
  markup: markup,
  css: css,
  javascript: javascript,
  jsx: jsx,
  typescript: typescript,
  tsx: tsx,
  json: json,
  bash: bash,
  python: python,
  go: go,
  rust: rust,
  java: java,
  sql: sql,
  yaml: yaml,
  // 常见别名，注册到同一份语法上
  html: markup,
  xml: markup,
  markdown: markup,
  js: javascript,
  ts: typescript,
  sh: bash,
  shell: bash,
  py: python,
  yml: yaml,
} as const

Object.entries(languages).forEach(([name, language]) => {
  SyntaxHighlighter.registerLanguage(name, language)
})

/** 递归取出子节点中的纯文本，代码块会用得到 */
function toPlainText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toPlainText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return toPlainText(node.props.children)
  return ''
}

/**
 * 代码块：带语言标识时走高亮，否则按行内代码渲染。
 * react-markdown v9 起不再提供 inline 标记，改用 className 上的 language- 判断。
 */
function CodeBlock({ className, children }: ComponentPropsWithoutRef<'code'>) {
  const language = /language-([\w+-]+)/.exec(className ?? '')?.[1]

  if (!language) {
    return (
      <code className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-[#c7254e]">
        {children}
      </code>
    )
  }

  return (
    <div className="my-2 overflow-x-auto rounded-lg bg-[#282c34]">
      <SyntaxHighlighter
        language={language.toLowerCase()}
        style={oneDark}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '12px',
          background: 'transparent',
          fontSize: '13px',
          lineHeight: 1.6,
        }}
        codeTagProps={{
          style: { fontFamily: 'ui-monospace, Consolas, "Courier New", monospace' },
        }}
      >
        {toPlainText(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  )
}

// 没有引入 typography 插件，这里逐个元素补齐排版样式
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-xl font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="marker:text-gray-400">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#07c160] underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-4 border-black/15 pl-3 text-gray-500 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-black/10" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-black/10 bg-black/[0.04] px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-black/10 px-2 py-1">{children}</td>,
  // 去掉外层 pre，改由 CodeBlock 里的容器负责圆角与滚动
  pre: ({ children }) => <>{children}</>,
  code: CodeBlock,
}

/** 渲染 AI 返回的 Markdown；content 为空时调用方会展示输入指示 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="break-words text-[15px] leading-relaxed">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  )
}
