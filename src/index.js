import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.less'
import ErrorBoundary from './ErrorBoundary'
import App from './App'

// 应用入口：把 React 主应用挂载到 public/index.html 中的 root 节点。
const root = createRoot(document.getElementById('root'))
root.render(<ErrorBoundary><App /></ErrorBoundary>)
