import type { Message } from './types'

/* -------------------------------------------------------------------------- */
/*                                   配置                                      */
/* -------------------------------------------------------------------------- */

/**
 * 接口根地址。
 * 默认走同源的开发代理（见 vite.config.ts 的 server.proxy）。
 * 不直连 https://open.bigmodel.cn 是因为其 OPTIONS 预检不返回 CORS 响应头，
 * 带 Authorization 的请求会被浏览器拦截；同源代理转发则不会触发预检。
 * 若已有自己的服务端代理，可用 VITE_ZHIPU_API_BASE 指向它。
 */
const DEFAULT_BASE_URL = '/api/zhipu'
/** 默认模型 */
const DEFAULT_MODEL = 'glm-4.6'
/** 默认采样温度 */
const DEFAULT_TEMPERATURE = 0.7
/** 默认最大输出 token 数 */
const DEFAULT_MAX_TOKENS = 2048
/** 默认系统提示词 */
const DEFAULT_SYSTEM_PROMPT =
  '你是一个乐于助人的 AI 助手。回答简洁清晰，使用 Markdown 格式组织内容，代码块请标注语言。'
/** SSE 流结束标志 */
const DONE_SIGNAL = '[DONE]'

/** 从环境变量读取字符串配置，取不到时使用默认值 */
function readStringEnv(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

/** 从环境变量读取数值配置，非法值时回退到默认值 */
function readNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** API Key：必填，未提供时在调用时给出友好提示 */
const API_KEY = import.meta.env.VITE_ZHIPU_API_KEY?.trim() ?? ''
/** 接口根地址，去掉结尾斜杠便于拼接路径 */
const BASE_URL = readStringEnv(import.meta.env.VITE_ZHIPU_API_BASE, DEFAULT_BASE_URL).replace(/\/+$/, '')
const MODEL = readStringEnv(import.meta.env.VITE_ZHIPU_MODEL, DEFAULT_MODEL)
const TEMPERATURE = readNumberEnv(import.meta.env.VITE_ZHIPU_TEMPERATURE, DEFAULT_TEMPERATURE)
const MAX_TOKENS = readNumberEnv(import.meta.env.VITE_ZHIPU_MAX_TOKENS, DEFAULT_MAX_TOKENS)

/* -------------------------------------------------------------------------- */
/*                                   类型                                      */
/* -------------------------------------------------------------------------- */

/** 流式请求的可选参数 */
export interface StreamChatOptions {
  /** 完整对话历史，按顺序发送给模型以实现多轮对话 */
  messages: Message[]
  /** 用于中断请求（例如用户点击“停止生成”） */
  signal?: AbortSignal
  /** 每收到一小段文本就回调一次，用于逐字渲染 */
  onDelta?: (delta: string) => void
  /** 系统提示词，缺省使用内置提示词 */
  systemPrompt?: string
  /** 采样温度，缺省使用环境变量或内置的 0.7 */
  temperature?: number
  /** 最大输出 token 数，缺省使用环境变量或内置的 2048 */
  maxTokens?: number
}

/** 流式请求的返回结果 */
export interface StreamChatResult {
  /** 本次回复的完整内容 */
  content: string
}

/** 流式响应中单个 SSE 事件的数据结构（仅取用到的字段） */
interface StreamChunk {
  choices?: Array<{
    delta?: {
      role?: string
      content?: string
    }
    finish_reason?: string | null
  }>
  error?: {
    code?: string
    message?: string
  }
}

/* -------------------------------------------------------------------------- */
/*                                   错误                                      */
/* -------------------------------------------------------------------------- */

/**
 * 对话接口错误。
 * message 是可以直接展示给用户的友好提示，status/code 便于排查问题。
 */
export class ChatAPIError extends Error {
  /** HTTP 状态码，网络层失败时为空 */
  readonly status?: number
  /** 服务端返回的错误码 */
  readonly code?: string

  constructor(
    message: string,
    options: { status?: number; code?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ChatAPIError'
    this.status = options.status
    this.code = options.code
  }
}

/** 判断是否为调用方主动中断（AbortController.abort）导致的错误 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** 把 HTTP 状态码翻译成用户能看懂的提示 */
function toFriendlyMessage(status: number, detail?: string): string {
  switch (status) {
    case 401:
    case 403:
      return 'API Key 无效或没有权限，请检查 .env.local 中的 VITE_ZHIPU_API_KEY。'
    case 404:
      return '接口地址不存在，请检查 VITE_ZHIPU_API_BASE 配置。'
    case 408:
    case 504:
      return '请求超时，请稍后重试。'
    case 429:
      return '请求过于频繁或额度已用完，请稍后再试。'
    default:
      if (status >= 500) return 'AI 服务暂时不可用，请稍后重试。'
      return detail
        ? `请求失败（${status}）：${detail}`
        : `请求失败（${status}），请稍后重试。`
  }
}

/** 读取错误响应体，构造带友好提示的错误 */
async function buildHttpError(response: Response): Promise<ChatAPIError> {
  let code: string | undefined
  let detail: string | undefined

  try {
    const data = (await response.json()) as { error?: { code?: string; message?: string } }
    code = data.error?.code
    detail = data.error?.message
  } catch {
    // 响应体不是 JSON 时忽略，仅用状态码生成提示
  }

  return new ChatAPIError(toFriendlyMessage(response.status, detail), {
    status: response.status,
    code,
  })
}

/* -------------------------------------------------------------------------- */
/*                                  主流程                                     */
/* -------------------------------------------------------------------------- */

/**
 * 发起一次流式对话请求，把历史消息一并发给模型。
 *
 * - 通过 onDelta 回调逐段返回文本，可用于逐字渲染
 * - 返回值中包含完整内容，便于调用方统一写入历史记录
 * - 出错时抛出 ChatAPIError，其中 message 可直接展示给用户
 */
export async function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { messages, signal, onDelta, systemPrompt, temperature, maxTokens } = options

  if (!API_KEY) {
    throw new ChatAPIError(
      '尚未配置 API Key，请在项目根目录的 .env.local 中设置 VITE_ZHIPU_API_KEY，然后重启开发服务器。',
    )
  }

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    signal,
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
        ...messages.map(({ role, content }) => ({ role, content })),
      ],
      stream: true,
      temperature: temperature ?? TEMPERATURE,
      max_tokens: maxTokens ?? MAX_TOKENS,
    }),
  }).catch((error: unknown) => {
    if (isAbortError(error)) throw error
    throw new ChatAPIError('网络连接失败，请检查网络后重试。', { cause: error })
  })

  if (!response.ok) throw await buildHttpError(response)

  if (!response.body) {
    throw new ChatAPIError('当前环境不支持流式响应，请更换浏览器后重试。')
  }

  return readStream(response.body, onDelta)
}

/**
 * 读取 SSE 流。
 * 每次收到数据后按行切分，未读完的半行留在缓冲区等待后续数据。
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void,
): Promise<StreamChatResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let content = ''
  let finished = false

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // 最后一段可能是不完整的行，留在缓冲区里等下一批数据
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const payload = readDataPayload(line)
      if (payload === null) continue
      if (payload === DONE_SIGNAL) {
        finished = true
        break
      }
      appendDelta(payload, (delta) => {
        content += delta
        onDelta?.(delta)
      })
    }
  }

  // 少数情况下流末尾没有换行，需要冲刷缓冲区中残留的一行
  if (!finished) {
    const payload = readDataPayload(buffer)
    if (payload !== null && payload !== DONE_SIGNAL) {
      appendDelta(payload, (delta) => {
        content += delta
        onDelta?.(delta)
      })
    }
  }

  return { content }
}

/** 从一行 SSE 文本中取出 data 载荷；不是 data 行时返回 null */
function readDataPayload(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  return trimmed.slice('data:'.length).trim()
}

/** 解析单个事件的 JSON，取出增量文本；解析失败的行直接跳过 */
function appendDelta(payload: string, emit: (delta: string) => void): void {
  let chunk: StreamChunk
  try {
    chunk = JSON.parse(payload) as StreamChunk
  } catch {
    return
  }

  if (chunk.error) {
    throw new ChatAPIError(chunk.error.message || 'AI 服务返回了错误，请稍后重试。', {
      code: chunk.error.code,
    })
  }

  const delta = chunk.choices?.[0]?.delta?.content
  if (delta) emit(delta)
}
