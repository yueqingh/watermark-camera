/* 诊断层：日志、全局错误捕获、一键复制诊断报告。必须最先加载。
   本文件内所有逻辑都有 try/catch 保护，不会影响主程序。 */
(function () {
  'use strict';
  var APP = { name: '水印相机', version: '1.1.0' };
  window.APP_INFO = APP;

  var MAX_LOG = 200, MAX_ACT = 60, MAX_ERR = 30;
  var logs = [], acts = [], errs = [];
  var T0 = Date.now();
  var stateFn = null, sensFn = null;
  var asyncInfo = {};
  var inHook = false;

  function pad(n, l) { n = String(n); l = l || 2; while (n.length < l) n = '0' + n; return n; }
  function ts(d) {
    d = d || new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  }
  function str(x) {
    try {
      if (x instanceof Error) return x.name + ': ' + x.message;
      if (typeof x === 'string') return x;
      if (x === undefined) return 'undefined';
      var s = JSON.stringify(x);
      return s === undefined ? String(x) : s;
    } catch (e) { try { return String(x); } catch (e2) { return '[无法转为文字]'; } }
  }
  function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function push(arr, item, max) { arr.push(item); if (arr.length > max) arr.splice(0, arr.length - max); }
  function stripQuery(u) { try { return String(u).split('#')[0].split('?')[0]; } catch (e) { return ''; } }

  function log(level, mod, msg) {
    try {
      var line = { t: ts(), l: level, m: mod || '-', s: cut(str(msg), 600) };
      push(logs, line, MAX_LOG);
    } catch (e) { /* 忽略 */ }
  }
  function action(name, detail) {
    try {
      push(acts, ts() + '  ' + name + (detail ? '  ' + cut(str(detail), 200) : ''), MAX_ACT);
      log('INFO', 'action', name + (detail ? ' ' + cut(str(detail), 200) : ''));
    } catch (e) { /* 忽略 */ }
  }
  function recordError(mod, msg, stack) {
    try {
      push(errs, { t: ts(), m: mod, s: cut(str(msg), 600), k: stack ? cut(String(stack), 1800) : '' }, MAX_ERR);
      log('ERROR', mod, msg);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 全局错误捕获 ---------- */
  try {
    window.addEventListener('error', function (e) {
      try {
        var t = e && e.target;
        if (t && t !== window && (t.src || t.href)) {
          log('ERROR', 'resource', '资源加载失败 ' + (t.tagName || '') + ' ' + stripQuery(t.src || t.href));
          return;
        }
        recordError('window.onerror', (e.message || '脚本错误') + ' @' + stripQuery(e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno,
          e.error && e.error.stack);
      } catch (x) { /* 忽略 */ }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      try {
        var r = e && e.reason;
        recordError('unhandledrejection', r instanceof Error ? (r.name + ': ' + r.message) : str(r), r && r.stack);
      } catch (x) { /* 忽略 */ }
    });
    ['error', 'warn'].forEach(function (k) {
      var orig = console[k];
      console[k] = function () {
        try {
          if (!inHook) {
            inHook = true;
            var parts = [];
            for (var i = 0; i < arguments.length; i++) parts.push(str(arguments[i]));
            if (k === 'error') recordError('console.error', parts.join(' '), (arguments[0] && arguments[0].stack) || '');
            else log('WARN', 'console.warn', parts.join(' '));
            inHook = false;
          }
        } catch (e) { inHook = false; }
        try { return orig && orig.apply(console, arguments); } catch (e2) { /* 忽略 */ }
      };
    });
    window.addEventListener('online', function () { log('INFO', 'net', '网络: 已联网'); });
    window.addEventListener('offline', function () { log('INFO', 'net', '网络: 已断网'); });
    document.addEventListener('visibilitychange', function () { log('INFO', 'page', '页面可见性: ' + document.visibilityState); });
    window.addEventListener('orientationchange', function () { log('INFO', 'page', '屏幕方向改变'); });
  } catch (e) { /* 忽略 */ }

  /* ---------- 网络请求监控（只记 URL、状态码、耗时） ---------- */
  try {
    if (window.fetch) {
      var of = window.fetch;
      window.fetch = function (input) {
        var u = '', t = Date.now();
        try { u = stripQuery(typeof input === 'string' ? input : (input && input.url) || ''); } catch (e) { /* 忽略 */ }
        log('INFO', 'net', 'fetch 开始 ' + u);
        var p = of.apply(this, arguments);
        try {
          p.then(function (r) {
            log(r && r.ok ? 'INFO' : 'WARN', 'net', 'fetch 结果 ' + (r && r.status) + ' ' + u + ' ' + (Date.now() - t) + 'ms');
          }, function (err) {
            log('ERROR', 'net', 'fetch 失败 ' + u + ' ' + str(err) + ' ' + (Date.now() - t) + 'ms');
          });
        } catch (e) { /* 忽略 */ }
        return p;
      };
    }
    if (window.XMLHttpRequest) {
      var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) {
        try { this.__u = stripQuery(u); this.__m = m; } catch (e) { /* 忽略 */ }
        return oo.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        try {
          var x = this, t = Date.now();
          log('INFO', 'net', 'XHR 开始 ' + x.__m + ' ' + x.__u);
          x.addEventListener('loadend', function () {
            log(x.status >= 400 || x.status === 0 ? 'WARN' : 'INFO', 'net', 'XHR 结果 ' + x.status + ' ' + x.__u + ' ' + (Date.now() - t) + 'ms');
          });
        } catch (e) { /* 忽略 */ }
        return os.apply(this, arguments);
      };
    }
  } catch (e) { /* 忽略 */ }

  /* ---------- 脱敏 ---------- */
  var REDACTED = '邮箱、手机号、令牌/密钥/密码/Cookie、32位以上长串、经纬度坐标、用户输入的地址与备注文字（报告中只显示字数）';
  function redact(s) {
    try {
      s = String(s);
      var sens = [];
      try { sens = sensFn ? sensFn() : []; } catch (e) { sens = []; }
      for (var i = 0; i < sens.length; i++) {
        var w = sens[i];
        if (w && String(w).length >= 2) s = s.split(String(w)).join('[已屏蔽文字]');
      }
      s = s.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '[邮箱]')
        .replace(/\b1[3-9]\d{9}\b/g, '[手机号]')
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=\-]{8,}/gi, '$1 [令牌]')
        .replace(/((?:api[_\-]?key|token|secret|password|passwd|pwd|cookie|authorization|session)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1[已屏蔽]')
        .replace(/-?\d{1,3}\.\d{4,}\s*[,，]\s*-?\d{1,3}\.\d{4,}/g, '[坐标]')
        .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '[长串已屏蔽]');
      return s;
    } catch (e) { return '[脱敏失败，内容已省略]'; }
  }

  /* ---------- 异步环境信息（提前缓存，保证点击复制时是同步的） ---------- */
  function refreshAsync() {
    try {
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then(function (v) { asyncInfo.persisted = String(v); }, function () { asyncInfo.persisted = '查询失败'; });
      } else asyncInfo.persisted = '不支持';
    } catch (e) { /* 忽略 */ }
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'camera' }).then(function (r) { asyncInfo.cam = r.state; }, function () { asyncInfo.cam = '无法查询'; });
      } else asyncInfo.cam = '不支持查询';
    } catch (e) { asyncInfo.cam = '无法查询'; }
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (r) {
          asyncInfo.sw = r ? ('已注册 ' + (r.active ? 'active' : r.installing ? 'installing' : r.waiting ? 'waiting' : '?')) : '未注册';
        }, function () { asyncInfo.sw = '查询失败'; });
      } else asyncInfo.sw = '不支持';
    } catch (e) { /* 忽略 */ }
  }
  refreshAsync();
  setInterval(refreshAsync, 15000);

  /* ---------- 生成报告 ---------- */
  function env() {
    var o = [];
    function add(k, f) { try { o.push('- ' + k + ': ' + f()); } catch (e) { o.push('- ' + k + ': [读取失败]'); } }
    add('浏览器', function () { return navigator.userAgent; });
    add('平台', function () { return navigator.platform || '?'; });
    add('语言', function () { return navigator.language; });
    add('屏幕/视口/像素比', function () { return screen.width + 'x' + screen.height + ' / ' + innerWidth + 'x' + innerHeight + ' / ' + (window.devicePixelRatio || 1); });
    add('已添加到主屏幕(独立App模式)', function () { return String(!!(window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches))); });
    add('安全连接(https)', function () { return String(window.isSecureContext); });
    add('当前网址', function () { return stripQuery(location.href); });
    add('是否联网', function () { return String(navigator.onLine); });
    add('相机接口(getUserMedia)', function () { return String(!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)); });
    add('分享接口(share)', function () { return String(!!navigator.share) + ' / 可分享文件: ' + String(!!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] }))); });
    add('剪贴板接口', function () { return String(!!(navigator.clipboard && navigator.clipboard.writeText)); });
    add('相机权限状态', function () { return asyncInfo.cam || '未知'; });
    add('离线缓存(Service Worker)', function () { return asyncInfo.sw || '未知'; });
    add('存储是否持久', function () { return asyncInfo.persisted || '未知'; });
    return o.join('\n');
  }

  function build() {
    var out = [];
    try {
      out.push('# ' + APP.name + ' 诊断报告');
      out.push('- 版本号: ' + APP.version);
      out.push('- 生成时间: ' + new Date().toString());
      out.push('- 已运行: ' + Math.round((Date.now() - T0) / 1000) + ' 秒');
      out.push('');
      out.push('## 运行环境');
      out.push(env());
      out.push('');
      out.push('## 当前状态与配置快照');
      var st = '';
      try { st = stateFn ? JSON.stringify(stateFn(), null, 1) : '（未提供）'; } catch (e) { st = '[读取状态失败: ' + str(e) + ']'; }
      out.push(st);
      out.push('');
      out.push('## 最近用户操作（最近 ' + acts.length + ' 条）');
      out.push(acts.length ? acts.join('\n') : '（无）');
      out.push('');
      out.push('## 最近错误及堆栈（' + errs.length + ' 条）');
      if (!errs.length) out.push('（无）');
      errs.forEach(function (e) {
        out.push(e.t + ' [' + e.m + '] ' + e.s);
        if (e.k) out.push(e.k);
      });
      out.push('');
      out.push('## 最近日志（' + logs.length + ' 条，最多 ' + MAX_LOG + '）');
      logs.forEach(function (l) { out.push(l.t + ' [' + l.l + '] [' + l.m + '] ' + l.s); });
      out.push('');
      out.push('已脱敏字段：' + REDACTED);
    } catch (e) {
      out.push('[报告生成过程出错: ' + str(e) + ']');
    }
    return redact(out.join('\n'));
  }

  /* ---------- 复制：clipboard → execCommand → 手动框 ---------- */
  var toastEl = null, toastTimer = 0;
  function toast(msg) {
    try {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'diag-toast';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
    } catch (e) { /* 忽略 */ }
  }

  function manualBox(text) {
    try {
      var old = document.getElementById('diagManual');
      if (old) old.remove();
      var wrap = document.createElement('div');
      wrap.id = 'diagManual';
      wrap.className = 'diag-modal';
      wrap.innerHTML = '<div class="diag-card"><p><b>自动复制没成功，请手动复制：</b><br>点下面的“全选”，再点弹出的“拷贝”，然后粘贴给我。</p>' +
        '<textarea readonly></textarea><div class="diag-row"><button type="button" data-a="sel">全选</button><button type="button" data-a="close">关闭</button></div></div>';
      document.body.appendChild(wrap);
      var ta = wrap.querySelector('textarea');
      ta.value = text;
      function selectAll() {
        try { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); } catch (e) { /* 忽略 */ }
      }
      wrap.addEventListener('click', function (ev) {
        var a = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-a');
        if (a === 'sel') selectAll();
        if (a === 'close') wrap.remove();
      });
      setTimeout(selectAll, 50);
    } catch (e) { /* 忽略 */ }
  }

  function execCopy(text) {
    var ta = null;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) {
      try { if (ta) ta.remove(); } catch (e2) { /* 忽略 */ }
      return false;
    }
  }

  function copyReport() {
    var text;
    try { text = build(); } catch (e) { text = '[报告生成失败] ' + str(e); }
    action('点击复制诊断报告', text.length + ' 字');
    function viaExec() {
      if (execCopy(text)) { log('INFO', 'diag', '复制成功(execCommand)'); toast('已复制诊断报告，请粘贴给我'); return; }
      log('WARN', 'diag', '自动复制失败，改为手动复制框');
      manualBox(text);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () {
          log('INFO', 'diag', '复制成功(clipboard)');
          toast('已复制诊断报告，请粘贴给我');
        }, function (err) {
          log('WARN', 'diag', 'clipboard 被拒绝: ' + str(err));
          viaExec();
        });
        return;
      }
    } catch (e) { log('WARN', 'diag', 'clipboard 异常: ' + str(e)); }
    viaExec();
  }

  function bindButtons() {
    try {
      var list = document.querySelectorAll('[data-diag-copy]');
      for (var i = 0; i < list.length; i++) list[i].addEventListener('click', copyReport);
    } catch (e) { /* 忽略 */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindButtons);
  else bindButtons();

  window.Diag = {
    info: function (m, s) { log('INFO', m, s); },
    warn: function (m, s) { log('WARN', m, s); },
    error: function (m, s) { recordError(m, s && s.message ? (s.name + ': ' + s.message) : s, s && s.stack); },
    log: log,
    action: action,
    toast: toast,
    setState: function (fn) { stateFn = fn; },
    setSensitive: function (fn) { sensFn = fn; },
    report: build,
    copy: copyReport,
    refresh: refreshAsync
  };
  log('INFO', 'boot', APP.name + ' v' + APP.version + ' 启动');
})();
