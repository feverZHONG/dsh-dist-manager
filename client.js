// DSH 插件分发目录管理插件 —— Client 半（dsh client bundle，手写）
// 功能：
//   1. 设置页 → 插件归档 小节：显示归档状态、执行归档、恢复版本、清理归档
//   2. 实时显示插件版本信息和归档统计
//   3. 一键归档所有旧版本
//   4. 支持恢复特定版本到 dist 根目录
// 曾用名：dist-archive-plugin（2026-08-16 更名，消除与 dist/ 数据目录的名字混淆）
window.__ModuleLoader__.load({
  id: 'dsh-dist-manager',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');

    var POLL_MS = 5000; // 5秒轮询一次状态

    // ── 设置页：插件归档 ──
    function ArchiveSettings(props) {
      var ctx = props.ctx;

      var statusState = react.useState(null);
      var status = statusState[0];
      var setStatus = statusState[1];
      var detailsState = react.useState(null);
      var details = detailsState[0];
      var setDetails = detailsState[1];
      var loadingState = react.useState(false);
      var loading = loadingState[0];
      var setLoading = loadingState[1];
      var errorState = react.useState('');
      var error = errorState[0];
      var setError = errorState[1];

      // 加载状态
      function loadStatus() {
        fetch('/dist-manager/status', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && typeof d === 'object') setStatus(d);
          })
          .catch(function () { /* 轮询失败静默 */ });
      }

      // 加载详细信息
      function loadDetails() {
        fetch('/dist-manager/details', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && typeof d === 'object') setDetails(d);
          })
          .catch(function () { /* 轮询失败静默 */ });
      }

      // 初始加载和轮询
      react.useEffect(function () {
        loadStatus();
        loadDetails();
        var id = setInterval(function () {
          loadStatus();
          loadDetails();
        }, POLL_MS);
        return function () { clearInterval(id); };
      }, []);

      // 归档单个插件
      function archivePlugin(pluginName) {
        setError('');
        setLoading(true);
        fetch('/dist-manager/archive', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ plugin: pluginName })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            setLoading(false);
            if (d && d.ok) {
              loadStatus();
              loadDetails();
            } else {
              setError((d && d.error) || '归档失败');
            }
          })
          .catch(function () {
            setLoading(false);
            setError('归档失败（Host 路由不可达）');
          });
      }

      // 归档所有插件
      function archiveAll() {
        setError('');
        setLoading(true);
        
        var plugins = status && status.plugins ? status.plugins : [];
        var toArchive = plugins.filter(function (p) { return p.totalVersions > 1; });
        
        if (toArchive.length === 0) {
          setLoading(false);
          setError('没有需要归档的插件');
          return;
        }
        
        var completed = 0;
        var errors = [];
        
        toArchive.forEach(function (plugin) {
          fetch('/dist-manager/archive', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ plugin: plugin.name })
          })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              completed++;
              if (!d || !d.ok) {
                errors.push(plugin.name + ': ' + ((d && d.error) || '未知错误'));
              }
              if (completed === toArchive.length) {
                setLoading(false);
                if (errors.length > 0) {
                  setError('部分归档失败: ' + errors.join('; '));
                }
                loadStatus();
                loadDetails();
              }
            })
            .catch(function () {
              completed++;
              errors.push(plugin.name + ': 网络错误');
              if (completed === toArchive.length) {
                setLoading(false);
                if (errors.length > 0) {
                  setError('部分归档失败: ' + errors.join('; '));
                }
                loadStatus();
                loadDetails();
              }
            });
        });
      }

      // 恢复版本
      function restoreVersion(pluginName, version) {
        setError('');
        setLoading(true);
        fetch('/dist-manager/restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ plugin: pluginName, version: version })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            setLoading(false);
            if (d && d.ok) {
              loadStatus();
              loadDetails();
            } else {
              setError((d && d.error) || '恢复失败');
            }
          })
          .catch(function () {
            setLoading(false);
            setError('恢复失败（Host 路由不可达）');
          });
      }

      // 清理归档
      function cleanArchive(pluginName) {
        setError('');
        setLoading(true);
        // 传 plugin = 清理该插件归档；不传 = 清理整个归档目录
        fetch('/dist-manager/clean', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(pluginName ? { plugin: pluginName } : {})
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            setLoading(false);
            if (d && d.ok) {
              loadStatus();
              loadDetails();
            } else {
              setError((d && d.error) || '清理失败');
            }
          })
          .catch(function () {
            setLoading(false);
            setError('清理失败（Host 路由不可达）');
          });
      }

      // 格式化文件大小
      function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      }

      // 格式化日期
      function formatDate(dateStr) {
        var d = new Date(dateStr);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      }

      // 渲染统计卡片
      function renderStatCard(title, value, color) {
        return react.createElement('div', {
          style: {
            flex: 1,
            padding: '12px 16px',
            borderRadius: 12,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-1)',
            textAlign: 'center'
          }
        },
          react.createElement('div', {
            style: { fontSize: 24, fontWeight: 600, color: color || 'var(--dsw-alias-label-primary)' }
          }, value),
          react.createElement('div', {
            style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }
          }, title)
        );
      }

      // 渲染插件列表
      function renderPluginList() {
        if (!status || !status.plugins) return null;

        return status.plugins.map(function (plugin) {
          return react.createElement('div', {
            key: plugin.name,
            style: {
              marginBottom: 12,
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)'
            }
          },
            react.createElement('div', {
              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }
            },
              react.createElement('div', {
                style: { fontSize: 14, fontWeight: 600 }
              }, plugin.name),
              react.createElement('div', {
                style: { display: 'flex', gap: 8 }
              },
                plugin.totalVersions > 1 ? react.createElement('button', {
                  type: 'button',
                  onClick: function () { archivePlugin(plugin.name); },
                  disabled: loading,
                  style: {
                    cursor: 'pointer', font: 'inherit', fontSize: 12,
                    color: 'var(--dsw-alias-label-primary)',
                    background: 'var(--dsw-alias-bg-layer-3)',
                    border: '1px solid var(--dsw-alias-border-l2)',
                    borderRadius: 6, padding: '4px 8px',
                    opacity: loading ? 0.5 : 1
                  }
                }, '📦 归档') : null,
                plugin.archivedCount > 0 ? react.createElement('button', {
                  type: 'button',
                  onClick: function () { cleanArchive(plugin.name); },
                  disabled: loading,
                  style: {
                    cursor: 'pointer', font: 'inherit', fontSize: 12,
                    color: 'var(--dsw-alias-label-primary)',
                    background: 'var(--dsw-alias-bg-layer-3)',
                    border: '1px solid var(--dsw-alias-border-l2)',
                    borderRadius: 6, padding: '4px 8px',
                    opacity: loading ? 0.5 : 1
                  }
                }, '🗑️ 清理') : null
              )
            ),
            react.createElement('div', {
              style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 }
            },
              '最新版本: ', react.createElement('span', {
                style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 }
              }, plugin.latestVersion || '无'),
              ' | 版本数: ', plugin.totalVersions,
              ' | 已归档: ', plugin.archivedCount
            )
          );
        });
      }

      // 渲染归档详情
      function renderArchiveDetails() {
        if (!details || !details.archived) return null;

        var pluginNames = Object.keys(details.archived);
        if (pluginNames.length === 0) return null;

        return react.createElement('div', {
          style: { marginTop: 16 }
        },
          react.createElement('div', {
            style: { fontSize: 13, fontWeight: 600, marginBottom: 8 }
          }, '归档详情'),
          pluginNames.map(function (pluginName) {
            var plugin = details.archived[pluginName];
            return react.createElement('div', {
              key: pluginName,
              style: {
                marginBottom: 8,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)'
              }
            },
              react.createElement('div', {
                style: { fontSize: 13, fontWeight: 500, marginBottom: 4 }
              }, pluginName),
              plugin.versions.map(function (version) {
                return react.createElement('div', {
                  key: version.version,
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 0',
                    borderBottom: '1px solid var(--dsw-alias-border-l2)'
                  }
                },
                  react.createElement('div', {
                    style: { fontSize: 12 }
                  }, 
                    react.createElement('span', {
                      style: { color: 'var(--dsw-alias-label-primary)' }
                    }, version.version),
                    ' (', formatSize(version.size), ')'
                  ),
                  react.createElement('button', {
                    type: 'button',
                    onClick: function () { restoreVersion(pluginName, version.version); },
                    disabled: loading,
                    style: {
                      cursor: 'pointer', font: 'inherit', fontSize: 11,
                      color: 'var(--dsw-alias-label-primary)',
                      background: 'var(--dsw-alias-bg-layer-3)',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      borderRadius: 4, padding: '2px 6px',
                      opacity: loading ? 0.5 : 1
                    }
                  }, '恢复')
                );
              })
            );
          })
        );
      }

      // 主渲染
      var nodes = [
        react.createElement('h2', { key: 'head', style: { margin: '0 0 8px', fontSize: 16, fontWeight: 600 } }, '插件归档'),
        react.createElement('p', { key: 'tip', style: { margin: '0 0 10px', fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)' } },
          '管理 DSH 插件的版本归档，自动将旧版本移至归档目录，保留最新版本在 dist 根目录。')
      ];

      // 统计卡片
      if (status) {
        nodes.push(react.createElement('div', {
          key: 'stats',
          style: { display: 'flex', gap: 12, marginBottom: 16 }
        },
          renderStatCard('插件总数', status.totalPlugins, 'var(--dsw-alias-label-primary)'),
          renderStatCard('当前版本', status.totalVersions, 'var(--dsw-alias-state-success-primary, #30a14e)'),
          renderStatCard('已归档', status.totalArchived, 'var(--dsw-alias-state-warning-primary, #f5a623)')
        ));
      }

      // 操作按钮
      nodes.push(react.createElement('div', {
        key: 'actions',
        style: { display: 'flex', gap: 8, marginBottom: 16 }
      },
        react.createElement('button', {
          type: 'button',
          onClick: archiveAll,
          disabled: loading,
          style: {
            cursor: 'pointer', font: 'inherit', fontSize: 13,
            color: 'var(--dsw-alias-label-primary)',
            background: 'var(--dsw-alias-bg-layer-3)',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 8, padding: '6px 12px',
            opacity: loading ? 0.5 : 1
          }
        }, '📦 一键归档所有'),
        react.createElement('button', {
          type: 'button',
          onClick: function () { cleanArchive(); },
          disabled: loading,
          style: {
            cursor: 'pointer', font: 'inherit', fontSize: 13,
            color: 'var(--dsw-alias-label-primary)',
            background: 'var(--dsw-alias-bg-layer-3)',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 8, padding: '6px 12px',
            opacity: loading ? 0.5 : 1
          }
        }, '🗑️ 清理所有归档')
      ));

      // 错误信息
      if (error) {
        nodes.push(react.createElement('div', {
          key: 'error',
          style: {
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--dsw-alias-state-danger-primary, #e5484d)',
            border: '1px solid var(--dsw-alias-state-danger-primary, #e5484d)',
            background: 'var(--dsw-alias-bg-layer-1)'
          }
        }, error));
      }

      // 插件列表
      nodes.push(react.createElement('div', {
        key: 'plugins',
        style: { marginBottom: 16 }
      },
        react.createElement('div', {
          style: { fontSize: 13, fontWeight: 600, marginBottom: 8 }
        }, '插件列表'),
        renderPluginList()
      ));

      // 归档详情
      nodes.push(renderArchiveDetails());

      // 提示信息
      nodes.push(react.createElement('p', {
        key: 'hint',
        style: { margin: '16px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
      },
        '归档操作会将旧版本插件包移至 archive 目录，保留最新版本在 dist 根目录。恢复操作会将归档的版本复制回 dist 根目录。'
      ));

      return react.createElement('div', {
        key: 'dist-manager',
        style: { padding: '4px 0', color: 'var(--dsw-alias-label-primary)' }
      }, nodes);
    }

    exports.inject = ['slots'];
    exports.apply = function (ctx) {
      var slots = ctx.get('slots');
      if (slots === undefined) return;

      slots.inject('settings.section', function () {
        return slots.register(
          {
            name: 'settings.section',
            id: 'dist-manager',
            order: 130,
            label: function () { return '插件归档'; }
          },
          function (props) { return react.createElement(ArchiveSettings, { ctx: ctx }); }
        );
      });
    };

    module.exports = exports;
    return module.exports;
  }
});