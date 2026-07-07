const STORAGE_PREFIX = 'stock-review'
const LATEST_DATA_SCHEMA_VERSION = 1

export const STORAGE_KEYS = {
  latestData: `${STORAGE_PREFIX}.cache.latest-data.v1`,
  dataConfig: `${STORAGE_PREFIX}.settings.data-config`,
  strategy: `${STORAGE_PREFIX}.settings.strategy`,
  reviewNotes: `${STORAGE_PREFIX}.review.notes`,
  watchlist: `${STORAGE_PREFIX}.review.watchlist`,
  portfolio: `${STORAGE_PREFIX}.portfolio.holdings`,
  transactions: `${STORAGE_PREFIX}.portfolio.transactions`
}

export const LEGACY_STORAGE_KEYS = {
  dataConfig: `${STORAGE_PREFIX}.data-config`,
  strategy: `${STORAGE_PREFIX}.strategy`,
  reviewNotes: `${STORAGE_PREFIX}.notes`,
  watchlist: `${STORAGE_PREFIX}.watchlist`
}

const MISSING = Symbol('missing')

function getDbStorage() {
  if (typeof window === 'undefined') return null
  return window.utools?.dbStorage || null
}

function getBrowserStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage || null
  } catch {
    return null
  }
}

function warnStorage(action, key, error) {
  if (typeof console !== 'undefined') {
    console.warn(`[storage] Failed to ${action} "${key}"`, error)
  }
}

function hasStoredValue(value) {
  return value !== MISSING && value !== undefined && value !== null
}

function readDbValue(key) {
  const storage = getDbStorage()
  if (!storage?.getItem) return MISSING
  try {
    const value = storage.getItem(key)
    return value == null ? MISSING : value
  } catch (error) {
    warnStorage('read dbStorage', key, error)
    return MISSING
  }
}

function writeDbValue(key, value) {
  const storage = getDbStorage()
  if (!storage?.setItem) return false
  try {
    storage.setItem(key, value)
    return true
  } catch (error) {
    warnStorage('write dbStorage', key, error)
    return false
  }
}

function removeDbValue(key) {
  const storage = getDbStorage()
  if (!storage?.removeItem) return false
  try {
    storage.removeItem(key)
    return true
  } catch (error) {
    warnStorage('remove dbStorage', key, error)
    return false
  }
}

function readLocalValue(key) {
  const storage = getBrowserStorage()
  if (!storage?.getItem) return MISSING
  try {
    const raw = storage.getItem(key)
    if (raw == null) return MISSING
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  } catch (error) {
    warnStorage('read localStorage', key, error)
    return MISSING
  }
}

function writeLocalValue(key, value) {
  const storage = getBrowserStorage()
  if (!storage?.setItem) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    warnStorage('write localStorage', key, error)
    return false
  }
}

function removeLocalValue(key) {
  const storage = getBrowserStorage()
  if (!storage?.removeItem) return false
  try {
    storage.removeItem(key)
    return true
  } catch (error) {
    warnStorage('remove localStorage', key, error)
    return false
  }
}

export function readStoredValue(key, fallback, legacyKeys = []) {
  const dbValue = readDbValue(key)
  if (hasStoredValue(dbValue)) return dbValue

  const localValue = readLocalValue(key)
  if (hasStoredValue(localValue)) {
    writeStoredValue(key, localValue)
    return localValue
  }

  for (const legacyKey of legacyKeys) {
    const legacyValue = readLocalValue(legacyKey)
    if (hasStoredValue(legacyValue)) {
      writeStoredValue(key, legacyValue)
      return legacyValue
    }
  }

  return fallback
}

export function writeStoredValue(key, value) {
  if (writeDbValue(key, value)) return true
  return writeLocalValue(key, value)
}

export function removeStoredValue(key, legacyKeys = []) {
  ;[key, ...legacyKeys].forEach(item => {
    removeDbValue(item)
    removeLocalValue(item)
  })
}

function toStoredDataBundle(bundle) {
  const stocks = Array.isArray(bundle?.stocks) ? bundle.stocks : []
  return {
    market: bundle?.market || null,
    sectors: Array.isArray(bundle?.sectors) ? bundle.sectors : [],
    stocks,
    sourceLabel: bundle?.sourceLabel || '',
    rawRows: [],
    updatedAt: bundle?.updatedAt || null,
    allMarketMode: Boolean(bundle?.allMarketMode),
    historyMode: bundle?.historyMode || null,
    historyScope: Number(bundle?.historyScope) || 0,
    historyEnhanceError: bundle?.historyEnhanceError || null,
    historyRuleMode: bundle?.historyRuleMode || null,
    supportsBacktest: bundle?.supportsBacktest === true,
    sourceSize: Number(bundle?.sourceSize) || stocks.length,
    resultLimit: bundle?.resultLimit ?? null
  }
}

function isUsableDataBundle(value) {
  return Boolean(
    value &&
    value.market &&
    Array.isArray(value.sectors) &&
    Array.isArray(value.stocks)
  )
}

export function loadLatestDataBundle() {
  const snapshot = readStoredValue(STORAGE_KEYS.latestData, null)
  const bundle = snapshot?.bundle || snapshot
  if (!isUsableDataBundle(bundle)) return null
  return {
    ...bundle,
    rawRows: []
  }
}

export function replaceLatestDataBundle(bundle) {
  removeStoredValue(STORAGE_KEYS.latestData)
  return writeStoredValue(STORAGE_KEYS.latestData, {
    schemaVersion: LATEST_DATA_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    bundle: toStoredDataBundle(bundle)
  })
}

export function clearLatestDataBundle() {
  removeStoredValue(STORAGE_KEYS.latestData)
}
