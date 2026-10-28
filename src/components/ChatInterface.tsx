import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChatAPIError, isAbortError, streamChat } from '../api'
import type { Message } from '../types'
import { Markdown } from './Markdown'

/** 把文本追加到最后一条 AI 消息上 */
function appendToLastAssistant(
  messages: Message[],
  update: (message: Message) => Message,
): Message[] {
  const lastIndex = messages.length - 1
  const last = messages[lastIndex]
  if (!last || last.role !== 'assistant') return messages

  const next = [...messages]
  next[lastIndex] = update(last)
  return next
}

const STORAGE_KEY = 'chat-assistant:history'

/** 从 LocalStorage 读取对话历史；解析失败或结构异常时安全回退为空数组 */
function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Message => {
      if (item === null || typeof item !== 'object') return false
      const record = item as Record<string, unknown>
      return (
        (record.role === 'user' || record.role === 'assistant') &&
        typeof record.content === 'string' &&
        typeof record.timestamp === 'number'
      )
    })
  } catch {
    return []
  }
}

export function ChatInterface() {
  // 用惰性初始化在首屏直接读取历史，避免渲染后再覆盖已保存内容
  const [messages, setMessages] = useState<Message[]>(loadMessages)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 新消息或流式增量到达时自动滚动到底部
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // 每次对话更新后自动保存到 LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    } catch {
      // 隐私模式或配额不足时忽略，不影响内存中的对话
    }
  }, [messages])

  // 输入框高度随内容自适应，最多 120px
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  // 组件卸载时中断未完成的请求
  useEffect(() => () => abortRef.current?.abort(), [])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMessage: Message = { role: 'user', content: text, timestamp: Date.now() }
    // 历史消息 + 本次提问，一起发送给模型以实现多轮对话
    const history = [...messages, userMessage]

    setMessages([...history, { role: 'assistant', content: '', timestamp: Date.now() }])
    setInput('')
    setError(null)
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const { content } = await streamChat({
        messages: history,
        signal: controller.signal,
        onDelta: (delta) => {
          setMessages((prev) =>
            appendToLastAssistant(prev, (message) => ({
              ...message,
              content: message.content + delta,
            })),
          )
        },
      })

      // 用接口返回的全量文本收尾，保证与真实返回一致
      setMessages((prev) => appendToLastAssistant(prev, (message) => ({ ...message, content })))
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof ChatAPIError ? err.message : '发生未知错误，请稍后重试。')
      }
      // 出错或中断时移除没有内容的占位气泡
      setMessages((prev) =>
        prev.filter(
          (message, index) =>
            !(index === prev.length - 1 && message.role === 'assistant' && !message.content),
        ),
      )
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing 用于避免中文输入法回车选词时误发送
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void handleSend()
    }
  }

  const handleClear = () => {
    if (!window.confirm('确定清空当前对话吗？此操作不可撤销。')) return
    // 中断可能正在进行的生成，避免残留请求继续写入消息
    abortRef.current?.abort()
    setIsStreaming(false)
    setError(null)
    setMessages([])
  }

  const canSend = input.trim().length > 0 && !isStreaming

  return (
    <div className="flex h-dvh flex-col bg-[#ededed]">
      <header className="relative flex shrink-0 items-center justify-center border-b border-black/10 bg-[#f7f7f7] px-4 py-2.5">
        <div className="text-center">
          <h1 className="text-base font-medium text-gray-800">AI 聊天助手</h1>
          <p className="text-xs text-gray-400">由智谱 GLM 驱动</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            title="清空当前对话"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-black/5 hover:text-red-500"
          >
            清空对话
          </button>
        )}
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-5">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message, index) => (
              <MessageItem
                key={`${message.timestamp}-${index}`}
                message={message}
                isPending={isStreaming && index === messages.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-auto mb-1 w-full max-w-3xl shrink-0 px-4">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        </div>
      )}

      <footer className="shrink-0 border-t border-black/10 bg-[#f7f7f7] px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder="输入消息，Enter 发送，Shift + Enter 换行"
            className="min-h-[42px] max-h-[120px] flex-1 resize-none rounded-lg border border-black/10 bg-white px-3 py-2.5 text-[15px] leading-normal outline-none placeholder:text-gray-400 focus:border-[#07c160] disabled:bg-gray-100 disabled:text-gray-400"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="h-[42px] shrink-0 rounded-lg bg-[#07c160] px-5 text-sm font-medium text-white transition-colors hover:bg-[#06ad56] disabled:bg-gray-300 disabled:text-gray-500 disabled:hover:bg-gray-300"
          >
            {isStreaming ? '思考中...' : '发送'}
          </button>
        </div>
      </footer>
    </div>
  )
}

function MessageItem({ message, isPending }: { message: Message; isPending: boolean }) {
  const isUser = message.role === 'user'
  const hasContent = message.content.length > 0
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用（非安全上下文或权限被拒）时静默失败
    }
  }

  return (
    <div className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-medium text-white ${
          isUser ? 'bg-[#5b8ff9]' : 'bg-[#07c160]'
        }`}
      >
        {isUser ? '我' : 'AI'}
      </div>

      <div className="min-w-0 max-w-[75%]">
        <div
          className={`relative rounded-lg px-3 py-2 text-left shadow-sm after:absolute after:top-3 after:h-0 after:w-0 after:border-y-[7px] after:border-y-transparent after:content-[''] ${
            isUser
              ? 'bg-[#95ec69] text-gray-900 after:-right-[7px] after:border-l-[7px] after:border-l-[#95ec69]'
              : 'bg-white text-gray-800 after:-left-[7px] after:border-r-[7px] after:border-r-white'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {message.content}
            </p>
          ) : hasContent ? (
            <>
              <Markdown content={message.content} />
              {isPending && (
                <span className="ml-0.5 inline-block h-[15px] w-[2px] animate-pulse bg-gray-400 align-text-bottom" />
              )}
            </>
          ) : (
            <ThinkingIndicator />
          )}
        </div>
        {!isUser && hasContent && (
          <button
            type="button"
            onClick={handleCopy}
            className="mt-1 text-xs text-gray-400 transition-colors hover:text-gray-600"
          >
            {copied ? '已复制 ✓' : '复制'}
          </button>
        )}
      </div>
    </div>
  )
}

/** AI 尚未产出首个 token 时的占位内容 */
function ThinkingIndicator() {
  return (
    <span className="flex items-center gap-1.5 py-0.5 text-sm text-gray-400">
      <span className="flex items-center gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      思考中...
    </span>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-400">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-lg font-medium text-[#07c160] shadow-sm">
        AI
      </div>
      <p className="text-sm">有什么可以帮你的？</p>
      <p className="text-xs">在下方输入内容开始对话</p>
    </div>
  )
}
