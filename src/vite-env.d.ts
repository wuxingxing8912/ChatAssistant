/// <reference types="vite/client" />

/** 项目自定义环境变量的类型声明，保证 import.meta.env 的类型安全 */
interface ImportMetaEnv {
  /** 智谱 AI 的 API Key，必填 */
  readonly VITE_ZHIPU_API_KEY: string
  /** 接口根地址，缺省为 https://open.bigmodel.cn/api/paas/v4 */
  readonly VITE_ZHIPU_API_BASE?: string
  /** 模型名称，缺省为 glm-4.6 */
  readonly VITE_ZHIPU_MODEL?: string
  /** 采样温度，缺省为 0.7 */
  readonly VITE_ZHIPU_TEMPERATURE?: string
  /** 单次回复的最大 token 数，缺省为 2048 */
  readonly VITE_ZHIPU_MAX_TOKENS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
