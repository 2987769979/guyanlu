import { marketSnapshot, sectorRows, stockUniverse } from './sampleData'
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage'

// SQLite 重算只需要日期范围；旧版数据源字段不再参与配置读取和持久化。
export const DEFAULT_DATA_CONFIG = {
  startDate: '',
  endDate: ''
}

const DEFAULT_WORKDAY_RANGE = 70

// 本地样例数据保持和真实数据相同的数据结构，方便 UI 与策略逻辑统一处理。
export function createSampleDataBundle() {
  return {
    market: marketSnapshot,
    sectors: sectorRows,
    stocks: stockUniverse,
    sourceLabel: '本地样例数据',
    rawRows: [],
    updatedAt: null,
    allMarketMode: false,
    historyMode: 'sample',
    historyScope: stockUniverse.length,
    supportsBacktest: true,
    sourceSize: stockUniverse.length,
    resultLimit: null
  }
}

export function loadDataConfig() {
  try {
    const saved = readStoredValue(STORAGE_KEYS.dataConfig, {}, [LEGACY_STORAGE_KEYS.dataConfig])
    return {
      startDate: String(saved?.startDate || ''),
      endDate: String(saved?.endDate || '')
    }
  } catch {
    return { ...DEFAULT_DATA_CONFIG }
  }
}

export function saveDataConfig(config) {
  writeStoredValue(STORAGE_KEYS.dataConfig, {
    startDate: String(config?.startDate || ''),
    endDate: String(config?.endDate || '')
  })
}

export function getDefaultDateRange() {
  const end = new Date()
  end.setHours(12, 0, 0, 0)
  while (end.getDay() === 0 || end.getDay() === 6) {
    end.setDate(end.getDate() - 1)
  }

  const start = new Date(end)
  let includedWorkdays = 1
  while (includedWorkdays < DEFAULT_WORKDAY_RANGE) {
    start.setDate(start.getDate() - 1)
    if (start.getDay() !== 0 && start.getDay() !== 6) includedWorkdays += 1
  }

  return {
    startDate: formatDate(start),
    endDate: formatDate(end)
  }
}

export function parseCodeList(codes) {
  return String(codes || '')
    .split(/[\s,，;；]+/)
    .map(code => code.trim().toUpperCase())
    .filter(Boolean)
}

export function parseStockMeta(text) {
  const map = new Map()
  String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const [code, name, industry, concept] = line.split(/[,，\t]/).map(item => item?.trim())
      if (!code) return
      map.set(code.toUpperCase(), {
        name: name || code.toUpperCase(),
        industry: industry || '未分类',
        concept: concept || industry || '同花顺数据'
      })
    })
  return map
}

// 把外部接口返回的逐日行情行转换成应用内部使用的 market/sectors/stocks 数据包。
export function buildDataBundleFromIfindRows({ rows, config, fetchedAt }) {
  const grouped = groupRows(rows)
  const metaMap = parseStockMeta(config.stockMetaText)
  const latestRows = []

  grouped.forEach((items, code) => {
    const sorted = items
      .filter(row => Number.isFinite(getNumber(row, FIELD_ALIASES.close, NaN)))
      .sort((a, b) => String(a.tradeDate || a.time).localeCompare(String(b.tradeDate || b.time)))
    if (!sorted.length) return

    const last = sorted[sorted.length - 1]
    const previous = sorted[sorted.length - 2]
    const close = getNumber(last, FIELD_ALIASES.close)
    const open = getNumber(last, FIELD_ALIASES.open, close)
    const high = getNumber(last, FIELD_ALIASES.high, close)
    const low = getNumber(last, FIELD_ALIASES.low, close)
    const prevClose = getNumber(last, FIELD_ALIASES.prevClose, getNumber(previous, FIELD_ALIASES.close, close))
    const volume = getNumber(last, FIELD_ALIASES.volume, 0)
    const rawAmount = getNumber(last, FIELD_ALIASES.amount, 0)
    const amount = rawAmount / amountUnitDivisor(rawAmount)
    const pctChg = getNumber(last, FIELD_ALIASES.pctChg, prevClose ? ((close - prevClose) / prevClose) * 100 : 0)
    const turnoverRate = getNumber(last, FIELD_ALIASES.turnoverRate, 0)
    const history = sorted.slice(-10).map(row => getNumber(row, FIELD_ALIASES.close))
    const meta = metaMap.get(code) || {}
    const fallbackMeta = classifyStockCode(code)
    const industry = meta.industry || fallbackMeta.industry
    const concept = meta.concept || fallbackMeta.concept
    const normalizedSectorKey = normalizeSectorKey(concept || industry)
    const rowName = getString(last, FIELD_ALIASES.name, code)

    latestRows.push({
      code,
      name: meta.name || rowName,
      tradeDate: normalizeDate(last.tradeDate || last.time),
      market: fallbackMeta.market,
      industry,
      concept,
      sectorKey: normalizedSectorKey,
      close,
      high,
      low,
      open,
      prevClose,
      high20: maxOf(sorted.slice(-20), FIELD_ALIASES.highLike, high),
      pctChg,
      amount,
      amountRank: 0,
      volume,
      volRatio20: calcRatio(volume, avgOf(sorted.slice(-20), FIELD_ALIASES.volume)),
      turnoverRate,
      turnoverPctile60: calcPercentile(sorted.slice(-60).map(row => getNumber(row, FIELD_ALIASES.turnoverRate, 0)), turnoverRate),
      closePos: calcClosePos(open, high, low, close),
      upperShadow: calcUpperShadow(open, high, low, close),
      ma5: avgOf(sorted.slice(-5), FIELD_ALIASES.close, close),
      ma10: avgOf(sorted.slice(-10), FIELD_ALIASES.close, close),
      ma20: avgOf(sorted.slice(-20), FIELD_ALIASES.close, close),
      ma60: avgOf(sorted.slice(-60), FIELD_ALIASES.close, close),
      stockReturn20: calcWindowReturn(sorted, 20),
      marketReturn20: 0,
      high60Position: calcHighPosition(sorted, close),
      previousSelected: false,
      nextOpenRet: 0,
      futureReturns: { d1: 0, d3: 0, d5: 0, d10: 0 },
      historyDays: sorted.length,
      history
    })
  })

  const withRanks = applyAmountRank(latestRows)
  const sectors = buildSectors(withRanks)
  const market = buildMarketSnapshot(withRanks, fetchedAt)

  return {
    market,
    sectors,
    stocks: withRanks,
    sourceLabel: config.sourceLabel || sourceLabelFor(config.source),
    rawRows: rows,
    updatedAt: fetchedAt,
    historyMode: latestRows.some(stock => stock.historyDays >= 20) ? 'history' : 'snapshot',
    historyScope: latestRows.filter(stock => stock.historyDays >= 20).length,
    supportsBacktest: false
  }
}

function classifyStockCode(code) {
  const fullCode = String(code || '').toUpperCase()
  const symbol = fullCode.split('.')[0]

  if (fullCode.endsWith('.BJ') || symbol.startsWith('8') || symbol.startsWith('4')) {
    return { market: '北交所', industry: '交易板块', concept: '北交所' }
  }
  if (symbol.startsWith('688') || symbol.startsWith('689')) {
    return { market: '科创板', industry: '交易板块', concept: '科创板' }
  }
  if (symbol.startsWith('300') || symbol.startsWith('301')) {
    return { market: '创业板', industry: '交易板块', concept: '创业板' }
  }
  if (fullCode.endsWith('.SH') || symbol.startsWith('6')) {
    return { market: '沪市', industry: '交易板块', concept: '沪市主板' }
  }
  if (fullCode.endsWith('.SZ') || symbol.startsWith('0') || symbol.startsWith('2')) {
    return { market: '深市', industry: '交易板块', concept: '深市主板' }
  }
  return { market: 'A股', industry: '未分类', concept: '未分类' }
}

function sourceLabelFor(source) {
  return {
    quantapi: '同花顺 QuantAPI',
    eastmoney: '东方财富公开接口',
    free: '免费稳定模式',
    akshare: 'AKShare'
  }[source] || '外部数据源'
}

// 兼容 iFinD、东方财富、AKShare 等不同表格形态，统一摊平成按日期排列的行数组。
export function normalizeIfindPayload(payload) {
  const tables = Array.isArray(payload?.tables)
    ? payload.tables
    : Array.isArray(payload?.data?.tables)
      ? payload.data.tables
      : []
  const rows = []

  tables.forEach(table => {
    const code = String(table.thscode || table.code || table.thsCode || '').toUpperCase()
    const data = table.table || table.data || table
    const timeValues = toArray(data.time || data.tradeDate || table.time || table.times)
    const keys = Object.keys(data).filter(key => !['time', 'tradeDate', 'thscode', 'code'].includes(key))
    const length = Math.max(timeValues.length, ...keys.map(key => toArray(data[key]).length), 1)

    for (let index = 0; index < length; index++) {
      const row = { code }
      row.time = timeValues[index] || timeValues[0] || table.time || ''
      keys.forEach(key => {
        const values = toArray(data[key])
        row[key] = values[index] ?? values[0]
      })
      rows.push(row)
    }
  })

  return rows
}

function groupRows(rows) {
  const map = new Map()
  rows.forEach(row => {
    const code = String(row.code || row.thscode || row.thsCode || '').toUpperCase()
    if (!code) return
    if (!map.has(code)) map.set(code, [])
    map.get(code).push(row)
  })
  return map
}

// 不同数据源字段名不一致，这里集中维护别名，避免转换逻辑里到处写条件判断。
const FIELD_ALIASES = {
  name: ['name', 'stockName', 'stock_name', 'securityName', 'secName', 'ths_stock_short_name_stock'],
  open: ['open', 'openPrice', 'open_price', 'ths_open_price_stock'],
  high: ['high', 'highPrice', 'high_price', 'ths_high_price_stock'],
  low: ['low', 'lowPrice', 'low_price', 'ths_low_stock', 'ths_low_price_stock'],
  close: ['close', 'latest', 'closePrice', 'close_price', 'ths_close_price_stock', 'ths_latest_price_stock'],
  prevClose: ['preClose', 'prevClose', 'pre_close', 'prev_close', 'ths_pre_close_stock'],
  pctChg: ['changeRatio', 'pct_chg', 'pctChg', 'change_ratio', 'ths_chg_ratio_stock'],
  amount: ['amount', 'amt', 'turnover', 'ths_amt_stock', 'ths_trans_amt_stock'],
  volume: ['volume', 'vol', 'ths_vol_stock', 'ths_trans_num_stock'],
  turnoverRate: ['turnoverRate', 'turnover_rate', 'turnover_ratio', 'ths_turnover_ratio_stock'],
  highLike: ['high', 'highPrice', 'high_price', 'ths_high_price_stock', 'close', 'latest', 'ths_close_price_stock']
}

// 根据当前股票样本估算市场宽度、成交额和强弱状态。
function buildMarketSnapshot(stocks, fetchedAt) {
  const advancers = stocks.filter(stock => stock.pctChg > 0).length
  const decliners = stocks.filter(stock => stock.pctChg < 0).length
  const totalAmount = stocks.reduce((sum, stock) => sum + stock.amount, 0)
  const limitUp = stocks.filter(stock => stock.pctChg >= 9.5).length
  const limitDown = stocks.filter(stock => stock.pctChg <= -9.5).length
  const upRatio = stocks.length ? advancers / stocks.length : 0
  const marketScore = Math.round(35 + upRatio * 35 + Math.min(totalAmount / Math.max(stocks.length, 1), 100) * 0.12)

  return {
    tradeDate: stocks[0]?.tradeDate || formatDate(new Date(fetchedAt || Date.now())),
    marketScore: Math.max(0, Math.min(100, marketScore)),
    marketState: marketScore >= 65 ? '强市' : marketScore >= 45 ? '震荡' : '弱市',
    totalAmount: Math.round(totalAmount),
    amountChange: 0,
    advancers,
    decliners,
    limitUp,
    limitDown,
    indices: [
      { name: '样本股票池', close: stocks.length, pctChg: stocks.length ? avgNumber(stocks.map(stock => stock.pctChg)) : 0, trend: '同花顺接口样本' }
    ],
    reviewNotes: [
      '当前为同花顺接口返回数据生成的复盘快照。',
      '如需全市场口径，请在配置中扩大代码池或接入全部A股代码列表。',
      '策略仅输出候选池和风险标签，不构成投资建议。'
    ]
  }
}

// 按行业/概念聚合股票，计算板块涨跌、广度和热度分。
function buildSectors(stocks) {
  const groups = new Map()
  stocks.forEach(stock => {
    if (!groups.has(stock.sectorKey)) {
      groups.set(stock.sectorKey, {
        key: stock.sectorKey,
        name: stock.concept || stock.industry || '同花顺数据',
        type: stock.concept ? '概念' : '行业',
        pctChg: 0,
        amountRank: 0,
        breadth: 0,
        streak: 1,
        score: 0,
        leaders: [],
        stocks: []
      })
    }
    groups.get(stock.sectorKey).stocks.push(stock)
  })

  return Array.from(groups.values()).map(group => {
    const sorted = [...group.stocks].sort((a, b) => b.pctChg - a.pctChg)
    const pctChg = avgNumber(group.stocks.map(stock => stock.pctChg))
    const breadth = group.stocks.filter(stock => stock.pctChg > 0).length / group.stocks.length
    const amountRank = avgNumber(group.stocks.map(stock => stock.amountRank))
    const score = Math.round(45 + Math.max(pctChg, -5) * 4 + breadth * 25 + amountRank * 20)

    return {
      key: group.key,
      name: group.name,
      type: group.type,
      pctChg,
      amountRank,
      breadth,
      streak: group.streak,
      score: Math.max(0, Math.min(100, score)),
      leaders: sorted.slice(0, 3).map(stock => stock.name)
    }
  }).sort((a, b) => b.score - a.score)
}

// 将成交额转换成 0-1 分位，后续策略用它衡量资金关注度。
function applyAmountRank(stocks) {
  const sorted = [...stocks].sort((a, b) => a.amount - b.amount)
  const rankMap = new Map(sorted.map((stock, index) => [stock.code, sorted.length <= 1 ? 1 : index / (sorted.length - 1)]))
  return stocks.map(stock => ({ ...stock, amountRank: rankMap.get(stock.code) || 0 }))
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function getNumber(row, keys, fallback = 0) {
  for (const key of keys) {
    if (row?.[key] == null) continue
    const value = Number(String(row[key]).replace(/,/g, ''))
    if (Number.isFinite(value)) return value
  }
  return fallback
}

function getString(row, keys, fallback = '') {
  for (const key of keys) {
    const value = String(row?.[key] ?? '').trim()
    if (value) return value
  }
  return fallback
}

function avgOf(rows, keys, fallback = 0) {
  const values = rows.map(row => getNumber(row, keys, NaN)).filter(Number.isFinite)
  return values.length ? avgNumber(values) : fallback
}

function maxOf(rows, keys, fallback = 0) {
  const values = rows.map(row => getNumber(row, keys, NaN)).filter(Number.isFinite)
  return values.length ? Math.max(...values) : fallback
}

function avgNumber(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function calcRatio(value, base) {
  return base > 0 ? Math.round((value / base) * 100) / 100 : 0
}

function calcPercentile(values, current) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!valid.length) return 0
  return valid.filter(value => value <= current).length / valid.length
}

function calcClosePos(open, high, low, close) {
  const range = high - low
  if (range <= 0) return 0.5
  return Math.max(0, Math.min(1, (close - low) / range))
}

function calcUpperShadow(open, high, low, close) {
  const range = high - low
  if (range <= 0) return 0
  return Math.max(0, Math.min(1, (high - Math.max(open, close)) / range))
}

function calcWindowReturn(rows, windowSize) {
  if (rows.length < 2) return 0
  const target = rows[Math.max(0, rows.length - windowSize - 1)]
  const last = rows[rows.length - 1]
  const start = getNumber(target, FIELD_ALIASES.close, 0)
  const end = getNumber(last, FIELD_ALIASES.close, 0)
  return start > 0 ? ((end - start) / start) * 100 : 0
}

function calcHighPosition(rows, close) {
  const highs = rows.slice(-60).map(row => getNumber(row, FIELD_ALIASES.highLike, close)).filter(Number.isFinite)
  const low = Math.min(...highs)
  const high = Math.max(...highs)
  if (!Number.isFinite(low) || !Number.isFinite(high) || high === low) return 0.5
  return Math.max(0, Math.min(1, (close - low) / (high - low)))
}

function normalizeDate(value) {
  if (!value) return formatDate(new Date())
  const text = String(value)
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  return text.slice(0, 10)
}

function normalizeSectorKey(value) {
  return String(value || 'ifind')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '') || 'ifind'
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function amountUnitDivisor(value) {
  return Math.abs(value) > 1000000 ? 100000000 : 1
}
