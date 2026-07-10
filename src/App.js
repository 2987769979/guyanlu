import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import {
  Alert,
  Box,
  Button,
  Chip,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Slider,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery
} from '@mui/material'
import AssessmentIcon from '@mui/icons-material/Assessment'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import BarChartIcon from '@mui/icons-material/BarChart'
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DashboardIcon from '@mui/icons-material/Dashboard'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import SellOutlinedIcon from '@mui/icons-material/SellOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import NotesIcon from '@mui/icons-material/Notes'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/Save'
import SearchIcon from '@mui/icons-material/Search'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import StackedBarChartIcon from '@mui/icons-material/StackedBarChart'
import SyncIcon from '@mui/icons-material/Sync'
import TableChartIcon from '@mui/icons-material/TableChart'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TuneIcon from '@mui/icons-material/Tune'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { apiContractRows, backtestBenchmarks } from './sampleData'
import {
  buildDataBundleFromIfindRows,
  createSampleDataBundle,
  getDefaultDateRange,
  loadDataConfig,
  normalizeIfindPayload,
  parseCodeList,
  saveDataConfig
} from './dataSource'
import {
  DEFAULT_STRATEGY,
  POOL_META,
  buildPools,
  buildReview,
  enrichStocks,
  formatAmount,
  formatPercent,
  runBacktestFromSample,
  updateNestedValue
} from './strategyEngine'
import {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  clearLatestDataBundle,
  loadLatestDataBundle,
  readStoredValue,
  removeStoredValue,
  replaceLatestDataBundle,
  writeStoredValue
} from './storage'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2454a6' },
    secondary: { main: '#0f766e' },
    success: { main: '#15803d' },
    warning: { main: '#b45309' },
    error: { main: '#b91c1c' },
    background: { default: '#f5f7fb', paper: '#ffffff' },
    text: { primary: '#172033', secondary: '#647089' }
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
    allVariants: { letterSpacing: 0 }
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: { styleOverrides: { root: { textTransform: 'none' } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 6 } } }
  }
})

const NAV_ITEMS = [
  { id: 'review', label: '市场复盘', icon: <DashboardIcon /> },
  { id: 'pools', label: '选股结果', icon: <TableChartIcon /> },
  { id: 'portfolio', label: '模拟持仓', icon: <AccountBalanceWalletIcon /> },
  { id: 'stock', label: '个股复盘', icon: <ShowChartIcon /> },
  { id: 'sectors', label: '板块强弱', icon: <StackedBarChartIcon /> },
  { id: 'strategy', label: '策略配置', icon: <TuneIcon /> },
  { id: 'historySync', label: '历史数据', icon: <ReceiptLongIcon /> },
  { id: 'backtest', label: '回测分析', icon: <AssessmentIcon /> },
  { id: 'risk', label: '风险观察', icon: <WarningAmberIcon /> }
]

const TOP_RANKED_POOL_ID = 'topRanked'
const POOL_ORDER = [TOP_RANKED_POOL_ID, 'focus', 'broad', 'strongVolume', 'mildTurnover', 'breakout', 'risk']

const DATA_SOURCE_STATUS = {
  sample: '当前使用本地样例数据',
  // quantapi: '同花顺数据源待配置',
  eastmoney: '东方财富数据源待更新',
  free: '免费稳定模式待更新',
  // akshare: 'AKShare 数据源待更新'
}

const DATA_SOURCE_LABEL = {
  sample: '本地样例数据',
  quantapi: '同花顺 QuantAPI',
  eastmoney: '东方财富公开接口',
  free: '免费稳定模式',
  akshare: 'AKShare'
}

const ALL_MARKET_TOP_LIMIT = 50
const ALL_MARKET_REFRESH_TIMEOUT_MS = 45000
const ALL_MARKET_HISTORY_ENHANCE_LIMIT = 120
const ALL_MARKET_HISTORY_ENHANCE_TIMEOUT_MS = 90000
const FULL_HISTORY_DEFAULT_DELAY_MS = 1500
const FULL_HISTORY_DEFAULT_CONCURRENCY = 5
const HISTORY_SYNC_ACTIVE_STATUSES = new Set(['preparing', 'running', 'stopping'])
const EMPTY_HISTORY_SYNC_STATE = {
  status: 'idle',
  message: '',
  total: 0,
  fetched: 0,
  failed: 0,
  pending: 0,
  progress: 0,
  concurrency: FULL_HISTORY_DEFAULT_CONCURRENCY,
  failedTaskCount: 0,
  stockListFile: '',
  dateIndexFile: '',
  dailyDir: '',
  dailyFiles: [],
  dates: [],
  items: [],
  failedTasks: [],
  errors: []
}
const PORTFOLIO_QUOTE_REFRESH_MS = 15000
const SHARE_LOT_SIZE = 100

const cloneStrategy = () => JSON.parse(JSON.stringify(DEFAULT_STRATEGY))

function formatPrice(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}元` : '--'
}

function createStatus(value, detail = '') {
  if (value && typeof value === 'object') {
    return {
      message: String(value.message || ''),
      detail: String(value.detail || value.message || ''),
      updatedAt: value.updatedAt || new Date().toISOString()
    }
  }
  const message = String(value || '')
  return {
    message,
    detail: detail || message,
    updatedAt: new Date().toISOString()
  }
}

function errorDetail(error, context = '') {
  const parts = []
  if (context) parts.push(context)
  if (error?.message) parts.push(error.message)
  if (error?.stack) parts.push(error.stack)
  return parts.filter(Boolean).join('\n\n')
}

// 加载用户保存过的策略参数，并和默认策略合并，防止版本升级后缺少新增字段。
function loadStrategy() {
  try {
    const saved = readStoredValue(STORAGE_KEYS.strategy, null, [LEGACY_STORAGE_KEYS.strategy])
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return cloneStrategy()
    const defaults = cloneStrategy()
    return {
      ...defaults,
      ...saved,
      weights: { ...defaults.weights, ...(saved.weights || {}) },
      thresholds: { ...defaults.thresholds, ...(saved.thresholds || {}) }
    }
  } catch {
    return cloneStrategy()
  }
}

function loadJsonObject(key, legacyKey) {
  try {
    const saved = readStoredValue(key, {}, legacyKey ? [legacyKey] : [])
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  } catch {
    return {}
  }
}

function loadJsonArray(key, legacyKey) {
  try {
    const saved = readStoredValue(key, [], legacyKey ? [legacyKey] : [])
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

function loadInitialDataConfig() {
  const dates = getDefaultDateRange()
  const saved = loadDataConfig()
  return {
    ...saved,
    startDate: saved.startDate || dates.startDate,
    endDate: saved.endDate || dates.endDate
  }
}

function loadInitialDataBundle(dataConfig) {
  if (dataConfig.source === 'sample') return createSampleDataBundle()
  return loadLatestDataBundle() || createSampleDataBundle()
}

// 应用启动时同时准备数据源配置和首屏数据，保证后续状态初始化来自同一份配置。
function createInitialAppState() {
  const dataConfig = loadInitialDataConfig()
  return {
    dataConfig,
    dataBundle: loadInitialDataBundle(dataConfig)
  }
}

// 实时行情会覆盖同一股票同一日期的历史行，让页面优先展示最新价格。
function mergeLatestRows(historyRows, realtimeRows) {
  if (!realtimeRows.length) return historyRows
  const map = new Map()
  historyRows.forEach(row => {
    map.set(`${row.code || row.thscode || row.thsCode}-${row.time || row.tradeDate || ''}`, row)
  })
  realtimeRows.forEach(row => {
    map.set(`${row.code || row.thscode || row.thsCode}-${row.time || row.tradeDate || ''}`, row)
  })
  return Array.from(map.values())
}

function normalizePortfolioCode(value) {
  const code = String(value || '').trim().toUpperCase()
  if (!code) return ''
  if (code.includes('.')) return code
  if (!/^\d{6}$/.test(code)) return code
  if (code.startsWith('6')) return `${code}.SH`
  if (code.startsWith('8') || code.startsWith('4')) return `${code}.BJ`
  return `${code}.SZ`
}

function toFiniteNumber(value, fallback = NaN) {
  if (value == null || String(value).trim() === '') return fallback
  const num = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(num) ? num : fallback
}

function normalizeShareLot(value, { fallback = SHARE_LOT_SIZE, max = Infinity } = {}) {
  const number = Number(value)
  const base = Number.isFinite(number) && number > 0 ? number : fallback
  let shares = Math.max(SHARE_LOT_SIZE, Math.round(base / SHARE_LOT_SIZE) * SHARE_LOT_SIZE)
  if (Number.isFinite(max) && max > 0) {
    const maxShares = max < SHARE_LOT_SIZE ? max : Math.floor(max / SHARE_LOT_SIZE) * SHARE_LOT_SIZE
    shares = Math.min(shares, maxShares || max)
  }
  return shares
}

function isShareLot(value, { max = Infinity, allowClearRemainder = false } = {}) {
  const shares = Number(value)
  if (!Number.isInteger(shares) || shares <= 0) return false
  if (Number.isFinite(max) && shares > max) return false
  if (allowClearRemainder && Number.isFinite(max) && shares === max) return true
  return shares >= SHARE_LOT_SIZE && shares % SHARE_LOT_SIZE === 0
}

// 将行情接口返回值转换成持仓模块可直接按代码索引的报价表。
function buildPortfolioQuoteMap(payload, fetchedAt, endpoint) {
  const rows = normalizeIfindPayload(payload)
  const map = {}
  rows.forEach(row => {
    const code = normalizePortfolioCode(row.code || row.thscode || row.thsCode)
    const close = toFiniteNumber(row.close ?? row.latest ?? row.closePrice)
    if (!code || !(close > 0)) return

    map[code] = {
      code,
      name: String(row.stockName || row.name || '').trim(),
      close,
      pctChg: toFiniteNumber(row.changeRatio ?? row.pctChg ?? row.change_ratio, 0),
      open: toFiniteNumber(row.open, close),
      high: toFiniteNumber(row.high, close),
      low: toFiniteNumber(row.low, close),
      amount: toFiniteNumber(row.amount, 0),
      volume: toFiniteNumber(row.volume, 0),
      turnoverRate: toFiniteNumber(row.turnoverRate, 0),
      tradeDate: row.time || row.tradeDate || '',
      updatedAt: fetchedAt || new Date().toISOString(),
      endpoint: endpoint || ''
    }
  })
  return map
}

const PORTFOLIO_QUOTE_COMPARE_KEYS = [
  'name',
  'close',
  'pctChg',
  'open',
  'high',
  'low',
  'amount',
  'volume',
  'turnoverRate',
  'tradeDate'
]

function hasPortfolioQuoteChanged(prevQuote, nextQuote) {
  if (!prevQuote || !nextQuote) return prevQuote !== nextQuote
  return PORTFOLIO_QUOTE_COMPARE_KEYS.some(key => prevQuote[key] !== nextQuote[key])
}

function mergePortfolioQuotes(prevQuotes, incomingQuotes, codes) {
  const prev = prevQuotes || {}
  const codeSet = new Set(codes)
  const next = {}
  let changed = Object.keys(prev).some(code => !codeSet.has(code))

  codes.forEach(code => {
    const incoming = incomingQuotes[code]
    const existing = prev[code]
    if (incoming) {
      next[code] = incoming
      if (hasPortfolioQuoteChanged(existing, incoming)) changed = true
    } else if (existing) {
      next[code] = existing
    }
  })

  return { next, changed }
}

function truncateText(value, maxLength = 28) {
  const text = String(value || '')
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function getRowCode(row) {
  return String(row?.code || row?.thscode || row?.thsCode || '').toUpperCase()
}

function getPoolMode(dataBundle) {
  if (!dataBundle.allMarketMode) return 'history'
  const historyRatio = dataBundle.sourceSize
    ? (Number(dataBundle.historyScope) || 0) / dataBundle.sourceSize
    : 0
  return (dataBundle.historyMode === 'enhanced' || dataBundle.historyMode === 'history') && historyRatio >= 0.35
    ? 'history'
    : 'snapshot'
}

function canRunReturnBacktest(dataBundle) {
  return dataBundle.supportsBacktest === true
}

// 全市场扫描先拿快照，再给排名靠前的股票补历史K线，提升评分和图表的可信度。
async function enhanceAllMarketHistory({ bridge, config, snapshotBundle, snapshotRows, sourceName, strategy, setStatus }) {
  if (!bridge?.fetchEastmoneyHistory) return snapshotBundle

  const ranked = enrichStocks(snapshotBundle.stocks, snapshotBundle.sectors, snapshotBundle.market, strategy)
  const codes = ranked
    .slice(0, ALL_MARKET_HISTORY_ENHANCE_LIMIT)
    .map(stock => stock.code)
    .filter(Boolean)
  if (!codes.length) return snapshotBundle

  setStatus(`正在为Top${codes.length}补充历史K线...`)

  try {
    const history = await withTimeout(
      bridge.fetchEastmoneyHistory({
        codes: codes.join(','),
        startDate: config.startDate,
        endDate: config.endDate,
        adjust: config.eastmoneyAdjust,
        concurrency: 4,
        tolerateErrors: true,
        disableFallback: true
      }),
      ALL_MARKET_HISTORY_ENHANCE_TIMEOUT_MS,
      `Top${codes.length}历史K线补充超时，已保留快照筛选结果`
    )
    const historyRows = normalizeIfindPayload(history.payload)
    const enhancedRows = mergeLatestRows(historyRows, snapshotRows)
    const enhancedBundle = buildDataBundleFromIfindRows({
      rows: enhancedRows,
      config,
      fetchedAt: history.fetchedAt || snapshotBundle.updatedAt
    })

    const historyScope = enhancedBundle.stocks.filter(stock => stock.historyDays >= 20).length
    if (!enhancedBundle.stocks.length || historyScope < Math.min(20, enhancedBundle.stocks.length)) {
      return {
        ...snapshotBundle,
        historyMode: 'snapshot',
        historyScope,
        historyEnhanceError: '历史K线样本不足，已保留快照筛选结果',
        supportsBacktest: false
      }
    }

    return {
      ...enhancedBundle,
      sourceLabel: `${sourceName}（Top${historyScope}历史增强）`,
      allMarketMode: true,
      historyMode: 'enhanced',
      historyScope,
      historyEnhanceError: null,
      supportsBacktest: false,
      sourceSize: snapshotBundle.sourceSize,
      resultLimit: ALL_MARKET_TOP_LIMIT
    }
  } catch (error) {
    return {
      ...snapshotBundle,
      historyMode: 'snapshot',
      historyScope: 0,
      historyEnhanceError: error.message || '历史K线补充失败',
      supportsBacktest: false
    }
  }
}

// 全市场模式下后端没有稳定板块表时，直接从已评分股票反推展示用板块列表。
function buildDisplaySectorsFromStocks(stocks) {
  const groups = new Map()
  stocks.forEach(stock => {
    const key = stock.sectorKey || 'unknown'
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: stock.sectorName || stock.concept || stock.industry || '未分类',
        type: stock.concept ? '概念' : '行业',
        stocks: []
      })
    }
    groups.get(key).stocks.push(stock)
  })

  return Array.from(groups.values()).map(group => {
    const sorted = [...group.stocks].sort((a, b) => b.totalScore - a.totalScore)
    const avg = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    const pctChg = avg(group.stocks.map(stock => stock.pctChg || 0))
    const breadth = group.stocks.filter(stock => (stock.pctChg || 0) > 0).length / group.stocks.length
    const amountRank = avg(group.stocks.map(stock => stock.amountRank || 0))
    const score = Math.round(45 + Math.max(pctChg, -5) * 4 + breadth * 25 + amountRank * 20)

    return {
      key: group.key,
      name: group.name,
      type: group.type,
      pctChg,
      amountRank,
      breadth,
      streak: 1,
      score: Math.max(0, Math.min(100, score)),
      leaders: sorted.slice(0, 3).map(stock => stock.name)
    }
  }).sort((a, b) => b.score - a.score)
}

// uTools 主入口只负责拉起独立窗口；真正的桌面界面通过 window=desktop 运行。
function isLauncherWindow() {
  if (typeof window === 'undefined' || !window.utools) return false
  try {
    if (window.utools.getWindowType?.() === 'browser') return false
  } catch {}

  try {
    return new URLSearchParams(window.location.search).get('window') !== 'desktop'
  } catch {
    return true
  }
}

// 启动壳页面：自动打开独立窗口，失败时给用户一个手动重试按钮。
function LauncherWindow() {
  const [status, setStatus] = useState('正在打开股研录窗口...')
  const [error, setError] = useState('')

  async function openWindow(forceReload = false) {
    const bridge = window.stockReviewBridge
    if (!bridge?.openDesktopWindow) {
      setError('当前环境不支持打开独立窗口，请在 uTools 中运行')
      return
    }

    try {
      setError('')
      setStatus(forceReload ? '正在重新打开股研录窗口...' : '正在打开股研录窗口...')
      const result = await bridge.openDesktopWindow({ forceReload, verify: true })
      if (!result?.ok) {
        setError('独立窗口打开失败，请点击按钮重试')
        return
      }
      setStatus('股研录窗口已打开')
    } catch (err) {
      setError(err?.message || '独立窗口打开失败，请点击按钮重试')
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => openWindow(false), 80)
    return () => clearTimeout(timer)
  }, [])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'background.default',
          p: 2
        }}
      >
        <Paper variant='outlined' sx={{ width: 'min(420px, 100%)', p: 3 }}>
          <Stack spacing={2} alignItems='flex-start'>
            <Stack direction='row' spacing={1.2} alignItems='center'>
              <BarChartIcon color='primary' />
              <Typography variant='h6' fontWeight={800}>股研录</Typography>
            </Stack>
            <Typography variant='body2' color='text.secondary'>{status}</Typography>
            {error && <Alert severity='warning' sx={{ width: '100%' }}>{error}</Alert>}
            <Button variant='contained' startIcon={<RestartAltIcon />} onClick={() => openWindow(true)}>
              重新打开窗口
            </Button>
          </Stack>
        </Paper>
      </Box>
    </ThemeProvider>
  )
}

export default function App() {
  if (isLauncherWindow()) return <LauncherWindow />

  // 主应用状态分为四块：数据源/策略、页面筛选、持仓交易、后台历史同步。
  const compact = useMediaQuery('(max-width: 900px)')
  const [initialAppState] = useState(createInitialAppState)
  const [activePage, setActivePage] = useState('review')
  const [strategy, setStrategy] = useState(loadStrategy)
  const [dataConfig, setDataConfig] = useState(initialAppState.dataConfig)
  const [dataBundle, setDataBundle] = useState(initialAppState.dataBundle)
  const [historySync, setHistorySync] = useState(EMPTY_HISTORY_SYNC_STATE)
  const [historySyncBusy, setHistorySyncBusy] = useState(false)
  const [historySyncAction, setHistorySyncAction] = useState(null)
  const [historySyncForm, setHistorySyncForm] = useState(() => ({
    startDate: initialAppState.dataConfig.startDate,
    endDate: initialAppState.dataConfig.endDate,
    delayMs: FULL_HISTORY_DEFAULT_DELAY_MS,
    concurrency: FULL_HISTORY_DEFAULT_CONCURRENCY,
    adjust: initialAppState.dataConfig.eastmoneyAdjust || '1'
  }))
  const [selectedPool, setSelectedPool] = useState(TOP_RANKED_POOL_ID)
  const [selectedStockCode, setSelectedStockCode] = useState('300750.SZ')
  const [query, setQuery] = useState('')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [marketFilter, setMarketFilter] = useState('all')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [notes, setNotes] = useState(() => loadJsonObject(STORAGE_KEYS.reviewNotes, LEGACY_STORAGE_KEYS.reviewNotes))
  const [watchlist, setWatchlist] = useState(() => loadJsonArray(STORAGE_KEYS.watchlist, LEGACY_STORAGE_KEYS.watchlist))
  const [portfolio, setPortfolio] = useState(() => loadJsonArray(STORAGE_KEYS.portfolio))
  const [portfolioQuotes, setPortfolioQuotes] = useState({})
  const portfolioQuotesRef = useRef({})
  const [portfolioQuoteState, setPortfolioQuoteState] = useState({
    loading: false,
    updatedAt: null,
    error: '',
    endpoint: '',
    count: 0
  })
  const [transactions, setTransactions] = useState(() => loadJsonArray(STORAGE_KEYS.transactions))
  const [positionPrefill, setPositionPrefill] = useState(null)
  const [statusInfo, setStatusInfo] = useState(() => createStatus(DATA_SOURCE_STATUS[dataConfig.source] || '数据源待配置'))
  const status = statusInfo.message
  const updateStatus = (value, detail = '') => setStatusInfo(createStatus(value, detail))
  const setStatus = updateStatus
  const historySyncActive = HISTORY_SYNC_ACTIVE_STATUSES.has(historySync.status)

  const activeMarket = dataBundle.market
  const activeSectors = dataBundle.sectors
  const activeStocks = dataBundle.stocks

  // 所有页面共享同一批评分结果，避免每个页面重复跑策略引擎。
  const scoredStocks = useMemo(() => {
    const scored = enrichStocks(activeStocks, activeSectors, activeMarket, strategy)
    return scored
  }, [activeStocks, activeSectors, activeMarket, strategy, dataBundle.allMarketMode])
  const displaySectors = useMemo(() => {
    if (!dataBundle.allMarketMode) return activeSectors
    return buildDisplaySectorsFromStocks(scoredStocks)
  }, [activeSectors, scoredStocks, dataBundle.allMarketMode])
  const poolMode = getPoolMode(dataBundle)
  const pools = useMemo(
    () => buildPools(scoredStocks, strategy, activeMarket, { mode: poolMode }),
    [scoredStocks, strategy, activeMarket, poolMode]
  )
  const review = useMemo(
    () => buildReview(scoredStocks, pools, activeMarket, displaySectors),
    [scoredStocks, pools, activeMarket, displaySectors]
  )
  const backtest = useMemo(() => {
    const rows = pools.broad.length ? pools.broad : scoredStocks.slice(0, ALL_MARKET_TOP_LIMIT)
    return {
      ...runBacktestFromSample(rows, strategy),
      available: canRunReturnBacktest(dataBundle),
      dataMode: dataBundle.historyMode || 'history'
    }
  }, [pools, scoredStocks, strategy, dataBundle])

  const selectedStock = scoredStocks.find(stock => stock.code === selectedStockCode) || scoredStocks[0]
  const topRankedRows = scoredStocks.slice(0, ALL_MARKET_TOP_LIMIT)
  const selectedPoolRows = selectedPool === TOP_RANKED_POOL_ID ? topRankedRows : (pools[selectedPool] || [])
  const poolRows = selectedPoolRows
  const visiblePoolRows = poolRows.filter(stock => {
    const keyword = query.trim().toLowerCase()
    const keywordOk = !keyword || [
      stock.code,
      stock.name,
      stock.industry,
      stock.concept,
      stock.reason
    ].some(value => String(value).toLowerCase().includes(keyword))
    const sectorOk = sectorFilter === 'all' || stock.sectorKey === sectorFilter
    const marketOk = marketFilter === 'all' || stock.market === marketFilter
    return keywordOk && sectorOk && marketOk
  })
  const portfolioQuoteCodes = useMemo(() => {
    return Array.from(new Set(portfolio.map(item => normalizePortfolioCode(item.code)).filter(Boolean))).join(',')
  }, [portfolio])

  // 用户配置与本地笔记即时持久化，刷新或重新打开窗口后能恢复工作现场。
  useEffect(() => {
    saveDataConfig(dataConfig)
  }, [dataConfig])

  // 持仓页打开后定时拉取快照报价，只在数据变化时刷新状态，减少无意义重渲染。
  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.reviewNotes, notes)
  }, [notes])

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.watchlist, watchlist)
  }, [watchlist])

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.portfolio, portfolio)
  }, [portfolio])

  useEffect(() => {
    portfolioQuotesRef.current = portfolioQuotes
  }, [portfolioQuotes])

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.transactions, transactions)
  }, [transactions])

  useEffect(() => {
    if (activePage !== 'portfolio') return undefined
    if (!portfolioQuoteCodes) {
      portfolioQuotesRef.current = {}
      setPortfolioQuotes({})
      setPortfolioQuoteState({
        loading: false,
        updatedAt: null,
        error: '',
        endpoint: '',
        count: 0
      })
      return undefined
    }

    const bridge = window.stockReviewBridge
    const fetchPortfolioSpot = bridge?.fetchPortfolioSpot || bridge?.fetchEastmoneySpot
    if (!fetchPortfolioSpot) {
      setPortfolioQuoteState(prev => ({
        ...prev,
        loading: false,
        error: '当前环境不支持持仓快照接口'
      }))
      return undefined
    }

    let cancelled = false
    let inFlight = false
    const codes = portfolioQuoteCodes.split(',').filter(Boolean)
    const codeSet = new Set(codes)

    const refreshPortfolioQuotes = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const result = await fetchPortfolioSpot({
          codes: portfolioQuoteCodes,
          intervalMs: PORTFOLIO_QUOTE_REFRESH_MS,
          timeoutMs: 6000
        })
        if (cancelled) return

        const quoteMap = buildPortfolioQuoteMap(result?.payload, result?.fetchedAt, result?.endpoint)
        const fetchedCodes = Object.keys(quoteMap).filter(code => codeSet.has(code))
        const mergedQuotes = mergePortfolioQuotes(portfolioQuotesRef.current, quoteMap, codes)
        if (mergedQuotes.changed) {
          portfolioQuotesRef.current = mergedQuotes.next
          setPortfolioQuotes(mergedQuotes.next)
        }
        const nextQuoteState = {
          loading: false,
          updatedAt: result?.fetchedAt || new Date().toISOString(),
          error: '',
          endpoint: result?.endpoint || '',
          count: fetchedCodes.length
        }
        setPortfolioQuoteState(prev => {
          if (
            !mergedQuotes.changed &&
            !prev.loading &&
            !prev.error &&
            prev.updatedAt &&
            prev.endpoint === nextQuoteState.endpoint &&
            prev.count === nextQuoteState.count
          ) {
            return prev
          }
          return nextQuoteState
        })
      } catch (error) {
        if (cancelled) return
        setPortfolioQuoteState(prev => ({
          ...prev,
          loading: false,
          error: error.message || '持仓快照获取失败'
        }))
      } finally {
        inFlight = false
      }
    }

    refreshPortfolioQuotes()
    const timer = setInterval(refreshPortfolioQuotes, PORTFOLIO_QUOTE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activePage, portfolioQuoteCodes])

  useEffect(() => {
    const utools = window.utools
    if (!utools?.onPluginEnter) return

    utools.onPluginEnter(({ code }) => {
      if (code === 'stock-pool') {
        setActivePage('pools')
      } else if (code === 'risk-watch') {
        setActivePage('risk')
        setSelectedPool('risk')
      } else {
        setActivePage('review')
      }
      try {
        utools.setSubInput(({ text }) => setQuery(text || ''), '代码 / 名称 / 板块')
      } catch {}
    })
  }, [])

  useEffect(() => {
    if (dataConfig.source === 'sample' || !dataConfig.autoRefresh) return undefined
    const minutes = Math.max(1, Number(dataConfig.refreshIntervalMinutes) || 30)
    const timer = setInterval(() => {
      handleRefreshData(dataConfig, { silent: true })
    }, minutes * 60 * 1000)
    return () => clearInterval(timer)
  }, [dataConfig])

  useEffect(() => {
    if (!historySyncActive) return undefined
    let cancelled = false
    const poll = async () => {
      const snapshot = await refreshFullHistoryStatus({ silent: true })
      if (!cancelled && snapshot) setHistorySync(snapshot)
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [historySyncActive])

  async function refreshFullHistoryStatus(options = {}) {
    const bridge = window.stockReviewBridge
    if (!bridge?.getFullMarketHistorySyncStatus) {
      if (!options.silent) setStatus('当前环境不支持全市场历史数据同步，请在 uTools/Electron 中运行')
      return null
    }
    try {
      const snapshot = await bridge.getFullMarketHistorySyncStatus()
      setHistorySync(snapshot || EMPTY_HISTORY_SYNC_STATE)
      if (!options.silent && snapshot?.message) setStatus(snapshot.message, snapshot.dateIndexFile || snapshot.outputFile || snapshot.message)
      return snapshot
    } catch (error) {
      if (!options.silent) setStatus(error.message || '读取历史同步状态失败', errorDetail(error, '读取历史同步状态失败'))
      return null
    }
  }

  async function handlePrepareFullHistoryList(force = false) {
    const bridge = window.stockReviewBridge
    if (!bridge?.prepareFullMarketHistoryList) {
      setStatus('当前环境不支持全市场历史数据同步，请在 uTools/Electron 中运行')
      return
    }
    try {
      setHistorySyncBusy(true)
      const snapshot = await bridge.prepareFullMarketHistoryList({
        ...historySyncForm,
        force
      })
      setHistorySync(snapshot || EMPTY_HISTORY_SYNC_STATE)
      setStatus(snapshot?.message || '全市场股票列表已加载')
    } catch (error) {
      setStatus(error.message || '加载全市场股票列表失败', errorDetail(error, '加载全市场股票列表失败'))
    } finally {
      setHistorySyncBusy(false)
    }
  }

  async function handleRefreshFullMarketStockSnapshot() {
    const bridge = window.stockReviewBridge
    if (!bridge?.refreshFullMarketStockListFromSnapshot) {
      setStatus('当前环境不支持刷新全市场股票清单，请在 uTools/Electron 中运行')
      return
    }
    try {
      setHistorySyncBusy(true)
      setHistorySyncAction({
        type: 'snapshot',
        label: '正在刷新快照清单',
        detail: '正在优先使用 Baostock 重建本地股票清单；失败后切换东方财富。',
        startedAt: Date.now()
      })
      setHistorySync(current => ({
        ...current,
        message: '正在刷新快照清单...'
      }))
      setStatus(
        '正在刷新快照清单...',
        '正在优先使用 Baostock 获取清单，失败后切换东方财富 clist'
      )
      const snapshot = await bridge.refreshFullMarketStockListFromSnapshot()
      setHistorySync(snapshot || EMPTY_HISTORY_SYNC_STATE)
      const actionText = snapshot?.stockListUpdated ? '已重新生成' : '未生成'
      const message = snapshot?.message || `${actionText}全市场股票清单：${snapshot?.snapshotStockCount || snapshot?.total || 0} 只`
      setStatus(
        message,
        snapshot?.stockListFile || snapshot?.error || ''
      )
    } catch (error) {
      setStatus(error.message || '刷新全市场股票清单失败', errorDetail(error, '刷新全市场股票清单失败'))
    } finally {
      setHistorySyncBusy(false)
      setHistorySyncAction(null)
    }
  }

  async function handleInstallBaostockPackage() {
    const bridge = window.stockReviewBridge
    if (!bridge?.installBaostockPackage) {
      setStatus('当前环境不支持安装 Baostock，请在 uTools/Electron 中运行')
      return
    }
    const pythonPath = String(dataConfig.pythonPath || '').trim()
    try {
      setHistorySyncBusy(true)
      setHistorySyncAction({
        type: 'installBaostock',
        label: '正在安装 Baostock',
        detail: `正在执行 ${pythonPath || 'python'} -m pip install baostock`,
        startedAt: Date.now()
      })
      setHistorySync(current => ({
        ...current,
        message: '正在安装 Baostock...'
      }))
      setStatus('正在安装 Baostock...', `正在执行 ${pythonPath || 'python'} -m pip install baostock`)
      const result = await bridge.installBaostockPackage({ pythonPath })
      const output = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim()
      setStatus('Baostock 安装完成', output || result?.command || 'pip install baostock')
      setHistorySync(current => ({
        ...current,
        message: 'Baostock 安装完成'
      }))
    } catch (error) {
      setStatus(error.message || 'Baostock 安装失败', errorDetail(error, 'Baostock 安装失败'))
      setHistorySync(current => ({
        ...current,
        message: error.message || 'Baostock 安装失败'
      }))
    } finally {
      setHistorySyncBusy(false)
      setHistorySyncAction(null)
    }
  }

  async function handleStartFullHistorySync() {
    const bridge = window.stockReviewBridge
    if (!bridge?.startFullMarketHistorySync) {
      setStatus('当前环境不支持全市场历史数据同步，请在 uTools/Electron 中运行')
      return
    }
    try {
      setHistorySyncBusy(true)
      const snapshot = await bridge.startFullMarketHistorySync({
        ...historySyncForm,
        delayMs: Number(historySyncForm.delayMs) || FULL_HISTORY_DEFAULT_DELAY_MS,
        concurrency: Number(historySyncForm.concurrency) || FULL_HISTORY_DEFAULT_CONCURRENCY
      })
      setHistorySync(snapshot || EMPTY_HISTORY_SYNC_STATE)
      setStatus(snapshot?.message || '全市场历史数据同步已开始', snapshot?.dateIndexFile || snapshot?.outputFile || '')
    } catch (error) {
      setStatus(error.message || '启动全市场历史数据同步失败', errorDetail(error, '启动全市场历史数据同步失败'))
    } finally {
      setHistorySyncBusy(false)
    }
  }

  async function handleRetryFailedHistoryTasks() {
    const bridge = window.stockReviewBridge
    if (!bridge?.retryFullMarketFailedTasks) {
      setStatus('当前环境不支持补跑失败任务，请在 uTools/Electron 中运行')
      return
    }
    try {
      setHistorySyncBusy(true)
      const snapshot = await bridge.retryFullMarketFailedTasks({
        ...historySyncForm,
        delayMs: Number(historySyncForm.delayMs) || FULL_HISTORY_DEFAULT_DELAY_MS,
        concurrency: Number(historySyncForm.concurrency) || FULL_HISTORY_DEFAULT_CONCURRENCY
      })
      setHistorySync(snapshot || EMPTY_HISTORY_SYNC_STATE)
      setStatus(snapshot?.message || '已开始补跑失败任务', snapshot?.dateIndexFile || snapshot?.outputFile || '')
    } catch (error) {
      setStatus(error.message || '补跑失败任务启动失败', errorDetail(error, '补跑失败任务启动失败'))
    } finally {
      setHistorySyncBusy(false)
    }
  }

  async function handleStopFullHistorySync() {
    const bridge = window.stockReviewBridge
    if (!bridge?.cancelFullMarketHistorySync) return
    try {
      const snapshot = await bridge.cancelFullMarketHistorySync()
      setHistorySync(snapshot || EMPTY_HISTORY_SYNC_STATE)
      setStatus(snapshot?.message || '正在停止全市场历史数据同步')
    } catch (error) {
      setStatus(error.message || '停止全市场历史数据同步失败', errorDetail(error, '停止全市场历史数据同步失败'))
    }
  }

  // 根据当前数据源配置调度不同桥接接口，并统一转换成应用内部数据包。
  const handleRefreshData = async (nextConfig = dataConfig, options = {}) => {
    if (nextConfig.source === 'sample') {
      clearLatestDataBundle()
      setDataBundle(createSampleDataBundle())
      setStatus('已切换为本地样例数据')
      return
    }

    const bridge = window.stockReviewBridge
    if (!bridge) {
      setStatus('当前运行环境未暴露数据桥接接口，请在 uTools/Electron 中运行')
      return
    }

    const codes = parseCodeList(nextConfig.codes)
    const isAllMarketMode = codes.length === 0
    if (nextConfig.source === 'quantapi' && !isAllMarketMode && !nextConfig.refreshToken.trim()) {
      setStatus('请先在策略配置页填写同花顺 refresh_token')
      setActivePage('strategy')
      return
    }

    try {
      setIsRefreshing(true)
      let sourceName = DATA_SOURCE_LABEL[nextConfig.source] || '数据源'
      if (!options.silent) {
        setStatus(`正在从${sourceName}${isAllMarketMode ? '扫描全市场行情' : '读取数据'}...`)
      }

      let history
      let realtime = null
      const codeText = codes.join(',')
      const commonOptions = {
        codes: codeText,
        startDate: nextConfig.startDate,
        endDate: nextConfig.endDate
      }

      if (nextConfig.source === 'free') {
        if (!bridge.fetchFreeStableData) throw new Error('当前环境不支持免费稳定模式')
        history = await bridge.fetchFreeStableData({
          ...commonOptions,
          pythonPath: nextConfig.pythonPath,
          historyLimit: nextConfig.freeHistoryLimit,
          windowDays: nextConfig.freeHistoryWindowDays,
          baostockAdjust: '2'
        })
      } else if (nextConfig.source === 'quantapi') {
        if (isAllMarketMode) {
          if (!bridge.fetchEastmoneySpot) throw new Error('同花顺全市场模式需要股票基础列表；当前环境也未提供东方财富全市场兜底接口')
          history = await withTimeout(
            bridge.fetchEastmoneySpot({ codes: '', timeoutMs: 30000, concurrency: 1, batchSize: 200 }),
            ALL_MARKET_REFRESH_TIMEOUT_MS,
            '东方财富全市场扫描超时，请稍后重试，或先填写部分股票代码池进行同步'
          )
          sourceName = `${sourceName}（全市场快照使用东方财富）`
        } else {
          if (!bridge.fetchIfindHistory) throw new Error('当前环境不支持同花顺 QuantAPI')
          history = await bridge.fetchIfindHistory({
            ...commonOptions,
            refreshToken: nextConfig.refreshToken,
            indicators: nextConfig.dailyIndicators
          })
        }
      } else if (nextConfig.source === 'eastmoney') {
        if (isAllMarketMode) {
          if (!bridge.fetchEastmoneySpot) throw new Error('当前环境不支持东方财富全市场快照接口')
          history = await withTimeout(
            bridge.fetchEastmoneySpot({ codes: '', timeoutMs: 30000, concurrency: 1, batchSize: 200 }),
            ALL_MARKET_REFRESH_TIMEOUT_MS,
            '东方财富全市场扫描超时，请稍后重试，或先填写部分股票代码池进行同步'
          )
        } else {
          if (!bridge.fetchEastmoneyHistory) throw new Error('当前环境不支持东方财富公开接口')
          history = await bridge.fetchEastmoneyHistory({
            ...commonOptions,
            adjust: nextConfig.eastmoneyAdjust
          })
          if (nextConfig.useRealtime && bridge.fetchEastmoneySpot) {
            realtime = await bridge.fetchEastmoneySpot({ codes: codeText })
          }
        }
      } else if (nextConfig.source === 'akshare') {
        if (isAllMarketMode) {
          if (!bridge.fetchAkshareSpot) throw new Error('当前环境不支持 AKShare 全市场快照')
          history = await bridge.fetchAkshareSpot({
            codes: '',
            pythonPath: nextConfig.pythonPath
          })
        } else {
          if (!bridge.fetchAkshareHistory) throw new Error('当前环境不支持 AKShare')
          history = await bridge.fetchAkshareHistory({
            ...commonOptions,
            pythonPath: nextConfig.pythonPath,
            adjust: nextConfig.akshareAdjust
          })
          if (nextConfig.useRealtime && bridge.fetchAkshareSpot) {
            realtime = await bridge.fetchAkshareSpot({
              codes: codeText,
              pythonPath: nextConfig.pythonPath
            })
          }
        }
      } else {
        throw new Error('未知数据源')
      }

      if (history?.endpoint === 'free_stable_bundle') {
        const meta = history.meta || {}
        const spotText = meta.spotSource === 'tencent' ? '腾讯快照' : '东方财富快照'
        const historyBackends = [
          meta.eastmoneyFetched ? '东方财富历史' : '',
          meta.baostockFetched ? 'Baostock历史' : '',
          meta.akshareFetched ? 'AKShare历史' : ''
        ].filter(Boolean)
        const backendText = historyBackends.length ? `${historyBackends.join('/')}缓存` : '历史缓存'
        sourceName = `${sourceName}（${spotText} + ${backendText}）`
        if (meta.failed) {
          sourceName = `${sourceName}，${meta.failed}只历史补齐失败`
        }
      } else if (history?.meta?.fallbackFrom === 'eastmoney' || realtime?.meta?.fallbackFrom === 'eastmoney') {
        sourceName = `${sourceName}（腾讯行情兜底）`
      }

      const historyRows = normalizeIfindPayload(history.payload)
      const realtimeRows = realtime ? normalizeIfindPayload(realtime.payload) : []
      const rows = mergeLatestRows(historyRows, realtimeRows)
      const bundle = buildDataBundleFromIfindRows({
        rows,
        config: nextConfig,
        fetchedAt: realtime?.fetchedAt || history.fetchedAt
      })

      if (!bundle.stocks.length) {
        throw new Error(`${sourceName}返回数据为空，请检查代码、日期范围和字段配置`)
      }

      let nextBundle = {
        ...bundle,
        sourceLabel: sourceName,
        allMarketMode: isAllMarketMode,
        historyMode: isAllMarketMode && nextConfig.source !== 'free' ? 'snapshot' : bundle.historyMode,
        historyScope: isAllMarketMode && nextConfig.source !== 'free' ? 0 : bundle.historyScope,
        historyEnhanceError: null,
        supportsBacktest: false,
        sourceSize: bundle.stocks.length,
        resultLimit: isAllMarketMode ? ALL_MARKET_TOP_LIMIT : null
      }
      if (isAllMarketMode && nextConfig.source !== 'free') {
        nextBundle = await enhanceAllMarketHistory({
          bridge,
          config: nextConfig,
          snapshotBundle: nextBundle,
          snapshotRows: rows,
          sourceName,
          strategy,
          setStatus
        })
      }
      replaceLatestDataBundle(nextBundle)
      setDataBundle(nextBundle)
      const firstStock = isAllMarketMode
        ? enrichStocks(nextBundle.stocks, nextBundle.sectors, nextBundle.market, strategy)[0]
        : nextBundle.stocks[0]
      if (firstStock) setSelectedStockCode(firstStock.code)
      const countText = isAllMarketMode
        ? `全市场${nextBundle.sourceSize}只${history.meta?.partial ? '（部分增强）' : ''}已保留，综合分Top${Math.min(nextBundle.sourceSize, ALL_MARKET_TOP_LIMIT)}用于默认展示`
        : `${nextBundle.stocks.length}只`
      const modeText = nextBundle.historyMode === 'enhanced'
        ? `，Top${nextBundle.historyScope}已补历史K线`
        : nextBundle.historyMode === 'snapshot'
          ? '，当前使用快照规则'
          : ''
      const freeMetaText = history.endpoint === 'free_stable_bundle'
        ? `，历史增强${history.meta?.historyTarget || 0}只，缓存文件：${history.meta?.cacheFile || '本地缓存'}`
        : ''
      const finalStatus = `${sourceName}数据已更新：${countText}，${nextBundle.market.tradeDate}${modeText}${freeMetaText}`
      const statusDetail = history.endpoint === 'free_stable_bundle'
        ? [
            finalStatus,
            '',
            `快照源：${history.meta?.spotSource || 'unknown'}`,
            `快照数量：${history.meta?.spotSize || 0}`,
            `历史目标：${history.meta?.historyTarget || 0}`,
            `历史成功：${history.meta?.historyFetched || 0}`,
            `东方财富历史：${history.meta?.eastmoneyFetched || 0}`,
            `Baostock历史：${history.meta?.baostockFetched || 0}`,
            `AKShare历史：${history.meta?.akshareFetched || 0}`,
            `缓存命中：${history.meta?.cachedOnly || 0}`,
            `失败数量：${history.meta?.failed || 0}`,
            `缓存文件：${history.meta?.cacheFile || ''}`,
            ...(history.meta?.errors?.length ? ['', '错误样例：', ...history.meta.errors] : [])
          ].join('\n')
        : finalStatus
      setStatus(finalStatus, statusDetail)
    } catch (error) {
      setStatus(error.message || '数据更新失败', errorDetail(error, '数据更新失败'))
    } finally {
      setIsRefreshing(false)
    }
  }

  // 只拉少量样本验证数据源可用性，避免用户调配置时触发全量刷新。
  const handleTestConnection = async () => {
    const bridge = window.stockReviewBridge
    if (!bridge) {
      setStatus('当前运行环境未暴露数据桥接接口，请在 uTools/Electron 中运行')
      return
    }

    const codes = parseCodeList(dataConfig.codes)
    const isAllMarketMode = codes.length === 0
    try {
      setIsRefreshing(true)
      if (dataConfig.source === 'sample') {
        setStatus('本地样例数据可用')
      } else if (dataConfig.source === 'free') {
        setStatus('正在测试免费稳定模式（东财/腾讯快照 + 历史缓存）...')
        const testCodes = isAllMarketMode ? '000001.SZ,600000.SH' : codes.slice(0, 3).join(',')
        const testBundle = await bridge.fetchFreeStableData({
          codes: testCodes,
          startDate: dataConfig.startDate,
          endDate: dataConfig.endDate,
          pythonPath: dataConfig.pythonPath,
          historyLimit: Math.min(3, Number(dataConfig.freeHistoryLimit) || 3),
          windowDays: Math.min(30, Math.max(1, Number(dataConfig.freeHistoryWindowDays) || 30)),
          baostockAdjust: '2'
        })
        setStatus(`免费稳定模式连接成功：快照${testBundle.meta?.spotSize || 0}只，历史${testBundle.meta?.historyTarget || 0}只`)
      } else if (dataConfig.source === 'quantapi') {
        if (isAllMarketMode) {
          setStatus('正在测试同花顺全市场兜底快照...')
          await bridge.fetchEastmoneySpot({ codes: '', probe: true })
          setStatus('同花顺全市场模式可用：将使用东方财富全市场快照兜底')
        } else if (!dataConfig.refreshToken.trim()) {
          setStatus('请先填写同花顺 refresh_token')
          return
        } else {
          setStatus('正在验证同花顺授权...')
          await bridge.getIfindAccessToken(dataConfig.refreshToken)
          setStatus('同花顺授权验证成功')
        }
      } else if (dataConfig.source === 'eastmoney') {
        if (isAllMarketMode) {
          setStatus('正在测试东方财富全市场快照...')
          await bridge.fetchEastmoneySpot({ codes: '', probe: true })
          setStatus('东方财富全市场快照连接成功')
        } else {
          const testCodes = codes.slice(0, 3).join(',')
          setStatus('正在测试东方财富历史K线...')
          const testHistory = await bridge.fetchEastmoneyHistory({
            codes: testCodes,
            startDate: dataConfig.startDate,
            endDate: dataConfig.endDate,
            adjust: dataConfig.eastmoneyAdjust
          })
          if (dataConfig.useRealtime && bridge.fetchEastmoneySpot) {
            await bridge.fetchEastmoneySpot({ codes: testCodes })
          }
          const fallbackText = testHistory?.meta?.fallbackFrom === 'eastmoney' ? '（已自动启用腾讯行情兜底）' : ''
          setStatus(`东方财富公开接口测试通过${fallbackText}`)
        }
      } else if (dataConfig.source === 'akshare') {
        setStatus(`正在测试 AKShare${isAllMarketMode ? '全市场快照' : ''}...`)
        await bridge.fetchAkshareSpot({
          codes: isAllMarketMode ? '' : codes.slice(0, 3).join(','),
          pythonPath: dataConfig.pythonPath
        })
        setStatus(`AKShare${isAllMarketMode ? '全市场快照' : ''}连接成功`)
      }
    } catch (error) {
      setStatus(error.message || '数据源测试失败', errorDetail(error, '数据源测试失败'))
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleSaveStrategy = () => {
    const next = {
      ...strategy,
      version: `${strategy.version.split('-')[0]}-${new Date().toISOString().slice(0, 10)}`,
      savedAt: new Date().toISOString()
    }
    setStrategy(next)
    writeStoredValue(STORAGE_KEYS.strategy, next)
    setStatus('策略版本已保存')
  }

  const handleResetStrategy = () => {
    const next = cloneStrategy()
    setStrategy(next)
    removeStoredValue(STORAGE_KEYS.strategy, [LEGACY_STORAGE_KEYS.strategy])
    setStatus('策略参数已恢复为 V1.1 默认值')
  }

  const handleCopyReview = () => {
    const text = [
      `交易日：${activeMarket.tradeDate}`,
      review.marketSummary,
      review.sectorSummary,
      review.stockSummary,
      review.riskSummary
    ].join('\n')
    if (window.utools?.copyText) window.utools.copyText(text)
    else if (window.stockReviewBridge?.copyText) window.stockReviewBridge.copyText(text)
    else navigator.clipboard?.writeText(text)
    setStatus('复盘摘要已复制')
  }

  const handleCopyStatus = () => {
    const text = [
      `[${statusInfo.updatedAt?.slice(0, 19).replace('T', ' ') || ''}] ${statusInfo.message}`,
      '',
      statusInfo.detail || statusInfo.message
    ].join('\n').trim()
    if (window.utools?.copyText) window.utools.copyText(text)
    else if (window.stockReviewBridge?.copyText) window.stockReviewBridge.copyText(text)
    else navigator.clipboard?.writeText(text)
    setStatus('状态信息已复制', text)
  }

  const handleExport = rows => {
    const headers = ['排名', '代码', '名称', '涨跌幅', '成交额', '换手率', '量能倍数', '综合分', '入选原因', '风险标签']
    const lines = rows.map(row => [
      row.rank,
      row.code,
      row.name,
      row.pctChg,
      row.amount,
      row.turnoverRate,
      row.volRatio20,
      row.totalScore,
      row.reason,
      row.riskTags.join('|')
    ].join(','))
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `stock-pool-${selectedPool}-${activeMarket.tradeDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setStatus('股票池 CSV 已导出')
  }

  const handleAddWatch = code => {
    setWatchlist(list => list.includes(code) ? list : [...list, code])
    setStatus('已加入观察')
  }

  const handleSavePosition = position => {
    setPortfolio(list => {
      const exists = list.some(item => item.id === position.id)
      if (exists) {
        return list.map(item => (item.id === position.id ? position : item))
      }
      return [...list, position]
    })
    setStatus(`持仓「${position.name || position.code}」已保存到本地`)
  }

  const handleRemovePosition = id => {
    setPortfolio(list => list.filter(item => item.id !== id))
    setStatus('持仓已删除')
  }

  const handleQuickAddPosition = row => {
    if (!row) return
    const price = Number.isFinite(row.close) ? Number(row.close.toFixed(2)) : null
    setPositionPrefill({
      code: row.code,
      name: row.name,
      shares: 100,
      cost: price,
      manualPrice: price,
      manualPctChg: null
    })
  }

  // 卖出/减仓会同时更新当前持仓和交易流水，历史盈亏从流水里汇总。
  const handleSellPosition = ({ position, sellShares, sellPrice }) => {
    const shares = Number(sellShares) || 0
    const price = Number(sellPrice) || 0
    const cost = Number(position.cost) || 0
    const heldShares = Number(position.shares) || 0
    if (shares <= 0 || price <= 0 || shares > heldShares || !isShareLot(shares, { max: heldShares, allowClearRemainder: true })) return
    const record = {
      id: createTransactionId(),
      positionId: position.id,
      code: position.code,
      name: position.name,
      cost,
      sellPrice: price,
      shares,
      amount: price * shares,
      profit: (price - cost) * shares,
      type: shares >= heldShares ? 'clear' : 'reduce',
      time: new Date().toISOString()
    }
    setTransactions(list => [record, ...list])
    setPortfolio(list => list.flatMap(item => {
      if (item.id !== position.id) return [item]
      const remaining = heldShares - shares
      if (remaining <= 0) return []
      return [{ ...item, shares: remaining }]
    }))
    const action = record.type === 'clear' ? '清仓' : '减仓'
    setStatus(`已${action}「${position.name || position.code}」${shares}股，本次盈亏 ${signed(record.profit)}`)
  }

  const handleClearTransactions = () => {
    setTransactions([])
    setStatus('历史交易记录已清空')
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box data-stock-review-app='desktop' className={compact ? 'app app-compact' : 'app'}>
        <Paper className='sidebar' elevation={0}>
          <Box className='brand'>
            <BarChartIcon color='primary' />
            <Box>
              <Typography variant='subtitle1' fontWeight={800}>A股量能复盘</Typography>
              <Typography variant='caption' color='text.secondary'>
                {dataBundle.sourceLabel} · 策略 {strategy.version}
              </Typography>
            </Box>
          </Box>
          <Tabs
            value={activePage}
            onChange={(_, value) => setActivePage(value)}
            orientation={compact ? 'horizontal' : 'vertical'}
            variant={compact ? 'scrollable' : 'standard'}
            className='nav-tabs'
          >
            {NAV_ITEMS.map(item => (
              <Tab
                key={item.id}
                value={item.id}
                icon={item.icon}
                iconPosition='start'
                label={item.label}
              />
            ))}
          </Tabs>
          {!compact && (
            <Alert severity='info' icon={<InfoOutlinedIcon />} className='compliance-alert'>
              仅用于盘后复盘、候选池跟踪和策略验证，不构成投资建议。
            </Alert>
          )}
        </Paper>

        <Box className='workspace'>
          <HeaderBar
            status={status}
            statusDetail={statusInfo.detail}
            isRefreshing={isRefreshing}
            onRefresh={() => handleRefreshData()}
            onCopyReview={handleCopyReview}
            onCopyStatus={handleCopyStatus}
            market={activeMarket}
            query={query}
            onQueryChange={setQuery}
          />
          {activePage === 'review' && (
            <ReviewPage
              market={activeMarket}
              sectors={displaySectors}
              scoredStocks={scoredStocks}
              pools={pools}
              review={review}
              onOpenPools={() => setActivePage('pools')}
              onSelectStock={code => {
                setSelectedStockCode(code)
                setActivePage('stock')
              }}
            />
          )}
          {activePage === 'pools' && (
            <PoolsPage
              pools={pools}
              topRankedRows={topRankedRows}
              poolRows={visiblePoolRows}
              selectedPool={selectedPool}
              setSelectedPool={setSelectedPool}
              query={query}
              setQuery={setQuery}
              sectorFilter={sectorFilter}
              setSectorFilter={setSectorFilter}
              marketFilter={marketFilter}
              setMarketFilter={setMarketFilter}
              sectors={displaySectors}
              stocks={scoredStocks}
              selectedStockCode={selectedStockCode}
              onSelectStock={code => {
                setSelectedStockCode(code)
                setActivePage('stock')
              }}
              onQuickAdd={handleQuickAddPosition}
              onExport={() => handleExport(visiblePoolRows)}
            />
          )}
          {activePage === 'portfolio' && (
            <PortfolioPage
              portfolio={portfolio}
              stocks={scoredStocks}
              portfolioQuotes={portfolioQuotes}
              portfolioQuoteState={portfolioQuoteState}
              onSavePosition={handleSavePosition}
              onRemovePosition={handleRemovePosition}
              onSellPosition={handleSellPosition}
              onClearTransactions={handleClearTransactions}
              transactions={transactions}
              onSelectStock={code => {
                if (!scoredStocks.some(stock => stock.code === code)) return
                setSelectedStockCode(code)
                setActivePage('stock')
              }}
            />
          )}
          {activePage === 'stock' && selectedStock && (
            <StockPage
              stock={selectedStock}
              stocks={scoredStocks}
              note={notes[selectedStock.code] || ''}
              watchlist={watchlist}
              onSelectStock={setSelectedStockCode}
              onNoteChange={value => setNotes(map => ({ ...map, [selectedStock.code]: value }))}
              onAddWatch={handleAddWatch}
            />
          )}
          {activePage === 'sectors' && (
            <SectorsPage
              sectors={displaySectors}
              scoredStocks={scoredStocks}
              onOpenPool={sectorKey => {
                setSectorFilter(sectorKey)
                setActivePage('pools')
              }}
            />
          )}
          {activePage === 'strategy' && (
            <StrategyPage
              strategy={strategy}
              onStrategyChange={setStrategy}
              onSave={handleSaveStrategy}
              onReset={handleResetStrategy}
              onRun={() => {
                setStatus('已按当前参数重新计算股票池')
                handleRefreshData(dataConfig)
              }}
              dataConfig={dataConfig}
              onDataConfigChange={setDataConfig}
              onRefreshData={() => handleRefreshData(dataConfig)}
              onTestConnection={handleTestConnection}
              isRefreshing={isRefreshing}
              dataBundle={dataBundle}
            />
          )}
          {activePage === 'historySync' && (
            <HistorySyncPage
              state={historySync}
              form={historySyncForm}
              onFormChange={setHistorySyncForm}
              isBusy={historySyncBusy}
              isActive={historySyncActive}
              action={historySyncAction}
              onPrepareList={() => handlePrepareFullHistoryList(true)}
              onRefreshStockList={handleRefreshFullMarketStockSnapshot}
              onInstallBaostock={handleInstallBaostockPackage}
              onStart={handleStartFullHistorySync}
              onRetryFailed={handleRetryFailedHistoryTasks}
              onStop={handleStopFullHistorySync}
              onRefresh={() => refreshFullHistoryStatus()}
            />
          )}
          {activePage === 'backtest' && (
            <BacktestPage
              backtest={backtest}
              benchmarks={backtestBenchmarks}
              strategy={strategy}
            />
          )}
          {activePage === 'risk' && (
            <RiskPage
              rows={pools.risk}
              selectedStockCode={selectedStockCode}
              onSelectStock={code => {
                setSelectedStockCode(code)
                setActivePage('stock')
              }}
              onExport={() => handleExport(pools.risk)}
            />
          )}
        </Box>
        {positionPrefill && (
          <PositionDialog
            prefill={positionPrefill}
            stocks={scoredStocks}
            onClose={() => setPositionPrefill(null)}
            onSubmit={form => {
              handleSavePosition(form)
              setPositionPrefill(null)
            }}
          />
        )}
      </Box>
    </ThemeProvider>
  )
}

function HeaderBar({ status, statusDetail, isRefreshing, onRefresh, onCopyReview, onCopyStatus, market, query, onQueryChange }) {
  return (
    <Paper className='topbar' elevation={0}>
      <Box>
        <Typography variant='h6' fontWeight={800}>盘后复盘工作台</Typography>
        <Typography variant='caption' color='text.secondary'>
          {market.tradeDate} · {market.marketState} · 市场分 {market.marketScore}
        </Typography>
      </Box>
      <Box className='topbar-actions'>
        <TextField
          size='small'
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder='搜索代码、名称、板块'
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <SearchIcon fontSize='small' />
              </InputAdornment>
            )
          }}
        />
        <Tooltip title='手动更新数据'>
          <span>
            <IconButton color='primary' onClick={onRefresh} disabled={isRefreshing}>
              <SyncIcon className={isRefreshing ? 'spin-icon' : ''} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title='复制复盘摘要'>
          <IconButton color='primary' onClick={onCopyReview}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={statusDetail || status}>
          <Chip size='small' icon={<SyncIcon />} label={status} variant='outlined' />
        </Tooltip>
        <Tooltip title='复制完整状态'>
          <span>
            <IconButton size='small' onClick={onCopyStatus} disabled={!status}>
              <ContentCopyIcon fontSize='small' />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Paper>
  )
}

function PageTitle({ icon, title, action }) {
  return (
    <Box className='page-title'>
      <Box className='page-title-main'>
        {icon}
        <Typography variant='h6' fontWeight={800}>{title}</Typography>
      </Box>
      {action}
    </Box>
  )
}

function ReviewPage({ market, sectors, scoredStocks, pools, review, onOpenPools, onSelectStock }) {
  const topStocks = pools.focus.length ? pools.focus : scoredStocks.slice(0, 5)
  return (
    <Box className='page'>
      <PageTitle
        icon={<DashboardIcon color='primary' />}
        title='市场复盘首页'
        action={(
          <Button variant='contained' startIcon={<FilterAltIcon />} onClick={onOpenPools}>
            查看股票池
          </Button>
        )}
      />

      <Box className='metric-grid'>
        <MetricCard label='市场情绪' value={`${market.marketScore}`} sub={market.marketState} accent='blue' />
        <MetricCard label='全市场成交额' value={`${market.totalAmount}亿`} sub={`较前日 ${formatPercent(market.amountChange)}`} accent='green' />
        <MetricCard label='上涨 / 下跌' value={`${market.advancers} / ${market.decliners}`} sub='涨跌家数' accent='cyan' />
        <MetricCard label='涨停 / 跌停' value={`${market.limitUp} / ${market.limitDown}`} sub='风险温度' accent='amber' />
      </Box>

      <Box className='content-grid two-columns'>
        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>复盘摘要</Typography>
          <Stack spacing={1.2} mt={1.5}>
            {[review.marketSummary, review.sectorSummary, review.stockSummary, review.riskSummary].map(item => (
              <Box key={item} className='summary-line'>
                <span />
                <Typography variant='body2'>{item}</Typography>
              </Box>
            ))}
          </Stack>
        </Paper>

        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>系统闭环</Typography>
          <Box className='flow-row'>
            {['数据同步', '因子计算', '股票池快照', '日报生成', '回测验证'].map((item, index) => (
              <Box className='flow-node' key={item}>
                <Chip size='small' label={`0${index + 1}`} />
                <Typography variant='body2' fontWeight={700}>{item}</Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>

      <Box className='content-grid two-columns wide-left'>
        <Paper className='panel' variant='outlined'>
          <Box className='panel-head'>
            <Typography variant='subtitle2' fontWeight={800}>次日重点跟踪池</Typography>
            <Chip size='small' label={`Top ${topStocks.length}`} color='primary' variant='outlined' />
          </Box>
          <StockTable rows={topStocks} compact onSelectStock={onSelectStock} />
        </Paper>

        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>指数与板块</Typography>
          <Stack spacing={1.25} mt={1.5}>
            {market.indices.map(index => (
              <Box key={index.name} className='index-row'>
                <Box>
                  <Typography variant='body2' fontWeight={700}>{index.name}</Typography>
                  <Typography variant='caption' color='text.secondary'>{index.trend}</Typography>
                </Box>
                <TrendChip value={index.pctChg} />
              </Box>
            ))}
            <Divider />
            {sectors.slice(0, 4).map(sector => (
              <Box key={sector.key} className='index-row'>
                <Box>
                  <Typography variant='body2' fontWeight={700}>{sector.name}</Typography>
                  <Typography variant='caption' color='text.secondary'>{sector.leaders.join('、')}</Typography>
                </Box>
                <ScorePill value={sector.score} />
              </Box>
            ))}
          </Stack>
        </Paper>
      </Box>
    </Box>
  )
}

function PoolsPage({
  pools,
  topRankedRows,
  poolRows,
  selectedPool,
  setSelectedPool,
  query,
  setQuery,
  sectorFilter,
  setSectorFilter,
  marketFilter,
  setMarketFilter,
  sectors,
  stocks,
  selectedStockCode,
  onSelectStock,
  onQuickAdd,
  onExport
}) {
  const markets = [...new Set(stocks.map(stock => stock.market))]
  const tabLabel = key => {
    if (key === TOP_RANKED_POOL_ID) return `综合Top${ALL_MARKET_TOP_LIMIT} ${topRankedRows.length}`
    return `${POOL_META[key].label} ${pools[key].length}`
  }

  return (
    <Box className='page'>
      <PageTitle
        icon={<TableChartIcon color='primary' />}
        title='选股结果页'
        action={(
          <Button startIcon={<FileDownloadIcon />} variant='outlined' onClick={onExport}>
            导出
          </Button>
        )}
      />

      <Paper className='panel' variant='outlined'>
        <Tabs
          value={selectedPool}
          onChange={(_, value) => setSelectedPool(value)}
          variant='scrollable'
          scrollButtons='auto'
          className='pool-tabs'
        >
          {POOL_ORDER.map(key => (
            <Tab key={key} value={key} label={tabLabel(key)} />
          ))}
        </Tabs>
        <Box className='filters'>
          <TextField
            size='small'
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder='代码 / 名称 / 原因'
            InputProps={{
              startAdornment: (
                <InputAdornment position='start'>
                  <SearchIcon fontSize='small' />
                </InputAdornment>
              )
            }}
          />
          <FormControl size='small'>
            <InputLabel>板块</InputLabel>
            <Select label='板块' value={sectorFilter} onChange={event => setSectorFilter(event.target.value)}>
              <MenuItem value='all'>全部板块</MenuItem>
              {sectors.map(sector => (
                <MenuItem key={sector.key} value={sector.key}>{sector.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size='small'>
            <InputLabel>市场</InputLabel>
            <Select label='市场' value={marketFilter} onChange={event => setMarketFilter(event.target.value)}>
              <MenuItem value='all'>全部市场</MenuItem>
              {markets.map(item => (
                <MenuItem key={item} value={item}>{item}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <StockTable rows={poolRows} selectedStockCode={selectedStockCode} onSelectStock={onSelectStock} onQuickAdd={onQuickAdd} />
      </Paper>
    </Box>
  )
}

function StockPage({ stock, stocks, note, watchlist, onSelectStock, onNoteChange, onAddWatch }) {
  const scoreRows = [
    ['量能', stock.volumeScore],
    ['换手', stock.turnoverScore],
    ['价格', stock.priceScore],
    ['趋势', stock.trendScore],
    ['相对强度', stock.relativeStrengthScore],
    ['板块', stock.sectorScore]
  ]

  return (
    <Box className='page'>
      <PageTitle
        icon={<ShowChartIcon color='primary' />}
        title='个股复盘页'
        action={(
          <FormControl size='small' sx={{ minWidth: 190 }}>
            <InputLabel>个股</InputLabel>
            <Select label='个股' value={stock.code} onChange={event => onSelectStock(event.target.value)}>
              {stocks.map(item => (
                <MenuItem key={item.code} value={item.code}>{item.code} {item.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      />

      <Box className='stock-layout'>
        <Paper className='panel' variant='outlined'>
          <Box className='stock-head'>
            <Box>
              <Typography variant='h5' fontWeight={900}>{stock.name}</Typography>
              <Typography color='text.secondary'>{stock.code} · {stock.market} · {stock.industry}</Typography>
            </Box>
            <Box className='stock-actions'>
              <Tooltip title='加入观察'>
                <span>
                  <IconButton
                    color={watchlist.includes(stock.code) ? 'secondary' : 'default'}
                    onClick={() => onAddWatch(stock.code)}
                  >
                    <BookmarkAddIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <ScorePill value={stock.totalScore} large />
            </Box>
          </Box>
          <Box className='kline-band'>
            <MiniLine values={stock.history?.length ? stock.history : [stock.close]} />
          </Box>
          <Box className='stock-stat-grid'>
            <InlineStat label='股价' value={formatPrice(stock.close)} />
            <InlineStat label='涨跌幅' value={formatPercent(stock.pctChg)} trend={stock.pctChg} />
            <InlineStat label='成交额' value={formatAmount(stock.amount)} />
            <InlineStat label='量能倍数' value={`${stock.volRatio20}x`} />
            <InlineStat label='换手率' value={formatPercent(stock.turnoverRate)} />
            <InlineStat label='收盘位置' value={formatPercent(stock.closePos * 100, 0)} />
            <InlineStat label='上影线' value={formatPercent(stock.upperShadow * 100, 0)} />
          </Box>
        </Paper>

        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>评分拆解</Typography>
          <Stack spacing={1.2} mt={1.5}>
            {scoreRows.map(([label, value]) => (
              <ScoreBar key={label} label={label} value={value} />
            ))}
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Typography variant='subtitle2' fontWeight={800}>入选原因</Typography>
          <Typography variant='body2' mt={1}>{stock.reason}</Typography>
          <RiskTags tags={stock.riskTags} />
        </Paper>
      </Box>

      <Box className='content-grid two-columns'>
        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>近 N 日表现口径</Typography>
          <TableContainer>
            <Table size='small'>
              <TableHead>
                <TableRow>
                  <TableCell>T+1</TableCell>
                  <TableCell>T+3</TableCell>
                  <TableCell>T+5</TableCell>
                  <TableCell>T+10</TableCell>
                  <TableCell>次日开盘</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><TrendChip value={stock.futureReturns.d1} /></TableCell>
                  <TableCell><TrendChip value={stock.futureReturns.d3} /></TableCell>
                  <TableCell><TrendChip value={stock.futureReturns.d5} /></TableCell>
                  <TableCell><TrendChip value={stock.futureReturns.d10} /></TableCell>
                  <TableCell><TrendChip value={stock.nextOpenRet} /></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        <Paper className='panel' variant='outlined'>
          <Box className='panel-head'>
            <Typography variant='subtitle2' fontWeight={800}>复盘笔记</Typography>
            <NotesIcon color='action' fontSize='small' />
          </Box>
          <TextField
            multiline
            minRows={4}
            fullWidth
            value={note}
            onChange={event => onNoteChange(event.target.value)}
            placeholder='记录观察条件、承接情况、风险点'
          />
        </Paper>
      </Box>
    </Box>
  )
}

function SectorsPage({ sectors, scoredStocks, onOpenPool }) {
  const rows = Array.isArray(sectors) ? sectors : []
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const pageRows = useMemo(() => {
    const start = page * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [rows, page, rowsPerPage])

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [rows.length, rowsPerPage, page])

  return (
    <Box className='page'>
      <PageTitle icon={<StackedBarChartIcon color='primary' />} title='板块强弱页' />
      <Paper className='panel' variant='outlined'>
        <TableContainer>
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell>板块</TableCell>
                <TableCell>类型</TableCell>
                <TableCell>涨跌幅</TableCell>
                <TableCell>成交额分位</TableCell>
                <TableCell>上涨占比</TableCell>
                <TableCell>连续性</TableCell>
                <TableCell>热度</TableCell>
                <TableCell>成分股</TableCell>
                <TableCell align='right'>联动</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map(sector => {
                const count = scoredStocks.filter(stock => stock.sectorKey === sector.key).length
                return (
                  <TableRow key={sector.key} hover>
                    <TableCell>
                      <Typography fontWeight={800}>{sector.name}</Typography>
                      <Typography variant='caption' color='text.secondary'>{sector.leaders.join('、')}</Typography>
                    </TableCell>
                    <TableCell>{sector.type}</TableCell>
                    <TableCell><TrendChip value={sector.pctChg} /></TableCell>
                    <TableCell>{formatPercent(sector.amountRank * 100, 0)}</TableCell>
                    <TableCell>{formatPercent(sector.breadth * 100, 0)}</TableCell>
                    <TableCell>{sector.streak} 日</TableCell>
                    <TableCell><ScorePill value={sector.score} /></TableCell>
                    <TableCell>{count} 只</TableCell>
                    <TableCell align='right'>
                      <Tooltip title='查看该板块股票池'>
                        <IconButton size='small' onClick={() => onOpenPool(sector.key)}>
                          <FilterAltIcon fontSize='small' />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component='div'
          count={rows.length}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[10, 20, 50, 100]}
          onPageChange={(event, nextPage) => setPage(nextPage)}
          onRowsPerPageChange={event => {
            setRowsPerPage(Number(event.target.value))
            setPage(0)
          }}
          labelRowsPerPage='每页'
          labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
        />
      </Paper>
    </Box>
  )
}

function StrategyPage({
  strategy,
  onStrategyChange,
  onSave,
  onReset,
  onRun,
  dataConfig,
  onDataConfigChange,
  onRefreshData,
  onTestConnection,
  isRefreshing,
  dataBundle
}) {
  const weightSum = Object.values(strategy.weights).reduce((sum, item) => sum + item, 0)
  const setValue = (path, value) => onStrategyChange(current => updateNestedValue(current, path, value))
  const setDataValue = (key, value) => onDataConfigChange(current => ({ ...current, [key]: value }))
  const scopeLabel = dataBundle.allMarketMode
    ? ` · 全市场${dataBundle.sourceSize || dataBundle.stocks?.length || 0}只 · 默认Top${dataBundle.resultLimit || ALL_MARKET_TOP_LIMIT}`
    : ''
  const thresholdRows = [
    ['最低综合分', 'thresholds.minScore', 40, 90, 1, strategy.thresholds.minScore],
    ['最大风险扣分', 'thresholds.maxRiskPenalty', 0, 50, 1, strategy.thresholds.maxRiskPenalty],
    ['最低市场分', 'thresholds.minMarketScore', 20, 80, 1, strategy.thresholds.minMarketScore],
    ['最低板块分', 'thresholds.minSectorScore', 20, 85, 1, strategy.thresholds.minSectorScore],
    ['最低成交额分位', 'thresholds.minAmountRank', 0.2, 0.9, 0.01, strategy.thresholds.minAmountRank],
    ['最小收盘位置', 'thresholds.minClosePos', 0.3, 0.9, 0.01, strategy.thresholds.minClosePos],
    ['最大上影线', 'thresholds.maxUpperShadow', 0.1, 0.7, 0.01, strategy.thresholds.maxUpperShadow],
    ['次日跟踪数量', 'thresholds.focusLimit', 3, 10, 1, strategy.thresholds.focusLimit]
  ]

  return (
    <Box className='page'>
      <PageTitle
        icon={<TuneIcon color='primary' />}
        title='策略配置页'
        action={(
          <Stack direction='row' spacing={1}>
            <Button startIcon={<PlayArrowIcon />} variant='contained' onClick={onRun} disabled={isRefreshing}>运行筛选</Button>
            <Button startIcon={<SaveIcon />} variant='outlined' onClick={onSave}>保存版本</Button>
            <Tooltip title='恢复默认'>
              <IconButton onClick={onReset}><RestartAltIcon /></IconButton>
            </Tooltip>
          </Stack>
        )}
      />

      <Paper className='panel' variant='outlined'>
        <Box className='panel-head'>
          <Box>
            <Typography variant='subtitle2' fontWeight={800}>数据源接入</Typography>
            <Typography variant='caption' color='text.secondary'>
              支持免费稳定模式、同花顺 QuantAPI、东方财富公开接口和 AKShare；可手动更新，也可按频率自动刷新。
            </Typography>
          </Box>
          <Chip size='small' label={`${dataBundle.sourceLabel}${scopeLabel}${dataBundle.updatedAt ? ` · ${dataBundle.updatedAt.slice(0, 19).replace('T', ' ')}` : ''}`} variant='outlined' />
        </Box>
        <Box className='data-source-grid'>
          <FormControl size='small'>
            <InputLabel>数据源</InputLabel>
            <Select label='数据源' value={dataConfig.source} onChange={event => setDataValue('source', event.target.value)}>
              <MenuItem value='sample'>本地样例数据</MenuItem>
              <MenuItem value='quantapi'>同花顺 QuantAPI</MenuItem>
              <MenuItem value='eastmoney'>东方财富公开接口</MenuItem>
              <MenuItem value='free'>免费稳定模式</MenuItem>
              <MenuItem value='akshare'>AKShare</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size='small'
            label='refresh_token'
            type='password'
            value={dataConfig.refreshToken}
            onChange={event => setDataValue('refreshToken', event.target.value)}
            disabled={dataConfig.source !== 'quantapi'}
          />
          <TextField
            size='small'
            label='Python 路径'
            value={dataConfig.pythonPath}
            onChange={event => setDataValue('pythonPath', event.target.value)}
            disabled={dataConfig.source !== 'akshare' && dataConfig.source !== 'free'}
          />
          <TextField
            size='small'
            label='免费模式历史股票数'
            type='number'
            value={dataConfig.freeHistoryLimit}
            onChange={event => setDataValue('freeHistoryLimit', Number(event.target.value))}
            inputProps={{ min: 1, max: 1200 }}
            disabled={dataConfig.source !== 'free'}
          />
          <TextField
            size='small'
            label='免费模式窗口天数'
            type='number'
            value={dataConfig.freeHistoryWindowDays}
            onChange={event => setDataValue('freeHistoryWindowDays', Number(event.target.value))}
            inputProps={{ min: 1, max: 30 }}
            disabled={dataConfig.source !== 'free'}
          />
          <TextField
            size='small'
            label='开始日期'
            type='date'
            value={dataConfig.startDate}
            onChange={event => setDataValue('startDate', event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size='small'
            label='结束日期'
            type='date'
            value={dataConfig.endDate}
            onChange={event => setDataValue('endDate', event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size='small'
            label='刷新间隔（分钟）'
            type='number'
            value={dataConfig.refreshIntervalMinutes}
            onChange={event => setDataValue('refreshIntervalMinutes', Number(event.target.value))}
            inputProps={{ min: 1 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(dataConfig.autoRefresh)}
                onChange={event => setDataValue('autoRefresh', event.target.checked)}
                disabled={dataConfig.source === 'sample'}
              />
            }
            label='自动刷新'
          />
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(dataConfig.useRealtime)}
                onChange={event => setDataValue('useRealtime', event.target.checked)}
                disabled={dataConfig.source === 'sample'}
              />
            }
            label='叠加实时快照'
          />
          <FormControl size='small'>
            <InputLabel>东方财富复权</InputLabel>
            <Select
              label='东方财富复权'
              value={dataConfig.eastmoneyAdjust}
              onChange={event => setDataValue('eastmoneyAdjust', event.target.value)}
              disabled={dataConfig.source !== 'eastmoney'}
            >
              <MenuItem value='0'>不复权</MenuItem>
              <MenuItem value='1'>前复权</MenuItem>
              <MenuItem value='2'>后复权</MenuItem>
            </Select>
          </FormControl>
          <FormControl size='small'>
            <InputLabel>AKShare 复权</InputLabel>
            <Select
              label='AKShare 复权'
              value={dataConfig.akshareAdjust}
              onChange={event => setDataValue('akshareAdjust', event.target.value)}
              disabled={dataConfig.source !== 'akshare'}
            >
              <MenuItem value=''>不复权</MenuItem>
              <MenuItem value='qfq'>前复权</MenuItem>
              <MenuItem value='hfq'>后复权</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <TextField
          label='股票代码池'
          value={dataConfig.codes}
          onChange={event => setDataValue('codes', event.target.value)}
          fullWidth
          multiline
          minRows={2}
          margin='normal'
          placeholder='留空=全市场；或输入 000001.SZ,600000.SH'
          helperText={`股票代码池留空时会读取全市场快照；免费稳定模式会为成交额靠前 ${dataConfig.freeHistoryLimit || 80} 只补充历史K线，其余股票用快照指标参与评分。`}
        />
        <Box className='content-grid two-columns'>
          <TextField
            label='日线指标'
            value={dataConfig.dailyIndicators}
            onChange={event => setDataValue('dailyIndicators', event.target.value)}
            fullWidth
            size='small'
            helperText='默认按 QuantAPI 历史行情字段解析：open, high, low, close, volume, amount, changeRatio'
          />
          <TextField
            label='名称/板块映射（可选）'
            value={dataConfig.stockMetaText}
            onChange={event => setDataValue('stockMetaText', event.target.value)}
            fullWidth
            multiline
            minRows={2}
            placeholder='300750.SZ,宁德时代,电池,新能源车'
            helperText='每行：代码,名称,行业,概念；不填时会用代码作为名称。'
          />
        </Box>
        <Stack direction='row' spacing={1} mt={2} flexWrap='wrap' useFlexGap>
          <Button startIcon={<SyncIcon />} variant='contained' onClick={onRefreshData} disabled={isRefreshing}>
            {isRefreshing ? '更新中' : '手动更新'}
          </Button>
          <Button variant='outlined' onClick={onTestConnection} disabled={isRefreshing}>
            测试数据源
          </Button>
            <Alert severity='info' sx={{ py: 0, alignItems: 'center' }}>
            同花顺需要 refresh_token；免费稳定模式需要本机 Python 已安装 akshare 和 baostock；东方财富公开接口无需 token。
          </Alert>
        </Stack>
      </Paper>

      <Box className='content-grid two-columns wide-left'>
        <Paper className='panel' variant='outlined'>
          <Box className='panel-head'>
            <Typography variant='subtitle2' fontWeight={800}>综合评分权重</Typography>
            <Chip size='small' label={`合计 ${Math.round(weightSum * 100)}%`} color={Math.abs(weightSum - 1) < 0.01 ? 'success' : 'warning'} variant='outlined' />
          </Box>
          <Stack spacing={2} mt={2}>
            {Object.entries(strategy.weights).map(([key, value]) => (
              <Box key={key}>
                <Box className='slider-label'>
                  <Typography variant='body2'>{weightLabel(key)}</Typography>
                  <Typography variant='body2' fontWeight={800}>{Math.round(value * 100)}%</Typography>
                </Box>
                <Slider size='small' min={0} max={0.35} step={0.01} value={value} onChange={(_, next) => setValue(`weights.${key}`, next)} />
              </Box>
            ))}
          </Stack>
        </Paper>

        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>过滤阈值</Typography>
          <Stack spacing={1.6} mt={2}>
            {thresholdRows.map(([label, path, min, max, step, value]) => (
              <Box key={path}>
                <Box className='slider-label'>
                  <Typography variant='body2'>{label}</Typography>
                  <Typography variant='body2' fontWeight={800}>{displayThreshold(path, value)}</Typography>
                </Box>
                <Slider size='small' min={min} max={max} step={step} value={value} onChange={(_, next) => setValue(path, next)} />
              </Box>
            ))}
          </Stack>
        </Paper>
      </Box>

      <Paper className='panel' variant='outlined'>
        <Typography variant='subtitle2' fontWeight={800}>后端接口合同</Typography>
        <TableContainer sx={{ mt: 1 }}>
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell>接口</TableCell>
                <TableCell>方法</TableCell>
                <TableCell>说明</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {apiContractRows.map(row => (
                <TableRow key={row.path}>
                  <TableCell><code>{row.path}</code></TableCell>
                  <TableCell><Chip size='small' label={row.method} /></TableCell>
                  <TableCell>{row.desc}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  )
}

// 历史同步页负责展示后台全市场K线任务，包括准备清单、启动、停止和失败补跑。
function HistorySyncPage({
  state,
  form,
  onFormChange,
  isBusy,
  isActive,
  action,
  onPrepareList,
  onRefreshStockList,
  onInstallBaostock,
  onStart,
  onRetryFailed,
  onStop,
  onRefresh
}) {
  const rows = Array.isArray(state.items) ? state.items : []
  const progress = Math.max(0, Math.min(100, Number(state.progress) || 0))
  const setFormValue = (key, value) => onFormChange(current => ({ ...current, [key]: value }))
  const statusMeta = historyJobStatusMeta(state.status)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [actionClock, setActionClock] = useState(Date.now())
  const actionElapsedMs = action?.startedAt ? Math.max(0, actionClock - action.startedAt) : 0
  const isSnapshotRefreshing = action?.type === 'snapshot'
  const isBaostockInstalling = action?.type === 'installBaostock'

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return rows.filter(row => {
      const statusOk = statusFilter === 'all' || row.status === statusFilter
      const keywordOk = !keyword || [row.code, row.name].some(value => String(value || '').toLowerCase().includes(keyword))
      return statusOk && keywordOk
    })
  }, [rows, query, statusFilter])
  const pageRows = useMemo(() => {
    const start = page * rowsPerPage
    return filteredRows.slice(start, start + rowsPerPage)
  }, [filteredRows, page, rowsPerPage])
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredRows.length / rowsPerPage) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [filteredRows.length, rowsPerPage, page])

  useEffect(() => {
    if (!action) return undefined
    setActionClock(Date.now())
    const timer = setInterval(() => setActionClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [action])

  const handleQueryChange = event => {
    setQuery(event.target.value)
    setPage(0)
  }
  const handleStatusFilterChange = event => {
    setStatusFilter(event.target.value)
    setPage(0)
  }

  return (
    <Box className='page'>
      <PageTitle
        icon={<ReceiptLongIcon color='primary' />}
        title='全市场历史数据'
        action={(
          <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
            <Button startIcon={<SyncIcon />} variant='outlined' onClick={onPrepareList} disabled={isBusy || isActive}>
              刷新列表
            </Button>
            <Button
              startIcon={isSnapshotRefreshing ? <SyncIcon className='spin-icon' /> : <TableChartIcon />}
              variant='outlined'
              onClick={onRefreshStockList}
              disabled={isBusy || isActive}
            >
              {isSnapshotRefreshing ? `刷新中 ${formatElapsed(actionElapsedMs)}` : '刷新快照清单'}
            </Button>
            <Button
              startIcon={isBaostockInstalling ? <SyncIcon className='spin-icon' /> : <AddCircleOutlineIcon />}
              variant='outlined'
              onClick={onInstallBaostock}
              disabled={isBusy || isActive}
            >
              {isBaostockInstalling ? `安装中 ${formatElapsed(actionElapsedMs)}` : '安装 Baostock'}
            </Button>
            <Button startIcon={<PlayArrowIcon />} variant='contained' onClick={() => onStart()} disabled={isBusy || isActive}>
              开始获取
            </Button>
            <Button startIcon={<RestartAltIcon />} color='warning' variant='outlined' onClick={onRetryFailed} disabled={isBusy || isActive || !state.failedTaskCount}>
              重跑失败{state.failedTaskCount ? `(${state.failedTaskCount})` : ''}
            </Button>
            <Button startIcon={<RestartAltIcon />} color='warning' variant='outlined' onClick={onStop} disabled={!isActive}>
              停止
            </Button>
            <IconButton onClick={onRefresh} disabled={isBusy}>
              <SyncIcon className={isActive ? 'spin-icon' : ''} />
            </IconButton>
          </Stack>
        )}
      />

      <Paper className='panel' variant='outlined'>
        <Box className='history-sync-grid'>
          <TextField
            size='small'
            type='date'
            label='开始时间'
            value={form.startDate}
            onChange={event => setFormValue('startDate', event.target.value)}
            InputLabelProps={{ shrink: true }}
            disabled={isActive}
          />
          <TextField
            size='small'
            type='date'
            label='结束时间'
            value={form.endDate}
            onChange={event => setFormValue('endDate', event.target.value)}
            InputLabelProps={{ shrink: true }}
            disabled={isActive}
          />
          <TextField
            size='small'
            type='number'
            label='单只延时(ms)'
            value={form.delayMs}
            onChange={event => setFormValue('delayMs', Number(event.target.value))}
            inputProps={{ min: 500, max: 60000, step: 100 }}
            disabled={isActive}
          />
          <TextField
            size='small'
            type='number'
            label='请求并发'
            value={form.concurrency || FULL_HISTORY_DEFAULT_CONCURRENCY}
            onChange={event => setFormValue('concurrency', Number(event.target.value))}
            inputProps={{ min: 3, max: 10, step: 1 }}
            disabled={isActive}
          />
          <FormControl size='small'>
            <InputLabel>复权</InputLabel>
            <Select
              label='复权'
              value={form.adjust}
              onChange={event => setFormValue('adjust', event.target.value)}
              disabled={isActive}
            >
              <MenuItem value='0'>不复权</MenuItem>
              <MenuItem value='1'>前复权</MenuItem>
              <MenuItem value='2'>后复权</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <Stack spacing={1.1} mt={2}>
          {action && (
            <Alert severity='info' icon={<SyncIcon className='spin-icon' />}>
              <Typography variant='body2' fontWeight={800}>
                {action.label} · 已耗时 {formatElapsed(actionElapsedMs)}
              </Typography>
              {action.detail && (
                <Typography variant='caption' color='text.secondary'>
                  {action.detail}
                </Typography>
              )}
            </Alert>
          )}
          <Box className='panel-head'>
            <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap' useFlexGap>
              <Chip size='small' label={statusMeta.label} color={statusMeta.color} variant='outlined' />
              {state.currentCode && <Chip size='small' label={`${state.currentCode} ${state.currentName || ''}`} />}
              {state.nextRequestAt && <Chip size='small' label={`下次请求 ${formatDateTime(state.nextRequestAt).slice(11)}`} variant='outlined' />}
            </Stack>
            <Typography variant='body2' fontWeight={800}>{progress}%</Typography>
          </Box>
          <LinearProgress variant='determinate' value={progress} />
          <Typography variant='caption' color='text.secondary'>{state.message || '等待任务'}</Typography>
          <Typography variant='caption' color='text.secondary' className='full-history-output'>
            数据文件：{state.outputFile || '未生成'}
          </Typography>
          {state.dailyDir && (
            <Typography variant='caption' color='text.secondary' className='full-history-output'>
              每日缓存目录：{state.dailyDir}
            </Typography>
          )}
          {state.stockListFile && (
            <Typography variant='caption' color='text.secondary' className='full-history-output'>
              全市场股票清单：{state.stockListFile}
            </Typography>
          )}
          {state.dateIndexFile && (
            <Typography variant='caption' color='text.secondary' className='full-history-output'>
              日期缓存索引：{state.dateIndexFile}
            </Typography>
          )}
          {state.metaFile && (
            <Typography variant='caption' color='text.secondary' className='full-history-output'>
              进度文件：{state.metaFile}
            </Typography>
          )}
        </Stack>
      </Paper>

      <Box className='metric-grid'>
        <MetricCard label='股票总数' value={state.total || rows.length} sub='全市场列表' accent='blue' />
        <MetricCard label='已获取' value={state.fetched || 0} sub='写入本地文件' accent='green' />
        <MetricCard label='未获取' value={state.pending || 0} sub='等待队列' accent='cyan' />
        <MetricCard label='无数据' value={state.skipped || 0} sub='停牌/未上市，不补跑' accent='cyan' />
        <MetricCard label='失败' value={state.failed || 0} sub='可稍后重跑' accent='amber' />
      </Box>

      <Paper className='panel' variant='outlined'>
        <Box className='panel-head'>
          <Typography variant='subtitle2' fontWeight={800}>获取历史数据的列表</Typography>
          <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap' useFlexGap>
            <Chip size='small' label={`${filteredRows.length}/${rows.length} 只`} variant='outlined' />
          </Stack>
        </Box>
        <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap' useFlexGap mb={1.5}>
          <TextField
            size='small'
            label='股票名称/代码'
            value={query}
            onChange={handleQueryChange}
            InputProps={{
              startAdornment: (
                <InputAdornment position='start'>
                  <SearchIcon fontSize='small' />
                </InputAdornment>
              )
            }}
          />
          <FormControl size='small' sx={{ minWidth: 128 }}>
            <InputLabel>状态</InputLabel>
            <Select label='状态' value={statusFilter} onChange={handleStatusFilterChange}>
              <MenuItem value='all'>全部状态</MenuItem>
              <MenuItem value='pending'>未获取</MenuItem>
              <MenuItem value='running'>获取中</MenuItem>
              <MenuItem value='done'>已获取</MenuItem>
              <MenuItem value='skipped'>无数据</MenuItem>
              <MenuItem value='failed'>失败</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        <TableContainer className='table-wrap full-history-table'>
          <Table size='small' stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>股票代码</TableCell>
                <TableCell>股票名称</TableCell>
                <TableCell>获取状态</TableCell>
                <TableCell align='right'>K线条数</TableCell>
                <TableCell>更新时间</TableCell>
                <TableCell>备注</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map(row => (
                <TableRow key={row.code} hover selected={row.status === 'running'}>
                  <TableCell><code>{row.code}</code></TableCell>
                  <TableCell>{row.name || row.code}</TableCell>
                  <TableCell><HistoryItemStatusChip status={row.status} /></TableCell>
                  <TableCell align='right'>{row.rowCount || 0}</TableCell>
                  <TableCell>{row.updatedAt ? formatDateTime(row.updatedAt) : '--'}</TableCell>
                  <TableCell>
                    <Typography variant='caption' color='text.secondary' className='reason-cell'>
                      {row.message || '未获取'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
              {!pageRows.length && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant='body2' color='text.secondary' textAlign='center' py={3}>
                      {rows.length ? '没有符合条件的股票' : '暂无股票列表'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  )
}

function historyJobStatusMeta(status) {
  return {
    idle: { label: '未开始', color: 'default' },
    preparing: { label: '加载列表', color: 'primary' },
    ready: { label: '待开始', color: 'primary' },
    running: { label: '获取中', color: 'warning' },
    stopping: { label: '停止中', color: 'warning' },
    stopped: { label: '已停止', color: 'default' },
    completed: { label: '已完成', color: 'success' },
    failed: { label: '失败', color: 'error' }
  }[status] || { label: status || '未知', color: 'default' }
}

function HistoryItemStatusChip({ status }) {
  const meta = {
    pending: { label: '未获取', color: 'default' },
    running: { label: '获取中', color: 'warning' },
    done: { label: '已获取', color: 'success' },
    skipped: { label: '无数据', color: 'info' },
    failed: { label: '失败', color: 'error' }
  }[status] || { label: status || '未获取', color: 'default' }

  return <Chip size='small' label={meta.label} color={meta.color} variant='outlined' />
}

function BacktestPage({ backtest, benchmarks, strategy }) {
  const canShowReturns = backtest.available
  return (
    <Box className='page'>
      <PageTitle icon={<AssessmentIcon color='primary' />} title='回测分析页' />
      {!canShowReturns && (
        <Alert severity='info' sx={{ mb: 2 }}>
          当前行情快照不包含未来收益样本，收益回测暂不计算；下方保留当前候选数量和文档基准结果。
        </Alert>
      )}
      <Box className='metric-grid'>
        <MetricCard label={canShowReturns ? '样例信号' : '当前候选'} value={backtest.signals} sub={`可统计 ${backtest.tradable}`} accent='blue' />
        <MetricCard label='T+5 胜率' value={canShowReturns ? `${backtest.win5}%` : '--'} sub={canShowReturns ? `均值 ${formatPercent(backtest.avg5)}` : '等待历史样本'} accent='green' />
        <MetricCard label='T+10 胜率' value={canShowReturns ? `${backtest.win10}%` : '--'} sub={canShowReturns ? `均值 ${formatPercent(backtest.avg10)}` : '等待历史样本'} accent='cyan' />
        <MetricCard label='交易约束' value={`${backtest.filtered}`} sub={`成本 ${formatPercent(strategy.costRate)}`} accent='amber' />
      </Box>

      <Box className='content-grid two-columns'>
        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>样例收益分布</Typography>
          <Box className='distribution'>
            {canShowReturns
              ? backtest.returns.map((value, index) => (
                <Tooltip title={formatPercent(value)} key={`${value}-${index}`}>
                  <span className={value >= 0 ? 'return-bar positive' : 'return-bar negative'} style={{ height: `${Math.max(10, Math.abs(value) * 14)}px` }} />
                </Tooltip>
              ))
              : <Typography variant='body2' color='text.secondary'>暂无可计算收益分布</Typography>}
          </Box>
          <Typography variant='caption' color='text.secondary'>
            T 日收盘出信号，T+1 开盘买入，扣除 {formatPercent(strategy.costRate)} 综合成本。
          </Typography>
        </Paper>

        <Paper className='panel' variant='outlined'>
          <Typography variant='subtitle2' fontWeight={800}>文档基准结果</Typography>
          <TableContainer sx={{ mt: 1 }}>
            <Table size='small'>
              <TableHead>
                <TableRow>
                  <TableCell>策略</TableCell>
                  <TableCell>信号</TableCell>
                  <TableCell>5日胜率</TableCell>
                  <TableCell>5日均值</TableCell>
                  <TableCell>10日胜率</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {benchmarks.map(row => (
                  <TableRow key={row.strategy}>
                    <TableCell>{row.strategy}</TableCell>
                    <TableCell>{row.signals}</TableCell>
                    <TableCell>{formatPercent(row.tradeWin5)}</TableCell>
                    <TableCell><TrendChip value={row.tradeAvg5} /></TableCell>
                    <TableCell>{formatPercent(row.tradeWin10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>
    </Box>
  )
}

function RiskPage({ rows, selectedStockCode, onSelectStock, onExport }) {
  const riskStats = rows.reduce((map, row) => {
    row.riskTags.forEach(tag => { map[tag] = (map[tag] || 0) + 1 })
    return map
  }, {})

  return (
    <Box className='page'>
      <PageTitle icon={<WarningAmberIcon color='warning' />} title='风险观察页' action={<Button startIcon={<FileDownloadIcon />} variant='outlined' onClick={onExport}>导出</Button>} />
      <Box className='risk-tags-row'>
        {Object.entries(riskStats).map(([tag, count]) => (
          <Chip key={tag} label={`${tag} ${count}`} color='warning' variant='outlined' />
        ))}
      </Box>
      <Paper className='panel' variant='outlined'>
        <StockTable rows={rows} selectedStockCode={selectedStockCode} onSelectStock={onSelectStock} />
      </Paper>
    </Box>
  )
}

function StockTable({ rows, selectedStockCode, onSelectStock, onQuickAdd, compact = false }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('desc')
  const [copyTip, setCopyTip] = useState('')

  const handleSort = key => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows
    const factor = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = Number(a[sortKey])
      const bv = Number(b[sortKey])
      const an = Number.isFinite(av) ? av : -Infinity
      const bn = Number.isFinite(bv) ? bv : -Infinity
      return (an - bn) * factor
    })
  }, [rows, sortKey, sortDir])

  const handleCopy = (event, text) => {
    event.stopPropagation()
    const value = String(text ?? '')
    const done = () => setCopyTip(`已复制：${value}`)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => fallbackCopy(value, done))
    } else {
      fallbackCopy(value, done)
    }
  }

  return (
    <TableContainer className='table-wrap'>
      <Table size='small' stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>排名</TableCell>
            <TableCell>代码</TableCell>
            <TableCell>名称</TableCell>
            <TableCell sortDirection={sortKey === 'close' ? sortDir : false}>
              <TableSortLabel
                active={sortKey === 'close'}
                direction={sortKey === 'close' ? sortDir : 'desc'}
                onClick={() => handleSort('close')}
              >
                股价
              </TableSortLabel>
            </TableCell>
            {!compact && <TableCell>板块</TableCell>}
            <TableCell>涨跌幅</TableCell>
            {!compact && <TableCell>成交额</TableCell>}
            <TableCell>换手</TableCell>
            <TableCell>量能</TableCell>
            <TableCell sortDirection={sortKey === 'totalScore' ? sortDir : false}>
              <TableSortLabel
                active={sortKey === 'totalScore'}
                direction={sortKey === 'totalScore' ? sortDir : 'desc'}
                onClick={() => handleSort('totalScore')}
              >
                综合分
              </TableSortLabel>
            </TableCell>
            {!compact && <TableCell>原因</TableCell>}
            <TableCell>风险</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedRows.map(row => (
            <TableRow key={row.code} hover selected={row.code === selectedStockCode} onClick={() => onSelectStock?.(row.code)} className='clickable-row'>
              <TableCell>{row.rank}</TableCell>
              <TableCell>
                <Tooltip title='点击复制代码'>
                  <code className='copy-cell' onClick={event => handleCopy(event, row.code)}>{row.code}</code>
                </Tooltip>
              </TableCell>
              <TableCell>
                <Tooltip title='点击复制名称'>
                  <Typography fontWeight={800} variant='body2' className='copy-cell' component='span' onClick={event => handleCopy(event, row.name)}>{row.name}</Typography>
                </Tooltip>
                {row.previousSelected && <Typography variant='caption' color='text.secondary' display='block'>连续入选</Typography>}
              </TableCell>
              <TableCell>
                {onQuickAdd ? (
                  <Tooltip title='点击加入模拟持仓'>
                    <Typography
                      variant='body2'
                      component='span'
                      className='copy-cell'
                      color='primary'
                      fontWeight={700}
                      onClick={event => {
                        event.stopPropagation()
                        onQuickAdd(row)
                      }}
                    >
                      {formatPrice(row.close)}
                    </Typography>
                  </Tooltip>
                ) : (
                  formatPrice(row.close)
                )}
              </TableCell>
              {!compact && <TableCell>{row.sectorName}</TableCell>}
              <TableCell><TrendChip value={row.pctChg} /></TableCell>
              {!compact && <TableCell>{formatAmount(row.amount)}</TableCell>}
              <TableCell>{formatPercent(row.turnoverRate)}</TableCell>
              <TableCell>{row.volRatio20}x</TableCell>
              <TableCell><ScorePill value={row.totalScore} /></TableCell>
              {!compact && (
                <TableCell className='reason-cell'>
                  <Tooltip title={row.reason}><span>{row.reason}</span></Tooltip>
                </TableCell>
              )}
              <TableCell><RiskTags tags={row.riskTags} compact /></TableCell>
            </TableRow>
          ))}
          {!sortedRows.length && (
            <TableRow>
              <TableCell colSpan={compact ? 9 : 12}>
                <Typography variant='body2' color='text.secondary' textAlign='center' py={3}>
                  当前条件下暂无结果
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Snackbar
        open={Boolean(copyTip)}
        autoHideDuration={1500}
        onClose={() => setCopyTip('')}
        message={copyTip}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </TableContainer>
  )
}

function fallbackCopy(value, done) {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    done?.()
  } catch (error) {
    /* clipboard unavailable */
  }
}

function formatCny(value, digits = 2) {
  if (!Number.isFinite(value)) return '--'
  return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function formatWan(value) {
  if (!Number.isFinite(value)) return '--'
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}万`
  return formatCny(value)
}

function formatDateTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = num => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${seconds}秒`
}

function signed(value, formatter = formatCny) {
  if (!Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${formatter(value)}`
}

function profitClass(value) {
  if (!Number.isFinite(value) || value === 0) return ''
  return value > 0 ? 'positive-text' : 'negative-text'
}

function createPositionId() {
  return `pos-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function createTransactionId() {
  return `txn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

// 将手工持仓、选股数据和实时快照合并成用于收益计算的一行持仓。
function resolvePosition(position, stocks, portfolioQuotes = {}) {
  const normalizedCode = normalizePortfolioCode(position.code)
  const stock = stocks.find(item => normalizePortfolioCode(item.code) === normalizedCode)
  const quote = portfolioQuotes[normalizedCode]
  const shares = Number(position.shares) || 0
  const cost = Number(position.cost) || 0
  const quotePrice = toFiniteNumber(quote?.close)
  const manualPrice = toFiniteNumber(position.manualPrice)
  const stockPrice = toFiniteNumber(stock?.close)
  const quotePct = toFiniteNumber(quote?.pctChg)
  const manualPct = toFiniteNumber(position.manualPctChg)
  const stockPct = toFiniteNumber(stock?.pctChg)
  const livePrice = Number.isFinite(quotePrice)
    ? quotePrice
    : Number.isFinite(manualPrice) ? manualPrice : Number.isFinite(stockPrice) ? stockPrice : NaN
  const livePct = Number.isFinite(quotePct)
    ? quotePct
    : Number.isFinite(manualPct) ? manualPct : Number.isFinite(stockPct) ? stockPct : NaN
  const price = Number.isFinite(livePrice) ? livePrice : cost
  const pctChg = Number.isFinite(livePct) ? livePct : 0
  const marketValue = shares * price
  const costValue = shares * cost
  const profit = marketValue - costValue
  const profitRate = cost > 0 ? ((price - cost) / cost) * 100 : 0
  const prevClose = pctChg <= -100 ? price : price / (1 + pctChg / 100)
  const dayProfit = shares * (price - prevClose)
  const history = quote && stock?.history?.length
    ? [...stock.history.slice(-9), price]
    : stock?.history?.length ? stock.history : [price]
  return {
    ...position,
    name: position.name || quote?.name || stock?.name || position.code,
    price,
    pctChg,
    shares,
    cost,
    marketValue,
    costValue,
    profit,
    profitRate,
    dayProfit,
    history,
    quoteUpdatedAt: quote?.updatedAt || null,
    quoteTradeDate: quote?.tradeDate || '',
    hasPortfolioQuote: Boolean(quote),
    inUniverse: Boolean(stock)
  }
}

function PortfolioPage({ portfolio, stocks, portfolioQuotes = {}, portfolioQuoteState = {}, transactions, onSavePosition, onRemovePosition, onSellPosition, onClearTransactions, onSelectStock }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [sellTarget, setSellTarget] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  const rows = portfolio.map(item => resolvePosition(item, stocks, portfolioQuotes))
  const totalMarketValue = rows.reduce((sum, row) => sum + row.marketValue, 0)
  const totalCostValue = rows.reduce((sum, row) => sum + row.costValue, 0)
  const totalProfit = rows.reduce((sum, row) => sum + row.profit, 0)
  const totalDayProfit = rows.reduce((sum, row) => sum + row.dayProfit, 0)
  const totalProfitRate = totalCostValue > 0 ? (totalProfit / totalCostValue) * 100 : 0
  const prevTotal = totalMarketValue - totalDayProfit
  const dayRate = prevTotal > 0 ? (totalDayProfit / prevTotal) * 100 : 0
  const historyProfit = (transactions || []).reduce((sum, item) => sum + (Number(item.profit) || 0), 0)
  const cumulativeProfit = totalProfit + historyProfit

  const ranked = rows.map(row => ({
    ...row,
    weight: totalMarketValue > 0 ? (row.marketValue / totalMarketValue) * 100 : 0
  }))
  const factor = sortDir === 'asc' ? 1 : -1
  const sortedRows = sortKey
    ? [...ranked].sort((a, b) => {
        const av = Number.isFinite(a[sortKey]) ? a[sortKey] : -Infinity
        const bv = Number.isFinite(b[sortKey]) ? b[sortKey] : -Infinity
        return (av - bv) * factor
      })
    : ranked
  const quoteCount = Number.isFinite(portfolioQuoteState?.count)
    ? portfolioQuoteState.count
    : rows.filter(row => row.hasPortfolioQuote).length
  const quoteStatusLabel = portfolioQuoteState?.error
    ? `持仓快照异常：${truncateText(portfolioQuoteState.error)}`
    : portfolioQuoteState?.updatedAt
      ? `当日快照 ${quoteCount}/${rows.length} · ${formatDateTime(portfolioQuoteState.updatedAt).slice(11)} · 15秒`
      : portfolioQuoteState?.loading
        ? '正在获取持仓快照...'
        : '持仓快照每15秒更新'

  const handleSort = key => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = row => {
    setEditing(row)
    setDialogOpen(true)
  }
  const handleSubmit = form => {
    onSavePosition(form)
    setDialogOpen(false)
  }

  const sortHead = (key, label, align = 'right') => (
    <TableCell align={align} sortDirection={sortKey === key ? sortDir : false}>
      <TableSortLabel
        active={sortKey === key}
        direction={sortKey === key ? sortDir : 'desc'}
        onClick={() => handleSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  )

  return (
    <Box className='page'>
      <PageTitle
        icon={<AccountBalanceWalletIcon color='primary' />}
        title='模拟持仓页'
        action={(
          <Stack direction='row' spacing={1}>
            <Button variant='outlined' startIcon={<ReceiptLongIcon />} onClick={() => setHistoryOpen(true)}>
              查看记录{transactions?.length ? ` (${transactions.length})` : ''}
            </Button>
            <Button variant='contained' startIcon={<AddCircleOutlineIcon />} onClick={openAdd}>
              添加持仓
            </Button>
          </Stack>
        )}
      />

      <Box className='metric-grid portfolio-metrics'>
        <MetricCard label='总市值(元)' value={formatWan(totalMarketValue)} sub={`持仓 ${rows.length} 只`} accent='blue' />
        <MetricCard
          label='浮动盈亏'
          value={signed(totalProfit)}
          sub={`浮动盈亏率 ${signed(totalProfitRate, v => formatPercent(v))}`}
          accent={totalProfit >= 0 ? 'green' : 'amber'}
        />
        <MetricCard
          label='累计盈亏'
          value={signed(cumulativeProfit)}
          sub={`浮动 ${signed(totalProfit)} + 历史 ${signed(historyProfit)}`}
          accent={cumulativeProfit >= 0 ? 'green' : 'amber'}
        />
        <MetricCard
          label='当日参考盈亏'
          value={signed(totalDayProfit)}
          sub={`当日 ${signed(dayRate, v => formatPercent(v))}`}
          accent='cyan'
        />
        <MetricCard label='持仓成本' value={formatWan(totalCostValue)} sub='累计买入市值' accent='amber' />
      </Box>

      <Paper className='panel' variant='outlined'>
        <Box className='panel-head'>
          <Typography variant='subtitle2' fontWeight={800}>持仓明细</Typography>
          <Chip
            size='small'
            variant='outlined'
            color={portfolioQuoteState?.error ? 'warning' : 'default'}
            label={quoteStatusLabel}
          />
        </Box>
        <TableContainer className='table-wrap'>
          <Table size='small' stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>股票 / 市值</TableCell>
                <TableCell align='center'>分时图</TableCell>
                {sortHead('profit', '盈亏')}
                {sortHead('dayProfit', '当日盈亏')}
                <TableCell align='right'>成本 / 现价</TableCell>
                {sortHead('shares', '持仓股数')}
                {sortHead('weight', '仓位比')}
                <TableCell align='center'>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedRows.map(row => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography
                      fontWeight={800}
                      variant='body2'
                      className={row.inUniverse ? 'copy-cell' : ''}
                      component='span'
                      onClick={row.inUniverse ? () => onSelectStock(row.code) : undefined}
                      sx={{ cursor: row.inUniverse ? 'pointer' : 'default' }}
                    >
                      {row.name}
                    </Typography>
                    <Typography variant='caption' color='text.secondary' display='block'>
                      <code>{row.code}</code> · {formatWan(row.marketValue)}
                    </Typography>
                  </TableCell>
                  <TableCell align='center'>
                    <Box className='spark-cell'>
                      <MiniLine values={row.history} />
                    </Box>
                  </TableCell>
                  <TableCell align='right'>
                    <Typography variant='body2' fontWeight={800} className={profitClass(row.profit)}>
                      {signed(row.profit)}
                    </Typography>
                    <Typography variant='caption' className={profitClass(row.profitRate)}>
                      {signed(row.profitRate, v => formatPercent(v))}
                    </Typography>
                  </TableCell>
                  <TableCell align='right'>
                    <Typography variant='body2' fontWeight={800} className={profitClass(row.dayProfit)}>
                      {signed(row.dayProfit)}
                    </Typography>
                    <Typography variant='caption' className={profitClass(row.pctChg)}>
                      {signed(row.pctChg, v => formatPercent(v))}
                    </Typography>
                  </TableCell>
                  <TableCell align='right'>
                    <Typography variant='body2'>{formatCny(row.cost, 3)}</Typography>
                    <Typography variant='caption' color='text.secondary'>{formatCny(row.price)}</Typography>
                  </TableCell>
                  <TableCell align='right'>{row.shares}</TableCell>
                  <TableCell align='right'>{formatPercent(row.weight)}</TableCell>
                  <TableCell align='center'>
                    <Tooltip title='卖出 / 减仓'>
                      <IconButton size='small' color='primary' onClick={() => setSellTarget(row)}>
                        <SellOutlinedIcon fontSize='small' />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title='编辑'>
                      <IconButton size='small' onClick={() => openEdit(row)}>
                        <EditOutlinedIcon fontSize='small' />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title='删除'>
                      <IconButton size='small' color='error' onClick={() => onRemovePosition(row.id)}>
                        <DeleteOutlineIcon fontSize='small' />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {!sortedRows.length && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography variant='body2' color='text.secondary' textAlign='center' py={3}>
                      暂无持仓，点击右上角「添加持仓」录入一笔模拟交易
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {dialogOpen && (
        <PositionDialog
          key={editing?.id || 'new'}
          editing={editing}
          stocks={stocks}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleSubmit}
        />
      )}

      {sellTarget && (
        <SellDialog
          key={sellTarget.id}
          position={sellTarget}
          onClose={() => setSellTarget(null)}
          onSubmit={payload => {
            onSellPosition(payload)
            setSellTarget(null)
          }}
        />
      )}

      {historyOpen && (
        <TransactionHistoryDialog
          transactions={transactions || []}
          historyProfit={historyProfit}
          onClear={onClearTransactions}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </Box>
  )
}

function SellDialog({ position, onClose, onSubmit }) {
  const heldShares = Number(position.shares) || 0
  const cost = Number(position.cost) || 0
  const livePrice = Number.isFinite(position.price) ? Number(position.price.toFixed(2)) : cost
  const [shares, setShares] = useState(String(normalizeShareLot(SHARE_LOT_SIZE, { max: heldShares })))
  const [price, setPrice] = useState(String(livePrice))

  const sharesNum = Number(shares)
  const priceNum = Number(price)
  const shareValid = isShareLot(sharesNum, { max: heldShares, allowClearRemainder: true })
  const shareError = shares.trim() !== '' && !shareValid
  const valid = shareValid && priceNum > 0
  const profit = valid ? (priceNum - cost) * sharesNum : 0
  const amount = valid ? priceNum * sharesNum : 0
  const isClear = sharesNum >= heldShares

  const handleSubmit = () => {
    if (!valid) return
    onSubmit({ position, sellShares: sharesNum, sellPrice: priceNum })
  }

  return (
    <Dialog open onClose={onClose} maxWidth='xs' fullWidth>
      <DialogTitle>卖出 / 减仓 · {position.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} mt={0.5}>
          <Typography variant='caption' color='text.secondary'>
            <code>{position.code}</code> · 当前持仓 {heldShares} 股 · 成本 {formatCny(cost, 3)}
          </Typography>
          <Stack direction='row' spacing={2}>
            <TextField
              size='small'
              type='number'
              label='卖出股数'
              value={shares}
              onChange={event => setShares(event.target.value)}
              onBlur={() => setShares(String(normalizeShareLot(shares, { max: heldShares })))}
              error={shareError}
              helperText={sharesNum > heldShares ? `不能超过 ${heldShares} 股` : shareError ? '股数必须为100的整数倍' : ' '}
              inputProps={{ min: SHARE_LOT_SIZE, max: heldShares, step: SHARE_LOT_SIZE }}
              fullWidth
            />
            <TextField
              size='small'
              type='number'
              label='卖出价'
              value={price}
              onChange={event => setPrice(event.target.value)}
              helperText=' '
              fullWidth
            />
          </Stack>
          <Box className='sell-preview'>
            <Box className='index-row'>
              <Typography variant='body2' color='text.secondary'>操作类型</Typography>
              <Chip size='small' color={isClear ? 'warning' : 'primary'} variant='outlined' label={isClear ? '清仓' : '减仓'} />
            </Box>
            <Box className='index-row'>
              <Typography variant='body2' color='text.secondary'>操作总金额</Typography>
              <Typography variant='body2' fontWeight={800}>{formatCny(amount)}</Typography>
            </Box>
            <Box className='index-row'>
              <Typography variant='body2' color='text.secondary'>本次盈亏</Typography>
              <Typography variant='body2' fontWeight={800} className={profitClass(profit)}>{signed(profit)}</Typography>
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant='contained' color={isClear ? 'warning' : 'primary'} onClick={handleSubmit} disabled={!valid}>
          确认{isClear ? '清仓' : '减仓'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function TransactionHistoryDialog({ transactions, historyProfit, onClear, onClose }) {
  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle>
        <Box className='panel-head'>
          <span>历史交易记录</span>
          <Chip
            size='small'
            variant='outlined'
            color={historyProfit >= 0 ? 'success' : 'error'}
            label={`历史累计盈亏 ${signed(historyProfit)}`}
          />
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <TableContainer sx={{ maxHeight: '60vh' }}>
          <Table size='small' stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>时间</TableCell>
                <TableCell>股票</TableCell>
                <TableCell align='center'>类型</TableCell>
                <TableCell align='right'>成本价</TableCell>
                <TableCell align='right'>出售价</TableCell>
                <TableCell align='right'>操作股数</TableCell>
                <TableCell align='right'>操作总金额</TableCell>
                <TableCell align='right'>盈亏金额</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.map(item => (
                <TableRow key={item.id} hover>
                  <TableCell>
                    <Typography variant='caption'>{formatDateTime(item.time)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant='body2' fontWeight={700}>{item.name}</Typography>
                    <Typography variant='caption' color='text.secondary'><code>{item.code}</code></Typography>
                  </TableCell>
                  <TableCell align='center'>
                    <Chip
                      size='small'
                      variant='outlined'
                      color={item.type === 'clear' ? 'warning' : 'primary'}
                      label={item.type === 'clear' ? '清仓' : '减仓'}
                    />
                  </TableCell>
                  <TableCell align='right'>{formatCny(item.cost, 3)}</TableCell>
                  <TableCell align='right'>{formatCny(item.sellPrice, 3)}</TableCell>
                  <TableCell align='right'>{item.shares}</TableCell>
                  <TableCell align='right'>{formatCny(item.amount)}</TableCell>
                  <TableCell align='right'>
                    <Typography variant='body2' fontWeight={800} className={profitClass(item.profit)}>
                      {signed(item.profit)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
              {!transactions.length && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography variant='body2' color='text.secondary' textAlign='center' py={3}>
                      暂无历史交易记录，清仓或减仓后会自动记录在此
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        {transactions.length > 0 && (
          <Button color='error' startIcon={<DeleteOutlineIcon />} onClick={onClear}>清空记录</Button>
        )}
        <Box flex={1} />
        <Button variant='contained' onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}

function PositionDialog({ editing, prefill, stocks, onClose, onSubmit }) {
  const stockList = stocks || []
  const base = editing || prefill || {}
  const [form, setForm] = useState(() => ({
    code: base.code || '',
    name: base.name || '',
    shares: String(normalizeShareLot(base.shares, { fallback: SHARE_LOT_SIZE })),
    cost: base.cost != null ? String(base.cost) : '',
    manualPrice: base.manualPrice != null ? String(base.manualPrice) : '',
    manualPctChg: base.manualPctChg != null ? String(base.manualPctChg) : ''
  }))

  const matched = stockList.find(item => item.code === form.code.trim())
  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
  const handleCodeChange = value => {
    const code = value.trim()
    const stock = stockList.find(item => item.code === code)
    setForm(prev => ({ ...prev, code: value, name: stock?.name || prev.name }))
  }

  const sharesNum = Number(form.shares)
  const costNum = Number(form.cost)
  const shareValid = isShareLot(sharesNum)
  const shareError = form.shares.trim() !== '' && !shareValid
  const valid = form.code.trim() && shareValid && costNum > 0

  const handleSave = () => {
    if (!valid) return
    onSubmit({
      id: editing?.id || createPositionId(),
      code: form.code.trim(),
      name: form.name.trim() || matched?.name || form.code.trim(),
      shares: sharesNum,
      cost: costNum,
      manualPrice: form.manualPrice.trim() === '' ? null : Number(form.manualPrice),
      manualPctChg: form.manualPctChg.trim() === '' ? null : Number(form.manualPctChg)
    })
  }

  return (
    <Dialog open onClose={onClose} maxWidth='xs' fullWidth>
      <DialogTitle>{editing ? '编辑持仓' : '添加持仓'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} mt={0.5}>
          <TextField
            size='small'
            label='股票代码'
            placeholder='如 300750.SZ'
            value={form.code}
            onChange={event => handleCodeChange(event.target.value)}
            helperText={matched ? `匹配到 ${matched.name}，将自动同步行情` : '未匹配选股数据，可在下方手动填现价'}
          />
          <TextField size='small' label='股票名称' value={form.name} onChange={event => update('name', event.target.value)} />
          <Stack direction='row' spacing={2}>
            <TextField
              size='small'
              type='number'
              label='持仓股数'
              value={form.shares}
              onChange={event => update('shares', event.target.value)}
              onBlur={() => update('shares', String(normalizeShareLot(form.shares)))}
              error={shareError}
              helperText={shareError ? '股数必须为100的整数倍' : ' '}
              inputProps={{ min: SHARE_LOT_SIZE, step: SHARE_LOT_SIZE }}
              fullWidth
            />
            <TextField
              size='small'
              type='number'
              label='成本价'
              value={form.cost}
              onChange={event => update('cost', event.target.value)}
              fullWidth
            />
          </Stack>
          <Stack direction='row' spacing={2}>
            <TextField
              size='small'
              type='number'
              label='现价'
              placeholder={matched ? `行情 ${formatCny(matched.close)}` : '手动输入'}
              value={form.manualPrice}
              onChange={event => update('manualPrice', event.target.value)}
              helperText={matched ? '留空则跟随实时行情' : ' '}
              fullWidth
            />
            <TextField
              size='small'
              type='number'
              label='当日涨跌幅%（可选）'
              placeholder={matched ? `行情 ${matched.pctChg}` : '手动输入'}
              value={form.manualPctChg}
              onChange={event => update('manualPctChg', event.target.value)}
              helperText={matched ? '留空则跟随实时行情' : ' '}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant='contained' onClick={handleSave} disabled={!valid}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}

function MetricCard({ label, value, sub, accent }) {
  return (
    <Paper className={`metric-card accent-${accent}`} variant='outlined'>
      <Typography variant='caption' color='text.secondary'>{label}</Typography>
      <Typography variant='h5' fontWeight={900}>{value}</Typography>
      <Typography variant='caption' color='text.secondary'>{sub}</Typography>
    </Paper>
  )
}

function ScorePill({ value, large = false }) {
  const color = value >= 75 ? 'success' : value >= 65 ? 'primary' : value >= 50 ? 'warning' : 'error'
  return <Chip size={large ? 'medium' : 'small'} color={color} label={Math.round(value)} variant={large ? 'filled' : 'outlined'} />
}

function TrendChip({ value }) {
  const positive = value >= 0
  return (
    <Chip
      size='small'
      icon={positive ? <TrendingUpIcon /> : <TrendingDownIcon />}
      color={positive ? 'success' : 'error'}
      variant='outlined'
      label={formatPercent(value)}
    />
  )
}

function RiskTags({ tags, compact = false }) {
  if (!tags?.length) return <Chip size='small' label='低风险' color='success' variant='outlined' />
  const visible = compact ? tags.slice(0, 1) : tags
  return (
    <Stack direction='row' spacing={0.5} flexWrap='wrap' useFlexGap mt={compact ? 0 : 1}>
      {visible.map(tag => <Chip key={tag} size='small' label={tag} color='warning' variant='outlined' />)}
      {compact && tags.length > 1 && <Chip size='small' label={`+${tags.length - 1}`} variant='outlined' />}
    </Stack>
  )
}

function ScoreBar({ label, value }) {
  return (
    <Box>
      <Box className='score-label'>
        <Typography variant='body2'>{label}</Typography>
        <Typography variant='body2' fontWeight={800}>{Math.round(value)}</Typography>
      </Box>
      <LinearProgress variant='determinate' value={Math.max(0, Math.min(100, value))} />
    </Box>
  )
}

function InlineStat({ label, value, trend }) {
  const className = typeof trend === 'number'
    ? trend >= 0 ? 'inline-stat positive-text' : 'inline-stat negative-text'
    : 'inline-stat'
  return (
    <Box className={className}>
      <Typography variant='caption' color='text.secondary'>{label}</Typography>
      <Typography variant='body1' fontWeight={900}>{value}</Typography>
    </Box>
  )
}

function MiniLine({ values }) {
  const width = 520
  const height = 170
  const safeValues = values.length > 1 ? values : [values[0] || 0, values[0] || 0]
  const min = Math.min(...safeValues)
  const max = Math.max(...safeValues)
  const span = max - min || 1
  const points = safeValues.map((value, index) => {
    const x = (index / (safeValues.length - 1)) * width
    const y = height - ((value - min) / span) * (height - 22) - 11
    return `${x},${y}`
  }).join(' ')

  return (
    <svg className='mini-line' viewBox={`0 0 ${width} ${height}`} role='img' aria-label='价格走势'>
      <line x1='0' y1={height - 28} x2={width} y2={height - 28} className='chart-axis' />
      <polyline points={points} fill='none' className='chart-line' />
      {safeValues.map((value, index) => {
        const x = (index / (safeValues.length - 1)) * width
        const y = height - ((value - min) / span) * (height - 22) - 11
        return <circle key={`${value}-${index}`} cx={x} cy={y} r='3.5' className='chart-dot' />
      })}
    </svg>
  )
}

function weightLabel(key) {
  return {
    volume: '量能得分',
    turnover: '换手得分',
    price: '价格强度',
    trend: '趋势得分',
    relativeStrength: '相对强度',
    sector: '板块热度'
  }[key] || key
}

function displayThreshold(path, value) {
  if (['thresholds.minAmountRank', 'thresholds.minClosePos', 'thresholds.maxUpperShadow'].includes(path)) {
    return `${Math.round(value * 100)}%`
  }
  return value
}
