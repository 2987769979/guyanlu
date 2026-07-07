export const DEFAULT_STRATEGY = {
  id: 'volume-review-v1.1',
  name: '量能复盘 V1.1',
  version: 'V1.1',
  weights: {
    volume: 0.25,
    turnover: 0.18,
    price: 0.2,
    trend: 0.17,
    relativeStrength: 0.1,
    sector: 0.1
  },
  thresholds: {
    minScore: 68,
    maxRiskPenalty: 25,
    minMarketScore: 45,
    minSectorScore: 45,
    minAmountRank: 0.55,
    minClosePos: 0.55,
    maxUpperShadow: 0.35,
    minTurnover: 2,
    maxTurnover: 18,
    maxMa20Deviation: 18,
    focusLimit: 5
  },
  costRate: 0.15
}

export const POOL_META = {
  focus: { label: '次日重点跟踪池', tone: 'blue' },
  broad: { label: '优化评分宽口径', tone: 'green' },
  strongVolume: { label: '强势放量池', tone: 'green' },
  mildTurnover: { label: '温和换手趋势池', tone: 'cyan' },
  breakout: { label: '放量突破池', tone: 'purple' },
  risk: { label: '风险观察池', tone: 'red' }
}

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0))

const round = (value, digits = 1) => {
  const base = 10 ** digits
  return Math.round((Number(value) || 0) * base) / base
}

const percentRankScore = value => clamp((Number(value) || 0) * 100)

function scoreRangePeak(value, low, idealLow, idealHigh, high) {
  if (value <= low || value >= high) return value < low ? clamp((value / low) * 45) : 35
  if (value >= idealLow && value <= idealHigh) return 92
  if (value < idealLow) return 45 + ((value - low) / (idealLow - low)) * 47
  return 92 - ((value - idealHigh) / (high - idealHigh)) * 42
}

function calcVolumeScore(stock) {
  const ratio = stock.volRatio20 || 0
  let ratioScore = 0

  if (ratio < 1) ratioScore = 20 + ratio * 35
  else if (ratio < 1.8) ratioScore = 55 + ((ratio - 1) / 0.8) * 25
  else if (ratio <= 3.5) ratioScore = 92
  else if (ratio <= 6) ratioScore = 92 - ((ratio - 3.5) / 2.5) * 22
  else ratioScore = 48

  return round(percentRankScore(stock.amountRank) * 0.55 + clamp(ratioScore) * 0.45)
}

function calcTurnoverScore(stock) {
  const turnoverScore = scoreRangePeak(stock.turnoverRate || 0, 1, 3, 12, 25)
  const percentileScore = percentRankScore(stock.turnoverPctile60)
  return round(turnoverScore * 0.65 + percentileScore * 0.35)
}

function calcPriceScore(stock) {
  const pct = stock.pctChg || 0
  let pctScore = 0
  if (pct < -2) pctScore = 10
  else if (pct < 0) pctScore = 25 + (pct + 2) * 10
  else if (pct < 3) pctScore = 45 + (pct / 3) * 25
  else if (pct <= 6) pctScore = 92
  else if (pct <= 9.5) pctScore = 92 - ((pct - 6) / 3.5) * 22
  else pctScore = 46

  const closeScore = percentRankScore(stock.closePos)
  const shadowScore = clamp(100 - (stock.upperShadow || 0) * 180)
  return round(pctScore * 0.44 + closeScore * 0.34 + shadowScore * 0.22)
}

function calcTrendScore(stock) {
  let score = 0
  if (stock.close > stock.ma20) score += 22
  if (stock.close > stock.ma60) score += 18
  if (stock.ma5 > stock.ma10 && stock.ma10 > stock.ma20) score += 25
  if (stock.ma20 > stock.ma60) score += 17
  if ((stock.stockReturn20 || 0) > 0) score += 10
  if (stock.close >= stock.high20) score += 8
  return clamp(score)
}

function upperBound(values, target) {
  let left = 0
  let right = values.length

  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (values[middle] <= target) {
      left = middle + 1
    } else {
      right = middle
    }
  }

  return left
}

function buildRelativeStrengthScoreMap(universe) {
  const values = universe
    .map(item => (item.stockReturn20 || 0) - (item.marketReturn20 || 0))
    .sort((a, b) => a - b)
  const size = values.length || 1
  const map = new Map()

  universe.forEach(stock => {
    const spread = (stock.stockReturn20 || 0) - (stock.marketReturn20 || 0)
    map.set(stock.code, round((upperBound(values, spread) / size) * 100))
  })

  return map
}

function calcSectorScore(sector) {
  if (!sector) return 0
  return round(
    clamp((sector.score || 0) * 0.5) +
    percentRankScore(sector.amountRank) * 0.2 +
    percentRankScore(sector.breadth) * 0.2 +
    clamp(sector.streak * 8, 0, 10)
  )
}

function calcRisk(stock) {
  const riskTags = []
  let penalty = 0

  if ((stock.upperShadow || 0) > 0.35) {
    penalty += 12
    riskTags.push('长上影')
  }
  if ((stock.turnoverRate || 0) > 18) {
    penalty += 14
    riskTags.push('高换手')
  } else if ((stock.turnoverRate || 0) > 12 && (stock.closePos || 0) < 0.55) {
    penalty += 9
    riskTags.push('高换手承压')
  }
  if ((stock.pctChg || 0) < 0 && (stock.volRatio20 || 0) > 1.6) {
    penalty += 15
    riskTags.push('放量下跌')
  }
  if ((stock.pctChg || 0) > 8) {
    penalty += 8
    riskTags.push('涨幅过大')
  }
  if ((stock.volRatio20 || 0) > 5 && (stock.closePos || 0) < 0.45) {
    penalty += 12
    riskTags.push('爆量滞涨')
  }
  if (stock.close < stock.ma20) {
    penalty += 12
    riskTags.push('跌破MA20')
  }
  if (stock.ma20 > 0) {
    const ma20Deviation = ((stock.close - stock.ma20) / stock.ma20) * 100
    if (ma20Deviation > 18) {
      penalty += 8
      riskTags.push('偏离MA20')
    }
  }
  if ((stock.high60Position || 0) > 0.88 && (stock.volRatio20 || 0) > 3.5) {
    penalty += 8
    riskTags.push('高位爆量')
  }

  return { riskPenalty: clamp(penalty, 0, 60), riskTags }
}

function buildReason(stock, scores, sector) {
  const reasons = []
  if (stock.pctChg >= 3 && stock.volRatio20 >= 1.8) reasons.push('放量上涨')
  if (stock.amountRank >= 0.7) reasons.push('成交额靠前')
  if (stock.closePos >= 0.65) reasons.push('收盘较强')
  if (stock.ma5 > stock.ma10 && stock.ma10 > stock.ma20) reasons.push('均线多头')
  if (stock.close >= stock.high20) reasons.push('突破20日高点')
  if (sector?.score >= 70) reasons.push('板块共振')
  if (scores.relativeStrengthScore >= 70) reasons.push('跑赢市场')
  return reasons.length ? reasons.join('、') : '低噪音观察'
}

function isBroadCandidate(stock, scores, strategy, market) {
  const t = strategy.thresholds
  const ma20Deviation = stock.ma20 ? ((stock.close - stock.ma20) / stock.ma20) * 100 : 0

  return (
    scores.totalScore >= t.minScore &&
    scores.riskPenalty <= t.maxRiskPenalty &&
    market.marketScore >= t.minMarketScore &&
    scores.sectorScore >= t.minSectorScore &&
    stock.amountRank >= t.minAmountRank &&
    stock.closePos >= t.minClosePos &&
    stock.upperShadow <= t.maxUpperShadow &&
    stock.turnoverRate >= t.minTurnover &&
    stock.turnoverRate <= t.maxTurnover &&
    ma20Deviation <= t.maxMa20Deviation &&
    !stock.name.includes('ST') &&
    !(stock.pctChg >= 9.4 && stock.nextOpenRet > 5)
  )
}

function calcMarketAdjustment(market) {
  if (market.marketState === '强市') return 4
  if (market.marketState === '弱市') return -6
  return 0
}

export function enrichStocks(universe, sectors, market, strategy = DEFAULT_STRATEGY) {
  const sectorMap = new Map(sectors.map(sector => [sector.key, sector]))
  const relativeStrengthScores = buildRelativeStrengthScoreMap(universe)

  return universe
    .map(stock => {
      const sector = sectorMap.get(stock.sectorKey)
      const baseScores = {
        volumeScore: calcVolumeScore(stock),
        turnoverScore: calcTurnoverScore(stock),
        priceScore: calcPriceScore(stock),
        trendScore: calcTrendScore(stock),
        relativeStrengthScore: relativeStrengthScores.get(stock.code) || 0,
        sectorScore: calcSectorScore(sector)
      }
      const risk = calcRisk(stock)
      const w = strategy.weights
      const marketAdjustment = calcMarketAdjustment(market)
      const rawScore =
        baseScores.volumeScore * w.volume +
        baseScores.turnoverScore * w.turnover +
        baseScores.priceScore * w.price +
        baseScores.trendScore * w.trend +
        baseScores.relativeStrengthScore * w.relativeStrength +
        baseScores.sectorScore * w.sector +
        marketAdjustment -
        risk.riskPenalty

      const scores = {
        ...baseScores,
        ...risk,
        marketAdjustment,
        totalScore: round(clamp(rawScore))
      }

      return {
        ...stock,
        ...scores,
        sectorName: sector?.name || stock.concept,
        reason: buildReason(stock, scores, sector),
        selected: false
      }
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((stock, index) => ({ ...stock, rank: index + 1 }))
}

export function buildPools(scoredStocks, strategy = DEFAULT_STRATEGY, market = { marketScore: 0 }, options = {}) {
  if (shouldUseSnapshotPools(scoredStocks, options)) {
    return buildSnapshotPools(scoredStocks, strategy)
  }

  const broad = scoredStocks
    .filter(stock => isBroadCandidate(stock, stock, strategy, market))
    .map(stock => ({ ...stock, selected: true }))

  const strongVolume = scoredStocks.filter(stock =>
    stock.pctChg > 3 &&
    stock.amountRank > 0.7 &&
    stock.volRatio20 > 1.8 &&
    stock.closePos > 0.65 &&
    stock.close > stock.ma20 &&
    stock.riskPenalty <= strategy.thresholds.maxRiskPenalty
  )

  const mildTurnover = scoredStocks.filter(stock =>
    stock.pctChg >= 0.5 &&
    stock.pctChg <= 5 &&
    stock.volRatio20 >= 1.05 &&
    stock.turnoverRate >= 2 &&
    stock.turnoverRate <= 12 &&
    stock.ma5 > stock.ma10 &&
    stock.ma10 > stock.ma20 &&
    stock.riskPenalty <= 22
  )

  const breakout = scoredStocks.filter(stock =>
    stock.close >= stock.high20 &&
    stock.volRatio20 > 1.5 &&
    stock.pctChg > 2 &&
    stock.upperShadow < 0.25 &&
    stock.riskPenalty <= 24
  )

  const risk = scoredStocks.filter(stock => stock.riskPenalty >= 25 || stock.riskTags.length >= 2)

  const focus = broad
    .filter(stock => stock.riskPenalty <= 20)
    .slice(0, strategy.thresholds.focusLimit)

  return { focus, broad, strongVolume, mildTurnover, breakout, risk }
}

function shouldUseSnapshotPools(scoredStocks, options = {}) {
  if (options?.mode === 'snapshot') return true
  if (options?.mode === 'history') return false
  if (!scoredStocks.length) return false

  const stocksWithHistory = scoredStocks.filter(stock => Number(stock.historyDays || 0) >= 20).length
  return stocksWithHistory / scoredStocks.length < 0.35
}

function buildSnapshotPools(scoredStocks, strategy = DEFAULT_STRATEGY) {
  const t = strategy.thresholds
  const broad = scoredStocks
    .filter(stock =>
      stock.totalScore >= Math.max(50, t.minScore - 14) &&
      stock.amountRank >= Math.max(0.25, t.minAmountRank - 0.25) &&
      stock.closePos >= Math.max(0.35, t.minClosePos - 0.2) &&
      stock.upperShadow <= Math.min(0.55, t.maxUpperShadow + 0.18) &&
      stock.riskPenalty <= t.maxRiskPenalty + 10 &&
      !stock.name.includes('ST')
    )
    .slice(0, 80)
    .map(stock => ({ ...stock, selected: true, snapshotSelected: true }))

  const strongVolume = scoredStocks
    .filter(stock =>
      stock.pctChg > 2 &&
      stock.amountRank > 0.65 &&
      stock.closePos > 0.58 &&
      stock.riskPenalty <= t.maxRiskPenalty + 8
    )
    .slice(0, 80)

  const mildTurnover = scoredStocks
    .filter(stock =>
      stock.pctChg >= 0 &&
      stock.pctChg <= 5 &&
      stock.turnoverRate >= 1 &&
      stock.turnoverRate <= 14 &&
      stock.amountRank >= 0.5 &&
      stock.riskPenalty <= 28
    )
    .slice(0, 80)

  const breakout = scoredStocks
    .filter(stock =>
      stock.pctChg > 2 &&
      stock.closePos > 0.72 &&
      stock.amountRank > 0.62 &&
      stock.upperShadow < 0.3 &&
      stock.riskPenalty <= 30
    )
    .slice(0, 80)

  const risk = scoredStocks
    .filter(stock =>
      stock.riskPenalty >= 8 ||
      stock.riskTags.length >= 1 ||
      stock.pctChg <= -5 ||
      stock.upperShadow > 0.28 ||
      stock.turnoverRate > 12
    )
    .sort((a, b) =>
      b.riskPenalty - a.riskPenalty ||
      Math.abs(b.pctChg || 0) - Math.abs(a.pctChg || 0)
    )
    .slice(0, 80)

  const focus = (broad.length ? broad : scoredStocks.slice(0, 20))
    .filter(stock => stock.riskPenalty <= 25)
    .slice(0, strategy.thresholds.focusLimit)

  return { focus, broad, strongVolume, mildTurnover, breakout, risk }
}

export function buildReview(scoredStocks, pools, market, sectors) {
  const topSector = [...sectors].sort((a, b) => b.score - a.score)[0]
  const avgScore = scoredStocks.reduce((sum, item) => sum + item.totalScore, 0) / scoredStocks.length
  const riskCount = pools.risk.length
  const newCount = pools.broad.filter(item => !item.previousSelected).length

  return {
    marketSummary: `${market.marketState}环境，市场分 ${market.marketScore}，全市场成交额 ${market.totalAmount} 亿，涨跌家数比 ${market.advancers}:${market.decliners}。`,
    sectorSummary: `最强板块为${topSector.name}，板块热度 ${topSector.score}，领涨代表：${topSector.leaders.join('、')}。`,
    stockSummary: `宽口径候选 ${pools.broad.length} 只，次日重点跟踪 ${pools.focus.length} 只，平均综合分 ${round(avgScore)}。`,
    riskSummary: `风险观察 ${riskCount} 只，新进入选 ${newCount} 只，重点排查长上影、高换手和爆量滞涨。`
  }
}

export function runBacktestFromSample(scoredStocks, strategy = DEFAULT_STRATEGY) {
  const candidates = scoredStocks.filter(stock => stock.selected || stock.totalScore >= strategy.thresholds.minScore)
  const tradable = candidates.filter(stock => stock.nextOpenRet < 5.5)
  const cost = strategy.costRate
  const d5Returns = tradable.map(stock => round((stock.futureReturns?.d5 || 0) - cost, 2))
  const d10Returns = tradable.map(stock => round((stock.futureReturns?.d10 || 0) - cost, 2))

  const avg = list => list.length ? round(list.reduce((sum, item) => sum + item, 0) / list.length, 2) : 0
  const winRate = list => list.length ? round((list.filter(item => item > 0).length / list.length) * 100, 2) : 0
  const worst = list => list.length ? Math.min(...list) : 0

  return {
    signals: candidates.length,
    tradable: tradable.length,
    filtered: candidates.length - tradable.length,
    win5: winRate(d5Returns),
    avg5: avg(d5Returns),
    win10: winRate(d10Returns),
    avg10: avg(d10Returns),
    maxDrawdown: round(Math.abs(Math.min(worst(d5Returns), worst(d10Returns))), 2),
    returns: d5Returns
  }
}

export function updateNestedValue(target, path, value) {
  const [group, key] = path.split('.')
  return {
    ...target,
    [group]: {
      ...target[group],
      [key]: value
    }
  }
}

export function formatPercent(value, digits = 2) {
  return `${round(value, digits)}%`
}

export function formatAmount(value) {
  return `${round(value, 1)}亿`
}
