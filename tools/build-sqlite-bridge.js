const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const preloadFile = path.join(projectRoot, 'bridge', 'preload.js')
const buildRoot = path.join(projectRoot, 'build', 'sqlite-bridge')
const generatedScript = path.join(buildRoot, 'sqlite_bridge.py')
const outputDir = path.join(projectRoot, 'public', 'runtime')
const outputFile = path.join(outputDir, 'sqlite_bridge.exe')

function extractBridgeSource() {
  const preloadSource = fs.readFileSync(preloadFile, 'utf8').replace(/\r\n/g, '\n')
  const startMarker = 'const SQLITE_HISTORY_BRIDGE_SCRIPT = String.raw`'
  const endMarker = '\n`\n\nconst SQLITE_HISTORY_BRIDGE_HASH'
  const start = preloadSource.indexOf(startMarker)
  const end = preloadSource.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) {
    throw new Error('无法从 bridge/preload.js 提取 SQLITE_HISTORY_BRIDGE_SCRIPT')
  }
  return preloadSource
    // 保留模板正文末尾、闭合反引号之前的换行；preload 运行时的 String.raw 也包含它。
    .slice(start + startMarker.length, end + 1)
    .replace(/^\n/, '')
}

function addExecutableBootstrap(source, sourceHash) {
  const payloadLine = 'payload = json.load(sys.stdin)'
  if (!source.includes(payloadLine)) {
    throw new Error('SQLite 桥接脚本缺少预期的 JSON 输入入口')
  }
  const bootstrap = [
    'for _stream in (sys.stdin, sys.stdout, sys.stderr):',
    '    if hasattr(_stream, "reconfigure"):',
    '        _stream.reconfigure(encoding="utf-8")',
    '',
    payloadLine,
    `_expected_bridge_hash = ${JSON.stringify(sourceHash)}`,
    '_actual_bridge_hash = str(payload.pop("__bridgeScriptHash", ""))',
    'if _actual_bridge_hash != _expected_bridge_hash:',
    '    print(json.dumps({',
    '        "ok": False,',
    '        "error": "sqlite_bridge.exe 与插件逻辑版本不一致，请重新执行 npm run build:release 并安装新包"',
    '    }, ensure_ascii=False))',
    '    raise SystemExit(0)'
  ].join('\n')
  return [
    '# 此文件由 tools/build-sqlite-bridge.js 从 bridge/preload.js 自动生成，请勿直接编辑。',
    source.replace(payloadLine, bootstrap)
  ].join('\n')
}

function findPythonWithPyInstaller() {
  const candidates = []
  if (String(process.env.PYTHON || '').trim()) {
    candidates.push({ command: String(process.env.PYTHON).trim(), prefix: [] })
  }
  if (process.platform === 'win32') candidates.push({ command: 'py', prefix: ['-3'] })
  candidates.push({ command: process.platform === 'win32' ? 'python' : 'python3', prefix: [] })

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, '-c', 'import PyInstaller'], {
      cwd: projectRoot,
      stdio: 'ignore',
      windowsHide: true
    })
    if (probe.status === 0) return candidate
  }
  throw new Error('未找到 PyInstaller。请先执行：python -m pip install pyinstaller')
}

function main() {
  const source = extractBridgeSource()
  const sourceHash = crypto.createHash('sha256').update(source, 'utf8').digest('hex')
  const generated = addExecutableBootstrap(source, sourceHash)
  fs.mkdirSync(buildRoot, { recursive: true })
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(generatedScript, generated, 'utf8')

  const python = findPythonWithPyInstaller()
  const args = [
    ...python.prefix,
    '-m', 'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name', 'sqlite_bridge',
    '--distpath', outputDir,
    '--workpath', path.join(buildRoot, 'work'),
    '--specpath', buildRoot,
    generatedScript
  ]
  const result = spawnSync(python.command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0 || !fs.existsSync(outputFile)) {
    throw new Error(`sqlite_bridge.exe 构建失败，退出码 ${result.status}`)
  }

  const sizeMb = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2)
  process.stdout.write(`sqlite_bridge.exe 已生成：${outputFile}（${sizeMb} MB）\n`)
  process.stdout.write(`SQLite 逻辑版本：${sourceHash}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
}
