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
const EASTMONEY_ULIST_ENDPOINT = 'http://push2.eastmoney.com/api/qt/ulist.np/get'
const EASTMONEY_CLIST_ENDPOINTS = [
  'http://82.push2.eastmoney.com/api/qt/clist/get',
  'http://push2.eastmoney.com/api/qt/clist/get'
]
const EASTMONEY_CLIST_FIELDS = 'f12,f14,f2,f3,f5,f6,f8,f15,f16,f17,f18'
const EASTMONEY_A_SHARE_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'
const TENCENT_FQKLINE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
const EASTMONEY_ULIST_BATCH_SIZE = 200
const EASTMONEY_ULIST_CONCURRENCY = 1
const EASTMONEY_REQUEST_RETRIES = 1
const EASTMONEY_RETRY_DELAY_MS = 350
const EASTMONEY_REQUEST_TIMEOUT_MS = 6000
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
const FULL_HISTORY_DAILY_CONCURRENCY = 8
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
const DESKTOP_WINDOW_URL = 'index.html?window=desktop'
const DESKTOP_WINDOW_FEATURE_CODES = new Set(['stock-review', 'stock-pool', 'risk-watch'])
let stockReviewDesktopWindow = null

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
    return typeof win.isDestroyed === 'function' ? !win.isDestroyed() : true
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

function openDesktopWindow() {
  hideUtoolsMainWindow()

  if (focusDesktopWindow(stockReviewDesktopWindow)) {
    return stockReviewDesktopWindow
  }

  const api = getUtoolsApi()
  if (!api?.createBrowserWindow) return null

  stockReviewDesktopWindow = api.createBrowserWindow(DESKTOP_WINDOW_URL, {
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
  })

  if (stockReviewDesktopWindow?.on) {
    stockReviewDesktopWindow.on('closed', () => {
      stockReviewDesktopWindow = null
    })
  }

  return stockReviewDesktopWindow
}

function setupDesktopWindowLauncher() {
  if (isDesktopWindowContext()) return

  const api = getUtoolsApi()
  if (!api?.onPluginEnter) return

  api.onPluginEnter(action => {
    const code = action?.code
    if (code && !DESKTOP_WINDOW_FEATURE_CODES.has(code)) return
    openDesktopWindow()
  })
}

setupDesktopWindowLauncher()

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body)
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
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
      req.destroy(new Error('同花顺接口请求超时'))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function getJson(url, headers = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = String(url).startsWith('http://') ? http : https
    const req = client.request(url, {
      method: 'GET',
      headers: {
        Referer: 'http://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0',
        ...headers
      },
      timeout
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}：${text.slice(0, 240)}`))
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
      req.destroy(new Error('接口请求超时'))
    })
    req.on('error', reject)
    req.end()
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getJsonWithRetry(url, headers = {}, retries = EASTMONEY_REQUEST_RETRIES, timeout = EASTMONEY_REQUEST_TIMEOUT_MS) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getJson(url, headers, timeout)
    } catch (error) {
      lastError = error
      if (attempt >= retries) break
      await sleep(EASTMONEY_RETRY_DELAY_MS * (attempt + 1))
    }
  }
  throw lastError
}

async function getFirstJson(urls, action) {
  const errors = []
  for (const url of urls) {
    try {
      return await getJson(url)
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
      1,
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
      1,
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

function buildEastmoneyAllMarketSecids() {
  const secids = []
  EASTMONEY_ALL_MARKET_SCAN_RANGES.forEach(range => {
    for (let code = range.start; code <= range.end; code++) {
      secids.push(`${range.market}.${String(code).padStart(6, '0')}`)
    }
  })
  return secids
}

function buildEastmoneyUlistUrl(secids) {
  const url = new URL(EASTMONEY_ULIST_ENDPOINT)
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

async function fetchEastmoneyClistPage(page, pageSize) {
  let lastError
  for (const endpoint of EASTMONEY_CLIST_ENDPOINTS) {
    try {
      const payload = await getJsonWithRetry(
        buildEastmoneyClistUrl(endpoint, page, pageSize),
        {},
        2,
        10000
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

  const firstPage = await fetchEastmoneyClistPage(page, pageSize)
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
      while (cursor < remainingPages.length) {
        const currentPage = remainingPages[cursor]
        cursor += 1
        try {
          const data = await fetchEastmoneyClistPage(currentPage, pageSize)
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

async function fetchEastmoneyUlist(secids, options = {}) {
  try {
    const payload = await getJsonWithRetry(
      buildEastmoneyUlistUrl(secids),
      {},
      options.retries ?? EASTMONEY_REQUEST_RETRIES,
      options.timeout ?? EASTMONEY_REQUEST_TIMEOUT_MS
    )
    return payload?.data?.diff || []
  } catch (error) {
    if (secids.length <= 20) {
      throw error
    }
    const middle = Math.ceil(secids.length / 2)
    const left = await fetchEastmoneyUlist(secids.slice(0, middle), options)
    const right = await fetchEastmoneyUlist(secids.slice(middle), options)
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
  const timeoutMs = Number(options.timeoutMs) || EASTMONEY_ALL_MARKET_TIMEOUT_MS
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
    if (Date.now() - startedAt > timeoutMs) return
    let rows = []
    try {
      rows = await fetchEastmoneyUlist(batch)
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
    while (cursor < batches.length && Date.now() - startedAt <= timeoutMs) {
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

async function fetchEastmoneyHistoryTable(code, options) {
  const { fullCode, secid } = eastmoneySecid(code)
  const url = new URL('http://push2his.eastmoney.com/api/qt/stock/kline/get')
  url.searchParams.set('secid', secid)
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6')
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')
  url.searchParams.set('klt', '101')
  url.searchParams.set('fqt', String(options.adjust || '1'))
  url.searchParams.set('beg', ymd(options.startDate, '19900101'))
  url.searchParams.set('end', ymd(options.endDate, '20500101'))
  url.searchParams.set('lmt', '1000')
  url.searchParams.set('ut', EASTMONEY_UT)
  const payload = await getJsonWithRetry(url.toString())
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
    throw new Error(`东方财富未返回 ${fullCode} 日K数据`)
  }
  return buildTableFromRows(fullCode, rows)
}

async function fetchEastmoneyHistory(options) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 3))
  const tolerateErrors = Boolean(options.tolerateErrors)
  const disableFallback = Boolean(options.disableFallback)
  const tables = []
  const errors = []
  let cursor = 0

  async function worker() {
    while (cursor < codes.length) {
      const code = codes[cursor]
      cursor += 1
      try {
        tables.push(await fetchEastmoneyHistoryTable(code, options))
      } catch (error) {
        errors.push(`${code}: ${error.message}`)
        if (!tolerateErrors) throw error
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()))

    if (!tables.length) {
      throw new Error(errors[0] || '东方财富历史K线返回为空')
    }

    return {
      ok: true,
      endpoint: 'eastmoney_kline',
      fetchedAt: new Date().toISOString(),
      payload: { tables },
      meta: errors.length ? {
        partial: true,
        failed: errors.length,
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

async function fetchEastmoneyHistoryBatch(options = {}) {
  const codes = String(options.codes || '').split(',').map(item => item.trim()).filter(Boolean)
  const concurrency = Math.max(1, Math.min(12, Number(options.concurrency) || 6))
  const tables = []
  const errors = []
  let cursor = 0

  async function worker() {
    while (cursor < codes.length) {
      const code = codes[cursor]
      cursor += 1
      try {
        tables.push(await fetchEastmoneyHistoryTable(code, options))
      } catch (error) {
        errors.push({ code: normalizeCacheCode(code), message: error.message })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, codes.length || 1) }, () => worker()))

  return {
    ok: true,
    endpoint: 'eastmoney_history_batch',
    fetchedAt: new Date().toISOString(),
    payload: { tables, errors },
    meta: errors.length ? {
      partial: true,
      failed: errors.length,
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
        concurrency: isAllMarket ? 8 : 6
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

function createFullHistoryJob(base = {}, items = []) {
  const rawDates = Array.isArray(base.dates) ? base.dates : []
  return {
    id: base.id || `history-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: base.status || 'idle',
    message: base.message || '',
    startDate: base.startDate || '',
    endDate: base.endDate || '',
    adjust: String(base.adjust || '1'),
    delayMs: clampFullHistoryDelay(base.delayMs),
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
    processed: Number(base.processed) || 0,
    cancelRequested: Boolean(base.cancelRequested),
    errors: Array.isArray(base.errors) ? base.errors : [],
    dailyFiles: Array.isArray(base.dailyFiles) ? base.dailyFiles : [],
    selectedOnly: Boolean(base.selectedOnly),
    selectedCodes: Array.isArray(base.selectedCodes) ? base.selectedCodes.map(normalizeCacheCode).filter(Boolean) : [],
    dates: rawDates.map(item => (typeof item === 'string' ? { date: item } : item)).map(item => ({
      date: normalizeFullHistoryDate(item.date || item.time || ''),
      status: item.status || 'pending',
      stockCount: Number(item.stockCount) || 0,
      processed: Number(item.processed) || 0,
      fetched: Number(item.fetched) || 0,
      failed: Number(item.failed) || 0,
      fileName: item.fileName || '',
      filePath: item.filePath || '',
      message: item.message || '',
      startedAt: item.startedAt || null,
      updatedAt: item.updatedAt || null,
      finishedAt: item.finishedAt || null
    })).filter(item => item.date),
    items: items.map(item => ({
      code: normalizeCacheCode(item.code || item.thscode || ''),
      name: String(item.name || item.stockName || item.code || item.thscode || '').trim(),
      status: item.status || 'pending',
      rowCount: Number(item.rowCount) || 0,
      failedCount: Number(item.failedCount) || 0,
      message: item.message || '',
      updatedAt: item.updatedAt || null
    })).filter(item => item.code)
  }
}

function buildFullHistorySnapshot(job = fullHistoryJob) {
  const items = Array.isArray(job?.items) ? job.items : []
  const dates = Array.isArray(job?.dates) ? job.dates : []
  const total = items.length
  const legacyFetched = items.filter(item => item.status === 'done').length
  const legacyFailed = items.filter(item => item.status === 'failed').length
  const legacyPending = items.filter(item => item.status === 'pending').length
  const recordTotal = total * dates.length
  const processed = dates.length ? Number(job?.processed) || dates.reduce((sum, item) => sum + (Number(item.processed) || 0), 0) : legacyFetched + legacyFailed
  const fetched = dates.length ? Number(job?.fetched) || dates.reduce((sum, item) => sum + (Number(item.fetched) || 0), 0) : legacyFetched
  const failed = dates.length ? Number(job?.failed) || dates.reduce((sum, item) => sum + (Number(item.failed) || 0), 0) : legacyFailed
  const pending = dates.length ? Math.max(0, recordTotal - processed) : legacyPending

  return {
    id: job?.id || '',
    status: job?.status || 'idle',
    message: job?.message || '',
    startDate: job?.startDate || '',
    endDate: job?.endDate || '',
    adjust: job?.adjust || '1',
    delayMs: clampFullHistoryDelay(job?.delayMs),
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
    pending,
    progress: dates.length
      ? (recordTotal ? Math.round((processed / recordTotal) * 10000) / 100 : 0)
      : (total ? Math.round(((fetched + failed) / total) * 10000) / 100 : 0),
    errors: (job?.errors || []).slice(-20),
    dailyFiles: Array.isArray(job?.dailyFiles) ? job.dailyFiles : [],
    selectedOnly: Boolean(job?.selectedOnly),
    selectedCodes: Array.isArray(job?.selectedCodes) ? job.selectedCodes : [],
    dates: dates.map(item => ({
      date: item.date,
      status: item.status,
      stockCount: Number(item.stockCount) || total,
      processed: Number(item.processed) || 0,
      fetched: Number(item.fetched) || 0,
      failed: Number(item.failed) || 0,
      fileName: item.fileName || '',
      filePath: item.filePath || '',
      message: item.message || '',
      startedAt: item.startedAt || null,
      updatedAt: item.updatedAt || null,
      finishedAt: item.finishedAt || null
    })),
    items: items.map(item => ({
      code: item.code,
      name: item.name || item.code,
      status: item.status,
      rowCount: Number(item.rowCount) || 0,
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

async function loadFullMarketHistoryItemsForDaily(options = {}) {
  ensureFullHistoryDir()
  if (!options.force) {
    const cachedItems = readFullMarketStockList()
    if (cachedItems?.length) return cachedItems
  }

  const spot = await fetchEastmoneyClistSpot({
    codes: '',
    pageSize: 500,
    concurrency: 2
  })
  const items = extractFullHistoryItemsFromSpot(spot)
  if (!items.length) throw new Error('全市场股票列表为空，无法开始历史数据同步')
  writeFullMarketStockList(items, spot?.endpoint || 'eastmoney_clist')
  return items.map(item => ({
    ...item,
    failedCount: Number(item.failedCount) || 0,
    message: item.message || '未获取'
  }))
}

async function refreshFullMarketStockListFromSnapshot(options = {}) {
  if (isFullHistoryActive()) throw new Error('全市场历史任务运行中，请先停止或等待完成后再刷新股票清单')
  ensureFullHistoryDir()

  const previousItems = readFullMarketStockList() || []
  const spot = await fetchEastmoneyClistSpot({
    codes: '',
    pageSize: 500,
    concurrency: 2
  })
  const items = extractFullHistoryItemsFromSpot(spot)
  if (!items.length) throw new Error('当前日期股票快照为空，无法生成全市场股票清单')

  const shouldRewrite = !previousItems.length || previousItems.length !== items.length || Boolean(options.force)
  if (shouldRewrite) {
    writeFullMarketStockList(items, spot?.endpoint || 'eastmoney_clist_snapshot')
  }

  const activeItems = shouldRewrite ? items : previousItems
  fullHistoryJob = createFullHistoryJob({
    ...fullHistoryJob,
    status: 'ready',
    stockListFile: FULL_HISTORY_STOCK_LIST_FILE,
    dateIndexFile: FULL_HISTORY_DATE_INDEX_FILE,
    dailyDir: FULL_HISTORY_DAILY_CACHE_DIR,
    message: shouldRewrite
      ? `已根据当前快照生成全市场股票清单：${items.length} 只`
      : `当前快照 ${items.length} 只，与本地清单数量一致，继续使用现有清单`
  }, activeItems)

  return {
    ...buildFullHistorySnapshot(fullHistoryJob),
    snapshotStockCount: items.length,
    previousStockCount: previousItems.length,
    stockListUpdated: shouldRewrite,
    stockListFile: FULL_HISTORY_STOCK_LIST_FILE
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

function parseFullHistorySelectedCodes(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeCacheCode).filter(Boolean)
  }
  return String(value || '').split(',').map(item => normalizeCacheCode(item.trim())).filter(Boolean)
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

function markFullHistoryItemDay(item, date, ok, totalDays, message = '') {
  item.updatedAt = new Date().toISOString()
  if (ok) {
    item.rowCount = (Number(item.rowCount) || 0) + 1
    item.status = 'done'
  } else {
    item.failedCount = (Number(item.failedCount) || 0) + 1
    if (!item.rowCount) item.status = 'failed'
  }
  const failed = Number(item.failedCount) || 0
  item.message = message || `已处理 ${Number(item.rowCount) || 0}/${totalDays} 天${failed ? `，失败 ${failed} 天` : ''}`
}

function updateFullHistoryDailyFiles(job, dayEntry) {
  const nextFile = {
    date: dayEntry.date,
    fileName: dayEntry.fileName,
    filePath: dayEntry.filePath,
    fetched: Number(dayEntry.fetched) || 0,
    failed: Number(dayEntry.failed) || 0,
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

async function fetchFullHistoryDay(job, dayEntry) {
  const date = dayEntry.date
  const filePath = getFullHistoryDailyFile(date)
  const fileName = path.basename(filePath)
  const recordsByCode = new Map()
  const totalDays = job.dates.length || 1
  const startedAt = new Date().toISOString()

  dayEntry.status = 'running'
  dayEntry.stockCount = job.items.length
  dayEntry.fileName = fileName
  dayEntry.filePath = filePath
  dayEntry.startedAt = startedAt
  dayEntry.updatedAt = startedAt
  dayEntry.message = `正在获取 ${date}`
  job.currentDate = date

  for (let index = 0; index < job.items.length; index += FULL_HISTORY_DAILY_BATCH_SIZE) {
    if (job.cancelRequested) return { cancelled: true }

    const batch = job.items.slice(index, index + FULL_HISTORY_DAILY_BATCH_SIZE)
    job.status = 'running'
    job.currentCode = `${Math.min(index + batch.length, job.items.length)}/${job.items.length}`
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
    try {
      const history = await fetchEastmoneyHistoryBatch({
        codes: batch.map(item => item.code).join(','),
        startDate: date,
        endDate: date,
        adjust: job.adjust,
        concurrency: FULL_HISTORY_DAILY_CONCURRENCY
      })
      tables = Array.isArray(history.payload?.tables) ? history.payload.tables : []
      errors = Array.isArray(history.payload?.errors) ? history.payload.errors : []
    } catch (error) {
      errors = batch.map(item => ({ code: item.code, message: error.message || '获取失败' }))
      addFullHistoryError(job, `${date}: ${error.message || '批次获取失败'}`)
    }

    const tableByCode = new Map()
    tables.forEach(table => {
      const code = normalizeCacheCode(table.thscode || table.code || table.thsCode || '')
      if (code) tableByCode.set(code, table)
    })
    const errorByCode = new Map(errors.map(item => [normalizeCacheCode(item.code || ''), item.message || '获取失败']))

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
        recordsByCode.set(item.code, {
          code: item.code,
          name: item.name || item.code,
          status: 'failed',
          data: null,
          error: message,
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

    if (index + FULL_HISTORY_DAILY_BATCH_SIZE < job.items.length && !job.cancelRequested) {
      await waitFullHistoryDelay(job)
    }
  }

  const generatedAt = new Date().toISOString()
  const fallbackStocks = job.items.map(item => recordsByCode.get(item.code) || {
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
      adjust: String(options.adjust || fullHistoryJob.adjust || '1')
    }
    return buildFullHistorySnapshot()
  }

  fullHistoryJob = createFullHistoryJob({
    status: 'preparing',
    startDate: normalizeFullHistoryDate(options.startDate),
    endDate: normalizeFullHistoryDate(options.endDate),
    delayMs: options.delayMs,
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

async function startFullMarketHistorySync(options = {}) {
  if (isFullHistoryActive()) return buildFullHistorySnapshot()

  const startDate = normalizeFullHistoryDate(options.startDate)
  const endDate = normalizeFullHistoryDate(options.endDate)
  if (!startDate || !endDate) throw new Error('请先选择开始时间和结束时间')
  if (startDate > endDate) throw new Error('开始时间不能晚于结束时间')

  const workdays = listFullHistoryWorkdays(startDate, endDate)
  if (!workdays.length) throw new Error('选择区间内没有工作日，请重新选择日期')

  const selectedCodes = parseFullHistorySelectedCodes(options.codes)
  const selectedCodeSet = new Set(selectedCodes)
  const sourceItems = fullHistoryJob?.items?.length
    ? fullHistoryJob.items
    : await loadFullMarketHistoryItemsForDaily()
  const items = selectedCodeSet.size
    ? sourceItems.filter(item => selectedCodeSet.has(normalizeCacheCode(item.code)))
    : sourceItems
  if (selectedCodeSet.size && !items.length) throw new Error('未在历史数据列表中找到选中的股票，请先刷新列表后再试')
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
    adjust: options.adjust,
    startedAt: new Date().toISOString(),
    outputFile: paths.outputFile,
    dailyDir: paths.dailyDir,
    stockListFile: paths.stockListFile,
    dateIndexFile: paths.dateIndexFile,
    metaFile: paths.metaFile,
    selectedOnly: selectedCodeSet.size > 0,
    selectedCodes: items.map(item => item.code),
    dates: workdays.map(date => ({
      date,
      status: 'pending',
      stockCount: resetItems.length,
      processed: 0,
      fetched: 0,
      failed: 0,
      fileName: path.basename(getFullHistoryDailyFile(date)),
      filePath: getFullHistoryDailyFile(date),
      message: '等待获取'
    })),
    message: `${selectedCodeSet.size ? '开始获取选中股票' : '开始按工作日获取'} ${resetItems.length} 只，${workdays.length} 天`
  }, resetItems)

  fullHistoryJob.promise = runFullMarketHistorySyncByDate(fullHistoryJob)
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

window.stockReviewBridge = {
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
