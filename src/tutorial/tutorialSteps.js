export const TUTORIAL_VERSION = 1

const DEFAULT_HISTORY_DIR = '%LOCALAPPDATA%\\股研录\\history-data'

export function createTutorialSteps({
  historyDataDir = '',
  historyFileStatusKnown = false,
  missingHistoryExecutables = [],
  historyItemCount = 0,
  calculationCount = 0,
  portfolioCount = 0,
  backtestCount = 0
} = {}) {
  const resolvedHistoryDir = historyDataDir || DEFAULT_HISTORY_DIR

  return [
    {
      id: 'welcome',
      target: '[data-tour-id="tutorial-button"]',
      title: '欢迎使用股研录',
      content: '这个教程会带您走完数据准备、历史行情获取、策略计算、结果查看、模拟持仓和回测分析的核心流程。',
      details: ['教程只做页面引导，不会自动启动数据任务或修改您的持仓。', '以后可以随时点击这里的“教程”重新查看。']
    },
    {
      id: 'history-entry',
      page: 'historySync',
      target: '[data-tour-id="nav-historySync"]',
      title: '第一步：进入历史数据',
      content: '首次使用时，先从“历史数据”页面准备全市场证券清单和日线数据。'
    },
    {
      id: 'history-files',
      page: 'historySync',
      target: '[data-tour-id="history-prerequisites"]',
      title: '准备历史数据程序',
      content: `固定数据目录为：${resolvedHistoryDir}`,
      details: [
        historyFileStatusKnown
          ? (missingHistoryExecutables.length
              ? `当前检测到缺少：${missingHistoryExecutables.join('、')}。请将这些程序放入该目录。`
              : '已检测到三个历史数据程序，文件准备完成。')
          : '请将 fetch_all_a_stocks_v2.exe、fetch_all_a_stocks_v3.exe 和 fetch_a_stock_history_by_stock.exe 放入该目录。',
        'stock-review.db 也会保存在这里；页面会显示实际程序地址、执行命令和任务状态。'
      ]
    },
    {
      id: 'refresh-stock-list',
      page: 'historySync',
      target: '[data-tour-id="history-refresh-snapshot"]',
      title: '刷新全市场证券清单',
      content: '程序文件准备完成后，点击“刷新快照清单”，生成或更新全市场证券列表。',
      details: [historyItemCount > 0 ? `当前已经识别到 ${historyItemCount} 只证券。` : '当前尚未读取到证券列表，建议先执行一次刷新。']
    },
    {
      id: 'fetch-history',
      page: 'historySync',
      target: '[data-tour-id="history-start"]',
      title: '获取历史行情',
      content: '确认页面中的开始日期和结束日期后，点击“开始获取”写入全市场历史数据；也可以先勾选少量股票，再获取选中的历史数据。',
      details: ['历史任务可能运行较久，可在本页查看进度或停止任务。', '教程不会替您点击这个按钮。']
    },
    {
      id: 'calculate',
      page: 'strategy',
      target: '[data-tour-id="calculate-from-sqlite"]',
      title: '从 SQLite 计算结果',
      content: '在“策略配置”页选择计算日期范围，然后点击“从 SQLite 计算”。系统只读取本地数据库，不会在计算阶段请求行情接口。',
      details: ['计算完成后会保存最近五次结果，并自动建立 Top50 五日跟踪批次。']
    },
    {
      id: 'calculation-source',
      page: 'strategy',
      target: '[data-tour-id="calculation-source"]',
      title: '切换和查看计算记录',
      content: calculationCount > 0
        ? `SQLite 中当前有 ${calculationCount} 条计算记录。选择任一批次后，市场复盘、选股、板块、风险和回测页面会同步使用该结果。`
        : '当前还没有 SQLite 计算记录，所以页面使用内置样例数据。完成一次计算后，可以在这里切换最近五次结果。'
    },
    {
      id: 'pool-results',
      page: 'pools',
      target: '[data-tour-id="pool-results"]',
      title: '查看选股结果',
      content: '这里可以切换综合 Top50、重点跟踪、温和换手、突破和风险等股票池，并按代码、板块或市场筛选。',
      details: ['点击股票行可进入个股复盘；导出按钮可以保存当前筛选结果。']
    },
    {
      id: 'quick-add-position',
      page: 'pools',
      target: '[data-tour-id="quick-add-position"]',
      title: '快捷加入模拟持仓',
      content: '点击结果表第一只股票的价格，可以带入代码、名称和当前价格，快速打开模拟持仓录入窗口。',
      details: ['如果当前股票池没有结果，也可以进入“模拟持仓”页面手工添加。']
    },
    {
      id: 'portfolio',
      page: 'portfolio',
      target: '[data-tour-id="add-position"]',
      title: '管理模拟持仓',
      content: portfolioCount > 0
        ? `当前已有 ${portfolioCount} 只模拟持仓。您可以继续添加，也可以编辑、减仓、清仓并查看历史交易记录。`
        : '点击“添加持仓”录入代码、股数和成本。保存后可以查看浮动盈亏、仓位占比以及历史交易记录。'
    },
    {
      id: 'backtest',
      page: 'backtest',
      target: '[data-tour-id="backtest-summary"]',
      title: '查看回测分析',
      content: backtestCount > 0
        ? `当前已经有 ${backtestCount} 个 Top50 跟踪批次，可以在这里切换批次并查看五日胜率、收益率和逐股明细。`
        : '当前还没有 Top50 跟踪批次。先获取历史数据并运行一次全市场计算，系统就会自动建立跟踪记录。',
      details: ['有新的未来交易日数据后，点击“刷新未来行情”即可更新阶段结果。']
    },
    {
      id: 'finish',
      page: 'review',
      target: '[data-tour-id="review-overview"]',
      title: '核心流程介绍完成',
      content: '现在可以从市场复盘首页开始使用。以后进入插件不会再次自动弹出教程，需要时点击顶部“教程”即可重新播放。'
    }
  ]
}
