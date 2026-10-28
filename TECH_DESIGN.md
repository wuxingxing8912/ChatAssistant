# 技术设计

## 技术栈
- React + TypeScript + Vite
- Tailwind CSS
- 智谱 AP API
- LocalStorage 存储对话历史
- react-markdown 渲染 Markdown

## 数据结构
- Message: role（user或assistant）、content(内容)、timestamp（时间戳）
- 对话历史存储在LocalStorage中

## API调用
- 使用智谱AI Chat Completions API
- 启用stream模式实现流式输出
- API Key存储在环境变量中

