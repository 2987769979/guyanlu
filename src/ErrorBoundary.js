import React from 'react'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'

const GLOBAL_ERROR_ID = `global-error-${Date.now()}`

// 为相同错误生成稳定 ID，用来把重复报错合并成计数，而不是刷满页面。
function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return `error-${hash >>> 0}`
}

// 本地 file URL 太长，展示前压缩成文件名和行列号，方便在弹窗里阅读。
function compactStack(stack) {
  return (stack || '').replace(/file:\/\/\/.*?([^/\\]+:\d+:\d+)/g, '$1')
}

// 捕获 React 边界之外的运行时错误，并在页面右侧追加可复制的错误卡片。
function showGlobalError(err, type) {
  if (!err?.name || !err?.message) return
  const errorId = hashString(`${err.name}:${err.message}`)
  let cardEl = document.getElementById(errorId)

  if (cardEl) {
    let countEl = cardEl.querySelector('.global-error-count')
    if (!countEl) {
      countEl = document.createElement('span')
      countEl.className = 'global-error-count'
      countEl.textContent = '2'
      cardEl.querySelector('.global-error-title')?.prepend(countEl)
    } else {
      countEl.textContent = String(parseInt(countEl.textContent, 10) + 1)
    }
    return
  }

  let containerEl = document.getElementById(GLOBAL_ERROR_ID)
  if (!containerEl) {
    containerEl = document.createElement('div')
    containerEl.id = GLOBAL_ERROR_ID
    containerEl.className = 'global-error'
    document.body.appendChild(containerEl)
  }

  const title = type === 'global' ? '未捕获错误' : '未处理的异步错误'
  const stack = compactStack(err.stack || err.message)
  cardEl = document.createElement('div')
  cardEl.id = errorId
  cardEl.className = 'global-error-card'

  const titleEl = document.createElement('div')
  titleEl.className = 'global-error-title'
  titleEl.textContent = title

  const stackEl = document.createElement('pre')
  stackEl.className = 'global-error-stack'
  stackEl.textContent = stack

  const copyBtnEl = document.createElement('button')
  copyBtnEl.className = 'global-error-btn'
  copyBtnEl.textContent = '复制'
  copyBtnEl.onclick = () => {
    if (window.utools?.copyText) window.utools.copyText(`${title}\n${stack}`)
    else navigator.clipboard?.writeText(`${title}\n${stack}`)
  }

  const closeBtnEl = document.createElement('button')
  closeBtnEl.className = 'global-error-btn'
  closeBtnEl.textContent = '关闭'
  closeBtnEl.onclick = () => cardEl?.parentNode?.removeChild(cardEl)

  const actionsEl = document.createElement('div')
  actionsEl.className = 'global-error-actions'
  actionsEl.appendChild(copyBtnEl)
  actionsEl.appendChild(closeBtnEl)

  const headerEl = document.createElement('div')
  headerEl.className = 'global-error-header'
  headerEl.appendChild(titleEl)
  headerEl.appendChild(actionsEl)

  cardEl.appendChild(headerEl)
  cardEl.appendChild(stackEl)
  containerEl.appendChild(cardEl)
}

// React 渲染兜底：组件树崩溃时展示错误详情，避免整页白屏。
export default class ErrorBoundary extends React.Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    error.stack = compactStack(error.stack)
    return { error }
  }

  componentDidMount() {
    window.addEventListener('error', event => {
      if (event.error) showGlobalError(event.error, 'global')
    })
    window.addEventListener('unhandledrejection', event => {
      if (event.reason) showGlobalError(event.reason, 'promise')
    })
  }

  handleCopyError = () => {
    const error = this.state.error
    if (!error) return
    if (window.utools?.copyText) window.utools.copyText(`React 渲染错误\n${error.stack}`)
    else navigator.clipboard?.writeText(`React 渲染错误\n${error.stack}`)
  }

  render() {
    if (this.state.error) {
      return (
        <div className='render-error-alert'>
          <Alert
            variant='filled'
            severity='error'
            action={<Button onClick={this.handleCopyError} color='inherit'>复制</Button>}
          >
            <AlertTitle>React 渲染错误</AlertTitle>
            <pre>{this.state.error.stack}</pre>
          </Alert>
        </div>
      )
    }
    return this.props.children
  }
}
