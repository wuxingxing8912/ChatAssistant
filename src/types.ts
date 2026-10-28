/**
 * 对话领域的公共类型定义。
 */

/** 消息角色：user 为用户发送，assistant 为 AI 回复 */
export type MessageRole = 'user' | 'assistant'

/**
 * 一条对话消息。
 * 也是持久化到 LocalStorage 时使用的数据结构。
 */
export interface Message {
  /** 消息发送方 */
  role: MessageRole
  /** 消息正文；AI 消息在流式输出期间会逐步增长 */
  content: string
  /** 消息创建时间戳（毫秒） */
  timestamp: number
}
