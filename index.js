// DSH 插件分发目录管理插件 —— Host 半（ESM，函数形式）
// 功能：
//   1. 自动扫描 dist 目录下的插件包（.tgz 文件）
//   2. 按插件名分组，按版本号排序
//   3. 保留最新版本，将旧版本移至归档目录
//   4. 提供 WebUI 管理界面，显示归档状态和操作
//   5. 支持手动归档、恢复、清理等操作
// 曾用名：dist-archive-plugin（2026-08-16 更名，消除与 dist/ 数据目录的名字混淆）
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync, cpSync, rmSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = fileURLToPath(new URL('.', import.meta.url))
const DIST_DIR = join(PLUGIN_ROOT, '..', 'dist') // 默认 dist 目录：workspace/dsh-plugins/dist
const ARCHIVE_DIR = join(DIST_DIR, 'archive')
const CONFIG_FILE = join(PLUGIN_ROOT, 'config.json')

export const name = 'dsh-dist-manager'
export const inject = ['webServer']

const MIME = {
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.js': 'application/javascript',
}

// 路径安全：插件名/版本号只允许安全字符（README 承诺的防路径穿越在这里落实）
const SAFE_PLUGIN_RE = /^[\w@][\w@.-]*$/
const SAFE_VERSION_RE = /^\d+\.\d+\.\d+$/
function safePluginName(name) {
  return typeof name === 'string' && SAFE_PLUGIN_RE.test(name) ? name : null
}
function safeVersion(v) {
  return typeof v === 'string' && SAFE_VERSION_RE.test(v) ? v : null
}

// 从文件名提取版本号
function extractVersion(filename) {
  const match = filename.match(/(\d+\.\d+\.\d+)\.tgz$/)
  return match ? match[1] : null
}

// 比较版本号
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  
  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) return 1
    if (parts1[i] < parts2[i]) return -1
  }
  return 0
}

// 读取配置文件
function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {
      distDir: DIST_DIR,
      archiveDir: ARCHIVE_DIR,
      autoArchive: true,
      keepVersions: 1
    }
  }
}

// 写入配置文件
function writeConfig(config) {
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
    return true
  } catch (e) {
    console.warn('[dist-manager] config write failed: ' + e.message)
    return false
  }
}

// 扫描 dist 目录，返回插件信息
function scanDistDir(distDir) {
  const plugins = {}
  
  try {
    const files = readdirSync(distDir)
    for (const file of files) {
      if (!file.endsWith('.tgz')) continue
      
      const version = extractVersion(file)
      if (!version) continue
      
      // 提取插件名（去掉版本号）
      const pluginName = file.replace(`-${version}.tgz`, '')
      
      if (!plugins[pluginName]) {
        plugins[pluginName] = {
          name: pluginName,
          versions: [],
          latest: null
        }
      }
      
      const filePath = join(distDir, file)
      const stats = statSync(filePath)
      
      plugins[pluginName].versions.push({
        version,
        file,
        path: filePath,
        size: stats.size,
        modified: stats.mtime
      })
    }
    
    // 按版本号排序，设置最新版本
    for (const pluginName in plugins) {
      plugins[pluginName].versions.sort((a, b) => 
        compareVersions(a.version, b.version)
      )
      plugins[pluginName].latest = plugins[pluginName].versions[plugins[pluginName].versions.length - 1]
    }
  } catch (e) {
    console.warn('[dist-manager] scan failed: ' + e.message)
  }
  
  return plugins
}

// 扫描归档目录，返回归档信息
function scanArchiveDir(archiveDir) {
  const archived = {}
  
  try {
    if (!existsSync(archiveDir)) return archived
    
    const dirs = readdirSync(archiveDir)
    for (const dir of dirs) {
      const dirPath = join(archiveDir, dir)
      const stats = statSync(dirPath)
      
      if (!stats.isDirectory()) continue
      
      const files = readdirSync(dirPath)
      const tgzFiles = files.filter(f => f.endsWith('.tgz'))
      
      if (tgzFiles.length > 0) {
        archived[dir] = {
          name: dir,
          versions: tgzFiles.map(file => {
            const version = extractVersion(file)
            const filePath = join(dirPath, file)
            const fileStats = statSync(filePath)
            return {
              version,
              file,
              path: filePath,
              size: fileStats.size,
              modified: fileStats.mtime
            }
          }).filter(v => v.version).sort((a, b) => compareVersions(a.version, b.version))
        }
      }
    }
  } catch (e) {
    console.warn('[dist-manager] archive scan failed: ' + e.message)
  }
  
  return archived
}

// 执行归档操作
function archivePlugin(pluginName, config) {
  const distDir = config.distDir || DIST_DIR
  const archiveDir = config.archiveDir || ARCHIVE_DIR
  
  const plugins = scanDistDir(distDir)
  const plugin = plugins[pluginName]
  
  if (!plugin) {
    return { ok: false, error: 'Plugin not found: ' + pluginName }
  }
  
  if (plugin.versions.length <= 1) {
    return { ok: false, error: 'Only one version exists, nothing to archive' }
  }
  
  // 保留最新版本，归档旧版本
  const latest = plugin.latest
  const oldVersions = plugin.versions.slice(0, -1)
  
  // 创建归档目录
  const pluginArchiveDir = join(archiveDir, pluginName)
  mkdirSync(pluginArchiveDir, { recursive: true })
  
  const archived = []
  for (const version of oldVersions) {
    const destPath = join(pluginArchiveDir, version.file)
    try {
      renameSync(version.path, destPath)
      archived.push(version.version)
    } catch (e) {
      console.warn('[dist-manager] archive failed for ' + version.file + ': ' + e.message)
    }
  }
  
  return {
    ok: true,
    plugin: pluginName,
    latestVersion: latest.version,
    archivedVersions: archived
  }
}

// 恢复旧版本
function restoreVersion(pluginName, version, config) {
  const distDir = config.distDir || DIST_DIR
  const archiveDir = config.archiveDir || ARCHIVE_DIR
  
  const pluginArchiveDir = join(archiveDir, pluginName)
  const sourceFile = join(pluginArchiveDir, `${pluginName}-${version}.tgz`)
  const destFile = join(distDir, `${pluginName}-${version}.tgz`)
  
  if (!existsSync(sourceFile)) {
    return { ok: false, error: 'Version not found in archive: ' + version }
  }
  
  try {
    cpSync(sourceFile, destFile)
    return { ok: true, plugin: pluginName, version }
  } catch (e) {
    return { ok: false, error: 'Restore failed: ' + e.message }
  }
}

// 清理归档
function cleanArchive(pluginName, config) {
  const archiveDir = config.archiveDir || ARCHIVE_DIR
  
  if (pluginName) {
    // 清理特定插件的归档
    const pluginArchiveDir = join(archiveDir, pluginName)
    if (existsSync(pluginArchiveDir)) {
      try {
        rmSync(pluginArchiveDir, { recursive: true, force: true })
        return { ok: true, plugin: pluginName }
      } catch (e) {
        return { ok: false, error: 'Clean failed: ' + e.message }
      }
    }
    return { ok: false, error: 'Plugin archive not found: ' + pluginName }
  } else {
    // 清理整个归档目录
    try {
      if (existsSync(archiveDir)) {
        rmSync(archiveDir, { recursive: true, force: true })
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'Clean failed: ' + e.message }
    }
  }
}

// 读取请求体
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export function apply(ctx, pluginConfig) {
  console.log('[dist-manager] plugin loaded (host half)')

  // 加载配置：apply(ctx, config) 的 Config 字段（cordis.yml 可改）优先于 config.json 文件，
  // 再回退到默认路径。只读已知字段，兼容 host 受控 Proxy。
  const fileConfig = readConfig()
  let config = Object.assign({}, fileConfig)
  if (pluginConfig && typeof pluginConfig === 'object') {
    if (typeof pluginConfig.distDir === 'string') config.distDir = pluginConfig.distDir
    if (typeof pluginConfig.archiveDir === 'string') config.archiveDir = pluginConfig.archiveDir
    if (typeof pluginConfig.autoArchive === 'boolean') config.autoArchive = pluginConfig.autoArchive
    if (typeof pluginConfig.keepVersions === 'number') config.keepVersions = pluginConfig.keepVersions
  }
  // 配置变更后同步写回 config.json（link 安装场景下插件目录可写）
  if (JSON.stringify(config) !== JSON.stringify(fileConfig)) writeConfig(config)
  
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: '/dist-manager',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        
        // 获取归档状态
        if (url.pathname === '/dist-manager/status') {
          const plugins = scanDistDir(config.distDir)
          const archived = scanArchiveDir(config.archiveDir)
          
          const summary = {
            totalPlugins: Object.keys(plugins).length,
            totalVersions: Object.values(plugins).reduce((sum, p) => sum + p.versions.length, 0),
            totalArchived: Object.values(archived).reduce((sum, p) => sum + p.versions.length, 0),
            plugins: Object.values(plugins).map(p => ({
              name: p.name,
              latestVersion: p.latest ? p.latest.version : null,
              totalVersions: p.versions.length,
              archivedCount: archived[p.name] ? archived[p.name].versions.length : 0
            }))
          }
          
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(summary))
          return
        }
        
        // 获取详细信息
        if (url.pathname === '/dist-manager/details') {
          const plugins = scanDistDir(config.distDir)
          const archived = scanArchiveDir(config.archiveDir)
          
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ plugins, archived }))
          return
        }
        
        // 执行归档
        if (url.pathname === '/dist-manager/archive' && req.method === 'POST') {
          let body = {}
          try { body = JSON.parse(await readBody(req)) } catch { /* ignore */ }
          
          const pluginName = safePluginName(body && body.plugin)
          if (!pluginName) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: 'Missing or invalid plugin name' }))
            return
          }
          
          const result = archivePlugin(pluginName, config)
          res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(result))
          return
        }
        
        // 恢复版本
        if (url.pathname === '/dist-manager/restore' && req.method === 'POST') {
          let body = {}
          try { body = JSON.parse(await readBody(req)) } catch { /* ignore */ }
          
          const pluginName = safePluginName(body && body.plugin)
          const version = safeVersion(body && body.version)
          
          if (!pluginName || !version) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: 'Missing or invalid plugin name/version' }))
            return
          }
          
          const result = restoreVersion(pluginName, version, config)
          res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(result))
          return
        }
        
        // 清理归档
        if (url.pathname === '/dist-manager/clean' && req.method === 'POST') {
          let body = {}
          try { body = JSON.parse(await readBody(req)) } catch { /* ignore */ }
          
          // 不传 plugin = 清理整个归档目录；传了就必须是安全插件名
          let pluginName = undefined
          if (body && body.plugin !== undefined && body.plugin !== null && body.plugin !== '') {
            pluginName = safePluginName(body.plugin)
            if (!pluginName) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: 'Invalid plugin name' }))
              return
            }
          }
          const result = cleanArchive(pluginName, config)
          res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(result))
          return
        }
        
        // 获取配置
        if (url.pathname === '/dist-manager/config' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(config))
          return
        }
        
        // 更新配置
        if (url.pathname === '/dist-manager/config' && req.method === 'POST') {
          let body = {}
          try { body = JSON.parse(await readBody(req)) } catch { /* ignore */ }
          
          const newConfig = { ...config, ...body }
          if (writeConfig(newConfig)) config = newConfig  // 内存同步，后续读立即生效
          
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, config: newConfig }))
          return
        }
        
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
      },
    }),
    'dist-manager: routes',
  )
  
  console.log('[dist-manager] loaded, dist=' + config.distDir + ', archive=' + config.archiveDir)
}