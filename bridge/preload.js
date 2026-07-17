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
const { TextDecoder } = require('util')

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
const STOCK_REVIEW_SYSTEM_DATA_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, '股研录')
  : path.join(os.homedir(), '.stock-review')
const FULL_HISTORY_DATA_DIR = path.join(STOCK_REVIEW_SYSTEM_DATA_DIR, 'history-data')
const STOCK_REVIEW_DATABASE_NAME = 'stock-review.db'
const STOCK_REVIEW_DATABASE_FILE = path.join(FULL_HISTORY_DATA_DIR, STOCK_REVIEW_DATABASE_NAME)
const FULL_HISTORY_DAILY_DATA_DIR = path.join(FULL_HISTORY_DATA_DIR, 'daily')
const FULL_HISTORY_STOCK_LIST_NAME = 'all-market-stocks.json'
const FULL_HISTORY_STOCK_LIST_FILE = path.join(FULL_HISTORY_DATA_DIR, FULL_HISTORY_STOCK_LIST_NAME)
const FULL_HISTORY_DATE_INDEX_FILE = path.join(FULL_HISTORY_DATA_DIR, 'all-market-history-date-index.json')
const FULL_HISTORY_SNAPSHOT_EXECUTABLE = path.join(FULL_HISTORY_DATA_DIR, 'fetch_all_a_stocks_v2.exe')
const FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE_NAME = 'fetch_all_a_stocks_v3.exe'
const FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE = path.join(FULL_HISTORY_DATA_DIR, FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE_NAME)
const FULL_HISTORY_EXECUTABLE_NAME = 'fetch_a_stock_history_by_stock.exe'
const FULL_HISTORY_EXECUTABLE = path.join(FULL_HISTORY_DATA_DIR, FULL_HISTORY_EXECUTABLE_NAME)
const FULL_HISTORY_SELECTED_CODES_NAME = 'selected-history-codes.json'
const FULL_HISTORY_SELECTED_CODES_FILE = path.join(FULL_HISTORY_DATA_DIR, FULL_HISTORY_SELECTED_CODES_NAME)
const FULL_HISTORY_CALCULATE_STOCK_LIST_NAME = 'all-market-stocks-Calculate.json'
const FULL_HISTORY_CALCULATE_STOCK_LIST_FILE = path.join(FULL_HISTORY_DATA_DIR, FULL_HISTORY_CALCULATE_STOCK_LIST_NAME)
const FULL_HISTORY_OUTPUT_DIR_NAME = 'all-market-history-by-stock'
const FULL_HISTORY_OUTPUT_DIR = path.join(FULL_HISTORY_DATA_DIR, FULL_HISTORY_OUTPUT_DIR_NAME)
const FULL_HISTORY_STOCK_INDEX_NAME = 'stock-history-index.json'
const FULL_HISTORY_STOCK_INDEX_FILE = path.join(FULL_HISTORY_OUTPUT_DIR, FULL_HISTORY_STOCK_INDEX_NAME)
const FULL_HISTORY_ROOT_STOCK_INDEX_FILE = path.join(FULL_HISTORY_DATA_DIR, FULL_HISTORY_STOCK_INDEX_NAME)
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
let fullHistoryProcess = null
let fullDailySnapshotProcess = null
let fullDailySnapshotCancelRequested = false
const DESKTOP_WINDOW_BASE_URL = 'index.html'
const DESKTOP_WINDOW_FEATURE_CODES = new Set(['stock-review', 'stock-pool', 'risk-watch'])
let stockReviewDesktopWindow = null
let sqlJsRuntimePromise = null
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

// Windows 对 CreateProcess 命令行长度有严格上限。业务脚本可能达到数十 KB，
// 因此这里只把一个很小的启动器放在 -c 参数中，真实脚本和输入统一走 stdin。
const PYTHON_STDIN_RUNNER = [
  'import io, json, sys',
  'envelope = json.load(sys.stdin)',
  'sys.stdin = io.StringIO(json.dumps(envelope.get("input") or {}, ensure_ascii=False))',
  'exec(compile(envelope.get("script") or "", "<stock-review-python>", "exec"), {"__name__": "__main__"})'
].join('\n')

function runPythonJson({ pythonPath, script, input, timeout = 120000, label = 'Python' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath || 'python', ['-c', PYTHON_STDIN_RUNNER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
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
    child.stdin.end(Buffer.from(JSON.stringify({
      script: String(script || ''),
      input: input || {}
    }), 'utf8'))
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
  return ['preparing', 'running', 'daily_snapshot_running', 'stopping'].includes(job?.status)
}

function clampFullHistoryDelay(value) {
  return Math.max(
    FULL_HISTORY_MIN_DELAY_MS,
    Math.min(FULL_HISTORY_MAX_DELAY_MS, Number(value) || FULL_HISTORY_DEFAULT_DELAY_MS)
  )
}

function normalizeFullHistoryDate(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8)
  if (!/^\d{8}$/.test(digits)) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function isFullHistoryAStock(item) {
  const code = normalizeCacheCode(item?.code || item?.thscode || '')
  const [symbol = '', market = ''] = code.split('.')
  if (market === 'SH') return STOCK_LIST_SH_PREFIXES.some(prefix => symbol.startsWith(prefix))
  if (market === 'SZ') return STOCK_LIST_SZ_PREFIXES.some(prefix => symbol.startsWith(prefix))
  if (market === 'BJ') return STOCK_LIST_BJ_PREFIXES.some(prefix => symbol.startsWith(prefix))
  return false
}

// 股票清单保留全证券类型供页面查询；历史程序只会处理 isFullHistoryAStock 为真的项目。
function inferFullHistorySecurityType(item) {
  const code = normalizeCacheCode(item?.code || item?.thscode || '')
  const [symbol = '', market = ''] = code.split('.')
  const name = decodeLegacyStockName(item?.name || item?.stockName || '').toLowerCase()

  if (isFullHistoryAStock({ code })) return 'a_stock'
  if (/新债|发债/.test(name) || /^(70|71|72|73|75|78|370|371|372)/.test(symbol)) return 'new_bond'
  if (/etf|交易型开放式/.test(name) || (market === 'SH' && /^(51|56|58)/.test(symbol)) || (market === 'SZ' && symbol.startsWith('159'))) return 'etf'
  if (/指数/.test(name) || (market === 'SH' && symbol.startsWith('000')) || (market === 'SZ' && symbol.startsWith('399')) || (market === 'BJ' && symbol.startsWith('899'))) return 'index'
  return 'bond'
}

function resolveFullHistoryStockIndexFile() {
  if (fs.existsSync(FULL_HISTORY_STOCK_INDEX_FILE)) return FULL_HISTORY_STOCK_INDEX_FILE
  if (fs.existsSync(FULL_HISTORY_ROOT_STOCK_INDEX_FILE)) return FULL_HISTORY_ROOT_STOCK_INDEX_FILE
  return FULL_HISTORY_STOCK_INDEX_FILE
}

function buildFullHistoryArgs(startDate, endDate, options = {}) {
  const args = [
    '--start', normalizeFullHistoryDate(startDate),
    '--end', normalizeFullHistoryDate(endDate),
    '--database', STOCK_REVIEW_DATABASE_NAME,
    '--source', 'baostock'
  ]
  if (options.selectedOnly && options.selectedCodesFile) {
    args.push('--codes-file', options.selectedCodesFile, '--force-refetch')
  }
  args.push('--resume')
  return args
}

function quoteCommandArgument(value) {
  const text = String(value || '')
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

function buildFullHistoryCommand(startDate, endDate, options = {}) {
  const start = normalizeFullHistoryDate(startDate) || '<开始日期>'
  const end = normalizeFullHistoryDate(endDate) || '<结束日期>'
  const selectedArgs = options.selectedOnly && options.selectedCodesFile
    ? ` --codes-file ${quoteCommandArgument(options.selectedCodesFile)} --force-refetch`
    : ''
  return `${FULL_HISTORY_EXECUTABLE_NAME} --start ${quoteCommandArgument(start)} --end ${quoteCommandArgument(end)} --database "${STOCK_REVIEW_DATABASE_NAME}" --source baostock${selectedArgs} --resume`
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
    databaseFile: base.databaseFile || STOCK_REVIEW_DATABASE_FILE,
    outputDir: base.outputDir || FULL_HISTORY_OUTPUT_DIR,
    dailyDir: base.dailyDir || FULL_HISTORY_DAILY_DATA_DIR,
    stockListFile: base.stockListFile || FULL_HISTORY_STOCK_LIST_FILE,
    calculateStockListFile: base.calculateStockListFile || FULL_HISTORY_CALCULATE_STOCK_LIST_FILE,
    stockIndexFile: base.stockIndexFile || resolveFullHistoryStockIndexFile(),
    executable: base.executable || FULL_HISTORY_EXECUTABLE,
    command: base.command || '',
    processId: Number(base.processId) || null,
    requiresCleanup: Boolean(base.requiresCleanup),
    cleanupReason: base.cleanupReason || '',
    hasDateOverlap: Boolean(base.hasDateOverlap),
    overlapReason: base.overlapReason || '',
    overlapRanges: Array.isArray(base.overlapRanges) ? base.overlapRanges : [],
    appendMode: Boolean(base.appendMode),
    datasetId: Number(base.datasetId) || null,
    previousStartDate: normalizeFullHistoryDate(base.previousStartDate),
    previousEndDate: normalizeFullHistoryDate(base.previousEndDate),
    indexStartDate: normalizeFullHistoryDate(base.indexStartDate),
    indexEndDate: normalizeFullHistoryDate(base.indexEndDate),
    indexedStockCount: Number(base.indexedStockCount) || 0,
    missingStockCount: Number(base.missingStockCount) || 0,
    stdout: String(base.stdout || ''),
    stderr: String(base.stderr || ''),
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
    selectedCodesFile: String(base.selectedCodesFile || ''),
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
      securityType: item.securityType || inferFullHistorySecurityType(item),
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
  const historyTotal = items.filter(isFullHistoryAStock).length
  const legacyFetched = items.filter(item => item.status === 'done').length
  const legacyFailed = items.filter(item => item.status === 'failed').length
  const legacySkipped = items.filter(item => item.status === 'skipped').length
  const legacyPending = items.filter(item => ['pending', 'running'].includes(item.status)).length
  const recordTotal = dates.length ? dates.reduce((sum, item) => sum + (Number(item.stockCount) || total), 0) : total
  const processed = dates.length ? Number(job?.processed) || dates.reduce((sum, item) => sum + (Number(item.processed) || 0), 0) : legacyFetched + legacyFailed + legacySkipped
  const fetched = dates.length ? Number(job?.fetched) || dates.reduce((sum, item) => sum + (Number(item.fetched) || 0), 0) : legacyFetched
  const failed = dates.length ? Number(job?.failed) || dates.reduce((sum, item) => sum + (Number(item.failed) || 0), 0) : legacyFailed
  const skipped = dates.length ? Number(job?.skipped) || dates.reduce((sum, item) => sum + (Number(item.skipped) || 0), 0) : legacySkipped
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
    databaseFile: job?.databaseFile || STOCK_REVIEW_DATABASE_FILE,
    outputDir: job?.outputDir || FULL_HISTORY_OUTPUT_DIR,
    dataDir: FULL_HISTORY_DATA_DIR,
    dailyDir: job?.dailyDir || FULL_HISTORY_DAILY_DATA_DIR,
    stockListFile: job?.stockListFile || FULL_HISTORY_STOCK_LIST_FILE,
    calculateStockListFile: job?.calculateStockListFile || FULL_HISTORY_CALCULATE_STOCK_LIST_FILE,
    stockIndexFile: job?.stockIndexFile || resolveFullHistoryStockIndexFile(),
    snapshotExecutable: FULL_HISTORY_SNAPSHOT_EXECUTABLE,
    snapshotCommand: `${path.basename(FULL_HISTORY_SNAPSHOT_EXECUTABLE)} --database "${STOCK_REVIEW_DATABASE_NAME}" --source baostock`,
    dailySnapshotExecutable: FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE,
    dailySnapshotCommand: `${FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE_NAME} --database "${STOCK_REVIEW_DATABASE_NAME}" --date <快照日期> --source auto`,
    dateIndexFile: job?.dateIndexFile || FULL_HISTORY_DATE_INDEX_FILE,
    metaFile: job?.metaFile || '',
    historyExecutable: job?.executable || FULL_HISTORY_EXECUTABLE,
    historyCommand: job?.command || buildFullHistoryCommand(job?.startDate, job?.endDate),
    processId: Number(job?.processId) || null,
    requiresCleanup: Boolean(job?.requiresCleanup),
    cleanupReason: job?.cleanupReason || '',
    hasDateOverlap: Boolean(job?.hasDateOverlap),
    overlapReason: job?.overlapReason || '',
    overlapRanges: Array.isArray(job?.overlapRanges) ? job.overlapRanges : [],
    indexStartDate: job?.indexStartDate || '',
    indexEndDate: job?.indexEndDate || '',
    indexedStockCount: Number(job?.indexedStockCount) || 0,
    missingStockCount: Number(job?.missingStockCount) || 0,
    stdout: String(job?.stdout || ''),
    stderr: String(job?.stderr || ''),
    total,
    stockTotal: total,
    historyTotal,
    dateTotal: dates.length,
    recordTotal,
    processed,
    fetched,
    failed,
    skipped,
    pending,
    progress: dates.length
      ? (recordTotal ? Math.round((processed / recordTotal) * 10000) / 100 : 0)
      : (total ? Math.round(((fetched + failed + skipped) / total) * 10000) / 100 : 0),
    errors: (job?.errors || []).slice(-20),
    failedTaskCount: failedTasks.length,
    failedTasks: failedTasks.slice(-200),
    dailyFiles: Array.isArray(job?.dailyFiles) ? job.dailyFiles : [],
    selectedOnly: Boolean(job?.selectedOnly),
    selectedCodes: Array.isArray(job?.selectedCodes) ? job.selectedCodes : [],
    selectedCodesFile: String(job?.selectedCodesFile || ''),
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
      securityType: item.securityType || inferFullHistorySecurityType(item),
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
  fs.mkdirSync(FULL_HISTORY_DATA_DIR, { recursive: true })
  fs.mkdirSync(FULL_HISTORY_DAILY_DATA_DIR, { recursive: true })
}

function createFullHistoryOutputPaths(startDate, endDate) {
  ensureFullHistoryDir()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const range = `${ymd(startDate, '00000000')}_${ymd(endDate, '99999999')}`
  const base = `all-market-history-${range}-${timestamp}`
  return {
    outputFile: FULL_HISTORY_DAILY_DATA_DIR,
    dailyDir: FULL_HISTORY_DAILY_DATA_DIR,
    stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
    dateIndexFile: FULL_HISTORY_DATE_INDEX_FILE,
    metaFile: path.join(FULL_HISTORY_DATA_DIR, `${base}.meta.json`)
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
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
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
  if (!payload) return null
  const stocks = extractFullMarketStockListRows(payload)
  if (!stocks.length) return null

  const items = stocks.map(item => ({
    code: normalizeFullMarketStockCode(item),
    name: String(item?.name || item?.code_name || item?.stockName || item?.stock_name || item?.securityName || item?.code || '').trim(),
    status: 'pending',
    rowCount: 0,
    failedCount: 0,
    message: '未获取',
    updatedAt: null
  })).filter(item => item.code)

  const deduped = new Map(items.map(item => [item.code, item]))
  return deduped.size
    ? Array.from(deduped.values()).sort((a, b) => a.code.localeCompare(b.code))
    : null
}

function extractFullMarketStockListRows(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const candidates = [payload.stocks, payload.items, payload.list, payload.rows, payload.records, payload.data, payload.result]
  for (const candidate of candidates) {
    const rows = extractFullMarketStockListRows(candidate)
    if (rows.length) return rows
  }
  return []
}

function normalizeFullMarketStockCode(item) {
  const rawValue = item?.code || item?.thscode || item?.ts_code || item?.stockCode || item?.stock_code || item?.symbol || ''
  const raw = String(rawValue).trim().toUpperCase()
  const prefixMatch = raw.match(/^(SH|SZ|BJ)[.\-_]?(\d{6})$/)
  if (prefixMatch) return `${prefixMatch[2]}.${prefixMatch[1]}`
  const suffixMatch = raw.match(/^(\d{6})[.\-_]?(SH|SZ|BJ)$/)
  if (suffixMatch) return `${suffixMatch[1]}.${suffixMatch[2]}`

  const symbol = String(item?.symbol || raw).replace(/\D/g, '').padStart(6, '0')
  if (!/^\d{6}$/.test(symbol)) return ''
  const marketValue = String(item?.market || item?.exchange || '').trim().toUpperCase()
  const market = ['SH', 'SSE', 'XSHG'].includes(marketValue)
    ? 'SH'
    : ['SZ', 'SZSE', 'XSHE'].includes(marketValue)
      ? 'SZ'
      : ['BJ', 'BSE'].includes(marketValue)
        ? 'BJ'
        : normalizeCacheCode(symbol).split('.')[1]
  return market ? `${symbol}.${market}` : ''
}

function extractFullHistoryIndexRows(payload) {
  if (Array.isArray(payload)) {
    return payload.map(item => (typeof item === 'string' ? { code: item } : item)).filter(Boolean)
  }
  if (!payload || typeof payload !== 'object') return []

  const candidates = [
    payload.stocks,
    payload.items,
    payload.records,
    payload.entries,
    payload.index,
    payload.stockHistoryIndex,
    payload.stockIndex,
    payload.data,
    payload.data?.stocks,
    payload.data?.items,
    payload.data?.records
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const rows = extractFullHistoryIndexRows(candidate)
    if (rows.length) return rows
  }

  return Object.entries(payload)
    .map(([code, value]) => {
      const normalizedCode = normalizeFullMarketStockCode({ code })
      if (!normalizedCode || value == null || Array.isArray(value)) return null
      if (typeof value === 'string') return { code, filePath: value }
      if (typeof value !== 'object') return null
      return { code, ...value }
    })
    .filter(Boolean)
}

function fullHistoryIndexDateRange(payload, rows = []) {
  const metadata = payload?.metadata || payload?.meta || {}
  const range = payload?.dateRange || payload?.range || metadata?.dateRange || metadata?.range || {}
  const startCandidates = [
    payload?.startDate,
    payload?.start,
    payload?.start_date,
    payload?.requestedStart,
    payload?.date_start,
    range?.startDate,
    range?.start,
    metadata?.startDate,
    metadata?.start,
    metadata?.start_date,
    metadata?.requestedStart,
    metadata?.date_start
  ]
  const endCandidates = [
    payload?.endDate,
    payload?.end,
    payload?.end_date,
    payload?.requestedEnd,
    payload?.date_end,
    range?.endDate,
    range?.end,
    metadata?.endDate,
    metadata?.end,
    metadata?.end_date,
    metadata?.requestedEnd,
    metadata?.date_end
  ]
  const rowStarts = rows.map(item => normalizeFullHistoryDate(item?.startDate || item?.start || item?.start_date)).filter(Boolean)
  const rowEnds = rows.map(item => normalizeFullHistoryDate(item?.endDate || item?.end || item?.end_date)).filter(Boolean)
  const startDate = startCandidates.map(normalizeFullHistoryDate).find(Boolean) || (rowStarts.length ? rowStarts.sort()[0] : '')
  const endDate = endCandidates.map(normalizeFullHistoryDate).find(Boolean) || (rowEnds.length ? rowEnds.sort().at(-1) : '')
  return { startDate, endDate }
}

function fullHistoryIndexRowCount(item) {
  const direct = [
    item?.rowCount,
    item?.row_count,
    item?.klineCount,
    item?.kLineCount,
    item?.kline_count,
    item?.recordCount,
    item?.dataCount,
    item?.count,
    item?.bars,
    item?.rows
  ].map(Number).find(Number.isFinite)
  if (Number.isFinite(direct)) return Math.max(0, direct)
  if (Array.isArray(item?.rows)) return item.rows.length
  if (Array.isArray(item?.data)) return item.data.length
  return 0
}

function normalizeFullHistoryIndexStatus(item) {
  const raw = String(item?.status || item?.state || item?.result || '').trim().toLowerCase()
  if (['done', 'completed', 'complete', 'success', 'succeeded', 'ok', 'finished', '完成', '已完成', '成功'].includes(raw)) return 'done'
  if (['failed', 'failure', 'error', '失败', '错误'].includes(raw)) return 'failed'
  if (['skipped', 'skip', 'no_data', 'nodata', 'empty', '跳过', '无数据'].includes(raw)) return 'skipped'
  if (['running', 'processing', 'fetching', 'in_progress', '运行中', '处理中', '获取中'].includes(raw)) return 'running'
  if (['pending', 'waiting', 'queued', '等待', '未获取', '排队中'].includes(raw)) return 'pending'
  return fullHistoryIndexRowCount(item) > 0 ? 'done' : 'done'
}

function fullHistoryIndexMessage(item, status) {
  const message = String(item?.message || item?.remark || item?.note || item?.errorMessage || item?.error || '').trim()
  if (message) return message
  if (status === 'done') return '已写入历史数据'
  if (status === 'failed') return '获取失败'
  if (status === 'skipped') return '无历史数据'
  if (status === 'running') return '获取中'
  return '未获取'
}

function readFullHistoryStockIndex() {
  const filePath = resolveFullHistoryStockIndexFile()
  const exists = fs.existsSync(filePath)
  if (!exists) {
    return {
      filePath,
      exists: false,
      readable: true,
      payload: null,
      rows: [],
      rowsByCode: new Map(),
      startDate: '',
      endDate: ''
    }
  }

  const payload = readJsonFile(filePath)
  if (!payload) {
    return {
      filePath,
      exists: true,
      readable: false,
      payload: null,
      rows: [],
      rowsByCode: new Map(),
      startDate: '',
      endDate: ''
    }
  }

  const rows = extractFullHistoryIndexRows(payload)
  const rowsByCode = new Map()
  rows.forEach(item => {
    const code = normalizeFullMarketStockCode(item)
    if (code) rowsByCode.set(code, item)
  })
  const { startDate, endDate } = fullHistoryIndexDateRange(payload, rows)
  return { filePath, exists: true, readable: true, payload, rows, rowsByCode, startDate, endDate }
}

function readCombinedFullHistoryItems() {
  const snapshotPayload = readJsonFile(FULL_HISTORY_STOCK_LIST_FILE)
  const snapshotRows = extractFullMarketStockListRows(snapshotPayload)
  const snapshotItems = readFullMarketStockList() || []
  const index = readFullHistoryStockIndex()
  const items = snapshotItems.map(item => {
    const indexItem = index.rowsByCode.get(item.code)
    if (!indexItem) {
      return {
        ...item,
        status: 'pending',
        rowCount: 0,
        failedCount: 0,
        message: '股票数据索引中暂无记录',
        updatedAt: null
      }
    }
    const status = normalizeFullHistoryIndexStatus(indexItem)
    return {
      ...item,
      status,
      rowCount: fullHistoryIndexRowCount(indexItem),
      failedCount: status === 'failed' ? 1 : 0,
      skippedCount: status === 'skipped' ? 1 : 0,
      message: fullHistoryIndexMessage(indexItem, status),
      updatedAt: indexItem.updatedAt || indexItem.updateTime || indexItem.lastUpdated || indexItem.last_updated || indexItem.finishedAt || indexItem.fetchedAt || indexItem.generatedAt || null
    }
  })
  return { snapshotPayload, snapshotRows, items, index }
}

function buildCalculateStockListPayload(snapshotPayload, stocks, startDate, endDate) {
  if (snapshotPayload && !Array.isArray(snapshotPayload) && Array.isArray(snapshotPayload.stocks)) {
    return {
      ...snapshotPayload,
      generatedAt: new Date().toISOString(),
      stockCount: stocks.length,
      calculationStartDate: startDate,
      calculationEndDate: endDate,
      stocks
    }
  }
  if (Array.isArray(snapshotPayload)) return stocks
  return {
    schemaVersion: 1,
    type: 'all_market_stock_list',
    source: snapshotPayload?.source || 'snapshot',
    generatedAt: new Date().toISOString(),
    stockCount: stocks.length,
    calculationStartDate: startDate,
    calculationEndDate: endDate,
    stocks
  }
}

function runExecutableJson(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(executable)) {
      reject(new Error(`未找到可执行程序：${executable}`))
      return
    }
    const child = spawn(executable, args, {
      cwd: FULL_HISTORY_DATA_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })
    const stdout = []
    const stderr = []
    const timeout = Math.max(10000, Number(options.timeout) || 120000)
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        options.onFinish?.(child)
      } catch {}
      callback(value)
    }
    try {
      options.onSpawn?.(child)
    } catch {}
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish(reject, new Error(`数据库命令执行超时（${Math.round(timeout / 1000)} 秒）`))
    }, timeout)
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', error => finish(reject, new Error(`无法启动 ${path.basename(executable)}：${error.message}`)))
    child.on('close', code => {
      const outText = Buffer.concat(stdout).toString('utf8').trim()
      const errText = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        finish(reject, new Error(errText || outText || `${path.basename(executable)} 退出码 ${code}`))
        return
      }
      const lines = outText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse()
      for (const line of lines) {
        try {
          finish(resolve, JSON.parse(line))
          return
        } catch {}
      }
      finish(reject, new Error(`${path.basename(executable)} 未返回有效 JSON：${outText.slice(-500)}`))
    })
  })
}

function databaseStatusItems(payload) {
  const rows = Array.isArray(payload?.stocks) ? payload.stocks : []
  return rows.map(item => {
    const rawStatus = String(item?.status || 'pending').toLowerCase()
    const normalizedStatus = rawStatus === 'empty' ? 'skipped' : rawStatus === 'completed' ? 'done' : rawStatus
    const securityType = item?.securityType || item?.security_type || inferFullHistorySecurityType(item)
    const status = securityType === 'a_stock' ? normalizedStatus : 'not_applicable'
    return {
      code: normalizeCacheCode(item?.code || ''),
      name: decodeLegacyStockName(item?.name || item?.code || ''),
      securityType,
      status: ['pending', 'running', 'done', 'skipped', 'failed', 'not_applicable'].includes(status) ? status : 'pending',
      rowCount: Number(item?.rowCount) || 0,
      failedCount: status === 'failed' ? 1 : 0,
      skippedCount: status === 'skipped' ? 1 : 0,
      message: status === 'not_applicable'
        ? '历史获取仅限沪深北 A 股'
        : String(item?.message || '').trim() || (status === 'done' ? '已写入数据库' : '未获取'),
      updatedAt: item?.updatedAt || null
    }
  }).filter(item => item.code)
}

function applyDatabaseStatusToJob(payload, job = fullHistoryJob) {
  const items = databaseStatusItems(payload)
  if (items.length || Number(payload?.stockCount) === 0) job.items = items
  const dataset = payload?.dataset || null
  job.databaseFile = STOCK_REVIEW_DATABASE_FILE
  job.indexStartDate = normalizeFullHistoryDate(dataset?.start_date || dataset?.startDate || '')
  job.indexEndDate = normalizeFullHistoryDate(dataset?.end_date || dataset?.endDate || '')
  job.indexedStockCount = items.filter(item => item.status !== 'pending').length
  job.missingStockCount = Number(payload?.missingStockCount ?? items.filter(item => item.status === 'pending' || item.status === 'failed').length) || 0
  return items
}

function databaseQueryExecutable() {
  if (fs.existsSync(FULL_HISTORY_EXECUTABLE)) return FULL_HISTORY_EXECUTABLE
  if (fs.existsSync(FULL_HISTORY_SNAPSHOT_EXECUTABLE)) return FULL_HISTORY_SNAPSHOT_EXECUTABLE
  return ''
}

async function queryFullHistoryDatabaseStatus() {
  const executable = databaseQueryExecutable()
  if (!executable) throw new Error(`未找到数据库查询程序，请放入 ${FULL_HISTORY_EXECUTABLE_NAME} 或 ${path.basename(FULL_HISTORY_SNAPSHOT_EXECUTABLE)}`)
  return runExecutableJson(executable, ['--database', STOCK_REVIEW_DATABASE_NAME, '--status-json'])
}

function normalizeSqliteCalculationDate(value, label) {
  const date = normalizeFullHistoryDate(value)
  if (!date) throw new Error(`请选择有效的${label}`)
  return date
}

function decodeLegacyStockName(value) {
  const text = String(value || '').trim()
  if (!text || /[\u3400-\u9fff]/.test(text) || !/[\x80-\xff]/.test(text)) return text
  try {
    const decoded = new TextDecoder('gb18030').decode(Buffer.from(text, 'latin1')).trim()
    return /[\u3400-\u9fff]/.test(decoded) ? decoded : text
  } catch {
    return text
  }
}

function getSqlJsRuntime() {
  if (!sqlJsRuntimePromise) {
    const runtimeRequire = eval('require')
    const packagedRuntime = path.join(__dirname, 'sql-asm.js')
    const initSqlJs = runtimeRequire(fs.existsSync(packagedRuntime) ? packagedRuntime : 'sql.js/dist/sql-asm.js')
    sqlJsRuntimePromise = initSqlJs()
  }
  return sqlJsRuntimePromise
}

// 历史程序以 WAL 模式写 SQLite。sql.js 只认识主数据库文件，不能把 -wal
// 中的已提交事务一起读写，因此这里只让 sql.js 承担计算页的大批量只读查询；
// 涉及历史数据范围和状态的读写统一交给 Python 标准库 sqlite3 的真实连接。
const SQLITE_HISTORY_BRIDGE_SCRIPT = String.raw`
import datetime
import json
import sqlite3
import sys

payload = json.load(sys.stdin)
database_file = str(payload.get("databaseFile") or "")
operation = str(payload.get("operation") or "")
connection = None

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def one(sql, parameters=()):
    row = connection.execute(sql, parameters).fetchone()
    return dict(row) if row is not None else None

def json_value(value, fallback):
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback

def json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def ensure_calculation_schema():
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS calculation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            calculated_at TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            strategy_version TEXT NOT NULL DEFAULT '',
            strategy_json TEXT NOT NULL,
            market_json TEXT NOT NULL,
            bundle_meta_json TEXT NOT NULL,
            stock_count INTEGER NOT NULL DEFAULT 0 CHECK (stock_count >= 0),
            sector_count INTEGER NOT NULL DEFAULT 0 CHECK (sector_count >= 0),
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_calculation_runs_latest
        ON calculation_runs(calculated_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS calculation_stocks (
            calculation_id INTEGER NOT NULL,
            stock_code TEXT NOT NULL,
            rank INTEGER NOT NULL DEFAULT 0,
            total_score REAL NOT NULL DEFAULT 0,
            risk_penalty REAL NOT NULL DEFAULT 0,
            is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
            result_json TEXT NOT NULL,
            PRIMARY KEY (calculation_id, stock_code),
            FOREIGN KEY (calculation_id) REFERENCES calculation_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_calculation_stocks_rank
        ON calculation_stocks(calculation_id, rank, stock_code);

        CREATE INDEX IF NOT EXISTS idx_calculation_stocks_score
        ON calculation_stocks(calculation_id, total_score DESC);

        CREATE TABLE IF NOT EXISTS calculation_sectors (
            calculation_id INTEGER NOT NULL,
            sector_key TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            score REAL NOT NULL DEFAULT 0,
            result_json TEXT NOT NULL,
            PRIMARY KEY (calculation_id, sector_key),
            FOREIGN KEY (calculation_id) REFERENCES calculation_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_calculation_sectors_order
        ON calculation_sectors(calculation_id, sort_order, sector_key);

        CREATE TABLE IF NOT EXISTS top50_tracking_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_calculation_id INTEGER NOT NULL UNIQUE,
            history_dataset_id INTEGER,
            calculated_at TEXT NOT NULL,
            signal_date TEXT NOT NULL,
            strategy_version TEXT NOT NULL DEFAULT '',
            horizon_days INTEGER NOT NULL DEFAULT 5 CHECK (horizon_days > 0),
            capital_per_stock REAL NOT NULL DEFAULT 10000 CHECK (capital_per_stock > 0),
            cost_rate REAL NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
            entry_date TEXT,
            exit_date TEXT,
            available_days INTEGER NOT NULL DEFAULT 0 CHECK (available_days >= 0),
            status TEXT NOT NULL DEFAULT 'pending',
            stock_count INTEGER NOT NULL DEFAULT 0 CHECK (stock_count >= 0),
            tradable_count INTEGER NOT NULL DEFAULT 0 CHECK (tradable_count >= 0),
            win_count INTEGER NOT NULL DEFAULT 0 CHECK (win_count >= 0),
            loss_count INTEGER NOT NULL DEFAULT 0 CHECK (loss_count >= 0),
            flat_count INTEGER NOT NULL DEFAULT 0 CHECK (flat_count >= 0),
            win_rate REAL,
            sum_price_change REAL,
            sum_return_pct REAL,
            avg_return_pct REAL,
            total_investment REAL,
            total_profit REAL,
            portfolio_return_pct REAL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_top50_tracking_runs_latest
        ON top50_tracking_runs(signal_date DESC, calculated_at DESC, id DESC);

        CREATE INDEX IF NOT EXISTS idx_top50_tracking_runs_status
        ON top50_tracking_runs(status, signal_date);

        CREATE TABLE IF NOT EXISTS top50_tracking_items (
            tracking_id INTEGER NOT NULL,
            stock_code TEXT NOT NULL,
            stock_name TEXT NOT NULL DEFAULT '',
            rank INTEGER NOT NULL,
            total_score REAL NOT NULL DEFAULT 0,
            signal_date TEXT NOT NULL,
            signal_close REAL NOT NULL DEFAULT 0,
            entry_date TEXT,
            entry_open REAL,
            exit_date TEXT,
            exit_price_date TEXT,
            exit_close REAL,
            shares INTEGER NOT NULL DEFAULT 0 CHECK (shares >= 0),
            gross_return_pct REAL,
            net_return_pct REAL,
            price_change REAL,
            investment_amount REAL,
            profit_amount REAL,
            result_status TEXT NOT NULL DEFAULT 'pending',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (tracking_id, stock_code),
            FOREIGN KEY (tracking_id) REFERENCES top50_tracking_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_top50_tracking_items_rank
        ON top50_tracking_items(tracking_id, rank, stock_code);

        CREATE INDEX IF NOT EXISTS idx_top50_tracking_items_result
        ON top50_tracking_items(tracking_id, result_status, net_return_pct DESC);
    """)
    # 兼容已经运行过早期开发版本的数据库，新增汇总字段时进行轻量原地迁移。
    tracking_columns = {
        str(row[1]) for row in connection.execute("PRAGMA table_info(top50_tracking_runs)").fetchall()
    }
    if "history_dataset_id" not in tracking_columns:
        connection.execute("ALTER TABLE top50_tracking_runs ADD COLUMN history_dataset_id INTEGER")
    if "sum_price_change" not in tracking_columns:
        connection.execute("ALTER TABLE top50_tracking_runs ADD COLUMN sum_price_change REAL")

def calculation_record(row):
    strategy = json_value(row.get("strategy_json"), {})
    return {
        "id": str(row.get("id")),
        "savedAt": str(row.get("calculated_at") or row.get("created_at") or ""),
        "calculationRange": {
            "startDate": str(row.get("start_date") or ""),
            "endDate": str(row.get("end_date") or "")
        },
        "stockCount": int(row.get("stock_count") or 0),
        "sectorCount": int(row.get("sector_count") or 0),
        "strategyVersion": str(row.get("strategy_version") or strategy.get("version") or ""),
        "strategy": strategy
    }

def list_calculation_records():
    rows = connection.execute("""
        SELECT id, calculated_at, start_date, end_date, strategy_version,
               strategy_json, stock_count, sector_count, created_at
        FROM calculation_runs
        ORDER BY calculated_at DESC, id DESC
        LIMIT 5
    """).fetchall()
    return [calculation_record(dict(row)) for row in rows]

def number(value, fallback=0.0):
    try:
        parsed = float(value)
        return parsed if parsed == parsed else fallback
    except Exception:
        return fallback

def rounded(value, digits=4):
    return round(number(value), digits)

def top50_tracking_record(row):
    return {
        "id": str(row.get("id")),
        "sourceCalculationId": str(row.get("source_calculation_id")),
        "historyDatasetId": None if row.get("history_dataset_id") is None else int(row.get("history_dataset_id")),
        "calculatedAt": str(row.get("calculated_at") or ""),
        "signalDate": str(row.get("signal_date") or ""),
        "strategyVersion": str(row.get("strategy_version") or ""),
        "horizonDays": int(row.get("horizon_days") or 5),
        "capitalPerStock": number(row.get("capital_per_stock"), 10000),
        "costRate": number(row.get("cost_rate"), 0),
        "entryDate": str(row.get("entry_date") or ""),
        "exitDate": str(row.get("exit_date") or ""),
        "availableDays": int(row.get("available_days") or 0),
        "status": str(row.get("status") or "pending"),
        "stockCount": int(row.get("stock_count") or 0),
        "tradableCount": int(row.get("tradable_count") or 0),
        "winCount": int(row.get("win_count") or 0),
        "lossCount": int(row.get("loss_count") or 0),
        "flatCount": int(row.get("flat_count") or 0),
        "winRate": None if row.get("win_rate") is None else number(row.get("win_rate")),
        "sumPriceChange": None if row.get("sum_price_change") is None else number(row.get("sum_price_change")),
        "sumReturnPct": None if row.get("sum_return_pct") is None else number(row.get("sum_return_pct")),
        "avgReturnPct": None if row.get("avg_return_pct") is None else number(row.get("avg_return_pct")),
        "totalInvestment": None if row.get("total_investment") is None else number(row.get("total_investment")),
        "totalProfit": None if row.get("total_profit") is None else number(row.get("total_profit")),
        "portfolioReturnPct": None if row.get("portfolio_return_pct") is None else number(row.get("portfolio_return_pct")),
        "updatedAt": str(row.get("updated_at") or "")
    }

def list_top50_tracking_records():
    rows = connection.execute("""
        SELECT * FROM top50_tracking_runs
        ORDER BY signal_date DESC, calculated_at DESC, id DESC
        LIMIT 250
    """).fetchall()
    return [top50_tracking_record(dict(row)) for row in rows]

def cleanup_top50_tracking_records(limit=250):
    stale_ids = [int(row["id"]) for row in connection.execute("""
        SELECT id FROM top50_tracking_runs
        ORDER BY signal_date DESC, calculated_at DESC, id DESC
        LIMIT -1 OFFSET ?
    """, (limit,)).fetchall()]
    if stale_ids:
        connection.executemany(
            "DELETE FROM top50_tracking_runs WHERE id = ?",
            [(item,) for item in stale_ids]
        )
    return stale_ids

def create_top50_tracking_for_calculation(calculation_id):
    run = one("""
        SELECT id, calculated_at, end_date, strategy_version, strategy_json, market_json
        FROM calculation_runs WHERE id = ?
    """, (calculation_id,))
    if not run:
        return None

    strategy = json_value(run.get("strategy_json"), {})
    market = json_value(run.get("market_json"), {})
    signal_date = str(market.get("tradeDate") or run.get("end_date") or "")
    if not signal_date:
        return None
    now = utc_now()
    dataset = one("SELECT id FROM history_datasets WHERE is_active = 1 ORDER BY id DESC LIMIT 1")
    connection.execute("""
        INSERT OR IGNORE INTO top50_tracking_runs (
            source_calculation_id, history_dataset_id, calculated_at, signal_date, strategy_version,
            horizon_days, capital_per_stock, cost_rate, status,
            stock_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 5, 10000, ?, 'pending', 0, ?, ?)
    """, (
        calculation_id,
        int(dataset["id"]) if dataset else None,
        run.get("calculated_at"),
        signal_date,
        str(run.get("strategy_version") or strategy.get("version") or ""),
        number(strategy.get("costRate"), 0.15),
        now,
        now
    ))
    tracking = one("SELECT id FROM top50_tracking_runs WHERE source_calculation_id = ?", (calculation_id,))
    if not tracking:
        return None
    tracking_id = int(tracking["id"])
    existing_count = one("SELECT COUNT(*) AS count FROM top50_tracking_items WHERE tracking_id = ?", (tracking_id,)) or {}
    if int(existing_count.get("count") or 0) == 0:
        rows = connection.execute("""
            SELECT stock_code, rank, total_score, result_json
            FROM calculation_stocks
            WHERE calculation_id = ?
            ORDER BY rank, stock_code
            LIMIT 50
        """, (calculation_id,)).fetchall()
        items = []
        for row in rows:
            stock = json_value(row["result_json"], {})
            items.append((
                tracking_id,
                str(row["stock_code"]),
                str(stock.get("name") or row["stock_code"]),
                int(row["rank"] or 0),
                number(row["total_score"]),
                signal_date,
                number(stock.get("close")),
                now
            ))
        connection.executemany("""
            INSERT INTO top50_tracking_items (
                tracking_id, stock_code, stock_name, rank, total_score,
                signal_date, signal_close, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, items)
        connection.execute(
            "UPDATE top50_tracking_runs SET stock_count = ?, updated_at = ? WHERE id = ?",
            (len(items), now, tracking_id)
        )
    return tracking_id

def backfill_top50_tracking():
    rows = connection.execute("""
        SELECT r.id
        FROM calculation_runs r
        LEFT JOIN top50_tracking_runs t ON t.source_calculation_id = r.id
        WHERE t.id IS NULL
        ORDER BY r.calculated_at, r.id
    """).fetchall()
    for row in rows:
        create_top50_tracking_for_calculation(int(row["id"]))

def future_market_dates(dataset_id, signal_date, horizon_days):
    # 至少有 1000 只股票有数据才视为完整市场交易日，避免单股补数被误计为 T+1。
    rows = connection.execute("""
        SELECT b.trade_date
        FROM daily_bars b
        WHERE b.dataset_id = ? AND b.trade_date > ?
        GROUP BY b.trade_date
        HAVING COUNT(DISTINCT b.stock_code) >= 1000
        ORDER BY b.trade_date
        LIMIT ?
    """, (dataset_id, signal_date, horizon_days)).fetchall()
    return [str(row["trade_date"]) for row in rows]

def refresh_top50_tracking_run(tracking_id, dataset_id, force=False):
    run = one("SELECT * FROM top50_tracking_runs WHERE id = ?", (tracking_id,))
    if not run or (run.get("status") == "completed" and not force):
        return
    stored_dataset_id = int(run.get("history_dataset_id") or 0)
    if stored_dataset_id:
        stored_dataset = one("SELECT id FROM history_datasets WHERE id = ?", (stored_dataset_id,))
        if stored_dataset:
            dataset_id = stored_dataset_id
    horizon_days = int(run.get("horizon_days") or 5)
    dates = future_market_dates(dataset_id, str(run.get("signal_date") or ""), horizon_days)
    available_days = len(dates)
    entry_date = dates[0] if dates else ""
    # 有几个未来交易日就先计算到第几个；达到 horizon_days 后结果转为最终状态。
    exit_date = dates[-1] if dates else ""
    now = utc_now()
    if available_days == 0:
        connection.execute("""
            UPDATE top50_tracking_runs
            SET available_days = ?, entry_date = NULLIF(?, ''), exit_date = NULL,
                status = 'pending', tradable_count = 0, win_count = 0,
                loss_count = 0, flat_count = 0, win_rate = NULL,
                sum_price_change = NULL, sum_return_pct = NULL, avg_return_pct = NULL,
                total_investment = NULL, total_profit = NULL, portfolio_return_pct = NULL,
                updated_at = ?
            WHERE id = ?
        """, (available_days, entry_date, now, tracking_id))
        connection.execute("""
            UPDATE top50_tracking_items
            SET entry_date = NULLIF(?, ''), entry_open = NULL, exit_date = NULL,
                exit_price_date = NULL, exit_close = NULL, shares = 0,
                gross_return_pct = NULL, net_return_pct = NULL, price_change = NULL,
                investment_amount = NULL, profit_amount = NULL,
                result_status = 'pending', updated_at = ?
            WHERE tracking_id = ?
        """, (entry_date, now, tracking_id))
        return

    capital_per_stock = number(run.get("capital_per_stock"), 10000)
    cost_rate = number(run.get("cost_rate"), 0.15)
    items = connection.execute("""
        SELECT stock_code FROM top50_tracking_items
        WHERE tracking_id = ? ORDER BY rank, stock_code
    """, (tracking_id,)).fetchall()
    results = []
    for item in items:
        code = str(item["stock_code"])
        entry = one("""
            SELECT open FROM daily_bars
            WHERE dataset_id = ? AND stock_code = ? AND trade_date = ?
        """, (dataset_id, code, entry_date))
        entry_open = number(entry.get("open")) if entry else 0
        if entry_open <= 0:
            results.append((
                entry_date, exit_date, None, None, 0, None, None, None,
                None, None, 'entry_missing', now, tracking_id, code
            ))
            continue

        exit_row = one("""
            SELECT trade_date, close FROM daily_bars
            WHERE dataset_id = ? AND stock_code = ?
              AND trade_date BETWEEN ? AND ? AND close IS NOT NULL AND close > 0
            ORDER BY trade_date DESC
            LIMIT 1
        """, (dataset_id, code, entry_date, exit_date))
        exit_close = number(exit_row.get("close")) if exit_row else 0
        if exit_close <= 0:
            results.append((
                entry_date, exit_date, None, entry_open, 0, None, None, None,
                None, None, 'exit_missing', now, tracking_id, code
            ))
            continue

        shares = int(capital_per_stock / entry_open / 100) * 100
        if shares < 100:
            results.append((
                entry_date, exit_date, str(exit_row.get("trade_date") or ""), entry_open,
                0, exit_close, None, exit_close - entry_open, None, None,
                'insufficient_capital', now, tracking_id, code
            ))
            continue

        gross_return_pct = (exit_close / entry_open - 1) * 100
        net_return_pct = gross_return_pct - cost_rate
        investment_amount = shares * entry_open
        profit_amount = shares * (exit_close - entry_open) - investment_amount * cost_rate / 100
        is_final = available_days >= horizon_days
        if str(exit_row.get("trade_date")) == exit_date:
            result_status = 'completed' if is_final else 'partial'
        else:
            result_status = 'completed_estimated' if is_final else 'partial_estimated'
        results.append((
            entry_date, exit_date, str(exit_row.get("trade_date") or ""), entry_open,
            shares, exit_close, rounded(gross_return_pct), rounded(exit_close - entry_open),
            rounded(investment_amount, 2), rounded(profit_amount, 2), result_status,
            now, tracking_id, code, rounded(net_return_pct)
        ))

    for values in results:
        if len(values) == 14:
            (item_entry_date, item_exit_date, exit_price_date, entry_open, shares,
             exit_close, gross_return_pct, price_change, investment_amount,
             profit_amount, result_status, item_updated_at, item_tracking_id, code) = values
            net_return_pct = None
        else:
            (item_entry_date, item_exit_date, exit_price_date, entry_open, shares,
             exit_close, gross_return_pct, price_change, investment_amount,
             profit_amount, result_status, item_updated_at, item_tracking_id, code,
             net_return_pct) = values
        connection.execute("""
            UPDATE top50_tracking_items
            SET entry_date = ?, exit_date = ?, exit_price_date = ?, entry_open = ?,
                shares = ?, exit_close = ?, gross_return_pct = ?, net_return_pct = ?,
                price_change = ?, investment_amount = ?, profit_amount = ?,
                result_status = ?, updated_at = ?
            WHERE tracking_id = ? AND stock_code = ?
        """, (
            item_entry_date, item_exit_date, exit_price_date, entry_open,
            shares, exit_close, gross_return_pct, net_return_pct,
            price_change, investment_amount, profit_amount,
            result_status, item_updated_at, item_tracking_id, code
        ))

    summary = one("""
        SELECT
            COUNT(*) AS tradable_count,
            SUM(CASE WHEN net_return_pct > 0 THEN 1 ELSE 0 END) AS win_count,
            SUM(CASE WHEN net_return_pct < 0 THEN 1 ELSE 0 END) AS loss_count,
            SUM(CASE WHEN net_return_pct = 0 THEN 1 ELSE 0 END) AS flat_count,
            SUM(price_change) AS sum_price_change,
            SUM(net_return_pct) AS sum_return_pct,
            AVG(net_return_pct) AS avg_return_pct,
            SUM(investment_amount) AS total_investment,
            SUM(profit_amount) AS total_profit
        FROM top50_tracking_items
        WHERE tracking_id = ?
          AND result_status IN ('partial', 'partial_estimated', 'completed', 'completed_estimated')
    """, (tracking_id,)) or {}
    tradable_count = int(summary.get("tradable_count") or 0)
    win_count = int(summary.get("win_count") or 0)
    total_investment = number(summary.get("total_investment"))
    total_profit = number(summary.get("total_profit"))
    win_rate = (win_count / tradable_count * 100) if tradable_count else 0
    portfolio_return_pct = (total_profit / total_investment * 100) if total_investment else 0
    run_status = 'completed' if available_days >= horizon_days else 'partial'
    connection.execute("""
        UPDATE top50_tracking_runs
        SET entry_date = ?, exit_date = ?, available_days = ?, status = ?,
            tradable_count = ?, win_count = ?, loss_count = ?, flat_count = ?,
            win_rate = ?, sum_price_change = ?, sum_return_pct = ?, avg_return_pct = ?,
            total_investment = ?, total_profit = ?, portfolio_return_pct = ?,
            updated_at = ?
        WHERE id = ?
    """, (
        entry_date, exit_date, available_days, run_status, tradable_count, win_count,
        int(summary.get("loss_count") or 0), int(summary.get("flat_count") or 0),
        rounded(win_rate), rounded(summary.get("sum_price_change")), rounded(summary.get("sum_return_pct")),
        rounded(summary.get("avg_return_pct")), rounded(total_investment, 2),
        rounded(total_profit, 2), rounded(portfolio_return_pct), now, tracking_id
    ))

def refresh_top50_tracking(tracking_id=None, force=False):
    backfill_top50_tracking()
    dataset = one("SELECT id FROM history_datasets WHERE is_active = 1 ORDER BY id DESC LIMIT 1")
    if not dataset:
        return
    if tracking_id:
        ids = [int(tracking_id)]
    else:
        query = "SELECT id FROM top50_tracking_runs"
        if not force:
            query += " WHERE status <> 'completed'"
        query += " ORDER BY signal_date, calculated_at, id"
        ids = [int(row["id"]) for row in connection.execute(query).fetchall()]
    for item in ids:
        refresh_top50_tracking_run(item, int(dataset["id"]), force)

def top50_tracking_detail(tracking_id):
    run = one("SELECT * FROM top50_tracking_runs WHERE id = ?", (tracking_id,))
    if not run:
        raise ValueError("所选 Top50 跟踪记录不存在")
    rows = connection.execute("""
        SELECT * FROM top50_tracking_items
        WHERE tracking_id = ? ORDER BY rank, stock_code
    """, (tracking_id,)).fetchall()
    items = []
    for raw in rows:
        row = dict(raw)
        items.append({
            "stockCode": str(row.get("stock_code") or ""),
            "stockName": str(row.get("stock_name") or ""),
            "rank": int(row.get("rank") or 0),
            "totalScore": number(row.get("total_score")),
            "signalDate": str(row.get("signal_date") or ""),
            "signalClose": number(row.get("signal_close")),
            "entryDate": str(row.get("entry_date") or ""),
            "entryOpen": None if row.get("entry_open") is None else number(row.get("entry_open")),
            "exitDate": str(row.get("exit_date") or ""),
            "exitPriceDate": str(row.get("exit_price_date") or ""),
            "exitClose": None if row.get("exit_close") is None else number(row.get("exit_close")),
            "shares": int(row.get("shares") or 0),
            "grossReturnPct": None if row.get("gross_return_pct") is None else number(row.get("gross_return_pct")),
            "netReturnPct": None if row.get("net_return_pct") is None else number(row.get("net_return_pct")),
            "priceChange": None if row.get("price_change") is None else number(row.get("price_change")),
            "investmentAmount": None if row.get("investment_amount") is None else number(row.get("investment_amount")),
            "profitAmount": None if row.get("profit_amount") is None else number(row.get("profit_amount")),
            "resultStatus": str(row.get("result_status") or "pending"),
            "updatedAt": str(row.get("updated_at") or "")
        })
    return {"record": top50_tracking_record(run), "items": items}

try:
    if not database_file:
        raise ValueError("未提供 SQLite 数据库文件")

    connection = sqlite3.connect(database_file, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 30000")

    if operation == "list_calculation_results":
        ensure_calculation_schema()
        connection.commit()
        result = {
            "ok": True,
            "databaseFile": database_file,
            "records": list_calculation_records()
        }

    elif operation == "save_calculation_result":
        bundle = payload.get("bundle") or {}
        strategy = payload.get("strategy") or {}
        market = bundle.get("market") or {}
        sectors = bundle.get("sectors") if isinstance(bundle.get("sectors"), list) else []
        stocks = bundle.get("stocks") if isinstance(bundle.get("stocks"), list) else []
        calculation_range = bundle.get("calculationRange") or {}
        start_date = str(calculation_range.get("startDate") or payload.get("startDate") or "")
        end_date = str(calculation_range.get("endDate") or payload.get("endDate") or "")
        if not start_date or not end_date:
            raise ValueError("计算结果缺少开始日期或结束日期")
        if not stocks:
            raise ValueError("计算结果中没有股票数据")

        calculated_at = str(payload.get("savedAt") or bundle.get("updatedAt") or utc_now())
        created_at = utc_now()
        excluded_meta_keys = {"market", "sectors", "stocks", "rawRows"}
        bundle_meta = {key: value for key, value in bundle.items() if key not in excluded_meta_keys}
        bundle_meta["rawRows"] = []

        ensure_calculation_schema()
        connection.execute("BEGIN IMMEDIATE")
        cursor = connection.execute("""
            INSERT INTO calculation_runs (
                calculated_at, start_date, end_date, strategy_version,
                strategy_json, market_json, bundle_meta_json,
                stock_count, sector_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            calculated_at,
            start_date,
            end_date,
            str(strategy.get("version") or ""),
            json_text(strategy),
            json_text(market),
            json_text(bundle_meta),
            len(stocks),
            len(sectors),
            created_at
        ))
        calculation_id = int(cursor.lastrowid)

        stock_rows = []
        for index, stock in enumerate(stocks):
            if not isinstance(stock, dict):
                continue
            code = str(stock.get("code") or stock.get("thscode") or stock.get("thsCode") or "").strip().upper()
            if not code:
                continue
            stock_rows.append((
                calculation_id,
                code,
                int(stock.get("rank") or index + 1),
                float(stock.get("totalScore") or 0),
                float(stock.get("riskPenalty") or 0),
                1 if stock.get("selected") else 0,
                json_text(stock)
            ))
        connection.executemany("""
            INSERT INTO calculation_stocks (
                calculation_id, stock_code, rank, total_score,
                risk_penalty, is_selected, result_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, stock_rows)

        sector_rows = []
        for index, sector in enumerate(sectors):
            if not isinstance(sector, dict):
                continue
            sector_key = str(sector.get("key") or "sector-%d" % (index + 1))
            sector_rows.append((
                calculation_id,
                sector_key,
                index + 1,
                float(sector.get("score") or 0),
                json_text(sector)
            ))
        connection.executemany("""
            INSERT INTO calculation_sectors (
                calculation_id, sector_key, sort_order, score, result_json
            ) VALUES (?, ?, ?, ?, ?)
        """, sector_rows)

        # Top50 跟踪只保存计算快照和必要字段，生命周期独立于“最近 5 次完整计算结果”。
        tracking_id = create_top50_tracking_for_calculation(calculation_id)
        cleanup_top50_tracking_records()

        stale_ids = [row[0] for row in connection.execute("""
            SELECT id FROM calculation_runs
            ORDER BY calculated_at DESC, id DESC
            LIMIT -1 OFFSET 5
        """).fetchall()]
        if stale_ids:
            connection.executemany("DELETE FROM calculation_runs WHERE id = ?", [(item,) for item in stale_ids])
        connection.commit()

        record_row = one("""
            SELECT id, calculated_at, start_date, end_date, strategy_version,
                   strategy_json, stock_count, sector_count, created_at
            FROM calculation_runs WHERE id = ?
        """, (calculation_id,))
        result = {
            "ok": True,
            "databaseFile": database_file,
            "record": calculation_record(record_row),
            "records": list_calculation_records(),
            "top50TrackingId": str(tracking_id or ""),
            "deletedCalculationIds": [str(item) for item in stale_ids]
        }

    elif operation == "read_calculation_result":
        ensure_calculation_schema()
        calculation_id = int(payload.get("calculationId") or 0)
        if not calculation_id:
            raise ValueError("未提供要读取的计算记录 ID")
        run = one("""
            SELECT id, calculated_at, start_date, end_date, strategy_version,
                   strategy_json, market_json, bundle_meta_json,
                   stock_count, sector_count, created_at
            FROM calculation_runs WHERE id = ?
        """, (calculation_id,))
        if not run:
            raise ValueError("所选计算记录不存在，可能已被最近五次保留规则清理")

        stock_rows = connection.execute("""
            SELECT result_json FROM calculation_stocks
            WHERE calculation_id = ?
            ORDER BY rank, stock_code
        """, (calculation_id,)).fetchall()
        sector_rows = connection.execute("""
            SELECT result_json FROM calculation_sectors
            WHERE calculation_id = ?
            ORDER BY sort_order, sector_key
        """, (calculation_id,)).fetchall()
        stocks = [json_value(row["result_json"], {}) for row in stock_rows]
        sectors = [json_value(row["result_json"], {}) for row in sector_rows]
        bundle = json_value(run.get("bundle_meta_json"), {})
        bundle.update({
            "market": json_value(run.get("market_json"), {}),
            "sectors": sectors,
            "stocks": stocks,
            "rawRows": [],
            "calculationRange": {
                "startDate": str(run.get("start_date") or ""),
                "endDate": str(run.get("end_date") or "")
            },
            "databaseFile": database_file
        })
        result = {
            "ok": True,
            "databaseFile": database_file,
            "record": calculation_record(run),
            "strategy": json_value(run.get("strategy_json"), {}),
            "bundle": bundle
        }

    elif operation == "delete_calculation_result":
        ensure_calculation_schema()
        calculation_id = int(payload.get("calculationId") or 0)
        if not calculation_id:
            raise ValueError("未提供要删除的计算记录 ID")
        connection.execute("BEGIN IMMEDIATE")
        run = one("SELECT id, calculated_at FROM calculation_runs WHERE id = ?", (calculation_id,))
        if not run:
            raise ValueError("所选计算记录不存在或已经被删除")
        tracking_ids = [str(row["id"]) for row in connection.execute(
            "SELECT id FROM top50_tracking_runs WHERE source_calculation_id = ?",
            (calculation_id,)
        ).fetchall()]
        # Top50 跟踪与完整计算结果生命周期独立，所以显式删除关联跟踪批次；
        # 逐股、板块和跟踪明细分别由外键级联清理。
        connection.execute(
            "DELETE FROM top50_tracking_runs WHERE source_calculation_id = ?",
            (calculation_id,)
        )
        connection.execute("DELETE FROM calculation_runs WHERE id = ?", (calculation_id,))
        connection.commit()
        result = {
            "ok": True,
            "databaseFile": database_file,
            "deletedCalculationId": str(calculation_id),
            "deletedTrackingIds": tracking_ids,
            "records": list_calculation_records()
        }

    elif operation == "refresh_top50_performance":
        ensure_calculation_schema()
        connection.execute("BEGIN IMMEDIATE")
        tracking_id = int(payload.get("trackingId") or 0)
        refresh_top50_tracking(
            tracking_id if tracking_id else None,
            bool(payload.get("force"))
        )
        deleted_ids = cleanup_top50_tracking_records()
        connection.commit()
        result = {
            "ok": True,
            "databaseFile": database_file,
            "records": list_top50_tracking_records(),
            "deletedTrackingIds": [str(item) for item in deleted_ids]
        }

    elif operation == "read_top50_performance":
        ensure_calculation_schema()
        tracking_id = int(payload.get("trackingId") or 0)
        if not tracking_id:
            raise ValueError("未提供要读取的 Top50 跟踪记录 ID")
        connection.commit()
        detail = top50_tracking_detail(tracking_id)
        result = {
            "ok": True,
            "databaseFile": database_file,
            **detail
        }

    elif operation == "inspect_coverage":
        connection.execute("PRAGMA query_only = ON")
        dataset = one("""
            SELECT id, start_date AS startDate, end_date AS endDate, source, adjust
            FROM history_datasets
            WHERE is_active = 1
            ORDER BY id DESC
            LIMIT 1
        """)
        if not dataset:
            result = {
                "ok": True,
                "datasetId": None,
                "existingStartDate": "",
                "existingEndDate": "",
                "existingTradeDateCount": 0,
                "overlapRanges": []
            }
        else:
            coverage = one("""
                SELECT MIN(trade_date) AS startDate,
                       MAX(trade_date) AS endDate,
                       COUNT(DISTINCT trade_date) AS tradeDateCount
                FROM daily_bars
                WHERE dataset_id = ?
            """, (dataset["id"],)) or {}
            overlap = one("""
                SELECT MIN(trade_date) AS startDate,
                       MAX(trade_date) AS endDate,
                       COUNT(DISTINCT trade_date) AS tradeDateCount
                FROM daily_bars
                WHERE dataset_id = ?
                  AND trade_date BETWEEN ? AND ?
            """, (dataset["id"], payload.get("startDate"), payload.get("endDate"))) or {}
            overlap_count = int(overlap.get("tradeDateCount") or 0)
            result = {
                "ok": True,
                "datasetId": int(dataset["id"]),
                "source": str(dataset.get("source") or "baostock"),
                "adjust": str(dataset.get("adjust") or "1"),
                "existingStartDate": str(coverage.get("startDate") or ""),
                "existingEndDate": str(coverage.get("endDate") or ""),
                "existingTradeDateCount": int(coverage.get("tradeDateCount") or 0),
                "overlapRanges": ([{
                    "startDate": str(overlap.get("startDate") or ""),
                    "endDate": str(overlap.get("endDate") or ""),
                    "tradeDateCount": overlap_count
                }] if overlap_count else [])
            }

    elif operation == "prepare_append":
        dataset_id = int(payload.get("datasetId") or 0)
        if not dataset_id:
            raise ValueError("未找到要追加的活动历史数据集")
        now = utc_now()
        connection.execute("BEGIN IMMEDIATE")
        active = one("SELECT id FROM history_datasets WHERE id = ? AND is_active = 1", (dataset_id,))
        if not active:
            raise ValueError("活动历史数据集已发生变化，请刷新页面后重试")
        connection.execute("""
            UPDATE history_datasets
            SET start_date = ?,
                end_date = ?,
                status = 'ready',
                updated_at = ?,
                completed_at = NULL,
                message = '准备追加新的历史日期区间'
            WHERE id = ?
        """, (payload.get("startDate"), payload.get("endDate"), now, dataset_id))
        connection.execute("DELETE FROM stock_history_status WHERE dataset_id = ?", (dataset_id,))
        connection.commit()
        result = {"ok": True, "datasetId": dataset_id}

    elif operation == "reconcile_append":
        connection.execute("BEGIN IMMEDIATE")
        dataset = one("""
            SELECT id FROM history_datasets
            WHERE is_active = 1
            ORDER BY id DESC
            LIMIT 1
        """)
        if not dataset:
            raise ValueError("未找到活动历史数据集，无法同步历史日期范围")
        dataset_id = int(dataset["id"])
        expected_dataset_id = int(payload.get("datasetId") or 0)
        if expected_dataset_id and dataset_id != expected_dataset_id:
            raise ValueError("活动历史数据集已发生变化，拒绝合并到其他数据集")
        coverage = one("""
            SELECT MIN(trade_date) AS startDate, MAX(trade_date) AS endDate
            FROM daily_bars
            WHERE dataset_id = ?
        """, (dataset_id,)) or {}
        merged_start = str(coverage.get("startDate") or payload.get("previousStartDate") or payload.get("startDate") or "")
        merged_end = str(coverage.get("endDate") or payload.get("previousEndDate") or payload.get("endDate") or "")
        now = utc_now()
        connection.execute("""
            UPDATE history_datasets
            SET start_date = ?,
                end_date = ?,
                updated_at = ?,
                message = '历史数据已按非重合日期区间追加'
            WHERE id = ?
        """, (merged_start, merged_end, now, dataset_id))
        connection.execute("""
            UPDATE stock_history_status
            SET request_start_date = ?,
                request_end_date = ?,
                first_trade_date = (
                    SELECT MIN(b.trade_date) FROM daily_bars b
                    WHERE b.dataset_id = stock_history_status.dataset_id
                      AND b.stock_code = stock_history_status.stock_code
                ),
                last_trade_date = (
                    SELECT MAX(b.trade_date) FROM daily_bars b
                    WHERE b.dataset_id = stock_history_status.dataset_id
                      AND b.stock_code = stock_history_status.stock_code
                ),
                row_count = (
                    SELECT COUNT(*) FROM daily_bars b
                    WHERE b.dataset_id = stock_history_status.dataset_id
                      AND b.stock_code = stock_history_status.stock_code
                ),
                status = CASE WHEN EXISTS (
                    SELECT 1 FROM daily_bars b
                    WHERE b.dataset_id = stock_history_status.dataset_id
                      AND b.stock_code = stock_history_status.stock_code
                ) THEN 'done' ELSE status END,
                error_message = CASE WHEN EXISTS (
                    SELECT 1 FROM daily_bars b
                    WHERE b.dataset_id = stock_history_status.dataset_id
                      AND b.stock_code = stock_history_status.stock_code
                ) THEN '' ELSE error_message END,
                updated_at = ?
            WHERE dataset_id = ?
        """, (merged_start, merged_end, now, dataset_id))
        connection.commit()

        # checkpoint 只是回收 WAL 空间；即使有其他读连接导致 busy，事务本身也已经安全提交。
        checkpoint = list(connection.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone())
        result = {
            "ok": True,
            "datasetId": dataset_id,
            "startDate": merged_start,
            "endDate": merged_end,
            "checkpoint": checkpoint
        }
    else:
        raise ValueError("不支持的 SQLite 历史数据操作: %s" % operation)
except Exception as error:
    if connection is not None:
        try:
            connection.rollback()
        except Exception:
            pass
    result = {"ok": False, "error": str(error)}
finally:
    if connection is not None:
        connection.close()

print(json.dumps(result, ensure_ascii=False))
`

function formatSqliteHistoryBridgeError(error) {
  const message = String(error?.message || error || 'SQLite 操作失败').trim()
  if (/database is locked|database table is locked/i.test(message)) {
    return new Error('SQLite 正被其他历史任务或数据库工具写入，请等待写入完成后重试')
  }
  return new Error(message)
}

async function runSqliteHistoryOperation(operation, payload = {}) {
  const input = {
    ...payload,
    operation,
    databaseFile: STOCK_REVIEW_DATABASE_FILE
  }
  const candidates = Array.from(new Set([
    String(process.env.PYTHON || '').trim(),
    'python',
    'py'
  ].filter(Boolean)))
  let lastStartError = null

  for (const pythonPath of candidates) {
    try {
      const result = await runPythonJson({
        pythonPath,
        script: SQLITE_HISTORY_BRIDGE_SCRIPT,
        input,
        timeout: operation === 'save_calculation_result' ? 180000 : 120000,
        label: 'SQLite 数据库操作'
      })
      if (!result?.ok) throw new Error(result?.error || 'SQLite 数据库操作失败')
      return result
    } catch (error) {
      if (/无法启动 Python/i.test(String(error?.message || error))) {
        lastStartError = error
        continue
      }
      throw formatSqliteHistoryBridgeError(error)
    }
  }

  throw new Error(`无法启动 Python sqlite3 运行环境：${lastStartError?.message || '未找到 python/py 命令'}`)
}

async function listCalculationResultsFromSqlite() {
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    return { ok: true, databaseFile: STOCK_REVIEW_DATABASE_FILE, records: [] }
  }
  return runSqliteHistoryOperation('list_calculation_results')
}

async function saveCalculationResultToSqlite(options = {}) {
  if (isFullHistoryActive()) throw new Error('历史数据正在写入 SQLite，请等待获取完成后再计算')
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    throw new Error(`未找到 SQLite 数据库：${STOCK_REVIEW_DATABASE_FILE}`)
  }
  return runSqliteHistoryOperation('save_calculation_result', {
    bundle: options.bundle || {},
    strategy: options.strategy || {},
    savedAt: options.savedAt || new Date().toISOString()
  })
}

async function readCalculationResultFromSqlite(options = {}) {
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    throw new Error(`未找到 SQLite 数据库：${STOCK_REVIEW_DATABASE_FILE}`)
  }
  return runSqliteHistoryOperation('read_calculation_result', {
    calculationId: String(options.calculationId || options.id || '')
  })
}

async function deleteCalculationResultFromSqlite(options = {}) {
  if (isFullHistoryActive()) throw new Error('历史数据正在写入 SQLite，请等待获取完成后再删除计算记录')
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    throw new Error(`未找到 SQLite 数据库：${STOCK_REVIEW_DATABASE_FILE}`)
  }
  return runSqliteHistoryOperation('delete_calculation_result', {
    calculationId: String(options.calculationId || options.id || '')
  })
}

async function refreshTop50PerformanceFromSqlite(options = {}) {
  if (isFullHistoryActive()) throw new Error('历史数据正在写入 SQLite，请等待获取完成后再刷新 Top50 跟踪')
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    return { ok: true, databaseFile: STOCK_REVIEW_DATABASE_FILE, records: [] }
  }
  return runSqliteHistoryOperation('refresh_top50_performance', {
    trackingId: String(options.trackingId || options.id || ''),
    force: Boolean(options.force)
  })
}

async function readTop50PerformanceFromSqlite(options = {}) {
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    throw new Error(`未找到 SQLite 数据库：${STOCK_REVIEW_DATABASE_FILE}`)
  }
  return runSqliteHistoryOperation('read_top50_performance', {
    trackingId: String(options.trackingId || options.id || '')
  })
}

async function inspectFullHistoryDateCoverage(startDate, endDate) {
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    return { datasetId: null, existingStartDate: '', existingEndDate: '', overlapRanges: [] }
  }
  const result = await runSqliteHistoryOperation('inspect_coverage', { startDate, endDate })
  return {
    datasetId: result.datasetId ? Number(result.datasetId) : null,
    source: String(result.source || 'baostock'),
    adjust: String(result.adjust || '1'),
    existingStartDate: normalizeFullHistoryDate(result.existingStartDate),
    existingEndDate: normalizeFullHistoryDate(result.existingEndDate),
    existingTradeDateCount: Number(result.existingTradeDateCount) || 0,
    overlapRanges: (Array.isArray(result.overlapRanges) ? result.overlapRanges : []).map(range => ({
      startDate: normalizeFullHistoryDate(range.startDate),
      endDate: normalizeFullHistoryDate(range.endDate),
      tradeDateCount: Number(range.tradeDateCount) || 0
    })).filter(range => range.startDate && range.endDate && range.tradeDateCount > 0)
  }
}

async function prepareFullHistoryDatabaseAppend(coverage, startDate, endDate) {
  if (!coverage?.datasetId) return { appendMode: false }
  await runSqliteHistoryOperation('prepare_append', {
    datasetId: coverage.datasetId,
    startDate,
    endDate
  })
  return {
    appendMode: true,
    datasetId: coverage.datasetId,
    previousStartDate: coverage.existingStartDate || '',
    previousEndDate: coverage.existingEndDate || ''
  }
}

async function reconcileFullHistoryAppendDataset(job) {
  if (!job?.appendMode || !fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) return null
  const result = await runSqliteHistoryOperation('reconcile_append', {
    datasetId: job.datasetId,
    startDate: job.startDate,
    endDate: job.endDate,
    previousStartDate: job.previousStartDate,
    previousEndDate: job.previousEndDate
  })
  const mergedStartDate = normalizeFullHistoryDate(result.startDate) || job.previousStartDate || job.startDate
  const mergedEndDate = normalizeFullHistoryDate(result.endDate) || job.previousEndDate || job.endDate
  job.indexStartDate = mergedStartDate
  job.indexEndDate = mergedEndDate
  return {
    startDate: mergedStartDate,
    endDate: mergedEndDate,
    checkpoint: Array.isArray(result.checkpoint) ? result.checkpoint : []
  }
}

// 从本地 SQLite 读取筛选所需的最近 61 根日 K。股票代码采用白名单，避免指数、ETF、债券等混入计算。
async function readStockHistoryFromSqlite(options = {}) {
  const startDate = normalizeSqliteCalculationDate(options.startDate, '开始日期')
  const endDate = normalizeSqliteCalculationDate(options.endDate, '结束日期')
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期')
  if (isFullHistoryActive()) throw new Error('历史数据正在写入 SQLite，请等待获取完成后再计算')
  if (!fs.existsSync(STOCK_REVIEW_DATABASE_FILE)) {
    throw new Error(`未找到 SQLite 数据库：${STOCK_REVIEW_DATABASE_FILE}`)
  }

  const SQL = await getSqlJsRuntime()
  const database = new SQL.Database(fs.readFileSync(STOCK_REVIEW_DATABASE_FILE))
  const rows = []
  let statement = null
  try {
    statement = database.prepare(`
      WITH ranked_bars AS (
        SELECT
          b.stock_code AS code,
          s.name AS name,
          b.trade_date AS time,
          b.open AS open,
          b.high AS high,
          b.low AS low,
          b.close AS close,
          b.volume AS volume,
          b.amount AS amount,
          b.change_ratio AS changeRatio,
          b.turnover_rate AS turnoverRate,
          ROW_NUMBER() OVER (
            PARTITION BY b.stock_code
            ORDER BY b.trade_date DESC
          ) AS row_number
        FROM daily_bars b
        JOIN history_datasets d ON d.id = b.dataset_id AND d.is_active = 1
        JOIN stocks s ON s.code = b.stock_code AND s.is_active = 1
        WHERE b.trade_date BETWEEN $startDate AND $endDate
          AND LENGTH(s.symbol) = 6
          AND (
            (s.market = 'SH' AND SUBSTR(s.symbol, 1, 3) IN ('600', '601', '603', '605', '688', '689'))
            OR (s.market = 'SZ' AND SUBSTR(s.symbol, 1, 3) IN ('000', '001', '002', '003', '300', '301'))
            OR (s.market = 'BJ' AND (SUBSTR(s.symbol, 1, 1) IN ('4', '8') OR SUBSTR(s.symbol, 1, 3) = '920'))
          )
      )
      SELECT code, name, time, open, high, low, close, volume, amount, changeRatio, turnoverRate
      FROM ranked_bars
      WHERE row_number <= 61
      ORDER BY code, time
    `)
    statement.bind({ $startDate: startDate, $endDate: endDate })
    while (statement.step()) {
      const row = statement.getAsObject()
      rows.push({ ...row, name: decodeLegacyStockName(row.name) })
    }
  } finally {
    try { statement?.free() } catch {}
    database.close()
  }

  if (!rows.length) {
    throw new Error(`SQLite 中没有 ${startDate} 至 ${endDate} 的 A 股日 K 数据`)
  }
  const stockCount = new Set(rows.map(row => row.code)).size
  return {
    ok: true,
    endpoint: 'sqlite_stock_history',
    databaseFile: STOCK_REVIEW_DATABASE_FILE,
    startDate,
    endDate,
    stockCount,
    rowCount: rows.length,
    maxBarsPerStock: 61,
    readAt: new Date().toISOString(),
    rows
  }
}

async function checkFullHistoryDatabase(startDate, endDate) {
  return runExecutableJson(FULL_HISTORY_EXECUTABLE, [
    '--database', STOCK_REVIEW_DATABASE_NAME,
    '--start', startDate,
    '--end', endDate,
    '--source', 'baostock',
    '--check'
  ])
}

function prepareFullHistoryExecutableInput(startDate, endDate) {
  const combined = readCombinedFullHistoryItems()
  if (!combined.snapshotPayload || !combined.snapshotRows.length) {
    const indexText = combined.index.exists ? `；检测到索引 ${combined.index.filePath}，但缺少快照清单` : ''
    throw new Error(`未找到有效的快照清单：${FULL_HISTORY_STOCK_LIST_FILE}${indexText}`)
  }
  if (combined.index.exists && !combined.index.readable) {
    throw new Error(`股票数据索引不是有效 JSON：${combined.index.filePath}`)
  }

  if (!combined.index.exists) {
    fs.copyFileSync(FULL_HISTORY_STOCK_LIST_FILE, FULL_HISTORY_CALCULATE_STOCK_LIST_FILE)
    return {
      ...combined,
      calculateCount: combined.snapshotRows.length,
      missingStockCount: combined.snapshotRows.length,
      noWork: false,
      requiresCleanup: false
    }
  }

  const indexStartDate = combined.index.startDate
  const indexEndDate = combined.index.endDate
  if (!indexStartDate || !indexEndDate || indexStartDate !== startDate || indexEndDate !== endDate) {
    const actualRange = indexStartDate && indexEndDate ? `${indexStartDate} 至 ${indexEndDate}` : '索引中未记录完整日期范围'
    return {
      ...combined,
      calculateCount: 0,
      missingStockCount: 0,
      noWork: false,
      requiresCleanup: true,
      cleanupReason: `页面日期为 ${startDate} 至 ${endDate}，已有历史数据范围为 ${actualRange}。继续前需要删除旧的历史输出和股票数据索引。`
    }
  }

  const missingStocks = combined.snapshotRows.filter(item => {
    const code = normalizeFullMarketStockCode(item)
    return code && !combined.index.rowsByCode.has(code)
  })
  const payload = buildCalculateStockListPayload(combined.snapshotPayload, missingStocks, startDate, endDate)
  atomicWriteJson(FULL_HISTORY_CALCULATE_STOCK_LIST_FILE, payload)
  return {
    ...combined,
    calculateCount: missingStocks.length,
    missingStockCount: missingStocks.length,
    noWork: missingStocks.length === 0,
    requiresCleanup: false
  }
}

function refreshFullHistoryJobItemsFromDisk(job = fullHistoryJob) {
  const combined = readCombinedFullHistoryItems()
  if (combined.items.length && (!combined.index.exists || combined.index.readable)) {
    job.items = combined.items
  }
  job.stockIndexFile = combined.index.filePath
  job.indexStartDate = combined.index.startDate
  job.indexEndDate = combined.index.endDate
  job.indexedStockCount = combined.index.rowsByCode.size
  job.missingStockCount = combined.items.filter(item => item.status === 'pending').length
  return combined
}

function appendFullHistoryProcessOutput(job, key, chunk) {
  const next = `${job[key] || ''}${Buffer.from(chunk).toString('utf8')}`
  job[key] = next.slice(-12000)
}

function startFullHistoryExecutableProcess(job) {
  const executionOptions = {
    selectedOnly: Boolean(job.selectedOnly),
    selectedCodesFile: job.selectedCodesFile || ''
  }
  const args = buildFullHistoryArgs(job.startDate, job.endDate, executionOptions)
  const child = spawn(FULL_HISTORY_EXECUTABLE, args, {
    cwd: FULL_HISTORY_DATA_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false
  })
  fullHistoryProcess = child
  job.status = 'running'
  job.processId = Number(child.pid) || null
  job.command = buildFullHistoryCommand(job.startDate, job.endDate, executionOptions)
  job.message = `历史数据程序已启动，进程 PID ${job.processId || '--'}`
  job.stdoutLineBuffer = ''

  const applyProgressLine = line => {
    if (!line.startsWith('STOCK_PROGRESS_JSON:')) return
    try {
      const event = JSON.parse(line.slice('STOCK_PROGRESS_JSON:'.length))
      const code = normalizeCacheCode(event?.code || '')
      if (!code) return
      const index = job.items.findIndex(item => item.code === code)
      const rawStatus = String(event?.status || 'pending').toLowerCase()
      const status = rawStatus === 'empty' ? 'skipped' : rawStatus
      const next = {
        code,
        name: String(event?.name || code),
        status: ['pending', 'running', 'done', 'skipped', 'failed'].includes(status) ? status : 'pending',
        rowCount: Number(event?.rowCount) || 0,
        failedCount: status === 'failed' ? 1 : 0,
        skippedCount: status === 'skipped' ? 1 : 0,
        message: String(event?.message || '').trim(),
        updatedAt: event?.updatedAt || new Date().toISOString()
      }
      if (index >= 0) job.items[index] = { ...job.items[index], ...next, name: job.items[index].name || next.name }
      else job.items.push(next)
    } catch {}
  }

  const consumeStdout = chunk => {
    const text = Buffer.from(chunk).toString('utf8')
    appendFullHistoryProcessOutput(job, 'stdout', chunk)
    const parts = `${job.stdoutLineBuffer || ''}${text}`.split(/\r?\n/)
    job.stdoutLineBuffer = parts.pop() || ''
    parts.forEach(applyProgressLine)
  }

  let finalized = false
  const finalize = (code, error = null) => {
    if (finalized) return
    finalized = true
    if (fullHistoryProcess === child) fullHistoryProcess = null
    job.processId = null
    job.finishedAt = new Date().toISOString()
    if (job.stdoutLineBuffer) applyProgressLine(job.stdoutLineBuffer)
    const reconcileAppend = () => {
      if (!job.appendMode) return Promise.resolve(null)
      return reconcileFullHistoryAppendDataset(job).catch(appendError => {
        addFullHistoryError(job, `合并历史日期范围失败：${appendError.message || appendError}`)
        return null
      })
    }

    if (job.cancelRequested) {
      job.status = 'stopped'
      job.message = '已停止历史数据程序'
      reconcileAppend()
      return
    }
    if (error) {
      job.status = 'failed'
      job.message = `历史数据程序启动失败：${error.message || error}`
      addFullHistoryError(job, job.message)
      reconcileAppend()
      return
    }
    if (code !== 0) {
      const detail = String(job.stderr || job.stdout || '').trim().slice(-1000)
      job.status = 'failed'
      job.message = `历史数据程序执行失败，退出码 ${code}${detail ? `：${detail}` : ''}`
      addFullHistoryError(job, job.message)
      reconcileAppend()
      return
    }
    job.status = 'completed'
    job.message = job.appendMode
      ? '历史数据程序执行完成，正在合并 SQLite 历史日期范围'
      : job.selectedOnly
        ? `选中的 ${job.selectedCodes.length} 只股票历史数据获取完成，正在刷新 SQLite 状态`
        : '历史数据程序执行完成，数据已写入 SQLite'
    reconcileAppend()
      .then(() => queryFullHistoryDatabaseStatus())
      .then(payload => {
        applyDatabaseStatusToJob(payload, job)
        job.message = job.appendMode
          ? `历史数据追加完成，SQLite 当前历史范围为 ${job.indexStartDate || '--'} 至 ${job.indexEndDate || '--'}`
          : job.selectedOnly
            ? `选中的 ${job.selectedCodes.length} 只股票历史数据已写入 SQLite`
            : '历史数据程序执行完成，数据已写入 SQLite'
      })
      .catch(queryError => addFullHistoryError(job, `读取数据库状态失败：${queryError.message || queryError}`))
  }

  child.stdout.on('data', consumeStdout)
  child.stderr.on('data', chunk => appendFullHistoryProcessOutput(job, 'stderr', chunk))
  child.on('error', error => finalize(null, error))
  child.on('close', code => finalize(code))
  return child
}

function terminateFullHistoryProcess(child) {
  if (!child || !child.pid) return Promise.resolve(false)
  if (process.platform !== 'win32') {
    try {
      return Promise.resolve(child.kill('SIGTERM'))
    } catch {
      return Promise.resolve(false)
    }
  }

  return new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const timer = setTimeout(() => {
      try {
        killer.kill()
      } catch {}
      try {
        child.kill()
      } catch {}
      finish(false)
    }, 10000)
    killer.on('error', () => {
      clearTimeout(timer)
      try {
        child.kill()
      } catch {}
      finish(false)
    })
    killer.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        try {
          child.kill()
        } catch {}
      }
      finish(code === 0)
    })
  })
}

function assertFullHistoryCleanupPath(target) {
  const root = path.resolve(FULL_HISTORY_DATA_DIR)
  const resolved = path.resolve(target)
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝清理固定历史数据目录之外的路径：${resolved}`)
  }
  return resolved
}

async function cleanupFullMarketHistoryExecutableData() {
  if (isFullHistoryActive()) throw new Error('历史数据程序运行中，无法清理；请先停止任务')
  const result = await runExecutableJson(FULL_HISTORY_EXECUTABLE, [
    '--database', STOCK_REVIEW_DATABASE_NAME,
    '--clear-history'
  ], { timeout: 120000 })
  const databaseStatus = await queryFullHistoryDatabaseStatus()
  const items = databaseStatusItems(databaseStatus)
  fullHistoryJob = createFullHistoryJob({
    status: 'ready',
    databaseFile: STOCK_REVIEW_DATABASE_FILE,
    message: result?.message || '旧历史数据已从 SQLite 清理，请重新点击“开始获取”'
  }, items)
  applyDatabaseStatusToJob(databaseStatus, fullHistoryJob)
  return {
    ...buildFullHistorySnapshot(fullHistoryJob),
    cleanupCompleted: true,
    removed: result?.removed || {}
  }
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

  if (!itemsByCode.size && fs.existsSync(FULL_HISTORY_DAILY_DATA_DIR)) {
    try {
      fs.readdirSync(FULL_HISTORY_DAILY_DATA_DIR)
        .filter(fileName => fileName.endsWith('.json'))
        .forEach(fileName => collect(readJsonFile(path.join(FULL_HISTORY_DAILY_DATA_DIR, fileName))))
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
  const items = readFullMarketStockList()
  if (!items?.length) {
    throw new Error(`未读取到股票清单，请将 ${path.basename(FULL_HISTORY_SNAPSHOT_EXECUTABLE)} 放入 ${FULL_HISTORY_DATA_DIR}，然后点击“刷新快照清单”`)
  }
  return items.map(item => ({
    ...item,
    failedCount: Number(item.failedCount) || 0,
    message: item.message || '来自固定清单文件'
  }))
}

function runFullMarketStockListExecutable(options = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FULL_HISTORY_SNAPSHOT_EXECUTABLE)) {
      reject(new Error(`未找到清单程序，请将 fetch_all_a_stocks_v2.exe 放入：${FULL_HISTORY_DATA_DIR}`))
      return
    }

    const args = ['--database', STOCK_REVIEW_DATABASE_NAME, '--source', 'baostock']
    const stdout = []
    const stderr = []
    const timeout = Math.max(30000, Number(options.timeout) || 10 * 60 * 1000)
    let settled = false
    const child = spawn(FULL_HISTORY_SNAPSHOT_EXECUTABLE, args, {
      cwd: FULL_HISTORY_DATA_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })
    const finish = callback => value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const fail = finish(reject)
    const succeed = finish(resolve)
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error(`刷新快照清单超时（${Math.round(timeout / 1000)} 秒）`))
    }, timeout)

    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', error => fail(new Error(`无法启动 ${path.basename(FULL_HISTORY_SNAPSHOT_EXECUTABLE)}：${error.message}`)))
    child.on('close', code => {
      const outText = Buffer.concat(stdout).toString('utf8').trim()
      const errText = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        fail(new Error(errText || outText || `清单程序退出码 ${code}`))
        return
      }
      succeed({
        executable: FULL_HISTORY_SNAPSHOT_EXECUTABLE,
        command: `${path.basename(FULL_HISTORY_SNAPSHOT_EXECUTABLE)} --database "${STOCK_REVIEW_DATABASE_NAME}" --source baostock`,
        stdout: outText,
        stderr: errText
      })
    })
  })
}

// 固定目录中的打包程序是刷新清单的唯一数据源。
async function refreshFullMarketStockListFromSnapshot(options = {}) {
  if (isFullHistoryActive()) throw new Error('全市场历史任务运行中，请先停止或等待完成后再刷新股票清单')
  ensureFullHistoryDir()

  const startedAt = Date.now()
  const previousItems = Array.isArray(fullHistoryJob?.items) ? fullHistoryJob.items : []
  const previousStockCount = previousItems.length

  fullHistoryJob = createFullHistoryJob({
    ...fullHistoryJob,
    status: 'preparing',
    message: `正在运行 ${path.basename(FULL_HISTORY_SNAPSHOT_EXECUTABLE)} 刷新快照清单`
  }, previousItems)

  try {
    const result = await runFullMarketStockListExecutable(options)
    const databaseStatus = await runExecutableJson(FULL_HISTORY_SNAPSHOT_EXECUTABLE, [
      '--database', STOCK_REVIEW_DATABASE_NAME,
      '--status-json'
    ])
    const items = databaseStatusItems(databaseStatus)
    if (!items.length) throw new Error('快照程序执行成功，但 SQLite 中没有有效股票数据')

    fullHistoryJob = createFullHistoryJob({
      ...fullHistoryJob,
      status: 'ready',
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      message: `已通过 Baostock 程序写入 SQLite 股票快照：${items.length} 只`
    }, items)
    applyDatabaseStatusToJob(databaseStatus, fullHistoryJob)

    return {
      ...buildFullHistorySnapshot(fullHistoryJob),
      snapshotStockCount: items.length,
      previousStockCount,
      stockListUpdated: true,
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      stockListSource: 'baostock_executable',
      snapshotExecutable: result.executable,
      snapshotCommand: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      refreshFailed: false,
      fallbackUsed: false,
      refreshDurationMs: Date.now() - startedAt
    }
  } catch (error) {
    const displayError = historyDisplayError(error)
    fullHistoryJob = createFullHistoryJob({
      status: 'failed',
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      message: `刷新 SQLite 股票快照失败${previousItems.length ? '，页面保留原状态' : ''}：${displayError}`,
      errors: [displayError]
    }, previousItems)

    return {
      ...buildFullHistorySnapshot(fullHistoryJob),
      snapshotStockCount: previousItems.length,
      previousStockCount,
      stockListUpdated: false,
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      refreshFailed: true,
      fallbackUsed: false,
      error: displayError,
      refreshDurationMs: Date.now() - startedAt
    }
  }
}

// 调用 v3 单日快照程序。程序会在同一事务中删除目标日期旧记录并写入新快照。
async function fetchFullMarketDailySnapshot(options = {}) {
  if (isFullHistoryActive()) throw new Error('历史数据正在写入 SQLite，请等待获取完成后再抓取每日快照')
  ensureFullHistoryDir()

  const queryDate = normalizeFullHistoryDate(options.date) || formatLocalYmd(new Date())
  if (!queryDate) throw new Error('请选择有效的快照日期')
  if (queryDate > formatLocalYmd(new Date())) throw new Error('快照日期不能晚于当前日期')
  if (!fs.existsSync(FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE)) {
    throw new Error(`未找到每日快照程序，请将 ${FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE_NAME} 放入：${FULL_HISTORY_DATA_DIR}`)
  }

  const args = [
    '--database', STOCK_REVIEW_DATABASE_NAME,
    '--date', queryDate,
    '--source', String(options.source || 'auto')
  ]
  const command = `${FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE_NAME} ${args.map(quoteCommandArgument).join(' ')}`
  fullDailySnapshotCancelRequested = false
  fullHistoryJob = createFullHistoryJob({
    ...fullHistoryJob,
    status: 'daily_snapshot_running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    processId: null,
    cancelRequested: false,
    databaseFile: STOCK_REVIEW_DATABASE_FILE,
    message: `正在获取 ${queryDate} 每日快照`
  }, fullHistoryJob?.items || [])

  try {
    const result = await runExecutableJson(FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE, args, {
      timeout: Math.max(10 * 60 * 1000, Number(options.timeout) || 45 * 60 * 1000),
      onSpawn: child => {
        fullDailySnapshotProcess = child
        fullHistoryJob.processId = Number(child.pid) || null
        fullHistoryJob.message = `每日快照程序已启动，进程 PID ${fullHistoryJob.processId || '--'}`
      },
      onFinish: child => {
        if (fullDailySnapshotProcess === child) fullDailySnapshotProcess = null
        fullHistoryJob.processId = null
      }
    })
    const databaseStatus = await queryFullHistoryDatabaseStatus()
    const items = databaseStatusItems(databaseStatus)
    fullHistoryJob = createFullHistoryJob({
      ...fullHistoryJob,
      status: 'ready',
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      message: result?.message || `${queryDate} 每日快照已写入 SQLite`
    }, items)
    applyDatabaseStatusToJob(databaseStatus, fullHistoryJob)
    return {
      ...buildFullHistorySnapshot(fullHistoryJob),
      dailySnapshotResult: result,
      dailySnapshotDate: queryDate,
      dailySnapshotExecutable: FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE,
      dailySnapshotCommand: command
    }
  } catch (error) {
    if (fullDailySnapshotCancelRequested) {
      fullDailySnapshotCancelRequested = false
      fullHistoryJob = createFullHistoryJob({
        ...fullHistoryJob,
        status: 'stopped',
        processId: null,
        cancelRequested: false,
        finishedAt: new Date().toISOString(),
        databaseFile: STOCK_REVIEW_DATABASE_FILE,
        message: `已停止获取 ${queryDate} 每日快照`
      }, fullHistoryJob?.items || [])
      return {
        ...buildFullHistorySnapshot(fullHistoryJob),
        dailySnapshotCancelled: true,
        dailySnapshotDate: queryDate,
        dailySnapshotExecutable: FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE,
        dailySnapshotCommand: command
      }
    }
    const displayError = historyDisplayError(error)
    fullHistoryJob = createFullHistoryJob({
      ...fullHistoryJob,
      status: 'failed',
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      message: `获取 ${queryDate} 每日快照失败：${displayError}`,
      errors: [...(fullHistoryJob?.errors || []), displayError]
    }, fullHistoryJob?.items || [])
    throw new Error(fullHistoryJob.message)
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
  return path.join(FULL_HISTORY_DAILY_DATA_DIR, `all-market-history-${date}.json`)
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
      dailyDir: FULL_HISTORY_DAILY_DATA_DIR,
      dates: {}
    }
  }
  return {
    ...payload,
    schemaVersion: payload.schemaVersion || FULL_HISTORY_DAILY_CACHE_VERSION,
    type: payload.type || 'all_market_history_date_index',
    stockListFile: payload.stockListFile || FULL_HISTORY_STOCK_LIST_FILE,
    dailyDir: payload.dailyDir || FULL_HISTORY_DAILY_DATA_DIR,
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
    dailyDir: FULL_HISTORY_DAILY_DATA_DIR
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
    const databaseStatus = await queryFullHistoryDatabaseStatus()
    const items = databaseStatusItems(databaseStatus)
    if (!items.length) throw new Error('SQLite 数据库中没有有效股票快照，请先点击“刷新快照清单”')
    fullHistoryJob = createFullHistoryJob({
      ...fullHistoryJob,
      status: 'ready',
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      message: `已从 SQLite 加载 ${items.length} 只股票及历史状态`
    }, items)
    applyDatabaseStatusToJob(databaseStatus, fullHistoryJob)
  } catch (error) {
    fullHistoryJob.status = 'failed'
    fullHistoryJob.message = error.message || '加载全市场股票列表失败'
    fullHistoryJob.errors.push(fullHistoryJob.message)
  }

  return buildFullHistorySnapshot()
}

// 启动固定目录中的历史数据打包程序；页面日期通过参数数组直接传入，不经过 Shell。
async function startFullMarketHistorySync(options = {}) {
  if (isFullHistoryActive()) return buildFullHistorySnapshot()

  const startDate = normalizeFullHistoryDate(options.startDate)
  const endDate = normalizeFullHistoryDate(options.endDate)
  const rawSelectedCodes = Array.isArray(options.selectedCodes) ? options.selectedCodes : []
  const selectedCodes = Array.from(new Set(
    rawSelectedCodes.map(normalizeCacheCode).filter(code => code && isFullHistoryAStock({ code }))
  ))
  if (!startDate || !endDate) throw new Error('请先选择开始时间和结束时间')
  if (startDate > endDate) throw new Error('开始时间不能晚于结束时间')
  if (rawSelectedCodes.length && !selectedCodes.length) throw new Error('所选证券中没有可获取历史数据的沪深北 A 股')

  if (!fs.existsSync(FULL_HISTORY_EXECUTABLE)) {
    throw new Error(`未找到历史数据程序，请将 ${FULL_HISTORY_EXECUTABLE_NAME} 放入：${FULL_HISTORY_DATA_DIR}`)
  }

  if (selectedCodes.length) {
    const databaseStatus = await queryFullHistoryDatabaseStatus()
    const allItems = databaseStatusItems(databaseStatus)
    const itemsByCode = new Map(allItems.map(item => [item.code, item]))
    const missingCodes = selectedCodes.filter(code => !itemsByCode.has(code))
    if (missingCodes.length) {
      throw new Error(`所选股票不在当前有效快照清单中：${missingCodes.slice(0, 5).join('、')}${missingCodes.length > 5 ? '…' : ''}`)
    }
    const selectedItems = selectedCodes.map(code => ({
      ...itemsByCode.get(code),
      status: 'pending',
      message: '等待获取选中历史数据'
    }))
    ensureFullHistoryDir()
    atomicWriteJson(FULL_HISTORY_SELECTED_CODES_FILE, {
      schemaVersion: 1,
      type: 'selected_history_codes',
      generatedAt: new Date().toISOString(),
      startDate,
      endDate,
      stocks: selectedItems.map(item => ({ code: item.code, name: item.name || item.code }))
    })
    const selectedExecutionOptions = {
      selectedOnly: true,
      selectedCodesFile: FULL_HISTORY_SELECTED_CODES_NAME
    }
    fullHistoryJob = createFullHistoryJob({
      status: 'preparing',
      startDate,
      endDate,
      startedAt: new Date().toISOString(),
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      executable: FULL_HISTORY_EXECUTABLE,
      command: buildFullHistoryCommand(startDate, endDate, selectedExecutionOptions),
      indexStartDate: databaseStatus?.dataset?.start_date || '',
      indexEndDate: databaseStatus?.dataset?.end_date || '',
      indexedStockCount: selectedItems.filter(item => item.status !== 'pending').length,
      missingStockCount: selectedItems.length,
      selectedOnly: true,
      selectedCodes,
      selectedCodesFile: FULL_HISTORY_SELECTED_CODES_NAME,
      message: `准备获取 ${selectedItems.length} 只选中 A 股在 ${startDate} 至 ${endDate} 的历史数据`
    }, selectedItems)

    try {
      startFullHistoryExecutableProcess(fullHistoryJob)
    } catch (error) {
      fullHistoryJob.status = 'failed'
      fullHistoryJob.finishedAt = new Date().toISOString()
      fullHistoryJob.message = `无法启动选中股票历史数据程序：${error.message || error}`
      fullHistoryJob.errors.push(fullHistoryJob.message)
    }
    return buildFullHistorySnapshot(fullHistoryJob)
  }

  const coverage = await inspectFullHistoryDateCoverage(startDate, endDate)
  if (coverage.overlapRanges.length) {
    const overlapText = coverage.overlapRanges
      .map(range => `${range.startDate} 至 ${range.endDate}（${range.tradeDateCount} 个已存交易日）`)
      .join('、')
    fullHistoryJob = createFullHistoryJob({
      ...fullHistoryJob,
      status: 'date_overlap',
      startDate,
      endDate,
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      hasDateOverlap: true,
      overlapRanges: coverage.overlapRanges,
      overlapReason: `所选日期 ${startDate} 至 ${endDate} 与 SQLite 已有历史数据重合：${overlapText}。请调整为不重合的日期区间后再开始获取。`,
      indexStartDate: coverage.existingStartDate,
      indexEndDate: coverage.existingEndDate,
      message: '所选日期范围与 SQLite 已有历史数据重合，未启动获取'
    }, fullHistoryJob.items || [])
    return buildFullHistorySnapshot(fullHistoryJob)
  }

  const appendContext = await prepareFullHistoryDatabaseAppend(coverage, startDate, endDate)
  let prepared = null
  try {
    prepared = await checkFullHistoryDatabase(startDate, endDate)
    if (!prepared?.ok) throw new Error(prepared?.message || 'SQLite 历史数据启动检查失败')
    if (prepared.requiresCleanup) {
      throw new Error(prepared.cleanupReason || prepared.message || 'SQLite 无法准备追加历史日期区间')
    }
  } catch (error) {
    if (appendContext.appendMode) {
      try {
        await reconcileFullHistoryAppendDataset({
          ...appendContext,
          startDate,
          endDate
        })
      } catch (restoreError) {
        throw new Error(`${error.message || error}；恢复原历史日期范围失败：${restoreError.message || restoreError}`)
      }
    }
    throw error
  }
  const preparedItems = databaseStatusItems(prepared)

  if (Number(prepared.missingStockCount) === 0) {
    const dataset = prepared?.dataset || {}
    fullHistoryJob = createFullHistoryJob({
      status: 'completed',
      startDate,
      endDate,
      finishedAt: new Date().toISOString(),
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      indexStartDate: dataset.start_date || startDate,
      indexEndDate: dataset.end_date || endDate,
      indexedStockCount: preparedItems.filter(item => item.status !== 'pending').length,
      missingStockCount: 0,
      message: 'SQLite 中的当前股票均已有历史数据，无需再次获取'
    }, preparedItems)
    return buildFullHistorySnapshot(fullHistoryJob)
  }

  fullHistoryJob = createFullHistoryJob({
    status: 'preparing',
    startDate,
    endDate,
    startedAt: new Date().toISOString(),
    databaseFile: STOCK_REVIEW_DATABASE_FILE,
    executable: FULL_HISTORY_EXECUTABLE,
    command: buildFullHistoryCommand(startDate, endDate),
    indexStartDate: prepared?.dataset?.start_date || '',
    indexEndDate: prepared?.dataset?.end_date || '',
    indexedStockCount: preparedItems.filter(item => item.status !== 'pending').length,
    missingStockCount: Number(prepared.missingStockCount) || 0,
    appendMode: Boolean(appendContext.appendMode),
    datasetId: appendContext.datasetId || null,
    previousStartDate: appendContext.previousStartDate || '',
    previousEndDate: appendContext.previousEndDate || '',
    message: appendContext.appendMode
      ? `日期无重合，准备向 SQLite 追加 ${startDate} 至 ${endDate}，待获取 ${Number(prepared.missingStockCount) || 0} 只股票`
      : `SQLite 启动检查完成，待获取 ${Number(prepared.missingStockCount) || 0} 只股票`
  }, preparedItems)

  try {
    startFullHistoryExecutableProcess(fullHistoryJob)
  } catch (error) {
    fullHistoryJob.status = 'failed'
    fullHistoryJob.finishedAt = new Date().toISOString()
    fullHistoryJob.message = `无法启动历史数据程序：${error.message || error}`
    fullHistoryJob.errors.push(fullHistoryJob.message)
    if (appendContext.appendMode) {
      try {
        await reconcileFullHistoryAppendDataset(fullHistoryJob)
      } catch (restoreError) {
        addFullHistoryError(fullHistoryJob, `恢复原历史日期范围失败：${restoreError.message || restoreError}`)
      }
    }
  }
  return buildFullHistorySnapshot(fullHistoryJob)
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

  if (!tasks.length && fs.existsSync(FULL_HISTORY_DAILY_DATA_DIR)) {
    try {
      fs.readdirSync(FULL_HISTORY_DAILY_DATA_DIR)
        .filter(fileName => fileName.endsWith('.json'))
        .forEach(fileName => {
          const payload = readJsonFile(path.join(FULL_HISTORY_DAILY_DATA_DIR, fileName))
          tasks.push(...failedTasksFromDailyPayload(payload))
        })
    } catch {}
  }
  return tasks
}

async function cancelFullMarketHistorySync() {
  if (fullDailySnapshotProcess || fullHistoryJob?.status === 'daily_snapshot_running') {
    fullDailySnapshotCancelRequested = true
    fullHistoryJob.status = 'stopping'
    fullHistoryJob.message = fullDailySnapshotProcess?.pid
      ? `正在停止每日快照程序，进程 PID ${fullDailySnapshotProcess.pid}`
      : '正在停止每日快照任务'
    if (fullDailySnapshotProcess) {
      await terminateFullHistoryProcess(fullDailySnapshotProcess)
    } else {
      fullHistoryJob.status = 'stopped'
      fullHistoryJob.finishedAt = new Date().toISOString()
      fullHistoryJob.message = '每日快照任务已停止'
    }
    return buildFullHistorySnapshot()
  }
  if (!isFullHistoryActive()) return buildFullHistorySnapshot()
  fullHistoryJob.cancelRequested = true
  fullHistoryJob.status = 'stopping'
  fullHistoryJob.message = fullHistoryProcess?.pid
    ? `正在停止历史数据程序，进程 PID ${fullHistoryProcess.pid}`
    : '正在停止历史数据任务'

  if (fullHistoryProcess) {
    await terminateFullHistoryProcess(fullHistoryProcess)
  } else {
    fullHistoryJob.status = 'stopped'
    fullHistoryJob.finishedAt = new Date().toISOString()
    fullHistoryJob.message = '历史数据任务已停止'
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
  async readStockHistoryFromSqlite(options) {
    return readStockHistoryFromSqlite(options)
  },
  async listCalculationResultsFromSqlite() {
    return listCalculationResultsFromSqlite()
  },
  async saveCalculationResultToSqlite(options) {
    return saveCalculationResultToSqlite(options)
  },
  async readCalculationResultFromSqlite(options) {
    return readCalculationResultFromSqlite(options)
  },
  async deleteCalculationResultFromSqlite(options) {
    return deleteCalculationResultFromSqlite(options)
  },
  async refreshTop50PerformanceFromSqlite(options) {
    return refreshTop50PerformanceFromSqlite(options)
  },
  async readTop50PerformanceFromSqlite(options) {
    return readTop50PerformanceFromSqlite(options)
  },
  async prepareFullMarketHistoryList(options) {
    return prepareFullMarketHistoryList(options)
  },
  async refreshFullMarketStockListFromSnapshot(options) {
    return refreshFullMarketStockListFromSnapshot(options)
  },
  async fetchFullMarketDailySnapshot(options) {
    return fetchFullMarketDailySnapshot(options)
  },
  async startFullMarketHistorySync(options) {
    return startFullMarketHistorySync(options)
  },
  async cancelFullMarketHistorySync() {
    return cancelFullMarketHistorySync()
  },
  async cleanupFullMarketHistoryExecutableData() {
    return cleanupFullMarketHistoryExecutableData()
  },
  async getFullMarketHistorySyncStatus(options = {}) {
    ensureFullHistoryDir()
    if (!isFullHistoryActive()) {
      try {
        const databaseStatus = await queryFullHistoryDatabaseStatus()
        const items = applyDatabaseStatusToJob(databaseStatus, fullHistoryJob)
        if (fullHistoryJob.status === 'idle') {
          fullHistoryJob.status = items.length ? 'ready' : 'idle'
          fullHistoryJob.message = items.length
            ? `已从 SQLite 加载 ${items.length} 只股票及历史状态`
            : 'SQLite 数据库中尚无股票快照'
        }
      } catch (error) {
        if (options.throwOnDatabaseError) throw error
        if (!fullHistoryJob.items.length) {
          fullHistoryJob.message = error.message || '读取 SQLite 数据库状态失败'
        }
      }
    }
    return buildFullHistorySnapshot()
  },
  getFullMarketHistoryPaths() {
    ensureFullHistoryDir()
    return {
      dataDir: FULL_HISTORY_DATA_DIR,
      databaseFile: STOCK_REVIEW_DATABASE_FILE,
      snapshotExecutable: FULL_HISTORY_SNAPSHOT_EXECUTABLE,
      snapshotCommand: `${path.basename(FULL_HISTORY_SNAPSHOT_EXECUTABLE)} --database "${STOCK_REVIEW_DATABASE_NAME}" --source baostock`,
      dailySnapshotExecutable: FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE,
      dailySnapshotCommand: `${FULL_HISTORY_DAILY_SNAPSHOT_EXECUTABLE_NAME} --database "${STOCK_REVIEW_DATABASE_NAME}" --date <快照日期> --source auto`,
      historyExecutable: FULL_HISTORY_EXECUTABLE,
      historyCommand: buildFullHistoryCommand('', ''),
      cleanupCommand: `${FULL_HISTORY_EXECUTABLE_NAME} --database "${STOCK_REVIEW_DATABASE_NAME}" --clear-history`
    }
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
