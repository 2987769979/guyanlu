/*
 * uTools preload bridge.
 * Keep Node/Electron capabilities behind controlled functions and expose only
 * small helpers that the React UI can safely call.
 */
const { clipboard } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')

const IFIND_API_BASE = 'https://quantapi.51ifind.com/api/v1'
const EASTMONEY_UT = '7eea3edcaed734bea9cbfc24409ed989'
const EASTMONEY_SPOT_FIELDS = 'f12,f14,f2,f3,f5,f6,f8,f15,f16,f17,f18'
const EASTMONEY_ULIST_ENDPOINTS = [
  'https://push2.eastmoney.com/api/qt/ulist.np/get',
  'http://push2.eastmoney.com/api/qt/ulist.np/get'
]
const EASTMONEY_ULIST_ENDPOINT = EASTMONEY_ULIST_ENDPOINTS[0]
const EASTMONEY_CLIST_ENDPOINTS = [
  'https://82.push2.eastmoney.com/api/qt/clist/get',
  'https://push2.eastmoney.com/api/qt/clist/get',
  'http://82.push2.eastmoney.com/api/qt/clist/get',
  'http://push2.eastmoney.com/api/qt/clist/get'
]
const EASTMONEY_CLIST_FIELDS = 'f12,f14,f2,f3,f5,f6,f8,f15,f16,f17,f18'
const EASTMONEY_A_SHARE_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'
const EASTMONEY_STOCK_LIST_ENDPOINTS = [
  'https://push2.eastmoney.com/api/qt/clist/get',
  'https://57.push2.eastmoney.com/api/qt/clist/get',
  'https://80.push2.eastmoney.com/api/qt/clist/get',
  'http://push2.eastmoney.com/api/qt/clist/get'
]
const EASTMONEY_STOCK_LIST_FS_CANDIDATES = [
  {
    source: 'eastmoney_clist_spot',
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'
  },
  {
    source: 'eastmoney_clist_spot_alt',
    fs: 'm:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:81+s:262144+f:!2'
  }
]
const EASTMONEY_STOCK_LIST_FIELDS = 'f12,f13,f14'
const EASTMONEY_STOCK_LIST_HEADERS = {
  Referer: 'https://quote.eastmoney.com/center/gridlist.html',
  Origin: 'https://quote.eastmoney.com',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache'
}
const STOCK_LIST_SH_PREFIXES = ['600', '601', '603', '605', '688', '689']
const STOCK_LIST_SZ_PREFIXES = ['000', '001', '002', '003', '300', '301']
const STOCK_LIST_BJ_PREFIXES = [
  '920', '430', '831', '832', '833', '834', '835', '836', '837', '838', '839',
  '870', '871', '872', '873', '889'
]
const TENCENT_FQKLINE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
const STOCK_REQUEST_DEFAULT_CONCURRENCY = 5
const STOCK_REQUEST_MIN_CONCURRENCY = 3
const STOCK_REQUEST_MAX_CONCURRENCY = 10
const REQUEST_JITTER_MIN_MS = 500
const REQUEST_JITTER_MAX_MS = 1500
const REQUEST_RETRY_BACKOFF_BASE_MS = 1000
const REQUEST_HOST_MIN_INTERVAL_MS = 350
const EASTMONEY_HISTORY_ENDPOINTS = [
  'https://push2his.eastmoney.com/api/qt/stock/kline/get',
  'http://push2his.eastmoney.com/api/qt/stock/kline/get'
]
const EASTMONEY_ULIST_BATCH_SIZE = 200
const EASTMONEY_ULIST_CONCURRENCY = 1
const EASTMONEY_REQUEST_RETRIES = 3
const EASTMONEY_RETRY_DELAY_MS = REQUEST_RETRY_BACKOFF_BASE_MS
const EASTMONEY_REQUEST_TIMEOUT_MS = 18000
const SNAPSHOT_REQUEST_RETRIES = 1
const SNAPSHOT_REQUEST_TIMEOUT_MS = 6000
const SNAPSHOT_REFRESH_MAX_MS = 45000
const SNAPSHOT_ULIST_TIMEOUT_MS = 30000
const SNAPSHOT_CLIST_ENDPOINTS = [
  'https://push2.eastmoney.com/api/qt/clist/get',
  'https://82.push2.eastmoney.com/api/qt/clist/get'
]
const EASTMONEY_ALL_MARKET_TIMEOUT_MS = 30000
const EASTMONEY_ALL_MARKET_CACHE_MS = 5 * 60 * 1000
const EASTMONEY_CLIST_PAGE_SIZE = 200
const FREE_DATA_CACHE_VERSION = 1
const FREE_HISTORY_RECENT_REFRESH_DAYS = 10
const FREE_HISTORY_DEFAULT_LIMIT = 80
const FREE_HISTORY_DEFAULT_WINDOW_DAYS = 30
const FREE_HISTORY_CACHE_DIR = path.join(os.homedir(), '.stock-review-cache')
const FREE_HISTORY_CACHE_FILE = path.join(FREE_HISTORY_CACHE_DIR, 'daily-bars-cache-v1.json')
const FULL_HISTORY_CACHE_DIR = path.join(FREE_HISTORY_CACHE_DIR, 'all-market-history')
const FULL_HISTORY_DAILY_CACHE_DIR = path.join(FULL_HISTORY_CACHE_DIR, 'daily')
const FULL_HISTORY_STOCK_LIST_FILE = path.join(FULL_HISTORY_CACHE_DIR, 'all-market-stocks.json')
const FULL_HISTORY_DATE_INDEX_FILE = path.join(FULL_HISTORY_CACHE_DIR, 'all-market-history-date-index.json')
const FULL_HISTORY_DAILY_CACHE_VERSION = 1
const FULL_HISTORY_DAILY_BATCH_SIZE = 80
const FULL_HISTORY_DAILY_CONCURRENCY = STOCK_REQUEST_DEFAULT_CONCURRENCY
const FULL_HISTORY_DEFAULT_DELAY_MS = 1500
const FULL_HISTORY_MIN_DELAY_MS = 500
const FULL_HISTORY_MAX_DELAY_MS = 60000
const EASTMONEY_ALL_MARKET_SCAN_RANGES = [
  { market: '0', start: 1, end: 3999 },
  { market: '0', start: 300000, end: 301999 },
  { market: '1', start: 600000, end: 605999 },
  { market: '1', start: 688000, end: 689999 },
  { market: '0', start: 920000, end: 920999 }
]
// 运行时缓存只存在于当前窗口进程，用于减少 token、全市场快照和历史同步状态的重复计算。
let accessTokenCache = {
  refreshToken: '',
  accessToken: '',
  expireAt: 0
}
let eastmoneyAllSpotCache = {
  expireAt: 0,
  result: null
}
let fullHistoryJob = createFullHistoryJob({ status: 'idle', message: '尚未开始全市场历史同步' })
const DESKTOP_WINDOW_BASE_URL = 'index.html'
const DESKTOP_WINDOW_FEATURE_CODES = new Set(['stock-review', 'stock-pool', 'risk-watch'])
let stockReviewDesktopWindow = null
let lastDesktopWindowUrl = ''

// 判断当前是否已经在独立桌面窗口中，避免启动入口递归创建新窗口。
function isDesktopWindowContext() {
  const api = getUtoolsApi()
  try {
    if (api?.getWindowType?.() === 'browser') return true
  } catch {}

  try {
    return new URL(window.location.href).searchParams.get('window') === 'desktop'
  } catch {
    return false
  }
}

function getUtoolsApi() {
  return typeof window !== 'undefined' ? window.utools : null
}

function hideUtoolsMainWindow() {
  const api = getUtoolsApi()
  if (!api?.hideMainWindow) return

  try {
    api.hideMainWindow(false)
  } catch {
    try {
      api.hideMainWindow()
    } catch {}
  }
}

function isUsableDesktopWindow(win) {
  if (!win) return false
  try {
    if (typeof win.isDestroyed === 'function') return !win.isDestroyed()
    return typeof win.show === 'function' || typeof win.focus === 'function'
  } catch {
    return false
  }
}

function focusDesktopWindow(win) {
  if (!isUsableDesktopWindow(win)) return false

  try {
    if (typeof win.isMinimized === 'function' && win.isMinimized() && typeof win.restore === 'function') {
      win.restore()
    }
    if (typeof win.show === 'function') win.show()
    if (typeof win.focus === 'function') win.focus()
    return true
  } catch {
    return false
  }
}

function buildDesktopWindowUrl() {
  return `${DESKTOP_WINDOW_BASE_URL}?window=desktop&launch=${Date.now()}`
}

function clearDesktopWindowReference(win) {
  if (!win || stockReviewDesktopWindow === win) {
    stockReviewDesktopWindow = null
  }
}

// 监听窗口关闭和加载失败，及时清理引用或尝试重新加载桌面页面。
function attachDesktopWindowEvents(win) {
  if (!win?.on) return
  const clear = () => clearDesktopWindowReference(win)
  try {
    win.on('close', clear)
    win.on('closed', clear)
  } catch {}

  const webContents = win.webContents
  if (!webContents?.on) return
  try {
    webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      if (typeof console !== 'undefined') {
        console.warn('[desktop-window] load failed', errorCode, errorDescription)
      }
      setTimeout(() => reloadDesktopWindow(win), 500)
    })
    webContents.on('render-process-gone', clear)
  } catch {}
}

function reloadDesktopWindow(win) {
  if (!isUsableDesktopWindow(win)) return false
  const url = buildDesktopWindowUrl()
  lastDesktopWindowUrl = url
  try {
    if (typeof win.loadURL === 'function') {
      win.loadURL(url)
      return true
    }
    if (typeof win.loadFile === 'function') {
      win.loadFile(DESKTOP_WINDOW_BASE_URL, { query: { window: 'desktop', launch: String(Date.now()) } })
      return true
    }
    if (typeof win.webContents?.loadURL === 'function') {
      win.webContents.loadURL(url)
      return true
    }
    if (typeof win.webContents?.reloadIgnoringCache === 'function') {
      win.webContents.reloadIgnoringCache()
      return true
    }
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[desktop-window] reload failed', error)
  }
  return false
}

// 独立窗口打开后检查 React 是否挂载成功，没挂上时自动重载一次。
function verifyDesktopWindowLoaded(win, attempt = 0) {
  if (!isUsableDesktopWindow(win)) return
  setTimeout(async () => {
    if (!isUsableDesktopWindow(win)) return
    const webContents = win.webContents
    if (typeof webContents?.executeJavaScript !== 'function') return
    try {
      const mounted = await webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-stock-review-app=\"desktop\"]'))",
        true
      )
      if (mounted) return
    } catch {
      return
    }

    if (attempt >= 1) return
    if (typeof console !== 'undefined') console.warn('[desktop-window] app content not mounted, reload once')
    if (reloadDesktopWindow(win)) verifyDesktopWindowLoaded(win, attempt + 1)
  }, attempt ? 3000 : 1800)
}

function openDesktopWindow(options = {}) {
  hideUtoolsMainWindow()

  if (focusDesktopWindow(stockReviewDesktopWindow)) {
    if (options.forceReload) {
      reloadDesktopWindow(stockReviewDesktopWindow)
    }
    if (options.verify !== false) {
      verifyDesktopWindowLoaded(stockReviewDesktopWindow)
    }
    return stockReviewDesktopWindow
  }

  clearDesktopWindowReference(stockReviewDesktopWindow)
  const api = getUtoolsApi()
  if (!api?.createBrowserWindow) return null

  lastDesktopWindowUrl = buildDesktopWindowUrl()
  stockReviewDesktopWindow = api.createBrowserWindow(lastDesktopWindowUrl, {
    width: 1600,
    height: 900,
    minWidth: 1366,
    minHeight: 760,
    center: true,
    show: true,
    backgroundColor: '#f5f7fb',
    title: '股研录',
    webPreferences: {
      preload: 'preload.js',
      contextIsolation: false,
      nodeIntegration: false
    }
  }, () => {
    focusDesktopWindow(stockReviewDesktopWindow)
    verifyDesktopWindowLoaded(stockReviewDesktopWindow)
  })

  attachDesktopWindowEvents(stockReviewDesktopWindow)
  verifyDesktopWindowLoaded(stockReviewDesktopWindow)

  return stockReviewDesktopWindow
}

function setupDesktopWindowLauncher() {
  if (isDesktopWindowContext()) return

  const api = getUtoolsApi()
  if (!api?.onPluginEnter) return

  api.onPluginEnter(action => {
    const code = action?.code
    if (code && !DESKTOP_WINDOW_FEATURE_CODES.has(code)) return
    openDesktopWindow({ verify: true })
  })
}

setupDesktopWindowLauncher()

// 所有外部行情请求共用 agent 和主机锁，控制并发与请求间隔，降低被限流概率。
const HTTP_AGENT = new http.Agent({ keepAlive: false, maxSockets: STOCK_REQUEST_MAX_CONCURRENCY })
const HTTPS_AGENT = new https.Agent({ keepAlive: false, maxSockets: STOCK_REQUEST_MAX_CONCURRENCY })
const requestHostLocks = new Map()
const requestHostLastStartAt = new Map()

function normalizeTimeoutMs(value, fallback = EASTMONEY_REQUEST_TIMEOUT_MS) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback
}

function normalizeDeadlineAt(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function isDeadlineExceeded(deadlineAt) {
  const deadline = normalizeDeadlineAt(deadlineAt)
  return Boolean(deadline && Date.now() >= deadline)
}

function getRemainingDeadlineMs(deadlineAt, fallback = Infinity) {
  const deadline = normalizeDeadlineAt(deadlineAt)
  if (!deadline) return fallback
  return Math.max(0, deadline - Date.now())
}

function createDeadlineError(label = '请求') {
  const error = new Error(`${label}超过最大等待时间`)
  error.code = 'ETIMEDOUT'
  return error
}

function timeoutWithinDeadline(timeoutMs, deadlineAt, label = '请求') {
  const timeout = normalizeTimeoutMs(timeoutMs)
  const deadline = normalizeDeadlineAt(deadlineAt)
  if (!deadline) return timeout
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw createDeadlineError(label)
  return Math.max(1, Math.min(timeout, remaining))
}

function clampStockRequestConcurrency(value, fallback = STOCK_REQUEST_DEFAULT_CONCURRENCY) {
  const number = Number(value)
  const concurrency = Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback
  return Math.max(STOCK_REQUEST_MIN_CONCURRENCY, Math.min(STOCK_REQUEST_MAX_CONCURRENCY, concurrency))
}

function randomDelayMs(min = REQUEST_JITTER_MIN_MS, max = REQUEST_JITTER_MAX_MS) {
  const lower = Math.max(0, Math.trunc(min))
  const upper = Math.max(lower, Math.trunc(max))
  return lower + Math.floor(Math.random() * (upper - lower + 1))
}

function requestLogUrl(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return String(url || '').slice(0, 160)
  }
}

function errorMessage(error) {
  return String(error?.message || error || 'request failed')
}

function historyDisplayError(error) {
  if (isRetryableRequestError(error)) {
    return '网络中断或接口限流，已记录失败，可稍后补跑'
  }
  return errorMessage(error)
}

function isRetryableRequestError(error) {
  const code = String(error?.code || '').toUpperCase()
  const message = errorMessage(error).toLowerCase()
  const statusCode = Number(error?.statusCode || error?.status || 0)
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE'].includes(code)) return true
  if (message.includes('socket hang up')) return true
  if (message.includes('timeout') || message.includes('timed out')) return true
  return statusCode === 429 || (statusCode >= 500 && statusCode < 600)
}

function createHttpError(statusCode, text) {
  const error = new Error(`HTTP ${statusCode}: ${String(text || '').slice(0, 240)}`)
  error.statusCode = statusCode
  return error
}

function requestHostKey(url) {
  try {
    return new URL(url).host
  } catch {
    return 'default'
  }
}

async function waitForRequestSlot(url, minIntervalMs = REQUEST_HOST_MIN_INTERVAL_MS) {
  const host = requestHostKey(url)
  const interval = Math.max(0, Math.trunc(Number(minIntervalMs) || 0))
  const previous = requestHostLocks.get(host) || Promise.resolve()
  let release
  const current = new Promise(resolve => {
    release = resolve
  })
  const chained = previous.catch(() => {}).then(() => current)
  requestHostLocks.set(host, chained)
  await previous.catch(() => {})

  try {
    const lastStartAt = requestHostLastStartAt.get(host) || 0
    const waitMs = Math.max(0, lastStartAt + interval - Date.now())
    if (waitMs) await sleep(waitMs)
    requestHostLastStartAt.set(host, Date.now())
  } finally {
    release()
    if (requestHostLocks.get(host) === chained) {
      requestHostLocks.delete(host)
    }
  }
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body)
    const req = https.request(url, {
      method: 'POST',
      agent: HTTPS_AGENT,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Connection: 'close',
        ...headers
      },
      timeout: 30000
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = text ? JSON.parse(text) : {}
        } catch (error) {
          reject(new Error(`同花顺接口返回非JSON内容：${text.slice(0, 240)}`))
          return
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`同花顺HTTP ${res.statusCode}：${json.errmsg || json.message || text.slice(0, 240)}`))
          return
        }
        resolve(json)
      })
    })

    req.on('timeout', () => {
      const error = new Error('iFinD request timeout')
      error.code = 'ETIMEDOUT'
      req.destroy(error)
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function getJson(url, headers = {}, timeout = EASTMONEY_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const client = String(url).startsWith('http://') ? http : https
    const timeoutMs = normalizeTimeoutMs(timeout)
    const req = client.request(url, {
      method: 'GET',
      agent: client === http ? HTTP_AGENT : HTTPS_AGENT,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'http://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Connection: 'close',
        ...headers
      },
      timeout: timeoutMs
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('aborted', () => {
        const error = new Error('response aborted')
        error.code = 'ECONNRESET'
        reject(error)
      })
      res.on('error', reject)
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(createHttpError(res.statusCode, text))
          return
        }
        let jsonText = text.trim()
        const jsonp = jsonText.match(/^[^(]+\((.*)\);?$/s)
        if (jsonp) jsonText = jsonp[1]
        try {
          resolve(JSON.parse(jsonText))
        } catch (error) {
          reject(new Error(`接口返回非JSON内容：${text.slice(0, 240)}`))
        }
      })
    })
    req.on('timeout', () => {
      const error = new Error(`request timeout after ${timeoutMs}ms`)
      error.code = 'ETIMEDOUT'
      req.destroy(error)
    })
    req.on('error', reject)
    req.end()
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 外部接口统一走重试、退避、截止时间和错误标记，调用方只需要关心业务结果。
async function requestWithRetry(requestFn, options = {}) {
  const retries = Math.max(0, Math.trunc(Number.isFinite(Number(options.retries)) ? Number(options.retries) : EASTMONEY_REQUEST_RETRIES))
  const label = options.label || 'request'
  const logUrl = requestLogUrl(options.url)
  const deadlineAt = normalizeDeadlineAt(options.deadlineAt)
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (deadlineAt && Date.now() >= deadlineAt) {
      throw lastError || createDeadlineError(label)
    }
    const jitterMs = randomDelayMs()
    await sleep(deadlineAt ? Math.min(jitterMs, Math.max(0, deadlineAt - Date.now())) : jitterMs)
    if (deadlineAt && Date.now() >= deadlineAt) {
      throw lastError || createDeadlineError(label)
    }
    try {
      await waitForRequestSlot(options.url, options.minIntervalMs ?? REQUEST_HOST_MIN_INTERVAL_MS)
      return await requestFn({ attempt, retries })
    } catch (error) {
      lastError = error
      if (options.url && !error.requestUrl) error.requestUrl = options.url
      error.attempts = attempt + 1
      if (attempt >= retries || !isRetryableRequestError(error)) break
      const baseDelay = EASTMONEY_RETRY_DELAY_MS * Math.pow(2, attempt)
      const delayMs = baseDelay + randomDelayMs(REQUEST_JITTER_MIN_MS, REQUEST_JITTER_MAX_MS)
      if (typeof options.onRetry === 'function') {
        try {
          options.onRetry({ attempt: attempt + 1, retries, delayMs, error, url: options.url })
        } catch {}
      }
      if (typeof console !== 'undefined' && options.logRetries !== false) {
        console.info(`[requestWithRetry] ${label} retry ${attempt + 1}/${retries} in ${delayMs}ms: ${errorMessage(error)} (${logUrl})`)
      }
      await sleep(deadlineAt ? Math.min(delayMs, Math.max(0, deadlineAt - Date.now())) : delayMs)
    }
  }
  throw lastError
}

async function getJsonWithRetry(url, headers = {}, retriesOrOptions = EASTMONEY_REQUEST_RETRIES, timeout = EASTMONEY_REQUEST_TIMEOUT_MS) {
  const options = retriesOrOptions && typeof retriesOrOptions === 'object'
    ? { ...retriesOrOptions }
    : { retries: retriesOrOptions, timeout }
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? options.timeout, EASTMONEY_REQUEST_TIMEOUT_MS)
  return requestWithRetry(
    () => getJson(url, headers, timeoutWithinDeadline(timeoutMs, options.deadlineAt, options.label || 'GET')),
    {
      ...options,
      timeoutMs,
      url,
      label: options.label || 'GET'
    }
  )
}

async function getFirstJson(urls, action) {
  const errors = []
  for (const url of urls) {
    try {
      return await getJsonWithRetry(url, {}, { label: action })
    } catch (error) {
      let host = url
      try {
        host = new URL(url).host
      } catch {}
      errors.push(`${host}：${error.message}`)
    }
  }
  throw new Error(`${action}失败：${errors.join('；')}`)
}

function createRequestProgress(total, label) {
  return {
    total,
    label,
    completed: 0,
    success: 0,
    failed: 0,
    retries: 0,
    logEvery: Math.max(10, Math.ceil(Math.max(1, total) / 100))
  }
}

function logRequestProgress(progress, force = false) {
  if (!progress || !progress.total || typeof console === 'undefined') return
  if (!force && progress.completed < progress.total && progress.completed % progress.logEvery !== 0) return
  console.info(`[${progress.label}] progress ${progress.completed}/${progress.total}, success ${progress.success}, failed ${progress.failed}, retries ${progress.retries}`)
}

// 简单并发队列：全市场股票请求量很大，用固定 worker 数逐项消费。
async function runRequestQueue(items, handler, options = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return
  const concurrency = clampStockRequestConcurrency(options.concurrency)
  let cursor = 0
  async function worker() {
    while (cursor < list.length) {
      if (typeof options.shouldStop === 'function' && options.shouldStop()) return
      const index = cursor
      cursor += 1
      await handler(list[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()))
}

function createFailedTask({ code, name, url, error, source, date, startDate, endDate, adjust }) {
  return {
    code: normalizeCacheCode(code || ''),
    name: String(name || code || '').trim(),
    url: String(url || error?.requestUrl || ''),
    errorMessage: errorMessage(error),
    errorCode: String(error?.code || error?.statusCode || ''),
    source: source || 'eastmoney_history',
    date: date || '',
    startDate: startDate || '',
    endDate: endDate || '',
    adjust: adjust || '',
    failedAt: new Date().toISOString()
  }
}

function assertIfindSuccess(payload, action) {
  const errorCode = Number(payload.errorcode ?? payload.errorCode ?? 0)
  if (Number.isFinite(errorCode) && errorCode !== 0) {
    throw new Error(`${action}失败：${payload.errmsg || payload.message || `errorcode ${errorCode}`}`)
  }
}

async function getAccessToken(refreshToken, force = false) {
  const token = String(refreshToken || '').trim()
  if (!token) throw new Error('请先填写同花顺 refresh_token')

  const now = Date.now()
  if (!force && accessTokenCache.refreshToken === token && accessTokenCache.accessToken && accessTokenCache.expireAt > now + 60 * 1000) {
    return accessTokenCache.accessToken
  }

  const payload = await postJson(`${IFIND_API_BASE}/get_access_token`, null, { refresh_token: token })
  assertIfindSuccess(payload, '获取access_token')
  const accessToken = payload?.data?.access_token || payload?.access_token
  if (!accessToken) throw new Error('同花顺接口未返回 access_token')

  accessTokenCache = {
    refreshToken: token,
    accessToken,
    expireAt: now + 6 * 24 * 60 * 60 * 1000
  }
  return accessToken
}

async function callIfindEndpoint({ refreshToken, endpoint, params, forceToken = false }) {
  const accessToken = await getAccessToken(refreshToken, forceToken)
  const payload = await postJson(`${IFIND_API_BASE}/${endpoint}`, params || {}, { access_token: accessToken })
  const errorCode = Number(payload.errorcode ?? payload.errorCode ?? 0)

  if (!forceToken && errorCode === -1302) {
    return callIfindEndpoint({ refreshToken, endpoint, params, forceToken: true })
  }

  assertIfindSuccess(payload, `调用${endpoint}`)
  return payload
}

function normalizeCode(code) {
  const text = String(code || '').trim().toUpperCase()
  if (!text) return ''
  if (text.includes('.')) return text
  if (text.startsWith('6')) return `${text}.SH`
  if (text.startsWith('8') || text.startsWith('4')) return `${text}.BJ`
  return `${text}.SZ`
}

function eastmoneySecid(code) {
  const fullCode = normalizeCode(code)
  const symbol = fullCode.split('.')[0]
  const suffix = fullCode.split('.')[1]
  const market = suffix === 'SH' ? '1' : '0'
  return { fullCode, symbol, secid: `${market}.${symbol}` }
}

function ymd(dateText, fallback) {
  return String(dateText || fallback || '')
    .replace(/-/g, '')
    .slice(0, 8)
}

function ymdToDateParam(dateText) {
  const text = ymd(dateText, '')
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : ''
}

function toNumber(value, fallback = 0) {
  const number = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(number) ? number : fallback
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function pctChange(close, previousClose) {
  return previousClose > 0 ? Math.round(((close - previousClose) / previousClose) * 10000) / 100 : 0
}

function tencentSymbol(code) {
  const fullCode = normalizeCode(code)
  const symbol = fullCode.split('.')[0]
  const suffix = fullCode.split('.')[1]
  const prefix = suffix === 'SH' ? 'sh' : suffix === 'BJ' ? 'bj' : 'sz'
  return { fullCode, symbol, marketCode: `${prefix}${symbol}` }
}

function tencentAdjustKey(adjust) {
  if (String(adjust) === '2') return 'hfq'
  if (String(adjust) === '0') return ''
  return 'qfq'
}

function buildTencentFqklineUrl(code, options = {}) {
  const { marketCode } = tencentSymbol(code)
  const adjustKey = tencentAdjustKey(options.adjust)
  const start = ymdToDateParam(options.startDate)
  const end = ymdToDateParam(options.endDate)
  const count = Number(options.count) || 1000
  const parts = [marketCode, 'day', start, end, String(count)]
  if (adjustKey) parts.push(adjustKey)

  const url = new URL(TENCENT_FQKLINE_ENDPOINT)
  url.searchParams.set('param', parts.join(','))
  return url.toString()
}

function tencentHeaders(code) {
  const { marketCode } = tencentSymbol(code)
  return {
    Referer: `https://gu.qq.com/${marketCode}/gp`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  }
}

function getTencentPayloadNode(payload, code) {
  const { marketCode } = tencentSymbol(code)
  return payload?.data?.[marketCode] || null
}

function getTencentKlineList(node, adjustKey) {
  if (!node) return []
  const preferredKey = adjustKey ? `${adjustKey}day` : 'day'
  return node[preferredKey] || node.qfqday || node.hfqday || node.day || []
}

function normalizeTencentKlineRows(code, payload, options = {}) {
  const { fullCode, marketCode } = tencentSymbol(code)
  const adjustKey = tencentAdjustKey(options.adjust)
  const node = getTencentPayloadNode(payload, code)
  const qt = node?.qt?.[marketCode] || []
  const stockName = qt[1] || fullCode
  const beg = ymd(options.startDate, '00000000')
  const end = ymd(options.endDate, '99999999')
  const sourceRows = getTencentKlineList(node, adjustKey)
    .filter(row => {
      const day = ymd(row?.[0], '')
      return day && day >= beg && day <= end
    })

  return sourceRows.map((row, index) => {
    const open = toNumber(row[1])
    const close = toNumber(row[2])
    const high = toNumber(row[3], close)
    const low = toNumber(row[4], close)
    const volume = toNumber(row[5])
    const previousClose = index > 0 ? toNumber(sourceRows[index - 1][2], close) : open
    return {
      time: row[0],
      stockName,
      open,
      close,
      high,
      low,
      volume,
      amount: Math.round(volume * close),
      changeRatio: pctChange(close, previousClose),
      turnoverRate: 0
    }
  })
}

function parseTencentQuoteDate(value, fallback) {
  const text = String(value || '')
  if (/^\d{8}/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }
  return fallback
}

function tencentQuoteToRow(code, payload, fallbackRow = null) {
  const { fullCode, marketCode } = tencentSymbol(code)
  const node = getTencentPayloadNode(payload, code)
  const qt = node?.qt?.[marketCode] || []
  const close = toNumber(qt[3], fallbackRow?.close || 0)
  if (!(close > 0)) return fallbackRow

  const splitAmount = String(qt[35] || '').split('/')
  const amountFromSplit = toNumber(splitAmount[2], 0)
  const amountFromField = toNumber(qt[37], 0) * 10000
  const previousClose = toNumber(qt[4], fallbackRow?.close || close)
  return {
    time: parseTencentQuoteDate(qt[30], fallbackRow?.time || new Date().toISOString().slice(0, 10)),
    stockName: qt[1] || fallbackRow?.stockName || fullCode,
    open: toNumber(qt[5], fallbackRow?.open || close),
    close,
    high: toNumber(qt[33], fallbackRow?.high || close),
    low: toNumber(qt[34], fallbackRow?.low || close),
    volume: toNumber(qt[36], toNumber(qt[6], fallbackRow?.volume || 0)),
    amount: amountFromSplit || amountFromField || fallbackRow?.amount || 0,
    changeRatio: toNumber(qt[32], pctChange(close, previousClose)),
    turnoverRate: toNumber(qt[38], fallbackRow?.turnoverRate || 0)
  }
}

async function fetchTencentHistory(options, fallbackError = null) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  const tables = []

  for (const code of codes) {
    const { fullCode } = tencentSymbol(code)
    const payload = await getJsonWithRetry(
      buildTencentFqklineUrl(code, {
        startDate: options.startDate,
        endDate: options.endDate,
        adjust: options.adjust,
        count: 1000
      }),
      tencentHeaders(code),
      options.retries ?? EASTMONEY_REQUEST_RETRIES,
      EASTMONEY_REQUEST_TIMEOUT_MS
    )
    const rows = normalizeTencentKlineRows(code, payload, options)
    if (!rows.length) {
      throw new Error(`腾讯行情未返回 ${fullCode} 日K数据`)
    }
    tables.push(buildTableFromRows(fullCode, rows))
  }

  return {
    ok: true,
    endpoint: fallbackError ? 'tencent_fqkline_fallback' : 'tencent_fqkline',
    fetchedAt: new Date().toISOString(),
    payload: { tables },
    meta: fallbackError ? {
      fallbackFrom: 'eastmoney',
      fallbackReason: fallbackError.message
    } : undefined
  }
}

async function fetchTencentSpot(options, fallbackError = null) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  const tables = []

  for (const code of codes) {
    const { fullCode } = tencentSymbol(code)
    const payload = await getJsonWithRetry(
      buildTencentFqklineUrl(code, { adjust: '1', count: 1 }),
      tencentHeaders(code),
      options.retries ?? EASTMONEY_REQUEST_RETRIES,
      EASTMONEY_REQUEST_TIMEOUT_MS
    )
    const [fallbackRow] = normalizeTencentKlineRows(code, payload, { adjust: '1' }).slice(-1)
    const row = tencentQuoteToRow(code, payload, fallbackRow)
    if (!row) {
      throw new Error(`腾讯行情未返回 ${fullCode} 快照数据`)
    }
    tables.push(buildTableFromRows(fullCode, [row]))
  }

  return {
    ok: true,
    endpoint: fallbackError ? 'tencent_spot_fallback' : 'tencent_spot',
    fetchedAt: new Date().toISOString(),
    payload: { tables },
    meta: fallbackError ? {
      fallbackFrom: 'eastmoney',
      fallbackReason: fallbackError.message
    } : undefined
  }
}

function buildTableFromRows(code, rows) {
  const table = {
    time: [],
    stockName: [],
    open: [],
    close: [],
    high: [],
    low: [],
    volume: [],
    amount: [],
    changeRatio: [],
    turnoverRate: []
  }
  rows.forEach(row => {
    table.time.push(row.time)
    table.stockName.push(row.stockName || '')
    table.open.push(row.open)
    table.close.push(row.close)
    table.high.push(row.high)
    table.low.push(row.low)
    table.volume.push(row.volume)
    table.amount.push(row.amount)
    table.changeRatio.push(row.changeRatio)
    table.turnoverRate.push(row.turnoverRate)
  })
  return { thscode: code, table }
}

function eastmoneySpotRowToTable(item, today) {
  return buildTableFromRows(normalizeCode(item.f12), [{
    time: today,
    stockName: item.f14,
    open: Number(item.f17),
    close: Number(item.f2),
    high: Number(item.f15),
    low: Number(item.f16),
    volume: Number(item.f5),
    amount: Number(item.f6),
    changeRatio: Number(item.f3),
    turnoverRate: Number(item.f8)
  }])
}

function hasAnyPrefix(value, prefixes) {
  return prefixes.some(prefix => String(value || '').startsWith(prefix))
}

function inferStockListMarket(symbol, f13, rawCode = '') {
  const text = String(symbol || '').trim().padStart(6, '0')
  const raw = String(rawCode || '').trim().toLowerCase()

  if (raw.startsWith('sh.') || hasAnyPrefix(text, STOCK_LIST_SH_PREFIXES)) return 'SH'
  if (raw.startsWith('sz.') || hasAnyPrefix(text, STOCK_LIST_SZ_PREFIXES)) return 'SZ'
  if (raw.startsWith('bj.') || hasAnyPrefix(text, STOCK_LIST_BJ_PREFIXES)) return 'BJ'
  if (String(f13) === '1') return 'SH'
  if (String(f13) === '0') return 'SZ'
  return ''
}

function normalizeStockListItem(raw, source) {
  const symbol = String(raw?.f12 || raw?.symbol || raw?.code || '').trim().padStart(6, '0')
  const name = String(raw?.f14 || raw?.name || raw?.stockName || '').trim()
  if (!/^\d{6}$/.test(symbol) || !name || symbol === '000000') return null

  const market = inferStockListMarket(symbol, raw?.f13, raw?.code || raw?.rawCode || '')
  if (!market) return null
  return {
    code: `${symbol}.${market}`,
    symbol,
    market,
    name,
    source
  }
}

function dedupeAndSortStockList(items) {
  const map = new Map()
  ;(items || []).forEach(item => {
    if (item?.code) map.set(item.code, item)
  })
  return Array.from(map.values()).sort((a, b) => (
    String(a.market || '').localeCompare(String(b.market || '')) ||
    String(a.symbol || '').localeCompare(String(b.symbol || ''))
  ))
}

function stockListItemsToHistoryItems(stocks) {
  return (stocks || []).map(item => ({
    code: normalizeCacheCode(item.code || ''),
    name: String(item.name || item.code || '').trim(),
    status: 'pending',
    rowCount: 0,
    failedCount: 0,
    skippedCount: 0,
    message: '未获取',
    updatedAt: null
  })).filter(item => item.code)
}

function buildEastmoneyStockListUrl(endpoint, fsFilter, page, pageSize) {
  const url = new URL(endpoint)
  url.searchParams.set('pn', String(page))
  url.searchParams.set('pz', String(pageSize))
  url.searchParams.set('po', '1')
  url.searchParams.set('np', '1')
  url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281')
  url.searchParams.set('fltt', '2')
  url.searchParams.set('invt', '2')
  url.searchParams.set('fid', 'f12')
  url.searchParams.set('fs', fsFilter)
  url.searchParams.set('fields', EASTMONEY_STOCK_LIST_FIELDS)
  url.searchParams.set('_', String(Date.now()))
  return url.toString()
}

async function fetchEastmoneyStockListPage(endpoint, fsFilter, page, pageSize, options = {}) {
  const requestUrl = buildEastmoneyStockListUrl(endpoint, fsFilter, page, pageSize)
  const payload = await getJsonWithRetry(
    requestUrl,
    EASTMONEY_STOCK_LIST_HEADERS,
    {
      retries: options.retries ?? SNAPSHOT_REQUEST_RETRIES,
      timeoutMs: options.timeoutMs ?? 10000,
      deadlineAt: options.deadlineAt,
      label: `eastmoney-stock-list page ${page}`,
      logRetries: options.logRetries
    }
  )
  return payload?.data || { diff: [], total: 0 }
}

async function fetchEastmoneyStockListFromCandidate(endpoint, candidate, options = {}) {
  const pageSize = Math.max(50, Math.min(500, Number(options.pageSize) || 500))
  const collected = []
  let page = 1
  let total = 0

  while (!isDeadlineExceeded(options.deadlineAt)) {
    const data = await fetchEastmoneyStockListPage(endpoint, candidate.fs, page, pageSize, options)
    const rows = Array.isArray(data.diff) ? data.diff : []
    if (page === 1) total = Number(data.total) || rows.length
    if (!rows.length) break

    rows.forEach(row => {
      const item = normalizeStockListItem(row, candidate.source)
      if (item) collected.push(item)
    })

    if (total && page * pageSize >= total) break
    page += 1
  }

  if (isDeadlineExceeded(options.deadlineAt)) throw createDeadlineError('eastmoney-stock-list')

  const stocks = dedupeAndSortStockList(collected)
  if (stocks.length < 1000) {
    throw new Error(`eastmoney stock list too small: ${stocks.length}, total=${total}`)
  }
  return {
    source: candidate.source,
    endpoint,
    stocks,
    meta: {
      total,
      stockCount: stocks.length,
      pages: page
    }
  }
}

async function fetchFullMarketAStockList(options = {}) {
  const errors = []
  const endpoints = Array.isArray(options.endpoints) && options.endpoints.length
    ? options.endpoints
    : EASTMONEY_STOCK_LIST_ENDPOINTS
  const candidates = Array.isArray(options.fsCandidates) && options.fsCandidates.length
    ? options.fsCandidates
    : EASTMONEY_STOCK_LIST_FS_CANDIDATES

  try {
    return await fetchBaostockStockList(options)
  } catch (error) {
    errors.push(`baostock: ${errorMessage(error)}`)
  }

  if (isDeadlineExceeded(options.deadlineAt)) {
    throw new Error(`all stock list sources failed: ${errors.join('; ')}`)
  }

  for (const candidate of candidates) {
    for (const endpoint of endpoints) {
      if (isDeadlineExceeded(options.deadlineAt)) {
        throw new Error(`all stock list sources failed: ${errors.join('; ')}`)
      }
      try {
        return await fetchEastmoneyStockListFromCandidate(endpoint, candidate, options)
      } catch (error) {
        errors.push(`${endpoint} / ${candidate.source}: ${errorMessage(error)}`)
      }
    }
  }

  throw new Error(`all stock list sources failed: ${errors.join('; ')}`)
}

function buildEastmoneyAllMarketSecids() {
  const secids = []
  EASTMONEY_ALL_MARKET_SCAN_RANGES.forEach(range => {
    for (let code = range.start; code <= range.end; code++) {
      secids.push(`${range.market}.${String(code).padStart(6, '0')}`)
    }
  })
  return secids
}

function buildEastmoneyUlistUrl(secids, endpoint = EASTMONEY_ULIST_ENDPOINT) {
  const url = new URL(endpoint)
  url.searchParams.set('secids', secids.join(','))
  url.searchParams.set('fields', EASTMONEY_SPOT_FIELDS)
  url.searchParams.set('fltt', '2')
  url.searchParams.set('invt', '2')
  url.searchParams.set('ut', EASTMONEY_UT)
  return url.toString()
}

function isValidEastmoneySpot(item) {
  const price = Number(item?.f2)
  const name = String(item?.f14 || '')
  return (
    item?.f12 &&
    Number.isFinite(price) &&
    price > 0 &&
    !name.includes('已切换') &&
    !name.includes('退市')
  )
}

function buildEastmoneyClistUrl(endpoint, page, pageSize) {
  const url = new URL(endpoint)
  url.searchParams.set('pn', String(page))
  url.searchParams.set('pz', String(pageSize))
  url.searchParams.set('po', '1')
  url.searchParams.set('np', '1')
  url.searchParams.set('ut', EASTMONEY_UT)
  url.searchParams.set('fltt', '2')
  url.searchParams.set('invt', '2')
  url.searchParams.set('fid', 'f12')
  url.searchParams.set('fs', EASTMONEY_A_SHARE_FS)
  url.searchParams.set('fields', EASTMONEY_CLIST_FIELDS)
  return url.toString()
}

async function fetchEastmoneyClistPage(page, pageSize, options = {}) {
  let lastError
  const endpoints = Array.isArray(options.endpoints) && options.endpoints.length
    ? options.endpoints
    : EASTMONEY_CLIST_ENDPOINTS
  for (const endpoint of endpoints) {
    if (isDeadlineExceeded(options.deadlineAt)) {
      throw lastError || createDeadlineError(`eastmoney-clist page ${page}`)
    }
    try {
      const requestUrl = buildEastmoneyClistUrl(endpoint, page, pageSize)
      const payload = await getJsonWithRetry(
        requestUrl,
        {},
        {
          retries: options.retries ?? EASTMONEY_REQUEST_RETRIES,
          timeoutMs: options.timeoutMs ?? EASTMONEY_REQUEST_TIMEOUT_MS,
          deadlineAt: options.deadlineAt,
          label: `eastmoney-clist page ${page}`,
          logRetries: options.logRetries
        }
      )
      return payload?.data || { diff: [], total: 0 }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function fetchEastmoneyClistSpot(options = {}) {
  const pageSize = Math.max(50, Math.min(500, Number(options.pageSize) || EASTMONEY_CLIST_PAGE_SIZE))
  const wantedCodes = new Set(String(options.codes || '').split(',').map(item => normalizeCode(item.trim()).split('.')[0]).filter(Boolean))
  const today = new Date().toISOString().slice(0, 10)
  const tables = []
  const seenCodes = new Set()
  let page = 1
  let total = 0
  let fetched = 0
  let failedPages = 0

  function collectRows(rows) {
    rows.filter(isValidEastmoneySpot).forEach(item => {
      const fullCode = normalizeCode(item.f12)
      const symbol = fullCode.split('.')[0]
      if (wantedCodes.size && !wantedCodes.has(symbol)) return
      if (seenCodes.has(symbol)) return
      seenCodes.add(symbol)
      tables.push(eastmoneySpotRowToTable(item, today))
    })
  }

  if (wantedCodes.size) {
    return fetchEastmoneySpot({ codes: Array.from(wantedCodes).join(',') })
  }

  let firstPage
  try {
    firstPage = await fetchEastmoneyClistPage(page, pageSize, options)
  } catch (error) {
    if (options.fallbackToUlist !== false && !wantedCodes.size) {
      const fallbackTimeoutMs = Math.max(
        1000,
        Math.min(
          Number(options.fallbackTimeoutMs) || 90000,
          getRemainingDeadlineMs(options.deadlineAt, Number(options.fallbackTimeoutMs) || 90000)
        )
      )
      const fallback = await fetchEastmoneyAllMarketSpot({
        ...options,
        concurrency: Math.max(1, Math.min(2, Number(options.concurrency) || 1)),
        batchSize: Number(options.batchSize) || EASTMONEY_ULIST_BATCH_SIZE,
        timeoutMs: fallbackTimeoutMs,
        requestTimeoutMs: options.timeoutMs ?? EASTMONEY_REQUEST_TIMEOUT_MS,
        deadlineAt: options.deadlineAt,
        logRetries: options.logRetries
      })
      return {
        ...fallback,
        endpoint: 'eastmoney_ulist_spot_fallback',
        meta: {
          ...(fallback.meta || {}),
          fallbackFrom: 'eastmoney_clist',
          fallbackReason: historyDisplayError(error)
        }
      }
    }
    throw error
  }
  const firstRows = Array.isArray(firstPage.diff) ? firstPage.diff : []
  total = Number(firstPage.total) || firstRows.length
  fetched += firstRows.length
  collectRows(firstRows)

  const totalPages = total > fetched ? Math.ceil(total / Math.max(firstRows.length || pageSize, 1)) : 1
  const remainingPages = []
  for (let nextPage = 2; nextPage <= totalPages; nextPage++) {
    remainingPages.push(nextPage)
  }

  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 6))
  let cursor = 0
  async function worker() {
    try {
      while (cursor < remainingPages.length && !isDeadlineExceeded(options.deadlineAt)) {
        const currentPage = remainingPages[cursor]
        cursor += 1
        try {
          const data = await fetchEastmoneyClistPage(currentPage, pageSize, options)
          const rows = Array.isArray(data.diff) ? data.diff : []
          fetched += rows.length
          collectRows(rows)
        } catch {
          failedPages += 1
        }
      }
    } catch {
      failedPages += 1
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, remainingPages.length || 1) }, () => worker()))

  if (!tables.length) {
    throw new Error('东方财富全市场快照返回为空')
  }

  return {
    ok: true,
    endpoint: 'eastmoney_clist_spot',
    fetchedAt: new Date().toISOString(),
    payload: { tables },
    meta: {
      total,
      pages: totalPages,
      failedPages,
      partial: failedPages > 0 || (total > 0 && fetched < total)
    }
  }
}

async function fetchEastmoneyUlistFromEndpoint(endpoint, secids, options = {}) {
  const payload = await getJsonWithRetry(
    buildEastmoneyUlistUrl(secids, endpoint),
    {},
    {
      retries: options.retries ?? EASTMONEY_REQUEST_RETRIES,
      timeoutMs: options.timeout ?? options.timeoutMs ?? EASTMONEY_REQUEST_TIMEOUT_MS,
      deadlineAt: options.deadlineAt,
      label: `eastmoney-ulist ${secids.length}`,
      logRetries: options.logRetries
    }
  )
  return payload?.data?.diff || []
}

async function fetchEastmoneyUlist(secids, options = {}) {
  let lastError
  try {
    for (const endpoint of EASTMONEY_ULIST_ENDPOINTS) {
      try {
        return await fetchEastmoneyUlistFromEndpoint(endpoint, secids, options)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  } catch (error) {
    if (secids.length <= 20) {
      if (options.allowPartial) return []
      throw error
    }
    const middle = Math.ceil(secids.length / 2)
    const left = await fetchEastmoneyUlist(secids.slice(0, middle), options).catch(err => {
      if (options.allowPartial) return []
      throw err
    })
    const right = await fetchEastmoneyUlist(secids.slice(middle), options).catch(err => {
      if (options.allowPartial) return []
      throw err
    })
    return [...left, ...right]
  }
}

async function fetchEastmoneyAllMarketSpot(options = {}) {
  const now = Date.now()
  if (!options.probe && eastmoneyAllSpotCache.result && eastmoneyAllSpotCache.expireAt > now) {
    return {
      ...eastmoneyAllSpotCache.result,
      fetchedAt: new Date().toISOString(),
      meta: {
        ...(eastmoneyAllSpotCache.result.meta || {}),
        cached: true
      }
    }
  }

  const secids = buildEastmoneyAllMarketSecids()
  const batchSize = Number(options.batchSize) || EASTMONEY_ULIST_BATCH_SIZE
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || EASTMONEY_ULIST_CONCURRENCY))
  const timeoutMs = timeoutWithinDeadline(
    Number(options.timeoutMs) || EASTMONEY_ALL_MARKET_TIMEOUT_MS,
    options.deadlineAt,
    'eastmoney-ulist fallback'
  )
  const probe = Boolean(options.probe)
  const today = new Date().toISOString().slice(0, 10)
  const tables = []
  const seenCodes = new Set()
  const batches = []
  let cursor = 0
  let completedBatches = 0
  let failedBatches = 0
  const startedAt = Date.now()

  for (let index = 0; index < secids.length; index += batchSize) {
    batches.push(secids.slice(index, index + batchSize))
  }

  async function runBatch(batch) {
    if (Date.now() - startedAt > timeoutMs || isDeadlineExceeded(options.deadlineAt)) return
    let rows = []
    try {
      rows = await fetchEastmoneyUlist(batch, {
        allowPartial: true,
        retries: options.retries ?? EASTMONEY_REQUEST_RETRIES,
        timeoutMs: options.requestTimeoutMs ?? EASTMONEY_REQUEST_TIMEOUT_MS,
        deadlineAt: options.deadlineAt,
        logRetries: options.logRetries
      })
      completedBatches += 1
    } catch {
      failedBatches += 1
      return
    }

    rows.filter(isValidEastmoneySpot).forEach(item => {
      if (seenCodes.has(item.f12)) return
      seenCodes.add(item.f12)
      tables.push(eastmoneySpotRowToTable(item, today))
    })
  }

  async function worker() {
    while (cursor < batches.length && Date.now() - startedAt <= timeoutMs && !isDeadlineExceeded(options.deadlineAt)) {
      if (probe && tables.length) return
      const batch = batches[cursor]
      cursor += 1
      await runBatch(batch)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  if (!tables.length) {
    if (eastmoneyAllSpotCache.result) {
      return {
        ...eastmoneyAllSpotCache.result,
        fetchedAt: new Date().toISOString(),
        meta: {
          ...(eastmoneyAllSpotCache.result.meta || {}),
          cached: true,
          stale: true
        }
      }
    }
    throw new Error('东方财富全市场扫描返回为空，请检查网络或稍后重试')
  }

  const result = {
    ok: true,
    endpoint: 'eastmoney_all_spot_ulist_scan',
    fetchedAt: new Date().toISOString(),
    payload: { tables },
    meta: {
      candidates: secids.length,
      batches: batches.length,
      completedBatches,
      failedBatches,
      elapsedMs: Date.now() - startedAt,
      partial: cursor < batches.length
    }
  }

  if (!options.probe) {
    eastmoneyAllSpotCache = {
      expireAt: Date.now() + EASTMONEY_ALL_MARKET_CACHE_MS,
      result
    }
  }

  return result
}

function buildEastmoneyHistoryUrl(endpoint, code, options = {}) {
  const { fullCode, secid } = eastmoneySecid(code)
  const url = new URL(endpoint)
  url.searchParams.set('secid', secid)
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')
  url.searchParams.set('klt', '101')
  url.searchParams.set('fqt', String(options.adjust || '1'))
  url.searchParams.set('beg', ymd(options.startDate, '19900101'))
  url.searchParams.set('end', ymd(options.endDate, '20500101'))
  url.searchParams.set('lmt', '1000')
  url.searchParams.set('ut', EASTMONEY_UT)
  return { fullCode, requestUrl: url.toString() }
}

async function fetchEastmoneyHistoryTable(code, options = {}) {
  const { fullCode } = eastmoneySecid(code)
  let payload
  let requestUrl = ''
  let lastError
  for (const endpoint of EASTMONEY_HISTORY_ENDPOINTS) {
    const built = buildEastmoneyHistoryUrl(endpoint, code, options)
    requestUrl = built.requestUrl
    try {
      payload = await getJsonWithRetry(requestUrl, {}, {
        retries: options.retries ?? EASTMONEY_REQUEST_RETRIES,
        timeoutMs: options.timeoutMs ?? options.timeout ?? EASTMONEY_REQUEST_TIMEOUT_MS,
        label: `eastmoney-history ${fullCode}`,
        onRetry: options.onRetry,
        logRetries: options.logRetries
      })
      break
    } catch (error) {
      if (!error.requestUrl) error.requestUrl = requestUrl
      lastError = error
    }
  }
  if (!payload) {
    throw lastError || new Error(`东方财富未返回 ${fullCode} 日K数据`)
  }
  const klines = payload?.data?.klines || []
  const rows = klines.map(line => {
    const [time, open, close, high, low, volume, amount, amplitude, changeRatio, change, turnoverRate] = String(line).split(',')
    return {
      time,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount),
      changeRatio: Number(changeRatio),
      turnoverRate: Number(turnoverRate)
    }
  })
  if (!rows.length) {
    const error = new Error(`东方财富未返回 ${fullCode} 日K数据`)
    error.requestUrl = requestUrl
    throw error
  }
  return buildTableFromRows(fullCode, rows)
}

// 按股票代码拉取东方财富历史K线；失败时可按配置回退到腾讯行情接口。
async function fetchEastmoneyHistory(options = {}) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  const concurrency = clampStockRequestConcurrency(options.concurrency)
  const tolerateErrors = options.tolerateErrors !== false || codes.length > 1
  const disableFallback = Boolean(options.disableFallback)
  const tables = []
  const errors = []
  const failedTasks = []
  const progress = createRequestProgress(codes.length, 'eastmoney-history')

  try {
    await runRequestQueue(codes, async code => {
      try {
        tables.push(await fetchEastmoneyHistoryTable(code, {
          ...options,
          onRetry: info => {
            progress.retries += 1
            if (typeof options.onRetry === 'function') options.onRetry(info)
          }
        }))
        progress.success += 1
      } catch (error) {
        const task = createFailedTask({
          code,
          name: code,
          error,
          source: 'eastmoney_history',
          startDate: options.startDate || '',
          endDate: options.endDate || '',
          adjust: String(options.adjust || '1')
        })
        failedTasks.push(task)
        errors.push(`${task.code || code}: ${task.errorMessage}`)
        progress.failed += 1
        if (!tolerateErrors) throw error
      } finally {
        progress.completed += 1
        logRequestProgress(progress)
      }
    }, { concurrency })
    logRequestProgress(progress, true)

    if (!tables.length) {
      throw new Error(errors[0] || '东方财富历史K线返回为空')
    }

    return {
      ok: true,
      endpoint: 'eastmoney_kline',
      fetchedAt: new Date().toISOString(),
      payload: { tables, errors, failedTasks },
      meta: errors.length ? {
        partial: true,
        failed: errors.length,
        failedTasks: failedTasks.length,
        concurrency,
        retries: EASTMONEY_REQUEST_RETRIES,
        timeoutMs: EASTMONEY_REQUEST_TIMEOUT_MS,
        errors: errors.slice(0, 8)
      } : undefined
    }
  } catch (error) {
    if (disableFallback) throw error
    return fetchTencentHistory(options, error)
  }
}

async function fetchEastmoneySpot(options) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  const allMarket = !codes.length
  if (allMarket) {
    return fetchEastmoneyAllMarketSpot(options)
  }

  try {
    const payload = await getJsonWithRetry(buildEastmoneyUlistUrl(codes.map(code => eastmoneySecid(code).secid)))
    const today = new Date().toISOString().slice(0, 10)
    const tables = (payload?.data?.diff || [])
      .filter(isValidEastmoneySpot)
      .map(item => eastmoneySpotRowToTable(item, today))
    if (!tables.length) {
      throw new Error('东方财富快照返回为空')
    }

    return {
      ok: true,
      endpoint: 'eastmoney_spot',
      fetchedAt: new Date().toISOString(),
      payload: { tables }
    }
  } catch (error) {
    return fetchTencentSpot(options, error)
  }
}

async function fetchPortfolioSpot(options = {}) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  if (!codes.length) {
    return {
      ok: true,
      endpoint: 'portfolio_spot_empty',
      fetchedAt: new Date().toISOString(),
      payload: { tables: [] },
      meta: { scope: 'portfolio' }
    }
  }

  try {
    const payload = await getJsonWithRetry(
      buildEastmoneyUlistUrl(codes.map(code => eastmoneySecid(code).secid)),
      {},
      options.retries ?? 1,
      options.timeoutMs ?? EASTMONEY_REQUEST_TIMEOUT_MS
    )
    const today = new Date().toISOString().slice(0, 10)
    const tables = (payload?.data?.diff || [])
      .filter(isValidEastmoneySpot)
      .map(item => eastmoneySpotRowToTable(item, today))
    if (!tables.length) {
      throw new Error('持仓快照返回为空')
    }

    return {
      ok: true,
      endpoint: 'portfolio_eastmoney_spot',
      fetchedAt: new Date().toISOString(),
      payload: { tables },
      meta: {
        scope: 'portfolio',
        intervalMs: Number(options.intervalMs) || 15000
      }
    }
  } catch (error) {
    const result = await fetchTencentSpot({ ...options, codes: codes.join(',') }, error)
    return {
      ...result,
      endpoint: `portfolio_${result.endpoint || 'spot'}`,
      meta: {
        ...(result.meta || {}),
        scope: 'portfolio',
        intervalMs: Number(options.intervalMs) || 15000
      }
    }
  }
}

function runPythonJson({ pythonPath, script, input, timeout = 120000, label = 'Python' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath || 'python', ['-c', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout = []
    const stderr = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${label} 调用超时`))
    }, timeout)

    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', error => {
      clearTimeout(timer)
      reject(new Error(`无法启动 Python：${error.message}`))
    })
    child.on('close', code => {
      clearTimeout(timer)
      const errText = Buffer.concat(stderr).toString('utf8')
      const outText = Buffer.concat(stdout).toString('utf8')
      if (code !== 0) {
        reject(new Error(errText || `Python 退出码 ${code}`))
        return
      }
      try {
        resolve(JSON.parse(outText))
      } catch (error) {
        reject(new Error(`${label} 返回非JSON内容：${outText.slice(0, 240)} ${errText.slice(0, 240)}`))
      }
    })
    child.stdin.write(JSON.stringify(input || {}))
    child.stdin.end()
  })
}

function installBaostockPackage(options = {}) {
  return new Promise((resolve, reject) => {
    const python = String(options.pythonPath || '').trim() || 'python'
    const child = spawn(python, ['-m', 'pip', 'install', 'baostock'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        PIP_NO_INPUT: '1'
      }
    })
    const stdout = []
    const stderr = []
    const timeout = Math.max(30000, Number(options.timeout) || 300000)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Baostock 安装超时，请检查 Python/pip 或网络环境'))
    }, timeout)

    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', error => {
      clearTimeout(timer)
      reject(new Error(`无法启动 Python：${error.message}`))
    })
    child.on('close', code => {
      clearTimeout(timer)
      const outText = Buffer.concat(stdout).toString('utf8')
      const errText = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        reject(new Error(errText || outText || `pip install baostock 退出码 ${code}`))
        return
      }
      resolve({
        ok: true,
        python,
        command: `${python} -m pip install baostock`,
        stdout: outText,
        stderr: errText
      })
    })
  })
}

const AKSHARE_SCRIPT = String.raw`
import json
import os
import sys

for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]:
    os.environ.pop(key, None)

def norm_code(code):
    text = str(code).strip().upper()
    if "." in text:
        return text
    if text.startswith("6"):
        return text + ".SH"
    if text.startswith("8") or text.startswith("4"):
        return text + ".BJ"
    return text + ".SZ"

def symbol_only(code):
    return norm_code(code).split(".")[0]

def table_from_rows(code, rows):
    table = {k: [] for k in ["time", "open", "close", "high", "low", "volume", "amount", "changeRatio", "turnoverRate"]}
    for row in rows:
        for key in table:
            table[key].append(row.get(key))
    return {"thscode": norm_code(code), "table": table}

def to_float(value):
    try:
        if value is None or value == "-":
            return 0
        return float(value)
    except Exception:
        return 0

try:
    import requests
    _requests_session_init = requests.Session.__init__
    def _stock_review_session_init(self, *args, **kwargs):
        _requests_session_init(self, *args, **kwargs)
        self.trust_env = False
        self.proxies = {}
    requests.Session.__init__ = _stock_review_session_init
    import akshare as ak
except Exception as exc:
    raise SystemExit("未安装 AKShare，请先执行：pip install akshare\n" + str(exc))

options = json.loads(sys.stdin.read() or "{}")
mode = options.get("mode", "history")
codes = [c.strip() for c in str(options.get("codes", "")).split(",") if c.strip()]
tables = []

if mode == "history":
    start_date = str(options.get("startDate", "")).replace("-", "")[:8]
    end_date = str(options.get("endDate", "")).replace("-", "")[:8]
    adjust = options.get("adjust", "")
    for code in codes:
        df = ak.stock_zh_a_hist(symbol=symbol_only(code), period="daily", start_date=start_date, end_date=end_date, adjust=adjust)
        rows = []
        for _, item in df.iterrows():
            rows.append({
                "time": str(item.get("日期", ""))[:10],
                "open": to_float(item.get("开盘")),
                "close": to_float(item.get("收盘")),
                "high": to_float(item.get("最高")),
                "low": to_float(item.get("最低")),
                "volume": to_float(item.get("成交量")),
                "amount": to_float(item.get("成交额")),
                "changeRatio": to_float(item.get("涨跌幅")),
                "turnoverRate": to_float(item.get("换手率")),
            })
        tables.append(table_from_rows(code, rows))
elif mode == "spot":
    raise SystemExit("AKShare spot 已禁用，请改用东财/Tencent 快照接口")
print(json.dumps({"tables": tables}, ensure_ascii=False))
`

const BAOSTOCK_HISTORY_SCRIPT = String.raw`
import json
import sys

def norm_code(code):
    text = str(code).strip().upper()
    if "." in text:
        return text
    if text.startswith("6"):
        return text + ".SH"
    if text.startswith("8") or text.startswith("4"):
        return text + ".BJ"
    return text + ".SZ"

def to_baostock_code(code):
    full = norm_code(code)
    symbol, suffix = full.split(".", 1)
    if suffix == "SH":
        return "sh." + symbol
    if suffix == "BJ":
        return "bj." + symbol
    return "sz." + symbol

def to_float(value):
    try:
        if value is None or value == "":
            return 0
        return float(value)
    except Exception:
        return 0

def table_from_rows(code, rows):
    table = {k: [] for k in ["time", "stockName", "open", "close", "high", "low", "volume", "amount", "changeRatio", "turnoverRate"]}
    for row in rows:
        for key in table:
            table[key].append(row.get(key))
    return {"thscode": norm_code(code), "table": table}

try:
    import baostock as bs
except Exception as exc:
    raise SystemExit("未安装 Baostock，请先执行：pip install baostock\n" + str(exc))

options = json.loads(sys.stdin.read() or "{}")
codes = [c.strip() for c in str(options.get("codes", "")).split(",") if c.strip()]
start_date = str(options.get("startDate", ""))[:10]
end_date = str(options.get("endDate", ""))[:10]
adjustflag = str(options.get("adjustflag", "2"))
fields = "date,code,open,high,low,close,preclose,volume,amount,pctChg,turn,isST"
tables = []
errors = []

login = bs.login()
if login.error_code != "0":
    raise SystemExit(login.error_msg or "Baostock 登录失败")

try:
    for code in codes:
        rows = []
        bs_code = to_baostock_code(code)
        result = bs.query_history_k_data_plus(
            bs_code,
            fields,
            start_date=start_date,
            end_date=end_date,
            frequency="d",
            adjustflag=adjustflag
        )
        if result.error_code != "0":
            errors.append({"code": norm_code(code), "message": result.error_msg})
            continue
        while result.next():
            item = result.get_row_data()
            row = dict(zip(result.fields, item))
            rows.append({
                "time": row.get("date", ""),
                "stockName": norm_code(code),
                "open": to_float(row.get("open")),
                "close": to_float(row.get("close")),
                "high": to_float(row.get("high")),
                "low": to_float(row.get("low")),
                "volume": to_float(row.get("volume")),
                "amount": to_float(row.get("amount")),
                "changeRatio": to_float(row.get("pctChg")),
                "turnoverRate": to_float(row.get("turn")),
                "preClose": to_float(row.get("preclose")),
                "isST": row.get("isST", "0"),
            })
        if rows:
            tables.append(table_from_rows(code, rows))
        else:
            errors.append({"code": norm_code(code), "message": "无历史K线数据"})
finally:
    bs.logout()

print(json.dumps({"tables": tables, "errors": errors}, ensure_ascii=False))
`

const BAOSTOCK_STOCK_LIST_SCRIPT = String.raw`
import json
import sys

SH_PREFIXES = ("600", "601", "603", "605", "688", "689")
SZ_PREFIXES = ("000", "001", "002", "003", "300", "301")
BJ_PREFIXES = (
    "920", "430", "831", "832", "833", "834", "835", "836", "837", "838", "839",
    "870", "871", "872", "873", "889",
)

def infer_market(symbol, raw_code=""):
    text = str(symbol or "").strip().zfill(6)
    raw = str(raw_code or "").strip().lower()
    if raw.startswith("sh.") or text.startswith(SH_PREFIXES):
        return "SH"
    if raw.startswith("sz.") or text.startswith(SZ_PREFIXES):
        return "SZ"
    if raw.startswith("bj.") or text.startswith(BJ_PREFIXES):
        return "BJ"
    return ""

def normalize_stock(symbol, name, source, raw_code=""):
    symbol = str(symbol or "").strip().zfill(6)
    name = str(name or "").strip()
    if not symbol or symbol == "000000" or not name:
        return None
    market = infer_market(symbol, raw_code)
    if not market:
        return None
    return {
        "code": f"{symbol}.{market}",
        "symbol": symbol,
        "market": market,
        "name": name,
        "source": source,
    }

def rows_to_dicts(rs):
    rows = []
    fields = list(getattr(rs, "fields", []) or [])
    while getattr(rs, "error_code", "0") == "0" and rs.next():
        values = rs.get_row_data()
        rows.append({fields[i]: values[i] for i in range(min(len(fields), len(values)))})
    return rows

def dedupe_and_sort(items):
    data = {}
    for item in items:
        if item and item.get("code"):
            data[item["code"]] = item
    return sorted(data.values(), key=lambda x: (x.get("market", ""), x.get("symbol", "")))

try:
    import baostock as bs
except Exception as exc:
    raise SystemExit("未安装 Baostock，请先执行：pip install baostock\n" + str(exc))

options = json.loads(sys.stdin.read() or "{}")
date = str(options.get("date") or "")[:10] or None
items = []
name_map = {}

login = bs.login()
if login.error_code != "0":
    raise SystemExit(login.error_msg or "Baostock 登录失败")

try:
    try:
        basic = bs.query_stock_basic()
        if getattr(basic, "error_code", "0") == "0":
            for row in rows_to_dicts(basic):
                raw_code = str(row.get("code") or "").strip().lower()
                symbol = raw_code.split(".")[-1].zfill(6)
                name = str(row.get("code_name") or row.get("codeName") or "").strip()
                if name:
                    name_map[raw_code] = name
                    item = normalize_stock(symbol, name, "baostock_stock_basic", raw_code)
                    if item:
                        items.append(item)
    except TypeError:
        pass

    all_stock = bs.query_all_stock(day=date) if date else bs.query_all_stock()
    if getattr(all_stock, "error_code", "0") == "0":
        for row in rows_to_dicts(all_stock):
            raw_code = str(row.get("code") or "").strip().lower()
            symbol = raw_code.split(".")[-1].zfill(6)
            name = str(row.get("code_name") or row.get("codeName") or name_map.get(raw_code, "")).strip()
            item = normalize_stock(symbol, name, "baostock_query_all_stock", raw_code)
            if item:
                items.append(item)
finally:
    bs.logout()

stocks = dedupe_and_sort(items)
if len(stocks) < 1000:
    raise SystemExit(f"Baostock 返回数量过少：{len(stocks)}；如今天不是交易日，可传入最近交易日")

print(json.dumps({"stocks": stocks, "stockCount": len(stocks)}, ensure_ascii=False))
`

function ensureCacheDir() {
  fs.mkdirSync(FREE_HISTORY_CACHE_DIR, { recursive: true })
}

function readFreeHistoryCache() {
  try {
    const text = fs.readFileSync(FREE_HISTORY_CACHE_FILE, 'utf8')
    const parsed = JSON.parse(text)
    if (!parsed || parsed.version !== FREE_DATA_CACHE_VERSION || typeof parsed.stocks !== 'object') {
      return { version: FREE_DATA_CACHE_VERSION, stocks: {} }
    }
    return parsed
  } catch {
    return { version: FREE_DATA_CACHE_VERSION, stocks: {} }
  }
}

function writeFreeHistoryCache(cache) {
  ensureCacheDir()
  const payload = {
    version: FREE_DATA_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    stocks: cache.stocks || {}
  }
  const tempFile = `${FREE_HISTORY_CACHE_FILE}.tmp`
  fs.writeFileSync(tempFile, JSON.stringify(payload))
  fs.renameSync(tempFile, FREE_HISTORY_CACHE_FILE)
  return payload
}

function normalizeCacheCode(code) {
  return normalizeCode(code).toUpperCase()
}

function rowsFromTable(table) {
  const code = normalizeCacheCode(table.thscode || table.code || table.thsCode || '')
  const data = table.table || table.data || table
  const times = toArray(data.time || data.tradeDate || table.time || table.times)
  const keys = Object.keys(data).filter(key => !['time', 'tradeDate', 'thscode', 'code'].includes(key))
  const length = Math.max(times.length, ...keys.map(key => toArray(data[key]).length), 0)
  const rows = []

  for (let index = 0; index < length; index++) {
    const row = { code, time: times[index] || times[0] || '' }
    keys.forEach(key => {
      const values = toArray(data[key])
      row[key] = values[index] ?? values[0]
    })
    if (row.time) rows.push(row)
  }
  return rows
}

function tableFromPlainRows(code, rows) {
  return buildTableFromRows(normalizeCacheCode(code), rows.map(row => ({
    time: row.time || row.tradeDate,
    stockName: row.stockName || row.name || normalizeCacheCode(code),
    open: toNumber(row.open),
    close: toNumber(row.close),
    high: toNumber(row.high),
    low: toNumber(row.low),
    volume: toNumber(row.volume),
    amount: toNumber(row.amount),
    changeRatio: toNumber(row.changeRatio ?? row.pctChg),
    turnoverRate: toNumber(row.turnoverRate ?? row.turn)
  })))
}

function mergeRowsByDate(existingRows, incomingRows, windowStart) {
  const map = new Map()
  ;[...(existingRows || []), ...(incomingRows || [])].forEach(row => {
    const time = String(row.time || row.tradeDate || '').slice(0, 10)
    if (!time || (windowStart && time < windowStart)) return
    map.set(time, {
      time,
      stockName: row.stockName || row.name || '',
      open: toNumber(row.open),
      close: toNumber(row.close),
      high: toNumber(row.high),
      low: toNumber(row.low),
      volume: toNumber(row.volume),
      amount: toNumber(row.amount),
      changeRatio: toNumber(row.changeRatio ?? row.pctChg),
      turnoverRate: toNumber(row.turnoverRate ?? row.turn)
    })
  })
  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time))
}

function getCacheRows(cache, code, startDate, endDate) {
  const rows = cache.stocks?.[normalizeCacheCode(code)]?.rows || []
  return rows.filter(row => (!startDate || row.time >= startDate) && (!endDate || row.time <= endDate))
}

function lastCachedDate(rows) {
  return rows.length ? rows[rows.length - 1].time : ''
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function chooseFreeHistoryCodes({ codes, spotTables, limit }) {
  if (codes.length) return codes.map(normalizeCacheCode)

  return spotTables
    .map(table => {
      const rows = rowsFromTable(table)
      const row = rows[rows.length - 1] || {}
      return {
        code: normalizeCacheCode(table.thscode),
        amount: toNumber(row.amount)
      }
    })
    .filter(item => item.code)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map(item => item.code)
}

async function fetchBaostockHistory(options) {
  const payload = await runPythonJson({
    pythonPath: options.pythonPath,
    script: BAOSTOCK_HISTORY_SCRIPT,
    input: {
      codes: options.codes,
      startDate: options.startDate,
      endDate: options.endDate,
      adjustflag: options.adjustflag || '2'
    },
    timeout: options.timeout || 180000,
    label: 'Baostock'
  })

  return {
    ok: true,
    endpoint: 'baostock_history',
    fetchedAt: new Date().toISOString(),
    payload,
    meta: payload.errors?.length ? {
      partial: true,
      failed: payload.errors.length,
      errors: payload.errors.slice(0, 8)
    } : undefined
  }
}

async function fetchBaostockStockList(options = {}) {
  const requestedTimeout = Number(options.baostockTimeoutMs ?? options.timeout) || 120000
  const timeout = Math.max(
    1000,
    Math.min(
      requestedTimeout,
      getRemainingDeadlineMs(options.deadlineAt, requestedTimeout)
    )
  )
  const payload = await runPythonJson({
    pythonPath: options.pythonPath,
    script: BAOSTOCK_STOCK_LIST_SCRIPT,
    input: {
      date: options.date || options.stockListDate || ''
    },
    timeout,
    label: 'Baostock stock list'
  })
  const stocks = dedupeAndSortStockList(payload.stocks || [])
  if (stocks.length < 1000) throw new Error(`Baostock 返回数量过少：${stocks.length}`)

  return {
    source: 'baostock',
    endpoint: 'baostock_stock_list',
    stocks,
    meta: {
      stockCount: stocks.length
    }
  }
}

async function fetchEastmoneyHistoryBatch(options = {}) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  const concurrency = clampStockRequestConcurrency(options.concurrency)
  const tables = []
  const errors = []
  const failedTasks = []
  const progress = createRequestProgress(codes.length, 'eastmoney-history-batch')

  await runRequestQueue(codes, async code => {
    try {
      tables.push(await fetchEastmoneyHistoryTable(code, {
        ...options,
        onRetry: info => {
          progress.retries += 1
          if (typeof options.onRetry === 'function') options.onRetry(info)
        }
      }))
      progress.success += 1
    } catch (error) {
      const task = createFailedTask({
        code,
        name: code,
        error,
        source: 'eastmoney_history_batch',
        date: options.startDate && options.startDate === options.endDate ? options.startDate : '',
        startDate: options.startDate || '',
        endDate: options.endDate || '',
        adjust: String(options.adjust || '1')
      })
      failedTasks.push(task)
      errors.push({ code: task.code || normalizeCacheCode(code), message: task.errorMessage, url: task.url, failedAt: task.failedAt })
      progress.failed += 1
    } finally {
      progress.completed += 1
      logRequestProgress(progress)
    }
  }, { concurrency })
  logRequestProgress(progress, true)

  return {
    ok: true,
    endpoint: 'eastmoney_history_batch',
    fetchedAt: new Date().toISOString(),
    payload: { tables, errors, failedTasks },
    meta: errors.length ? {
      partial: true,
      failed: errors.length,
      failedTasks: failedTasks.length,
      concurrency,
      retries: EASTMONEY_REQUEST_RETRIES,
      timeoutMs: EASTMONEY_REQUEST_TIMEOUT_MS,
      errors: errors.slice(0, 8)
    } : undefined
  }
}

async function fetchAkshareHistory(options) {
  const payload = await runPythonJson({
    pythonPath: options.pythonPath,
    script: AKSHARE_SCRIPT,
    input: {
      mode: 'history',
      codes: options.codes,
      startDate: options.startDate,
      endDate: options.endDate,
      adjust: options.adjust || ''
    },
    label: 'AKShare'
  })
  return {
    ok: true,
    endpoint: 'akshare_history',
    fetchedAt: new Date().toISOString(),
    payload
  }
}

async function fetchAkshareSpot(options) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  if (!codes.length) {
    return fetchEastmoneySpot(options)
  }

  try {
    const fallback = await fetchEastmoneyClistSpot({ codes: options.codes })
    return {
      ...fallback,
      endpoint: 'eastmoney_clist_spot_for_free_mode',
      meta: {
        ...(fallback.meta || {}),
        fallbackFor: 'free_mode_spot',
        reason: 'prefer_node_direct_spot'
      }
    }
  } catch (eastmoneyError) {
    try {
      return await fetchTencentSpot(options, eastmoneyError)
    } catch (tencentError) {
      throw new Error(`免费模式快照失败：东财直连和腾讯快照都不可用。东财错误：${eastmoneyError.message}；腾讯错误：${tencentError.message}`)
    }
  }
}

async function fetchAkshareSpotUnsafe(options) {
  return fetchAkshareSpot(options)
}

// 免费稳定模式：组合实时快照、历史缓存和多个免费后端，生成前端可直接使用的数据包。
async function fetchFreeStableData(options = {}) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean).map(normalizeCacheCode)
  const isAllMarket = !codes.length
  const historyLimit = Math.max(1, Math.min(1200, Number(options.historyLimit) || FREE_HISTORY_DEFAULT_LIMIT))
  const endDate = new Date().toISOString().slice(0, 10)
  const windowDays = Math.max(1, Math.min(30, Number(options.windowDays) || FREE_HISTORY_DEFAULT_WINDOW_DAYS))
  const configuredStart = String(options.startDate || '').slice(0, 10)
  const defaultWindowStart = daysAgo(windowDays)
  const windowStart = configuredStart && configuredStart > defaultWindowStart ? configuredStart : defaultWindowStart
  const cache = readFreeHistoryCache()
  let spot
  try {
    spot = await fetchEastmoneyClistSpot({ codes: codes.join(',') })
  } catch (error) {
    spot = await fetchAkshareSpot({
      codes: codes.join(','),
      pythonPath: options.pythonPath
    })
    spot.meta = {
      ...(spot.meta || {}),
      fallbackFrom: 'eastmoney_clist',
      fallbackReason: error.message
    }
  }
  const spotEndpoint = String(spot?.endpoint || '')
  const spotSource = spotEndpoint.startsWith('tencent')
    ? 'tencent'
    : spotEndpoint.startsWith('eastmoney')
      ? 'eastmoney_clist'
      : 'eastmoney_clist'
  const spotTables = Array.isArray(spot.payload?.tables) ? spot.payload.tables : []
  const historyCodes = chooseFreeHistoryCodes({ codes, spotTables, limit: historyLimit })
  const tablesByCode = new Map()
  const warningMessages = []
  let fetchedHistoryCodes = 0
  let cachedOnlyCodes = 0
  let eastmoneyHistoryCount = 0
  let baostockHistoryCount = 0
  let akshareHistoryCount = 0

  historyCodes.forEach(code => {
    const cachedRows = getCacheRows(cache, code, windowStart, endDate)
    if (cachedRows.length) tablesByCode.set(code, tableFromPlainRows(code, cachedRows))
  })

  const missingCodes = historyCodes.filter(code => {
    const cachedRows = getCacheRows(cache, code, windowStart, endDate)
    const lastDate = lastCachedDate(cachedRows)
    return !cachedRows.length || lastDate < addDays(endDate, -FREE_HISTORY_RECENT_REFRESH_DAYS)
  })

  const batches = []
  const batchSize = isAllMarket ? 40 : 80
  for (let index = 0; index < missingCodes.length; index += batchSize) {
    batches.push(missingCodes.slice(index, index + batchSize))
  }

  for (const batch of batches) {
    try {
      let history
      let historyBackend = 'eastmoney'
      const missingAfterEastmoney = []

      history = await fetchEastmoneyHistoryBatch({
        codes: batch.join(','),
        startDate: windowStart,
        endDate,
        adjust: options.eastmoneyAdjust || '1',
        concurrency: options.concurrency || STOCK_REQUEST_DEFAULT_CONCURRENCY
      })
      const eastmoneyTables = Array.isArray(history.payload?.tables) ? history.payload.tables : []
      const eastmoneyCodeSet = new Set(eastmoneyTables.map(table => normalizeCacheCode(table.thscode)))
      batch.forEach(code => {
        if (!eastmoneyCodeSet.has(normalizeCacheCode(code))) missingAfterEastmoney.push(code)
      })
      ;(history.payload?.errors || []).forEach(item => warningMessages.push(`${item.code}: ${item.message}`))

      const tables = Array.isArray(history.payload?.tables) ? history.payload.tables : []
      tables.forEach(table => {
        const code = normalizeCacheCode(table.thscode)
        const incomingRows = rowsFromTable(table)
        const previousRows = cache.stocks?.[code]?.rows || []
        const rows = mergeRowsByDate(previousRows, incomingRows, windowStart)
        cache.stocks[code] = {
          code,
          rows,
          updatedAt: new Date().toISOString(),
          source: historyBackend
        }
        tablesByCode.set(code, tableFromPlainRows(code, rows.filter(row => row.time >= windowStart && row.time <= endDate)))
        fetchedHistoryCodes += 1
        eastmoneyHistoryCount += 1
      })

      if (missingAfterEastmoney.length) {
        try {
          historyBackend = 'baostock'
          const fallback = await fetchBaostockHistory({
            codes: missingAfterEastmoney.join(','),
            startDate: windowStart,
            endDate,
            pythonPath: options.pythonPath,
            adjustflag: options.baostockAdjust || '2',
            timeout: isAllMarket ? 120000 : 90000
          })
          const fallbackTables = Array.isArray(fallback.payload?.tables) ? fallback.payload.tables : []
          const fallbackCodeSet = new Set(fallbackTables.map(table => normalizeCacheCode(table.thscode)))
          fallbackTables.forEach(table => {
            const code = normalizeCacheCode(table.thscode)
            const incomingRows = rowsFromTable(table)
            const previousRows = cache.stocks?.[code]?.rows || []
            const rows = mergeRowsByDate(previousRows, incomingRows, windowStart)
            cache.stocks[code] = {
              code,
              rows,
              updatedAt: new Date().toISOString(),
              source: historyBackend
            }
            tablesByCode.set(code, tableFromPlainRows(code, rows.filter(row => row.time >= windowStart && row.time <= endDate)))
            fetchedHistoryCodes += 1
            baostockHistoryCount += 1
          })
          ;(fallback.payload?.errors || []).forEach(item => warningMessages.push(`${item.code || 'baostock'}: ${item.message}`))

          const missingAfterBaostock = missingAfterEastmoney.filter(code => !fallbackCodeSet.has(normalizeCacheCode(code)))
          if (missingAfterBaostock.length) {
            historyBackend = 'akshare'
            const akFallback = await fetchAkshareHistory({
              codes: missingAfterBaostock.join(','),
              startDate: windowStart,
              endDate,
              pythonPath: options.pythonPath,
              adjust: options.akshareAdjust || 'qfq'
            })
            const akTables = Array.isArray(akFallback.payload?.tables) ? akFallback.payload.tables : []
            akTables.forEach(table => {
              const code = normalizeCacheCode(table.thscode)
              const incomingRows = rowsFromTable(table)
              const previousRows = cache.stocks?.[code]?.rows || []
              const rows = mergeRowsByDate(previousRows, incomingRows, windowStart)
              cache.stocks[code] = {
                code,
                rows,
                updatedAt: new Date().toISOString(),
                source: historyBackend
              }
              tablesByCode.set(code, tableFromPlainRows(code, rows.filter(row => row.time >= windowStart && row.time <= endDate)))
              fetchedHistoryCodes += 1
              akshareHistoryCount += 1
            })
          }
        } catch (error) {
          warningMessages.push(...missingAfterEastmoney.map(code => `${code}: fallback failed: ${error.message}`))
        }
      }
    } catch (error) {
      warningMessages.push(...batch.map(code => `${code}: ${error.message}`))
    }
  }

  historyCodes.forEach(code => {
    if (tablesByCode.has(code)) return
    const cachedRows = getCacheRows(cache, code, windowStart, endDate)
    if (cachedRows.length) {
      tablesByCode.set(code, tableFromPlainRows(code, cachedRows))
      cachedOnlyCodes += 1
      return
    }
    const spotTable = spotTables.find(table => normalizeCacheCode(table.thscode) === code)
    if (spotTable) {
      tablesByCode.set(code, spotTable)
    }
  })

  const historyCodeSet = new Set(historyCodes)
  spotTables.forEach(table => {
    const code = normalizeCacheCode(table.thscode)
    if (!isAllMarket || historyCodeSet.has(code)) return
    tablesByCode.set(code, table)
  })

  const realtimeRowsByCode = new Map()
  spotTables.forEach(table => {
    const code = normalizeCacheCode(table.thscode)
    const rows = rowsFromTable(table)
    const latest = rows[rows.length - 1]
    if (latest) realtimeRowsByCode.set(code, latest)
  })

  realtimeRowsByCode.forEach((row, code) => {
    if (!tablesByCode.has(code)) return
    const historyRows = rowsFromTable(tablesByCode.get(code))
    const mergedRows = mergeRowsByDate(historyRows, [row], windowStart)
    tablesByCode.set(code, tableFromPlainRows(code, mergedRows))
  })

  writeFreeHistoryCache(cache)

  const tables = Array.from(tablesByCode.values())
  if (!tables.length) {
    throw new Error('免费稳定模式未获取到可用数据，请确认免费快照接口与历史接口可用')
  }
  const finalHistoryCodes = new Set(tables.map(table => normalizeCacheCode(table.thscode)))
  const unresolvedCodes = historyCodes.filter(code => !finalHistoryCodes.has(normalizeCacheCode(code)))

  return {
    ok: true,
    endpoint: 'free_stable_bundle',
    fetchedAt: new Date().toISOString(),
    payload: { tables },
    meta: {
      allMarket: isAllMarket,
      spotSource,
      spotSize: spotTables.length,
      historyTarget: historyCodes.length,
      historyFetched: fetchedHistoryCodes,
      eastmoneyFetched: eastmoneyHistoryCount,
      baostockFetched: baostockHistoryCount,
      akshareFetched: akshareHistoryCount,
      cachedOnly: cachedOnlyCodes,
      failed: unresolvedCodes.length,
      errors: [...unresolvedCodes.map(code => `${code}: 历史补齐失败`), ...warningMessages].slice(0, 20),
      cacheFile: FREE_HISTORY_CACHE_FILE,
      partial: unresolvedCodes.length > 0 || (isAllMarket && spotTables.length > historyCodes.length)
    }
  }
}

function isFullHistoryActive(job = fullHistoryJob) {
  return ['preparing', 'running', 'stopping'].includes(job?.status)
}

function clampFullHistoryDelay(value) {
  return Math.max(
    FULL_HISTORY_MIN_DELAY_MS,
    Math.min(FULL_HISTORY_MAX_DELAY_MS, Number(value) || FULL_HISTORY_DEFAULT_DELAY_MS)
  )
}

function normalizeFullHistoryDate(value) {
  return ymdToDateParam(value)
}

// 创建全市场历史同步任务对象，前端轮询看到的状态都从这里派生。
function createFullHistoryJob(base = {}, items = []) {
  const rawDates = Array.isArray(base.dates) ? base.dates : []
  const retryTaskMap = base.retryTaskMap && typeof base.retryTaskMap === 'object'
    ? Object.fromEntries(Object.entries(base.retryTaskMap).map(([date, codes]) => [
      normalizeFullHistoryDate(date),
      Array.from(new Set((Array.isArray(codes) ? codes : []).map(normalizeCacheCode).filter(Boolean)))
    ]).filter(([date, codes]) => date && codes.length))
    : null
  return {
    id: base.id || `history-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: base.status || 'idle',
    message: base.message || '',
    startDate: base.startDate || '',
    endDate: base.endDate || '',
    adjust: String(base.adjust || '1'),
    delayMs: clampFullHistoryDelay(base.delayMs),
    concurrency: clampStockRequestConcurrency(base.concurrency || FULL_HISTORY_DAILY_CONCURRENCY),
    startedAt: base.startedAt || null,
    finishedAt: base.finishedAt || null,
    currentDate: base.currentDate || '',
    currentCode: base.currentCode || '',
    currentName: base.currentName || '',
    nextRequestAt: base.nextRequestAt || null,
    outputFile: base.outputFile || '',
    dailyDir: base.dailyDir || FULL_HISTORY_DAILY_CACHE_DIR,
    stockListFile: base.stockListFile || FULL_HISTORY_STOCK_LIST_FILE,
    dateIndexFile: base.dateIndexFile || FULL_HISTORY_DATE_INDEX_FILE,
    metaFile: base.metaFile || '',
    fetched: Number(base.fetched) || 0,
    failed: Number(base.failed) || 0,
    skipped: Number(base.skipped) || 0,
    processed: Number(base.processed) || 0,
    cancelRequested: Boolean(base.cancelRequested),
    errors: Array.isArray(base.errors) ? base.errors : [],
    failedTasks: Array.isArray(base.failedTasks) ? base.failedTasks : [],
    dailyFiles: Array.isArray(base.dailyFiles) ? base.dailyFiles : [],
    selectedOnly: Boolean(base.selectedOnly),
    selectedCodes: Array.isArray(base.selectedCodes) ? base.selectedCodes.map(normalizeCacheCode).filter(Boolean) : [],
    retryTaskMap,
    dates: rawDates.map(item => (typeof item === 'string' ? { date: item } : item)).map(item => ({
      date: normalizeFullHistoryDate(item.date || item.time || ''),
      status: item.status || 'pending',
      stockCount: Number(item.stockCount) || 0,
      processed: Number(item.processed) || 0,
      fetched: Number(item.fetched) || 0,
      failed: Number(item.failed) || 0,
      skipped: Number(item.skipped) || 0,
      fileName: item.fileName || '',
      filePath: item.filePath || '',
      message: item.message || '',
      startedAt: item.startedAt || null,
      updatedAt: item.updatedAt || null,
      finishedAt: item.finishedAt || null,
      failedTasks: Array.isArray(item.failedTasks) ? item.failedTasks : []
    })).filter(item => item.date),
    items: items.map(item => ({
      code: normalizeCacheCode(item.code || item.thscode || ''),
      name: String(item.name || item.stockName || item.code || item.thscode || '').trim(),
      status: item.status || 'pending',
      rowCount: Number(item.rowCount) || 0,
      failedCount: Number(item.failedCount) || 0,
      skippedCount: Number(item.skippedCount) || 0,
      message: item.message || '',
      updatedAt: item.updatedAt || null
    })).filter(item => item.code)
  }
}

// 将后台任务压缩成前端展示用快照，避免暴露 Promise 和过大的内部结构。
function buildFullHistorySnapshot(job = fullHistoryJob) {
  const items = Array.isArray(job?.items) ? job.items : []
  const dates = Array.isArray(job?.dates) ? job.dates : []
  const total = items.length
  const legacyFetched = items.filter(item => item.status === 'done').length
  const legacyFailed = items.filter(item => item.status === 'failed').length
  const legacyPending = items.filter(item => item.status === 'pending').length
  const recordTotal = dates.length ? dates.reduce((sum, item) => sum + (Number(item.stockCount) || total), 0) : total
  const processed = dates.length ? Number(job?.processed) || dates.reduce((sum, item) => sum + (Number(item.processed) || 0), 0) : legacyFetched + legacyFailed
  const fetched = dates.length ? Number(job?.fetched) || dates.reduce((sum, item) => sum + (Number(item.fetched) || 0), 0) : legacyFetched
  const failed = dates.length ? Number(job?.failed) || dates.reduce((sum, item) => sum + (Number(item.failed) || 0), 0) : legacyFailed
  const skipped = dates.length ? Number(job?.skipped) || dates.reduce((sum, item) => sum + (Number(item.skipped) || 0), 0) : items.filter(item => item.status === 'skipped').length
  const pending = dates.length ? Math.max(0, recordTotal - processed) : legacyPending
  const failedTasks = Array.isArray(job?.failedTasks) ? job.failedTasks : []

  return {
    id: job?.id || '',
    status: job?.status || 'idle',
    message: job?.message || '',
    startDate: job?.startDate || '',
    endDate: job?.endDate || '',
    adjust: job?.adjust || '1',
    delayMs: clampFullHistoryDelay(job?.delayMs),
    concurrency: clampStockRequestConcurrency(job?.concurrency || FULL_HISTORY_DAILY_CONCURRENCY),
    startedAt: job?.startedAt || null,
    finishedAt: job?.finishedAt || null,
    currentDate: job?.currentDate || '',
    currentCode: job?.currentCode || '',
    currentName: job?.currentName || '',
    nextRequestAt: job?.nextRequestAt || null,
    outputFile: job?.outputFile || '',
    dailyDir: job?.dailyDir || FULL_HISTORY_DAILY_CACHE_DIR,
    stockListFile: job?.stockListFile || FULL_HISTORY_STOCK_LIST_FILE,
    dateIndexFile: job?.dateIndexFile || FULL_HISTORY_DATE_INDEX_FILE,
    metaFile: job?.metaFile || '',
    total,
    stockTotal: total,
    dateTotal: dates.length,
    recordTotal,
    processed,
    fetched,
    failed,
    skipped,
    pending,
    progress: dates.length
      ? (recordTotal ? Math.round((processed / recordTotal) * 10000) / 100 : 0)
      : (total ? Math.round(((fetched + failed) / total) * 10000) / 100 : 0),
    errors: (job?.errors || []).slice(-20),
    failedTaskCount: failedTasks.length,
    failedTasks: failedTasks.slice(-200),
    dailyFiles: Array.isArray(job?.dailyFiles) ? job.dailyFiles : [],
    selectedOnly: Boolean(job?.selectedOnly),
    selectedCodes: Array.isArray(job?.selectedCodes) ? job.selectedCodes : [],
    retryTaskMap: job?.retryTaskMap || null,
    dates: dates.map(item => ({
      date: item.date,
      status: item.status,
      stockCount: Number(item.stockCount) || total,
      processed: Number(item.processed) || 0,
      fetched: Number(item.fetched) || 0,
      failed: Number(item.failed) || 0,
      skipped: Number(item.skipped) || 0,
      fileName: item.fileName || '',
      filePath: item.filePath || '',
      message: item.message || '',
      startedAt: item.startedAt || null,
      updatedAt: item.updatedAt || null,
      finishedAt: item.finishedAt || null,
      failedTaskCount: Array.isArray(item.failedTasks) ? item.failedTasks.length : 0
    })),
    items: items.map(item => ({
      code: item.code,
      name: item.name || item.code,
      status: item.status,
      rowCount: Number(item.rowCount) || 0,
      failedCount: Number(item.failedCount) || 0,
      skippedCount: Number(item.skippedCount) || 0,
      message: item.message || '',
      updatedAt: item.updatedAt || null
    }))
  }
}

function ensureFullHistoryDir() {
  fs.mkdirSync(FULL_HISTORY_CACHE_DIR, { recursive: true })
  fs.mkdirSync(FULL_HISTORY_DAILY_CACHE_DIR, { recursive: true })
}

function createFullHistoryOutputPaths(startDate, endDate) {
  ensureFullHistoryDir()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const range = `${ymd(startDate, '00000000')}_${ymd(endDate, '99999999')}`
  const base = `all-market-history-${range}-${timestamp}`
  return {
    outputFile: FULL_HISTORY_DAILY_CACHE_DIR,
    dailyDir: FULL_HISTORY_DAILY_CACHE_DIR,
    stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
    dateIndexFile: FULL_HISTORY_DATE_INDEX_FILE,
    metaFile: path.join(FULL_HISTORY_CACHE_DIR, `${base}.meta.json`)
  }
}

function atomicWriteJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tempFile = `${file}.tmp`
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tempFile, file)
  return payload
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeFullHistoryMeta(job = fullHistoryJob) {
  if (!job?.metaFile) return
  try {
    const payload = {
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      ...buildFullHistorySnapshot(job)
    }
    fs.writeFileSync(job.metaFile, JSON.stringify(payload, null, 2), 'utf8')
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[full-history] write meta failed', error)
  }
}

function appendFullHistoryRecord(file, record) {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
}

function extractFullHistoryItemsFromSpot(spot) {
  const tables = Array.isArray(spot?.payload?.tables) ? spot.payload.tables : []
  const map = new Map()

  tables.forEach(table => {
    const code = normalizeCacheCode(table.thscode || table.code || table.thsCode || '')
    if (!code || map.has(code)) return
    const rows = rowsFromTable(table)
    const latest = rows[rows.length - 1] || {}
    map.set(code, {
      code,
      name: latest.stockName || latest.name || code,
      status: 'pending',
      rowCount: 0,
      message: '未获取',
      updatedAt: null
    })
  })

  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
}

async function loadFullMarketHistoryItems() {
  const spot = await fetchEastmoneyClistSpot({
    codes: '',
    pageSize: 500,
    concurrency: 2
  })
  const items = extractFullHistoryItemsFromSpot(spot)
  if (!items.length) throw new Error('全市场股票列表为空，无法开始历史数据同步')
  return items
}

function buildFullHistoryRecord(item, table, job) {
  const rows = rowsFromTable(table)
    .filter(row => row.time)
    .map(row => ({
      time: String(row.time || '').slice(0, 10),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      volume: toNumber(row.volume),
      amount: toNumber(row.amount),
      changeRatio: toNumber(row.changeRatio ?? row.pctChg),
      turnoverRate: toNumber(row.turnoverRate ?? row.turn)
    }))

  return {
    code: item.code,
    name: item.name || item.code,
    startDate: job.startDate,
    endDate: job.endDate,
    adjust: job.adjust,
    rowCount: rows.length,
    fetchedAt: new Date().toISOString(),
    rows
  }
}

function addFullHistoryError(job, message) {
  if (!message) return
  job.errors.push(message)
  if (job.errors.length > 200) job.errors = job.errors.slice(-200)
}

function addFullHistoryFailedTask(job, dayEntry, task) {
  if (!task?.code) return
  if (!Array.isArray(job.failedTasks)) job.failedTasks = []
  if (!Array.isArray(dayEntry.failedTasks)) dayEntry.failedTasks = []
  job.failedTasks.push(task)
  dayEntry.failedTasks.push(task)
}

function buildFullMarketStockListPayload(items, source = 'eastmoney_clist') {
  const stocks = (items || []).map(item => {
    const code = normalizeCacheCode(item.code || item.thscode || '')
    const [symbol, market = ''] = code.split('.')
    return {
      code,
      symbol,
      market,
      name: String(item.name || item.stockName || code).trim(),
      source
    }
  }).filter(item => item.code)

  return {
    schemaVersion: FULL_HISTORY_DAILY_CACHE_VERSION,
    type: 'all_market_stock_list',
    source,
    generatedAt: new Date().toISOString(),
    stockCount: stocks.length,
    stocks
  }
}

function writeFullMarketStockList(items, source = 'eastmoney_clist') {
  ensureFullHistoryDir()
  return atomicWriteJson(FULL_HISTORY_STOCK_LIST_FILE, buildFullMarketStockListPayload(items, source))
}

function readFullMarketStockList() {
  const payload = readJsonFile(FULL_HISTORY_STOCK_LIST_FILE)
  if (!payload || !Array.isArray(payload.stocks)) return null

  const items = payload.stocks.map(item => ({
    code: normalizeCacheCode(item.code || item.thscode || ''),
    name: String(item.name || item.stockName || item.code || '').trim(),
    status: 'pending',
    rowCount: 0,
    failedCount: 0,
    message: '未获取',
    updatedAt: null
  })).filter(item => item.code)

  return items.length ? items : null
}

function readFullMarketStockListFromDailyCache() {
  const itemsByCode = new Map()
  const collect = payload => {
    const stocks = Array.isArray(payload?.stocks) ? payload.stocks : []
    stocks.forEach(item => {
      const code = normalizeCacheCode(item.code || item.thscode || '')
      if (!code || itemsByCode.has(code)) return
      itemsByCode.set(code, {
        code,
        name: String(item.name || item.stockName || item.code || code).trim(),
        status: 'pending',
        rowCount: 0,
        failedCount: 0,
        message: '来自本地每日缓存',
        updatedAt: null
      })
    })
  }

  const dateIndex = readFullHistoryDateIndex()
  Object.values(dateIndex?.dates || {}).forEach(entry => {
    const filePath = entry?.filePath || (entry?.date ? getFullHistoryDailyFile(entry.date) : '')
    if (filePath) collect(readJsonFile(filePath))
  })

  if (!itemsByCode.size && fs.existsSync(FULL_HISTORY_DAILY_CACHE_DIR)) {
    try {
      fs.readdirSync(FULL_HISTORY_DAILY_CACHE_DIR)
        .filter(fileName => fileName.endsWith('.json'))
        .forEach(fileName => collect(readJsonFile(path.join(FULL_HISTORY_DAILY_CACHE_DIR, fileName))))
    } catch {}
  }

  const items = Array.from(itemsByCode.values()).sort((a, b) => a.code.localeCompare(b.code))
  return items.length ? items : null
}

function getFullMarketStockListFallbackItems(previousItems = []) {
  if (Array.isArray(previousItems) && previousItems.length) return previousItems
  if (Array.isArray(fullHistoryJob?.items) && fullHistoryJob.items.length) {
    return fullHistoryJob.items.map(item => ({
      ...item,
      status: 'pending',
      message: item.message || '来自当前任务缓存'
    }))
  }
  return readFullMarketStockListFromDailyCache() || []
}

async function loadFullMarketHistoryItemsForDaily(options = {}) {
  ensureFullHistoryDir()
  const cachedItems = readFullMarketStockList()
  if (!options.force) {
    if (cachedItems?.length) return cachedItems
  }

  const maxDurationMs = normalizeTimeoutMs(options.maxDurationMs ?? SNAPSHOT_REFRESH_MAX_MS, SNAPSHOT_REFRESH_MAX_MS)
  const deadlineAt = Date.now() + maxDurationMs
  let result
  try {
    result = await fetchFullMarketAStockList({
      pageSize: 500,
      retries: SNAPSHOT_REQUEST_RETRIES,
      timeoutMs: options.timeoutMs ?? 10000,
      baostockTimeoutMs: options.baostockTimeoutMs ?? 25000,
      deadlineAt
    })
  } catch (error) {
    const fallbackItems = getFullMarketStockListFallbackItems(cachedItems || [])
    if (fallbackItems.length) {
      if (typeof console !== 'undefined') {
        console.warn('[full-history] stock list refresh failed, using cached list', error.message || error)
      }
      return fallbackItems.map(item => ({
        ...item,
        failedCount: Number(item.failedCount) || 0,
        message: item.message || '使用缓存清单'
      }))
    }
    throw new Error(`暂时无法加载全市场股票清单：${historyDisplayError(error)}`)
  }

  const items = stockListItemsToHistoryItems(result.stocks)
  if (!items.length) throw new Error('全市场股票列表为空，无法开始历史数据同步')
  writeFullMarketStockList(result.stocks, result.source || 'eastmoney_clist_stock_list')
  return items.map(item => ({
    ...item,
    failedCount: Number(item.failedCount) || 0,
    message: item.message || '未获取'
  }))
}

// Rebuild the all-market stock list from the latest Baostock result, falling back to Eastmoney.
async function refreshFullMarketStockListFromSnapshot(options = {}) {
  if (isFullHistoryActive()) throw new Error('全市场历史任务运行中，请先停止或等待完成后再刷新股票清单')
  ensureFullHistoryDir()

  const startedAt = Date.now()
  const maxDurationMs = normalizeTimeoutMs(options.maxDurationMs ?? SNAPSHOT_REFRESH_MAX_MS, SNAPSHOT_REFRESH_MAX_MS)
  const deadlineAt = startedAt + maxDurationMs
  const retries = Math.max(
    0,
    Math.trunc(Number.isFinite(Number(options.retries)) ? Number(options.retries) : SNAPSHOT_REQUEST_RETRIES)
  )
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? 10000, 10000)
  const previousStockCount = fs.existsSync(FULL_HISTORY_STOCK_LIST_FILE)
    ? (readFullMarketStockList() || []).length
    : 0

  try {
    fs.rmSync(FULL_HISTORY_STOCK_LIST_FILE, { force: true })
  } catch (error) {
    throw new Error(`清除旧股票清单失败：${error.message || error}`)
  }

  try {
    const result = await fetchFullMarketAStockList({
      pageSize: 500,
      retries,
      timeoutMs,
      baostockTimeoutMs: options.baostockTimeoutMs ?? 25000,
      deadlineAt
    })
    const items = stockListItemsToHistoryItems(result.stocks)
    if (!items.length) throw new Error('最新股票清单为空，未写入本地清单')

    writeFullMarketStockList(result.stocks, result.source || 'eastmoney_clist_stock_list')
    const sourceLabel = result.source === 'baostock' ? 'Baostock' : '东方财富'
    fullHistoryJob = createFullHistoryJob({
      ...fullHistoryJob,
      status: 'ready',
      stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
      dateIndexFile: FULL_HISTORY_DATE_INDEX_FILE,
      dailyDir: FULL_HISTORY_DAILY_CACHE_DIR,
      message: `已清除旧清单并通过 ${sourceLabel} 生成全市场股票清单：${items.length} 只`
    }, items)

    return {
      ...buildFullHistorySnapshot(fullHistoryJob),
      snapshotStockCount: items.length,
      previousStockCount,
      stockListUpdated: true,
      stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
      stockListSource: result.source,
      stockListEndpoint: result.endpoint,
      refreshFailed: false,
      fallbackUsed: false,
      refreshDurationMs: Date.now() - startedAt,
      maxDurationMs
    }
  } catch (error) {
    const displayError = historyDisplayError(error)
    fullHistoryJob = createFullHistoryJob({
      status: 'failed',
      stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
      dateIndexFile: FULL_HISTORY_DATE_INDEX_FILE,
      dailyDir: FULL_HISTORY_DAILY_CACHE_DIR,
      message: `刷新快照清单失败，旧清单已清除：${displayError}`,
      errors: [displayError]
    }, [])

    return {
      ...buildFullHistorySnapshot(fullHistoryJob),
      snapshotStockCount: 0,
      previousStockCount,
      stockListUpdated: false,
      stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
      refreshFailed: true,
      fallbackUsed: false,
      error: displayError,
      refreshDurationMs: Date.now() - startedAt,
      maxDurationMs
    }
  }
}

function formatLocalYmd(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalYmd(dateText) {
  const normalized = normalizeFullHistoryDate(dateText)
  if (!normalized) return null
  const [year, month, day] = normalized.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

function listFullHistoryWorkdays(startDate, endDate) {
  const start = parseLocalYmd(startDate)
  const end = parseLocalYmd(endDate)
  if (!start || !end || start > end) return []

  const dates = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) dates.push(formatLocalYmd(cursor))
  }
  return dates
}

function getFullHistoryDailyFile(date) {
  return path.join(FULL_HISTORY_DAILY_CACHE_DIR, `all-market-history-${date}.json`)
}

function readFullHistoryDateIndex() {
  const payload = readJsonFile(FULL_HISTORY_DATE_INDEX_FILE)
  if (!payload || typeof payload.dates !== 'object') {
    return {
      schemaVersion: FULL_HISTORY_DAILY_CACHE_VERSION,
      type: 'all_market_history_date_index',
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
      dailyDir: FULL_HISTORY_DAILY_CACHE_DIR,
      dates: {}
    }
  }
  return {
    ...payload,
    schemaVersion: payload.schemaVersion || FULL_HISTORY_DAILY_CACHE_VERSION,
    type: payload.type || 'all_market_history_date_index',
    stockListFile: payload.stockListFile || FULL_HISTORY_STOCK_LIST_FILE,
    dailyDir: payload.dailyDir || FULL_HISTORY_DAILY_CACHE_DIR,
    dates: payload.dates || {}
  }
}

function writeFullHistoryDateIndex(index) {
  return atomicWriteJson(FULL_HISTORY_DATE_INDEX_FILE, {
    ...index,
    schemaVersion: FULL_HISTORY_DAILY_CACHE_VERSION,
    type: 'all_market_history_date_index',
    updatedAt: new Date().toISOString(),
    stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
    dailyDir: FULL_HISTORY_DAILY_CACHE_DIR
  })
}

function updateFullHistoryDateIndex(date, dailyPayload) {
  const index = readFullHistoryDateIndex()
  index.dates[date] = {
    date,
    fileName: path.basename(dailyPayload.filePath),
    filePath: dailyPayload.filePath,
    adjust: dailyPayload.adjust,
    status: dailyPayload.status,
    stockCount: dailyPayload.stockCount,
    selectedOnly: Boolean(dailyPayload.selectedOnly),
    selectedCount: Number(dailyPayload.selectedCount) || 0,
    fetched: dailyPayload.fetched,
    failed: dailyPayload.failed,
    failedTaskCount: Array.isArray(dailyPayload.failedTasks) ? dailyPayload.failedTasks.length : 0,
    updatedAt: dailyPayload.generatedAt
  }
  return writeFullHistoryDateIndex(index)
}

function fullHistoryRowData(row, date) {
  return {
    time: String(row.time || date || '').slice(0, 10),
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    volume: toNumber(row.volume),
    amount: toNumber(row.amount),
    changeRatio: toNumber(row.changeRatio ?? row.pctChg),
    turnoverRate: toNumber(row.turnoverRate ?? row.turn)
  }
}

function markFullHistoryItemDay(item, date, ok, totalDays, message = '', skipped = false) {
  item.updatedAt = new Date().toISOString()
  if (ok) {
    item.rowCount = (Number(item.rowCount) || 0) + 1
    item.status = 'done'
  } else if (skipped) {
    // 请求成功但当日没有K线（停牌/未上市/新股）：记为跳过，不算失败。
    item.skippedCount = (Number(item.skippedCount) || 0) + 1
    if (!item.rowCount && item.status !== 'failed') item.status = 'skipped'
  } else {
    item.failedCount = (Number(item.failedCount) || 0) + 1
    if (!item.rowCount) item.status = 'failed'
  }
  const failed = Number(item.failedCount) || 0
  const skippedCount = Number(item.skippedCount) || 0
  item.message = message || `已处理 ${Number(item.rowCount) || 0}/${totalDays} 天${skippedCount ? `，跳过 ${skippedCount} 天` : ''}${failed ? `，失败 ${failed} 天` : ''}`
}

function updateFullHistoryDailyFiles(job, dayEntry) {
  const nextFile = {
    date: dayEntry.date,
    fileName: dayEntry.fileName,
    filePath: dayEntry.filePath,
    fetched: Number(dayEntry.fetched) || 0,
    failed: Number(dayEntry.failed) || 0,
    failedTaskCount: Array.isArray(dayEntry.failedTasks) ? dayEntry.failedTasks.length : 0,
    status: dayEntry.status,
    updatedAt: dayEntry.finishedAt || dayEntry.updatedAt || new Date().toISOString()
  }
  const existingIndex = job.dailyFiles.findIndex(item => item.date === dayEntry.date)
  if (existingIndex >= 0) {
    job.dailyFiles.splice(existingIndex, 1, nextFile)
  } else {
    job.dailyFiles.push(nextFile)
  }
}

function getFullHistoryItemsForDate(job, date) {
  const codes = job?.retryTaskMap?.[date]
  if (!Array.isArray(codes) || !codes.length) return job.items
  const codeSet = new Set(codes.map(normalizeCacheCode).filter(Boolean))
  return job.items.filter(item => codeSet.has(item.code))
}

function getFullHistoryDatesForItem(job, item) {
  const dates = Array.isArray(job?.dates) ? job.dates : []
  if (!job?.retryTaskMap) return dates
  const code = normalizeCacheCode(item?.code || '')
  return dates.filter(dayEntry => {
    const codes = job.retryTaskMap?.[dayEntry.date]
    return Array.isArray(codes) && codes.map(normalizeCacheCode).includes(code)
  })
}

function writeFullHistoryDayPayload(job, dayEntry, recordsByCode, dayItems) {
  const date = dayEntry.date
  const filePath = dayEntry.filePath || getFullHistoryDailyFile(date)
  const fileName = dayEntry.fileName || path.basename(filePath)
  const generatedAt = new Date().toISOString()
  const fallbackStocks = dayItems.map(item => recordsByCode.get(item.code) || {
    code: item.code,
    name: item.name || item.code,
    status: 'failed',
    data: null,
    error: '未处理',
    source: 'eastmoney'
  })
  const existingDaily = job.selectedOnly ? readJsonFile(filePath) : null
  let stocks = fallbackStocks
  if (job.selectedOnly && Array.isArray(existingDaily?.stocks) && existingDaily.stocks.length) {
    const existingCodes = new Set(existingDaily.stocks.map(item => normalizeCacheCode(item.code)))
    const mergedByCode = new Map(existingDaily.stocks.map(item => [normalizeCacheCode(item.code), item]))
    fallbackStocks.forEach(item => mergedByCode.set(item.code, item))
    stocks = [
      ...existingDaily.stocks.map(item => mergedByCode.get(normalizeCacheCode(item.code))).filter(Boolean),
      ...fallbackStocks.filter(item => !existingCodes.has(normalizeCacheCode(item.code)))
    ]
    const seen = new Set()
    stocks = stocks.filter(item => {
      const code = normalizeCacheCode(item.code)
      if (!code || seen.has(code)) return false
      seen.add(code)
      return true
    })
  }

  const status = dayEntry.failed > 0 ? (dayEntry.fetched > 0 ? 'partial' : 'failed') : 'done'
  const payload = {
    schemaVersion: FULL_HISTORY_DAILY_CACHE_VERSION,
    type: 'all_market_daily_history',
    date,
    adjust: job.adjust,
    status,
    generatedAt,
    stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
    dateIndexFile: FULL_HISTORY_DATE_INDEX_FILE,
    fileName,
    filePath,
    stockCount: stocks.length,
    selectedOnly: Boolean(job.selectedOnly),
    selectedCount: job.items.length,
    fetched: dayEntry.fetched,
    failed: dayEntry.failed,
    skipped: Number(dayEntry.skipped) || 0,
    failedTasks: Array.isArray(dayEntry.failedTasks) ? dayEntry.failedTasks : [],
    stocks
  }

  atomicWriteJson(filePath, payload)
  updateFullHistoryDateIndex(date, payload)
  dayEntry.status = status
  dayEntry.message = `${date} 已写入 ${fileName}`
  dayEntry.finishedAt = generatedAt
  dayEntry.updatedAt = generatedAt
  updateFullHistoryDailyFiles(job, dayEntry)
  return { cancelled: false, payload }
}

async function fetchFullHistoryDay(job, dayEntry) {
  const date = dayEntry.date
  const filePath = getFullHistoryDailyFile(date)
  const fileName = path.basename(filePath)
  const recordsByCode = new Map()
  const dayItems = getFullHistoryItemsForDate(job, date)
  const totalDays = job.dates.length || 1
  const startedAt = new Date().toISOString()

  dayEntry.status = 'running'
  dayEntry.stockCount = dayItems.length
  dayEntry.failedTasks = []
  dayEntry.fileName = fileName
  dayEntry.filePath = filePath
  dayEntry.startedAt = startedAt
  dayEntry.updatedAt = startedAt
  dayEntry.message = `正在获取 ${date}`
  job.currentDate = date

  for (let index = 0; index < dayItems.length; index += FULL_HISTORY_DAILY_BATCH_SIZE) {
    if (job.cancelRequested) return { cancelled: true }

    const batch = dayItems.slice(index, index + FULL_HISTORY_DAILY_BATCH_SIZE)
    job.status = 'running'
    job.currentCode = `${Math.min(index + batch.length, dayItems.length)}/${dayItems.length}`
    job.currentName = date
    job.message = `正在获取 ${date}：${job.currentCode}`
    batch.forEach(item => {
      item.status = 'running'
      item.message = `正在获取 ${date}`
      item.updatedAt = new Date().toISOString()
    })
    writeFullHistoryMeta(job)

    let tables = []
    let errors = []
    let failedTasks = []
    try {
      const history = await fetchEastmoneyHistoryBatch({
        codes: batch.map(item => item.code).join(','),
        startDate: date,
        endDate: date,
        adjust: job.adjust,
        concurrency: job.concurrency || FULL_HISTORY_DAILY_CONCURRENCY
      })
      tables = Array.isArray(history.payload?.tables) ? history.payload.tables : []
      errors = Array.isArray(history.payload?.errors) ? history.payload.errors : []
      failedTasks = Array.isArray(history.payload?.failedTasks) ? history.payload.failedTasks : []
    } catch (error) {
      errors = batch.map(item => ({ code: item.code, message: error.message || '获取失败' }))
      failedTasks = batch.map(item => createFailedTask({
        code: item.code,
        name: item.name || item.code,
        error,
        source: 'eastmoney_history_daily',
        date,
        startDate: date,
        endDate: date,
        adjust: job.adjust
      }))
      addFullHistoryError(job, `${date}: ${error.message || '批次获取失败'}`)
    }

    const tableByCode = new Map()
    tables.forEach(table => {
      const code = normalizeCacheCode(table.thscode || table.code || table.thsCode || '')
      if (code) tableByCode.set(code, table)
    })
    const errorByCode = new Map(errors.map(item => [normalizeCacheCode(item.code || ''), item.message || '获取失败']))
    const failedTaskByCode = new Map(failedTasks.map(item => [normalizeCacheCode(item.code || ''), item]))

    batch.forEach(item => {
      const table = tableByCode.get(item.code)
      const rows = table ? rowsFromTable(table).filter(row => String(row.time || '').slice(0, 10) === date) : []
      const row = rows[0]
      if (row) {
        const record = {
          code: item.code,
          name: item.name || item.code,
          status: 'done',
          data: fullHistoryRowData(row, date),
          source: 'eastmoney'
        }
        recordsByCode.set(item.code, record)
        dayEntry.fetched += 1
        job.fetched += 1
        markFullHistoryItemDay(item, date, true, totalDays)
      } else {
        const message = errorByCode.get(item.code) || '未返回当日历史数据'
        const failedTask = failedTaskByCode.get(item.code) || createFailedTask({
          code: item.code,
          name: item.name || item.code,
          error: new Error(message),
          source: 'eastmoney_history_daily',
          date,
          startDate: date,
          endDate: date,
          adjust: job.adjust
        })
        addFullHistoryFailedTask(job, dayEntry, failedTask)
        recordsByCode.set(item.code, {
          code: item.code,
          name: item.name || item.code,
          status: 'failed',
          data: null,
          error: message,
          url: failedTask.url,
          failedAt: failedTask.failedAt,
          source: 'eastmoney'
        })
        dayEntry.failed += 1
        job.failed += 1
        markFullHistoryItemDay(item, date, false, totalDays, message)
      }
    })

    dayEntry.processed += batch.length
    job.processed += batch.length
    dayEntry.updatedAt = new Date().toISOString()
    if (errors.length) addFullHistoryError(job, `${date}: ${errors[0].code || 'batch'} ${errors[0].message || '获取失败'}`)
    writeFullHistoryMeta(job)

    if (index + FULL_HISTORY_DAILY_BATCH_SIZE < dayItems.length && !job.cancelRequested) {
      await waitFullHistoryDelay(job)
    }
  }

  const generatedAt = new Date().toISOString()
  const fallbackStocks = dayItems.map(item => recordsByCode.get(item.code) || {
    code: item.code,
    name: item.name || item.code,
    status: 'failed',
    data: null,
    error: '未处理',
    source: 'eastmoney'
  })
  const existingDaily = job.selectedOnly ? readJsonFile(filePath) : null
  let stocks = fallbackStocks
  if (job.selectedOnly && Array.isArray(existingDaily?.stocks) && existingDaily.stocks.length) {
    const existingCodes = new Set(existingDaily.stocks.map(item => normalizeCacheCode(item.code)))
    const mergedByCode = new Map(existingDaily.stocks.map(item => [normalizeCacheCode(item.code), item]))
    fallbackStocks.forEach(item => mergedByCode.set(item.code, item))
    stocks = [
      ...existingDaily.stocks.map(item => mergedByCode.get(normalizeCacheCode(item.code))).filter(Boolean),
      ...fallbackStocks.filter(item => !existingCodes.has(normalizeCacheCode(item.code)))
    ]
    const seen = new Set()
    stocks = stocks.filter(item => {
      const code = normalizeCacheCode(item.code)
      if (!code || seen.has(code)) return false
      seen.add(code)
      return true
    })
  }
  const status = dayEntry.failed > 0 ? (dayEntry.fetched > 0 ? 'partial' : 'failed') : 'done'
  const payload = {
    schemaVersion: FULL_HISTORY_DAILY_CACHE_VERSION,
    type: 'all_market_daily_history',
    date,
    adjust: job.adjust,
    status,
    generatedAt,
    stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
    dateIndexFile: FULL_HISTORY_DATE_INDEX_FILE,
    fileName,
    filePath,
    stockCount: stocks.length,
    selectedOnly: Boolean(job.selectedOnly),
    selectedCount: job.items.length,
    fetched: dayEntry.fetched,
    failed: dayEntry.failed,
    failedTasks: Array.isArray(dayEntry.failedTasks) ? dayEntry.failedTasks : [],
    stocks
  }

  atomicWriteJson(filePath, payload)
  updateFullHistoryDateIndex(date, payload)
  dayEntry.status = status
  dayEntry.message = `${date} 已写入 ${fileName}`
  dayEntry.finishedAt = generatedAt
  dayEntry.updatedAt = generatedAt
  updateFullHistoryDailyFiles(job, dayEntry)
  return { cancelled: false, payload }
}

async function waitFullHistoryDelay(job) {
  const baseDelay = clampFullHistoryDelay(job.delayMs)
  const jitter = Math.floor(Math.random() * Math.min(500, baseDelay * 0.25))
  const target = Date.now() + baseDelay + jitter
  job.nextRequestAt = new Date(target).toISOString()

  while (!job.cancelRequested && Date.now() < target) {
    await sleep(Math.min(300, Math.max(0, target - Date.now())))
  }

  job.nextRequestAt = null
}

function prepareFullHistoryDayEntries(job) {
  const now = new Date().toISOString()
  job.dates.forEach(dayEntry => {
    dayEntry.status = 'running'
    dayEntry.stockCount = getFullHistoryItemsForDate(job, dayEntry.date).length
    dayEntry.fileName = path.basename(getFullHistoryDailyFile(dayEntry.date))
    dayEntry.filePath = getFullHistoryDailyFile(dayEntry.date)
    dayEntry.startedAt = dayEntry.startedAt || now
    dayEntry.updatedAt = now
    dayEntry.failedTasks = []
    dayEntry.message = `正在获取 ${dayEntry.date}`
  })
}

async function runFullMarketHistorySyncByStockRange(job) {
  try {
    ensureFullHistoryDir()
    writeFullHistoryDateIndex(readFullHistoryDateIndex())
    prepareFullHistoryDayEntries(job)
    writeFullHistoryMeta(job)

    const recordsByDate = new Map(job.dates.map(dayEntry => [dayEntry.date, new Map()]))
    const progress = createRequestProgress(job.items.length, 'full-history-stock-range')
    const totalStocks = job.items.length || 1
    const totalDays = job.dates.length || 1

    await runRequestQueue(job.items, async (item, index) => {
      const itemDates = getFullHistoryDatesForItem(job, item)
      if (!itemDates.length || job.cancelRequested) return

      item.status = 'running'
      item.message = '获取中'
      item.updatedAt = new Date().toISOString()
      job.status = 'running'
      job.currentCode = `${Math.min(index + 1, totalStocks)}/${totalStocks}`
      job.currentName = item.name || item.code
      job.message = `正在获取区间K线 ${job.currentCode} ${item.code} ${item.name || ''}`.trim()

      try {
        const table = await fetchEastmoneyHistoryTable(item.code, {
          startDate: itemDates[0]?.date || job.startDate,
          endDate: itemDates[itemDates.length - 1]?.date || job.endDate,
          adjust: job.adjust,
          retries: EASTMONEY_REQUEST_RETRIES,
          timeoutMs: EASTMONEY_REQUEST_TIMEOUT_MS,
          logRetries: true,
          onRetry: info => {
            progress.retries += 1
            if (typeof console !== 'undefined') {
              console.info(`[full-history] retry ${item.code} ${info.attempt}/${info.retries}`)
            }
          }
        })
        const rowsByDate = new Map(rowsFromTable(table)
          .filter(row => row.time)
          .map(row => [String(row.time || '').slice(0, 10), row]))
        let rowCount = 0

        itemDates.forEach(dayEntry => {
          const date = dayEntry.date
          const row = rowsByDate.get(date)
          const recordsByCode = recordsByDate.get(date)
          if (row) {
            recordsByCode.set(item.code, {
              code: item.code,
              name: item.name || item.code,
              status: 'done',
              data: fullHistoryRowData(row, date),
              source: 'eastmoney'
            })
            dayEntry.fetched += 1
            job.fetched += 1
            rowCount += 1
            markFullHistoryItemDay(item, date, true, totalDays)
          } else {
            // 区间请求已经成功返回，只是这一天没有K线：几乎都是停牌/未上市/新股，
            // 属于正常缺口而非请求失败——记为跳过，不写入 failedTasks，也不计入 failed，避免补跑队列无限膨胀。
            const message = '当日无交易数据（停牌/未上市）'
            recordsByCode.set(item.code, {
              code: item.code,
              name: item.name || item.code,
              status: 'skipped',
              data: null,
              reason: message,
              source: 'eastmoney'
            })
            dayEntry.skipped = (Number(dayEntry.skipped) || 0) + 1
            job.skipped = (Number(job.skipped) || 0) + 1
            markFullHistoryItemDay(item, date, false, totalDays, '', true)
          }
        })

        const skippedCount = Number(item.skippedCount) || 0
        item.rowCount = rowCount
        if (rowCount > 0) {
          item.status = 'done'
          item.message = `已获取 ${rowCount} 条${skippedCount ? `，跳过 ${skippedCount} 天` : ''}`
        } else {
          // 整段区间都没有数据：请求本身成功，判定为无数据而非失败。
          item.status = 'skipped'
          item.message = '区间内无交易数据（停牌/未上市）'
        }
        progress.success += 1
      } catch (error) {
        const message = historyDisplayError(error)
        item.status = 'failed'
        item.rowCount = 0
        item.message = message
        progress.failed += 1

        itemDates.forEach(dayEntry => {
          const date = dayEntry.date
          const recordsByCode = recordsByDate.get(date)
          const failedTask = createFailedTask({
            code: item.code,
            name: item.name || item.code,
            error,
            source: 'eastmoney_history_range',
            date,
            startDate: job.startDate,
            endDate: job.endDate,
            adjust: job.adjust
          })
          addFullHistoryFailedTask(job, dayEntry, failedTask)
          recordsByCode.set(item.code, {
            code: item.code,
            name: item.name || item.code,
            status: 'failed',
            data: null,
            error: message,
            url: failedTask.url,
            failedAt: failedTask.failedAt,
            source: 'eastmoney'
          })
          dayEntry.failed += 1
          job.failed += 1
          markFullHistoryItemDay(item, date, false, totalDays, message)
        })
        addFullHistoryError(job, `${item.code}: ${message}`)
      } finally {
        item.updatedAt = new Date().toISOString()
        itemDates.forEach(dayEntry => {
          dayEntry.processed += 1
          dayEntry.updatedAt = new Date().toISOString()
        })
        job.processed += itemDates.length
        progress.completed += 1
        logRequestProgress(progress)
        if (progress.completed % 10 === 0 || progress.completed === progress.total) {
          writeFullHistoryMeta(job)
        }
      }
    }, {
      concurrency: job.concurrency || FULL_HISTORY_DAILY_CONCURRENCY,
      shouldStop: () => Boolean(job.cancelRequested)
    })
    logRequestProgress(progress, true)

    for (const dayEntry of job.dates) {
      writeFullHistoryDayPayload(
        job,
        dayEntry,
        recordsByDate.get(dayEntry.date) || new Map(),
        getFullHistoryItemsForDate(job, dayEntry.date)
      )
    }

    if (job.cancelRequested) {
      job.status = 'stopped'
      job.message = '已停止全市场历史数据同步'
    } else {
      job.status = 'completed'
      job.message = `全市场历史数据同步完成，股票 ${job.items.length} 只，日期 ${job.dates.length} 天，成功 ${job.fetched} 条，跳过 ${Number(job.skipped) || 0} 条，失败 ${job.failed} 条`
    }
    job.currentDate = ''
    job.currentCode = ''
    job.currentName = ''
    job.nextRequestAt = null
    job.finishedAt = new Date().toISOString()
    writeFullHistoryMeta(job)
  } catch (error) {
    job.status = 'failed'
    job.message = error.message || '全市场历史数据同步失败'
    job.finishedAt = new Date().toISOString()
    addFullHistoryError(job, job.message)
    writeFullHistoryMeta(job)
  }
}

async function runFullMarketHistorySync(job) {
  try {
    ensureFullHistoryDir()
    fs.writeFileSync(job.outputFile, '', 'utf8')
    writeFullHistoryMeta(job)

    for (let index = 0; index < job.items.length; index++) {
      if (job.cancelRequested) {
        job.status = 'stopped'
        job.message = '已停止全市场历史数据同步'
        break
      }

      const item = job.items[index]
      item.status = 'running'
      item.message = '获取中'
      item.updatedAt = new Date().toISOString()
      job.status = 'running'
      job.currentCode = item.code
      job.currentName = item.name || item.code
      job.message = `正在获取 ${item.code} ${item.name || ''}`.trim()
      writeFullHistoryMeta(job)

      try {
        const table = await fetchEastmoneyHistoryTable(item.code, {
          startDate: job.startDate,
          endDate: job.endDate,
          adjust: job.adjust
        })
        const record = buildFullHistoryRecord(item, table, job)
        appendFullHistoryRecord(job.outputFile, record)
        item.status = 'done'
        item.rowCount = record.rowCount
        item.message = '已获取'
      } catch (error) {
        item.status = 'failed'
        item.rowCount = 0
        item.message = error.message || '获取失败'
        job.errors.push(`${item.code}: ${item.message}`)
      } finally {
        item.updatedAt = new Date().toISOString()
        job.fetched = job.items.filter(row => row.status === 'done').length
        job.failed = job.items.filter(row => row.status === 'failed').length
        writeFullHistoryMeta(job)
      }

      if (index < job.items.length - 1 && !job.cancelRequested) {
        await waitFullHistoryDelay(job)
      }
    }

    if (!job.cancelRequested && job.status !== 'stopped') {
      job.status = 'completed'
      job.message = `全市场历史数据同步完成，成功 ${job.fetched} 只，失败 ${job.failed} 只`
    }
    job.currentCode = ''
    job.currentName = ''
    job.nextRequestAt = null
    job.finishedAt = new Date().toISOString()
    writeFullHistoryMeta(job)
  } catch (error) {
    job.status = 'failed'
    job.message = error.message || '全市场历史数据同步失败'
    job.finishedAt = new Date().toISOString()
    job.errors.push(job.message)
    writeFullHistoryMeta(job)
  }
}

async function runFullMarketHistorySyncByDate(job) {
  try {
    ensureFullHistoryDir()
    writeFullHistoryDateIndex(readFullHistoryDateIndex())
    writeFullHistoryMeta(job)

    for (let index = 0; index < job.dates.length; index++) {
      const dayEntry = job.dates[index]
      if (job.cancelRequested) {
        job.status = 'stopped'
        job.message = '已停止全市场历史数据同步'
        break
      }

      const result = await fetchFullHistoryDay(job, dayEntry)
      writeFullHistoryMeta(job)
      if (result.cancelled || job.cancelRequested) {
        job.status = 'stopped'
        job.message = '已停止全市场历史数据同步'
        break
      }

      if (index < job.dates.length - 1) {
        await waitFullHistoryDelay(job)
      }
    }

    if (!job.cancelRequested && job.status !== 'stopped') {
      job.status = 'completed'
      job.message = `全市场历史数据同步完成，工作日 ${job.dates.length} 天，股票 ${job.items.length} 只，成功 ${job.fetched} 条，失败 ${job.failed} 条`
    }
    job.currentDate = ''
    job.currentCode = ''
    job.currentName = ''
    job.nextRequestAt = null
    job.finishedAt = new Date().toISOString()
    writeFullHistoryMeta(job)
  } catch (error) {
    job.status = 'failed'
    job.message = error.message || '全市场历史数据同步失败'
    job.finishedAt = new Date().toISOString()
    addFullHistoryError(job, job.message)
    writeFullHistoryMeta(job)
  }
}

async function prepareFullMarketHistoryList(options = {}) {
  if (isFullHistoryActive()) return buildFullHistorySnapshot()
  if (fullHistoryJob?.items?.length && !options.force) {
    fullHistoryJob = {
      ...fullHistoryJob,
      startDate: normalizeFullHistoryDate(options.startDate) || fullHistoryJob.startDate,
      endDate: normalizeFullHistoryDate(options.endDate) || fullHistoryJob.endDate,
      delayMs: clampFullHistoryDelay(options.delayMs || fullHistoryJob.delayMs),
      concurrency: clampStockRequestConcurrency(options.concurrency || fullHistoryJob.concurrency),
      adjust: String(options.adjust || fullHistoryJob.adjust || '1')
    }
    return buildFullHistorySnapshot()
  }

  fullHistoryJob = createFullHistoryJob({
    status: 'preparing',
    startDate: normalizeFullHistoryDate(options.startDate),
    endDate: normalizeFullHistoryDate(options.endDate),
    delayMs: options.delayMs,
    concurrency: options.concurrency,
    adjust: options.adjust,
    message: '正在加载全市场股票列表'
  })

  try {
    const items = await loadFullMarketHistoryItemsForDaily({ force: options.force })
    fullHistoryJob = createFullHistoryJob({
      ...fullHistoryJob,
      status: 'ready',
      message: `已加载 ${items.length} 只股票，等待开始获取历史数据`
    }, items)
  } catch (error) {
    fullHistoryJob.status = 'failed'
    fullHistoryJob.message = error.message || '加载全市场股票列表失败'
    fullHistoryJob.errors.push(fullHistoryJob.message)
  }

  return buildFullHistorySnapshot()
}

// 启动全市场历史K线同步：按工作日拆任务。
async function startFullMarketHistorySync(options = {}) {
  if (isFullHistoryActive()) return buildFullHistorySnapshot()

  const startDate = normalizeFullHistoryDate(options.startDate)
  const endDate = normalizeFullHistoryDate(options.endDate)
  if (!startDate || !endDate) throw new Error('请先选择开始时间和结束时间')
  if (startDate > endDate) throw new Error('开始时间不能晚于结束时间')

  const workdays = listFullHistoryWorkdays(startDate, endDate)
  if (!workdays.length) throw new Error('选择区间内没有工作日，请重新选择日期')

  const items = fullHistoryJob?.items?.length
    ? fullHistoryJob.items
    : await loadFullMarketHistoryItemsForDaily()
  const resetItems = items.map(item => ({
    ...item,
    status: 'pending',
    rowCount: 0,
    failedCount: 0,
    message: '未获取',
    updatedAt: null
  }))
  const paths = createFullHistoryOutputPaths(startDate, endDate)

  fullHistoryJob = createFullHistoryJob({
    status: 'running',
    startDate,
    endDate,
    delayMs: options.delayMs,
    concurrency: options.concurrency,
    adjust: options.adjust,
    startedAt: new Date().toISOString(),
    outputFile: paths.outputFile,
    dailyDir: paths.dailyDir,
    stockListFile: paths.stockListFile,
    dateIndexFile: paths.dateIndexFile,
    metaFile: paths.metaFile,
    selectedOnly: false,
    selectedCodes: [],
    dates: workdays.map(date => ({
      date,
      status: 'pending',
      stockCount: resetItems.length,
      processed: 0,
      fetched: 0,
      failed: 0,
      skipped: 0,
      failedTasks: [],
      fileName: path.basename(getFullHistoryDailyFile(date)),
      filePath: getFullHistoryDailyFile(date),
      message: '等待获取'
    })),
    message: `开始按工作日获取 ${resetItems.length} 只，${workdays.length} 天`
  }, resetItems)

  fullHistoryJob.promise = runFullMarketHistorySyncByStockRange(fullHistoryJob)
  return buildFullHistorySnapshot()
}

function normalizeFailedHistoryTask(task) {
  const code = normalizeCacheCode(task?.code || task?.thscode || '')
  const date = normalizeFullHistoryDate(task?.date || task?.time || task?.startDate || '')
  if (!code || !date) return null
  return {
    ...task,
    code,
    date,
    name: String(task?.name || task?.stockName || code).trim(),
    errorMessage: errorMessage(task?.errorMessage || task?.message || task?.error || '获取失败'),
    failedAt: task?.failedAt || new Date().toISOString()
  }
}

function failedTasksFromDailyPayload(payload) {
  const date = normalizeFullHistoryDate(payload?.date || '')
  if (!date) return []
  if (Array.isArray(payload?.failedTasks) && payload.failedTasks.length) {
    return payload.failedTasks.map(task => normalizeFailedHistoryTask({ ...task, date })).filter(Boolean)
  }
  const stocks = Array.isArray(payload?.stocks) ? payload.stocks : []
  return stocks
    .filter(item => item?.status === 'failed')
    .map(item => normalizeFailedHistoryTask({
      code: item.code,
      name: item.name || item.code,
      date,
      url: item.url || '',
      errorMessage: item.error || item.message || '获取失败',
      source: item.source || 'eastmoney_history_daily',
      failedAt: item.failedAt || payload.generatedAt
    }))
    .filter(Boolean)
}

function readFullHistoryFailedTasksFromDailyFiles() {
  const tasks = []
  const dateIndex = readFullHistoryDateIndex()
  const entries = Object.values(dateIndex?.dates || {})
  entries.forEach(entry => {
    const filePath = entry?.filePath || (entry?.date ? getFullHistoryDailyFile(entry.date) : '')
    if (!filePath) return
    const payload = readJsonFile(filePath)
    tasks.push(...failedTasksFromDailyPayload(payload))
  })

  if (!tasks.length && fs.existsSync(FULL_HISTORY_DAILY_CACHE_DIR)) {
    try {
      fs.readdirSync(FULL_HISTORY_DAILY_CACHE_DIR)
        .filter(fileName => fileName.endsWith('.json'))
        .forEach(fileName => {
          const payload = readJsonFile(path.join(FULL_HISTORY_DAILY_CACHE_DIR, fileName))
          tasks.push(...failedTasksFromDailyPayload(payload))
        })
    } catch {}
  }
  return tasks
}

// 从日缓存或当前任务中提取失败记录，只补跑失败的股票/日期组合。
async function retryFullMarketFailedTasks(options = {}) {
  if (isFullHistoryActive()) return buildFullHistorySnapshot()

  const inputTasks = Array.isArray(options.failedTasks) && options.failedTasks.length
    ? options.failedTasks
    : (Array.isArray(fullHistoryJob?.failedTasks) ? fullHistoryJob.failedTasks : [])
  let failedTasks = inputTasks.map(normalizeFailedHistoryTask).filter(Boolean)
  if (!failedTasks.length) {
    failedTasks = readFullHistoryFailedTasksFromDailyFiles()
  }
  if (!failedTasks.length) throw new Error('没有可补跑的失败任务')

  const taskMap = new Map()
  const nameByCode = new Map()
  failedTasks.forEach(task => {
    if (!taskMap.has(task.date)) taskMap.set(task.date, new Set())
    taskMap.get(task.date).add(task.code)
    if (task.name) nameByCode.set(task.code, task.name)
  })
  const dates = Array.from(taskMap.keys()).sort()
  const codes = Array.from(new Set(dates.flatMap(date => Array.from(taskMap.get(date))))).sort()
  const cachedItems = fullHistoryJob?.items?.length ? fullHistoryJob.items : (readFullMarketStockList() || [])
  const itemByCode = new Map(cachedItems.map(item => [normalizeCacheCode(item.code), item]))
  const retryTaskMap = Object.fromEntries(dates.map(date => [date, Array.from(taskMap.get(date)).sort()]))
  const resetItems = codes.map(code => ({
    ...(itemByCode.get(code) || {}),
    code,
    name: nameByCode.get(code) || itemByCode.get(code)?.name || code,
    status: 'pending',
    rowCount: 0,
    failedCount: 0,
    message: '等待补跑',
    updatedAt: null
  }))
  const startDate = dates[0]
  const endDate = dates[dates.length - 1]
  const paths = createFullHistoryOutputPaths(startDate, endDate)

  fullHistoryJob = createFullHistoryJob({
    status: 'running',
    startDate,
    endDate,
    delayMs: options.delayMs,
    concurrency: options.concurrency,
    adjust: options.adjust || fullHistoryJob?.adjust || '1',
    startedAt: new Date().toISOString(),
    outputFile: paths.outputFile,
    dailyDir: paths.dailyDir,
    stockListFile: paths.stockListFile,
    dateIndexFile: paths.dateIndexFile,
    metaFile: paths.metaFile,
    selectedOnly: true,
    selectedCodes: resetItems.map(item => item.code),
    retryTaskMap,
    dates: dates.map(date => ({
      date,
      status: 'pending',
      stockCount: retryTaskMap[date].length,
      processed: 0,
      fetched: 0,
      failed: 0,
      skipped: 0,
      failedTasks: [],
      fileName: path.basename(getFullHistoryDailyFile(date)),
      filePath: getFullHistoryDailyFile(date),
      message: '等待补跑'
    })),
    message: `开始补跑失败任务 ${failedTasks.length} 条，股票 ${resetItems.length} 只，日期 ${dates.length} 天`
  }, resetItems)

  fullHistoryJob.promise = runFullMarketHistorySyncByStockRange(fullHistoryJob)
  return buildFullHistorySnapshot()
}

function cancelFullMarketHistorySync() {
  if (isFullHistoryActive()) {
    fullHistoryJob.cancelRequested = true
    fullHistoryJob.status = 'stopping'
    fullHistoryJob.message = '正在停止，当前请求结束后会暂停'
    writeFullHistoryMeta(fullHistoryJob)
  }
  return buildFullHistorySnapshot()
}

// 暴露给 React 的白名单桥接 API；前端只能通过这些函数访问 Node/Electron 能力。
window.stockReviewBridge = {
  openDesktopWindow(options = {}) {
    const win = openDesktopWindow({
      forceReload: Boolean(options.forceReload),
      verify: options.verify !== false
    })
    return {
      ok: Boolean(win),
      url: lastDesktopWindowUrl,
      reused: Boolean(win && win === stockReviewDesktopWindow)
    }
  },
  copyText(text) {
    clipboard.writeText(String(text || ''))
    return true
  },
  async getIfindAccessToken(refreshToken) {
    await getAccessToken(refreshToken, true)
    return { ok: true }
  },
  async fetchIfindHistory(options) {
    const payload = await callIfindEndpoint({
      refreshToken: options.refreshToken,
      endpoint: 'cmd_history_quotation',
      params: {
        codes: options.codes,
        indicators: options.indicators,
        startdate: options.startDate,
        enddate: options.endDate,
        functionpara: { Fill: 'Blank' }
      }
    })
    return {
      ok: true,
      endpoint: 'cmd_history_quotation',
      fetchedAt: new Date().toISOString(),
      payload
    }
  },
  async fetchIfindRealtime(options) {
    const payload = await callIfindEndpoint({
      refreshToken: options.refreshToken,
      endpoint: 'real_time_quotation',
      params: {
        codes: options.codes,
        indicators: options.indicators
      }
    })
    return {
      ok: true,
      endpoint: 'real_time_quotation',
      fetchedAt: new Date().toISOString(),
      payload
    }
  },
  async fetchEastmoneyHistory(options) {
    return fetchEastmoneyHistory(options)
  },
  async fetchEastmoneySpot(options) {
    return fetchEastmoneySpot(options)
  },
  async fetchPortfolioSpot(options) {
    return fetchPortfolioSpot(options)
  },
  async fetchEastmoneyClistSpot(options) {
    return fetchEastmoneyClistSpot(options)
  },
  async fetchAkshareHistory(options) {
    return fetchAkshareHistory(options)
  },
  async fetchAkshareSpot(options) {
    return fetchAkshareSpot(options)
  },
  async installBaostockPackage(options) {
    return installBaostockPackage(options)
  },
  async fetchFreeStableData(options) {
    return fetchFreeStableData(options)
  },
  async prepareFullMarketHistoryList(options) {
    return prepareFullMarketHistoryList(options)
  },
  async refreshFullMarketStockListFromSnapshot(options) {
    return refreshFullMarketStockListFromSnapshot(options)
  },
  async startFullMarketHistorySync(options) {
    return startFullMarketHistorySync(options)
  },
  async retryFullMarketFailedTasks(options) {
    return retryFullMarketFailedTasks(options)
  },
  async cancelFullMarketHistorySync() {
    return cancelFullMarketHistorySync()
  },
  async getFullMarketHistorySyncStatus() {
    return buildFullHistorySnapshot()
  },
  getRuntimeInfo() {
    return {
      platform: process.platform,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  }
}
