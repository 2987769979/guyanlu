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

`history_datasets` 被删除时，其运行记录、单股状态和日 K 数据通过外键级联清理；`stocks` 与 `snapshot_runs` 保留。

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

页面集成命令：

```text
fetch_a_stock_history_by_stock.exe --database "stock-review.db" --start 2020-01-01 --end 2026-07-08 --source baostock --check
fetch_a_stock_history_by_stock.exe --database "stock-review.db" --status-json
fetch_a_stock_history_by_stock.exe --database "stock-review.db" --clear-history
```

`--status-json` 和 `--check` 只向 stdout 输出机器可读 JSON，不生成 JSON 文件。正常历史获取会输出 `STOCK_PROGRESS_JSON:` 前缀的单股进度行，Electron 桥接据此实时更新页面。
