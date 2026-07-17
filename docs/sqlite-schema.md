# 股研录 SQLite 数据库结构

固定数据库文件：`%LOCALAPPDATA%\股研录\history-data\stock-review.db`

数据库使用 WAL 日志、外键约束和 30 秒 busy timeout。快照与历史程序共用同一个数据库，不再生成 `all-market-stocks.json`、`all-market-stocks-Calculate.json`、`stock-history-index.json` 或单股 JSON。

## 表结构

| 表 | 用途 | 关键约束/索引 |
| --- | --- | --- |
| `schema_meta` | 数据库版本与最近批次等键值元数据 | `key` 主键 |
| `snapshot_runs` | 每次股票快照刷新批次 | 自增主键、来源、查询日期、股票数、执行状态 |
| `stocks` | 股票主数据及当前快照有效性 | `code` 主键；`(is_active, market, symbol)` 索引 |
| `history_datasets` | 当前历史日期范围和复权参数 | 仅允许一条 `is_active=1` 的数据集 |
| `history_runs` | 每次历史程序执行记录 | 关联数据集，记录请求数、完成数、失败数和空数据数 |
| `stock_history_status` | 每只股票在当前数据集中的同步状态 | `(dataset_id, stock_code)` 联合主键；按状态索引 |
| `daily_bars` | 所有股票的日 K 明细 | `(dataset_id, stock_code, trade_date)` 联合主键；按交易日索引 |
| `calculation_runs` | 每次策略计算的批次、日期范围、策略、市场摘要和数据包元信息 | 自增主键；按 `(calculated_at, id)` 倒序索引；只保留最近 5 条 |
| `calculation_stocks` | 某次计算的逐股结果 | `(calculation_id, stock_code)` 联合主键；按排名和综合分索引；批次删除时级联删除 |
| `calculation_sectors` | 某次计算的板块强弱结果 | `(calculation_id, sector_key)` 联合主键；按展示顺序索引；批次删除时级联删除 |
| `top50_tracking_runs` | 每次计算前 50 名的五日跟踪批次及汇总指标 | `source_calculation_id` 唯一；按信号日和状态索引；独立保留最近 250 个批次 |
| `top50_tracking_items` | Top50 单股买卖价、收益率、股数和盈亏金额 | `(tracking_id, stock_code)` 联合主键；按排名和结果状态索引；批次删除时级联删除 |

`history_datasets` 被删除时，其运行记录、单股状态和日 K 数据通过外键级联清理；`stocks` 与 `snapshot_runs` 保留。

## 计算结果历史

计算完成后，页面不再把全市场结果写入 uTools `dbStorage`，而是在同一个 `stock-review.db` 事务中写入以下结构：

```sql
CREATE TABLE calculation_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    calculated_at     TEXT NOT NULL,
    start_date        TEXT NOT NULL,
    end_date          TEXT NOT NULL,
    strategy_version  TEXT NOT NULL DEFAULT '',
    strategy_json     TEXT NOT NULL,
    market_json       TEXT NOT NULL,
    bundle_meta_json  TEXT NOT NULL,
    stock_count       INTEGER NOT NULL DEFAULT 0 CHECK (stock_count >= 0),
    sector_count      INTEGER NOT NULL DEFAULT 0 CHECK (sector_count >= 0),
    created_at        TEXT NOT NULL
);

CREATE TABLE calculation_stocks (
    calculation_id  INTEGER NOT NULL,
    stock_code      TEXT NOT NULL,
    rank            INTEGER NOT NULL DEFAULT 0,
    total_score     REAL NOT NULL DEFAULT 0,
    risk_penalty    REAL NOT NULL DEFAULT 0,
    is_selected     INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
    result_json     TEXT NOT NULL,
    PRIMARY KEY (calculation_id, stock_code),
    FOREIGN KEY (calculation_id) REFERENCES calculation_runs(id) ON DELETE CASCADE
);

CREATE TABLE calculation_sectors (
    calculation_id  INTEGER NOT NULL,
    sector_key      TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    score           REAL NOT NULL DEFAULT 0,
    result_json     TEXT NOT NULL,
    PRIMARY KEY (calculation_id, sector_key),
    FOREIGN KEY (calculation_id) REFERENCES calculation_runs(id) ON DELETE CASCADE
);
```

设计说明：

- `calculation_runs` 只保存批次级字段，策略和市场摘要使用 JSON，方便策略字段升级时保持向后兼容。
- 股票和板块拆成明细行，避免单个超大文档，同时保留排名、综合分、风险分等可直接检索字段。
- 页面启动只读取最近 5 次的轻量批次索引；选择某一批次后才加载对应股票与板块明细。
- 策略页展开或切换数据源时只使用内存中的启动查询结果，不重复访问数据库；只有页面刷新按钮会重新查询批次索引。
- 第 6 次结果写入成功后，在同一事务中删除最早批次，明细通过外键级联删除。
- 用户在数据源下拉框中主动删除记录时，会在同一事务中删除计算批次、逐股结果、板块结果以及关联的 Top50 跟踪批次和明细。
- 写入使用 `BEGIN IMMEDIATE`、30 秒 busy timeout 和外键约束；任一明细失败会回滚整个批次，不产生半成品。

## Top50 五日跟踪

每次完整计算入库时，同一个事务会把排名前 50 的必要字段复制为独立跟踪快照。跟踪表不外键关联 `calculation_runs`，因此完整计算结果执行“最近 5 次”清理后，历史跟踪结果仍然存在；为控制数据库增长，跟踪批次最多保留最近 250 个。

```sql
CREATE TABLE top50_tracking_runs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    source_calculation_id INTEGER NOT NULL UNIQUE,
    history_dataset_id    INTEGER,
    calculated_at         TEXT NOT NULL,
    signal_date           TEXT NOT NULL,
    strategy_version      TEXT NOT NULL DEFAULT '',
    horizon_days          INTEGER NOT NULL DEFAULT 5,
    capital_per_stock     REAL NOT NULL DEFAULT 10000,
    cost_rate             REAL NOT NULL DEFAULT 0,
    entry_date             TEXT,
    exit_date              TEXT,
    available_days         INTEGER NOT NULL DEFAULT 0,
    status                 TEXT NOT NULL DEFAULT 'pending',
    stock_count            INTEGER NOT NULL DEFAULT 0,
    tradable_count         INTEGER NOT NULL DEFAULT 0,
    win_count              INTEGER NOT NULL DEFAULT 0,
    loss_count             INTEGER NOT NULL DEFAULT 0,
    flat_count             INTEGER NOT NULL DEFAULT 0,
    win_rate               REAL,
    sum_price_change       REAL,
    sum_return_pct         REAL,
    avg_return_pct         REAL,
    total_investment       REAL,
    total_profit           REAL,
    portfolio_return_pct   REAL,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);

CREATE TABLE top50_tracking_items (
    tracking_id       INTEGER NOT NULL,
    stock_code        TEXT NOT NULL,
    stock_name        TEXT NOT NULL DEFAULT '',
    rank              INTEGER NOT NULL,
    total_score       REAL NOT NULL DEFAULT 0,
    signal_date       TEXT NOT NULL,
    signal_close      REAL NOT NULL DEFAULT 0,
    entry_date        TEXT,
    entry_open        REAL,
    exit_date         TEXT,
    exit_price_date   TEXT,
    exit_close        REAL,
    shares            INTEGER NOT NULL DEFAULT 0,
    gross_return_pct  REAL,
    net_return_pct    REAL,
    price_change      REAL,
    investment_amount REAL,
    profit_amount     REAL,
    result_status     TEXT NOT NULL DEFAULT 'pending',
    updated_at        TEXT NOT NULL,
    PRIMARY KEY (tracking_id, stock_code),
    FOREIGN KEY (tracking_id) REFERENCES top50_tracking_runs(id) ON DELETE CASCADE
);
```

统计口径：

- 信号日 `T` 使用计算批次中的市场交易日，买入价为 `T+1` 开盘价。未来行情达到 1～4 个完整市场交易日时，先使用当前最后一个未来交易日的收盘价生成阶段结果；达到第 5 日后使用 T+5 收盘价形成最终结果。
- `history_dataset_id` 固定记录计算发生时使用的历史数据集；该数据集仍存在时优先从其中取未来行情，已被清理时才回退到当前活动数据集。
- 完整市场交易日要求 `daily_bars` 至少包含 1000 个不同股票代码，避免单股补数据被误当成新交易日。
- 单股预算默认 10000 元，买入股数为 `floor(10000 / T+1开盘价 / 100) * 100`；不足 100 股时记为不可交易。
- 毛收益率为 `(卖出价 / 买入价 - 1) * 100`；净收益率再减去策略的综合成本率；胜率只统计可交易股票中净收益率大于 0 的比例。
- 每股涨跌额合计为 50 只股票中可交易标的 `(卖出价 - 买入价)` 的总和；盈亏金额为 `股数 * (卖出价 - 买入价) - 实际投入金额 * 综合成本率 / 100`；组合收益率为总盈亏金额除以总实际投入金额。
- 若股票在当前估值日停牌，使用 `T+1` 至当前估值日范围内最近一个有效收盘价，阶段明细标记为 `partial_estimated`，最终明细标记为 `completed_estimated`；若 `T+1` 无开盘价则不纳入胜率和金额汇总。
- 每次打开“Top50 五日跟踪”页面、点击“刷新未来行情”以及每日快照成功入库后，程序都会重新扫描。没有未来行情时状态为 `pending`，存在 1～4 日时为 `partial`，达到 5 日时为 `completed`。

## 历史日期增量追加

历史页面点击“开始获取”时，会先按 `daily_bars.trade_date` 检查所选日期区间：

- 历史抓取队列只包含沪深北 A 股；指数、ETF、债券和新债保留在证券清单中供页面分类查询，但不会进入历史抓取程序。
- 区间内存在已保存交易日时，不启动获取，并提示重合的开始日期、结束日期和已存交易日数量。
- 区间内没有已保存交易日时，复用当前活动数据集追加写入；原有日 K、运行记录和股票快照均保留。
- 追加完成后，活动数据集的起止日期以及单股行数会按数据库中的实际日 K 重新汇总。

`daily_bars` 的联合主键包含 `trade_date`，因此同一股票、同一数据集、同一交易日不会被重复插入。

## 可执行程序协议

刷新股票快照：

```text
fetch_all_a_stocks_v2.exe --database "stock-review.db" --source baostock
```

获取当天或指定交易日快照，并按交易日替换写入 `daily_bars`：

```text
fetch_all_a_stocks_v3.exe --database "stock-review.db" --date 2026-07-14 --source auto
```

`v3` 会先完成远端数据获取，再在同一 SQLite 事务中删除目标日期的原记录并写入新快照；远端获取失败时不会删除原数据。页面使用 `auto`：目标日期为当天时使用东方财富批量快照，历史日期使用 Baostock；Baostock 历史快照会按目标日期在市清单过滤退市、未上市和停牌代码。运行期间可通过“停止”按钮终止快照进程。

启动历史获取：

```text
fetch_a_stock_history_by_stock.exe --start 2020-01-01 --end 2026-07-08 --database "stock-review.db" --source baostock --resume
```

获取页面中选中的 A 股：

```text
fetch_a_stock_history_by_stock.exe --start 2026-07-01 --end 2026-07-15 --database "stock-review.db" --source baostock --codes-file "selected-history-codes.json" --force-refetch --resume
```

选中获取只替换指定股票在所选日期范围内的日 K，股票在范围外的历史数据保持不变。页面使用代码文件传参，避免跨页选择较多股票时超过 Windows 命令行长度限制；指定日期会与该股票已有覆盖范围合并。

页面集成命令：

```text
fetch_a_stock_history_by_stock.exe --database "stock-review.db" --start 2020-01-01 --end 2026-07-08 --source baostock --check
fetch_a_stock_history_by_stock.exe --database "stock-review.db" --status-json
fetch_a_stock_history_by_stock.exe --database "stock-review.db" --clear-history
```

`--status-json` 和 `--check` 只向 stdout 输出机器可读 JSON，不生成 JSON 文件。正常历史获取会输出 `STOCK_PROGRESS_JSON:` 前缀的单股进度行，Electron 桥接据此实时更新页面。
