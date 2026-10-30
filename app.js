/* 水印相机主程序 v1.1。不使用定位，不上传任何数据。 */
(function () {
  'use strict';
  var D = window.Diag || { info: function () {}, warn: function () {}, error: function () {}, action: function () {}, log: function () {}, setState: function () {}, setSensitive: function () {} };
  var APP = window.APP_INFO || { name: '水印相机', version: '?' };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return p2(Math.floor(sec / 60)) + ':' + p2(sec % 60); }

  /* ================= 设置存取 ================= */
  var KEY = 'wmcam.settings.v1';
  var storageOk = true, memStore = {};
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { storageOk = false; return memStore[k] || null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) { storageOk = false; memStore[k] = v; D.warn('store', '本地存储不可用: ' + (e && e.name)); } }

  var DEF = {
    v: 2, addrs: [], cur: '',
    show: { time: true, date: true, week: true, addr: true, note: false, idmark: true },
    note: '', side: '水印相机', accent: '#F5A623', scale: 1, quality: 0.92, after: 'next', vq: '1080', facing: 'environment',
    alTime: 'photo', alCustom: '', alAddr: '', alFb: '', alManual: '', alExtra: ''
  };
  var S = JSON.parse(JSON.stringify(DEF));
  function loadSettings() {
    try {
      var raw = sget(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        Object.keys(DEF).forEach(function (k) {
          if (o[k] === undefined) return;
          if (k === 'show') { Object.keys(DEF.show).forEach(function (s) { if (o.show && o.show[s] !== undefined) S.show[s] = !!o.show[s]; }); }
          else S[k] = o[k];
        });
        if (o.autoPrev === true && o.after === undefined) S.after = 'preview';
        if (!Array.isArray(S.addrs)) S.addrs = [];
        if (S.v < 2) S.side = o.side === undefined ? DEF.side : o.side;
        S.v = 2;
      }
      D.info('settings', '已读取设置，地址 ' + S.addrs.length + ' 个');
    } catch (e) { D.error('settings', e); }
  }
  function saveSettings() { try { sset(KEY, JSON.stringify(S)); } catch (e) { D.error('settings', e); } }

  function curAddr() {
    var a = null;
    for (var i = 0; i < S.addrs.length; i++) if (S.addrs[i].id === S.cur) a = S.addrs[i];
    if (!a && S.addrs.length) a = S.addrs[0];
    return a;
  }
  function curAddrText() { var a = curAddr(); return a ? a.text : ''; }
  function wmOpts() { return { scale: S.scale, accent: S.accent, show: S.show }; }

  /* 14位随机编号（只用来区分照片，不具备验证作用） */
  var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function genCode() {
    var a = new Uint8Array(14), s = '', i;
    try { crypto.getRandomValues(a); } catch (e) { for (i = 0; i < 14; i++) a[i] = Math.floor(Math.random() * 256); }
    for (i = 0; i < 14; i++) s += ALPHA.charAt(a[i] % 32);
    return s;
  }
  var nextCode = genCode();
  function wmInfo(d, addrOverride, code) {
    return { time: d, addr: addrOverride !== undefined ? addrOverride : curAddrText(), note: S.note, side: S.side, code: code || nextCode };
  }

  /* ================= 提示 ================= */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3200);
  }

  /* ================= 标签页 ================= */
  var curTab = 'cam';
  function goTab(name) {
    if (name === curTab) return;
    D.action('切换页面', name);
    var leaving = curTab; curTab = name;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
    $$('.tabbar button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    if (leaving === 'cam') { stopRecord(); stopStream(); }
    if (name === 'cam' && cam.want) camStart();
    if (name === 'set') drawPreview();
    if (name === 'cam') fitFrame();
  }
  $$('.tabbar button').forEach(function (b) { b.addEventListener('click', function () { goTab(b.getAttribute('data-tab')); }); });

  /* ================= 地址管理 ================= */
  var editId = '';
  function renderChip() {
    var a = curAddr();
    $('#addrChipTxt').textContent = a ? (a.name + ' · ' + a.text) : '未设置地址，点此添加';
  }
  function addrItemHtml(a, withActs) {
    return '<div class="addr-item' + (curAddr() && curAddr().id === a.id ? ' on' : '') + '" data-id="' + esc(a.id) + '">' +
      '<span class="dot"></span><span class="t"><b>' + esc(a.name) + '</b><i>' + esc(a.text) + '</i></span>' +
      (withActs ? '<button type="button" data-act="edit">编辑</button><button type="button" class="del" data-act="del">删除</button>' : '') + '</div>';
  }
  function renderAddrs() {
    var html = S.addrs.length ? S.addrs.map(function (a) { return addrItemHtml(a, true); }).join('') :
      '<div class="empty">还没有地址。先在下面添加一个，水印上才会显示地址。</div>';
    $('#addrList').innerHTML = html;
    $('#pickList').innerHTML = S.addrs.map(function (a) { return addrItemHtml(a, false); }).join('');
    renderChip();
    renderAlOptions();
  }
  function selectAddr(id) {
    S.cur = id; saveSettings(); D.action('选择地址', '共' + S.addrs.length + '个');
    renderAddrs(); drawPreview(); drawOverlay();
  }
  $('#addrList').addEventListener('click', function (e) {
    var item = e.target.closest('.addr-item'); if (!item) return;
    var id = item.getAttribute('data-id'), act = e.target.getAttribute('data-act');
    if (act === 'edit') {
      var a = S.addrs.filter(function (x) { return x.id === id; })[0]; if (!a) return;
      editId = id; $('#addrName').value = a.name; $('#addrText').value = a.text;
      $('#addrSave').textContent = '保存修改'; $('#addrCancel').hidden = false; $('#addrName').focus();
      D.action('编辑地址');
    } else if (act === 'del') {
      if (!confirm('删除这个地址？')) return;
      S.addrs = S.addrs.filter(function (x) { return x.id !== id; });
      if (S.cur === id) S.cur = S.addrs.length ? S.addrs[0].id : '';
      saveSettings(); D.action('删除地址'); renderAddrs(); drawPreview(); drawOverlay();
    } else selectAddr(id);
  });
  $('#pickList').addEventListener('click', function (e) {
    var item = e.target.closest('.addr-item'); if (!item) return;
    selectAddr(item.getAttribute('data-id')); $('#pickSheet').hidden = true;
  });
  function resetAddrForm() {
    editId = ''; $('#addrName').value = ''; $('#addrText').value = '';
    $('#addrSave').textContent = '添加'; $('#addrCancel').hidden = true;
  }
  $('#addrSave').addEventListener('click', function () {
    var text = $('#addrText').value.trim(), name = $('#addrName').value.trim();
    if (!text) { toast('请先填写地址'); return; }
    if (!name) name = Array.from(text).slice(0, 6).join('');
    if (editId) {
      S.addrs.forEach(function (a) { if (a.id === editId) { a.name = name; a.text = text; } });
      D.action('保存地址修改');
    } else {
      var id = 'a' + Date.now();
      S.addrs.push({ id: id, name: name, text: text });
      if (!S.cur || S.addrs.length === 1) S.cur = id;
      D.action('添加地址', '共' + S.addrs.length + '个');
    }
    saveSettings(); resetAddrForm(); renderAddrs(); drawPreview(); drawOverlay(); toast('已保存');
  });
  $('#addrCancel').addEventListener('click', resetAddrForm);
  $('#addrChip').addEventListener('click', function () {
    if (rec.on) return;
    if (!S.addrs.length) { goTab('set'); setTimeout(function () { $('#addrName').focus(); }, 100); return; }
    $('#pickSheet').hidden = false;
  });
  $('#pickManage').addEventListener('click', function () { $('#pickSheet').hidden = true; goTab('set'); });
  $$('.sheet').forEach(function (s) {
    s.addEventListener('click', function (e) { if (e.target === s || e.target.hasAttribute('data-close')) s.hidden = true; });
  });

  /* ================= 设置页绑定 ================= */
  var ACCENTS = ['#F5A623', '#FFFFFF', '#FF5B5B', '#3ECF8E', '#4DA3FF', '#C77DFF'];
  function renderAccents() {
    $('#accents').innerHTML = ACCENTS.map(function (c) {
      return '<button type="button" data-c="' + c + '" class="' + (S.accent.toLowerCase() === c.toLowerCase() ? 'on' : '') + '" style="background:' + c + '" aria-label="颜色"></button>';
    }).join('');
  }
  $('#accents').addEventListener('click', function (e) {
    var c = e.target.getAttribute && e.target.getAttribute('data-c'); if (!c) return;
    S.accent = c; saveSettings(); renderAccents(); drawPreview(); drawOverlay(); D.action('改竖线颜色');
  });
  var CHK = { shTime: 'time', shDate: 'date', shWeek: 'week', shAddr: 'addr', shNote: 'note', shId: 'idmark' };
  Object.keys(CHK).forEach(function (id) {
    $('#' + id).addEventListener('change', function (e) {
      S.show[CHK[id]] = e.target.checked; saveSettings(); drawPreview(); drawOverlay(); D.action('开关水印项', CHK[id] + '=' + e.target.checked);
    });
  });
  function bindText(id, key) {
    $('#' + id).addEventListener('input', function (e) { S[key] = e.target.value; saveSettings(); drawPreview(); drawOverlay(); });
    $('#' + id).addEventListener('change', function () { D.action('修改文字设置', key); });
  }
  bindText('noteTxt', 'note'); bindText('sideTxt', 'side');
  $('#scaleRng').addEventListener('input', function (e) { S.scale = parseFloat(e.target.value); saveSettings(); drawPreview(); drawOverlay(); });
  $('#scaleRng').addEventListener('change', function () { D.action('调整水印大小', S.scale); });
  $('#qual').addEventListener('change', function (e) { S.quality = parseFloat(e.target.value); saveSettings(); D.action('修改照片质量', S.quality); });
  $('#after').addEventListener('change', function (e) { S.after = e.target.value; saveSettings(); D.action('拍完之后', S.after); });
  $('#vq').addEventListener('change', function (e) { S.vq = e.target.value; saveSettings(); D.action('视频清晰度', S.vq); });
  function syncSettingsUi() {
    $('#shTime').checked = S.show.time; $('#shDate').checked = S.show.date; $('#shWeek').checked = S.show.week;
    $('#shAddr').checked = S.show.addr; $('#shNote').checked = S.show.note; $('#shId').checked = S.show.idmark;
    $('#noteTxt').value = S.note; $('#sideTxt').value = S.side; $('#scaleRng').value = S.scale;
    $('#qual').value = String(S.quality); $('#after').value = S.after; $('#vq').value = S.vq;
    $('#alTime').value = S.alTime; $('#alExtra').value = S.alExtra; $('#alManual').value = S.alManual;
    $('#alCustom').value = S.alCustom || '';
    $('#alCustomRow').hidden = S.alTime !== 'custom';
    renderAlOptions();
    renderAccents();
  }

  /* ================= 水印预览 ================= */
  function drawPreview() {
    try {
      var cv = $('#prevCv'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#59616e'); g.addColorStop(0.5, '#8b919b'); g.addColorStop(1, '#3a3f48');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, H * 0.18, W * 0.55, H * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(W * 0.4, H * 0.45, W * 0.55, H * 0.22);
      var addr = curAddrText() || '示例：顺和横街19号, 四川省, 成都市 武侯区';
      WM.draw(ctx, W, H, wmInfo(new Date(), addr, 'ABCD2345EFGH67'), wmOpts());
    } catch (e) { D.error('preview', e); }
  }

  /* ================= 相机 ================= */
  var video = $('#video'), frame = $('#frame'), ovl = $('#ovl'), stage = $('#stage');
  var cam = { stream: null, want: false, starting: false, facing: 'environment', busy: false, tick: 0, mode: 'photo' };
  var MAX_SIDE = 4096, MAX_PIXELS = 16000000, MAX_VIDEO_SEC = 300;

  function setCamMsg(html) { $('#camMsg').innerHTML = html; }
  function showHint(on) { $('#camHint').hidden = !on; frame.hidden = on; }

  function fitFrame() {
    try {
      if (frame.hidden || !video.videoWidth) return;
      var cw = stage.clientWidth, ch = stage.clientHeight, ar = video.videoWidth / video.videoHeight;
      var w = cw, h = cw / ar;
      if (h > ch) { h = ch; w = ch * ar; }
      frame.style.width = Math.floor(w) + 'px'; frame.style.height = Math.floor(h) + 'px';
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      ovl.width = Math.round(w * dpr); ovl.height = Math.round(h * dpr);
      drawOverlay();
    } catch (e) { D.error('cam', e); }
  }
  function drawOverlay() {
    try {
      if (frame.hidden || !ovl.width) return;
      var ctx = ovl.getContext('2d');
      ctx.clearRect(0, 0, ovl.width, ovl.height);
      WM.draw(ctx, ovl.width, ovl.height, wmInfo(new Date(), undefined, rec.on ? rec.code : nextCode), wmOpts());
    } catch (e) { D.error('overlay', e); }
  }
  window.addEventListener('resize', fitFrame);

  function stopStream() {
    try {
      clearInterval(cam.tick);
      if (cam.stream) { cam.stream.getTracks().forEach(function (t) { t.stop(); }); D.info('cam', '相机已关闭'); }
      cam.stream = null; video.srcObject = null;
      $('#shutter').disabled = true; showHint(true);
      setCamMsg(cam.want ? '相机已暂停，点下面按钮继续。' : '点下面的按钮开启相机。<br>不需要定位权限，只会请求“相机”。');
      $('#camStart').textContent = cam.want ? '继续使用相机' : '开启相机';
    } catch (e) { D.error('cam', e); }
  }
  function camFail(e) {
    cam.starting = false; cam.stream = null;
    var n = e && e.name || '', msg;
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') msg = '相机权限被拒绝。<br>请到 iPhone“设置 → Safari → 相机”改成“询问”或“允许”，回来再点“开启相机”。<br>或者直接用下面的“系统相机”。';
    else if (n === 'NotFoundError' || n === 'OverconstrainedError') msg = '找不到可用的镜头。可以试试切换镜头，或用“系统相机”。';
    else if (n === 'NotReadableError' || n === 'AbortError') msg = '相机正被别的应用占用，关掉其他用相机的应用后再试。';
    else msg = '相机没能打开（' + esc(n || '未知原因') + '）。可以用“系统相机”代替。';
    D.error('cam', e || new Error('相机失败'));
    showHint(true); setCamMsg(msg); $('#camStart').textContent = '重试开启相机';
  }
  function camStart() {
    if (cam.starting) return;
    cam.starting = true; cam.want = true;
    D.action('开启相机', cam.facing);
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      camFail({ name: '不支持' }); setCamMsg('这个环境不支持网页相机（需要 https 网址）。请用“系统相机”。'); return;
    }
    if (cam.stream) { cam.stream.getTracks().forEach(function (t) { t.stop(); }); cam.stream = null; }
    setCamMsg('正在开启相机…');
    var t0 = Date.now();
    md.getUserMedia({ audio: false, video: { facingMode: { ideal: cam.facing }, width: { ideal: 4096 }, height: { ideal: 3072 } } })
      .catch(function (e) {
        if (e && e.name === 'OverconstrainedError') { D.warn('cam', '分辨率要求过高，降级重试'); return md.getUserMedia({ audio: false, video: { facingMode: cam.facing } }); }
        throw e;
      })
      .then(function (stream) {
        cam.stream = stream; video.srcObject = stream;
        video.classList.toggle('mirror', cam.facing === 'user');
        var p = video.play(); return p && p.then ? p : null;
      })
      .then(function () {
        var tr = cam.stream && cam.stream.getVideoTracks()[0];
        var st = tr && tr.getSettings ? tr.getSettings() : {};
        D.info('cam', '相机已开启 ' + (st.width || '?') + 'x' + (st.height || '?') + ' 镜头=' + (st.facingMode || cam.facing) + ' 耗时' + (Date.now() - t0) + 'ms');
        cam.starting = false;
        var ready = function () {
          if (!video.videoWidth) return;
          showHint(false); fitFrame(); $('#shutter').disabled = false;
          clearInterval(cam.tick); cam.tick = setInterval(drawOverlay, 1000);
        };
        if (video.videoWidth) ready(); else { video.addEventListener('loadedmetadata', ready, { once: true }); setTimeout(ready, 800); }
      })
      .catch(camFail);
  }
  $('#camStart').addEventListener('click', camStart);
  $('#flip').addEventListener('click', function () {
    if (rec.on) { toast('录像中不能切换镜头'); return; }
    cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; S.facing = cam.facing; saveSettings();
    D.action('切换镜头', cam.facing);
    if (cam.want) { stopStreamKeep(); camStart(); }
  });
  function stopStreamKeep() { try { if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); }); cam.stream = null; clearInterval(cam.tick); } catch (e) { /* */ } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (rec.on) { D.warn('rec', '页面切到后台，自动结束录像'); stopRecord(); } if (cam.stream) stopStream(); }
    else if (curTab === 'cam' && cam.want && !cam.stream) camStart();
  });

  /* 拍照 / 视频 模式 */
  function setMode(m) {
    cam.mode = m; D.action('切换拍摄模式', m);
    $$('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
    $('#shutter').classList.toggle('video', m === 'video');
  }
  $('#modeSeg').addEventListener('click', function (e) {
    var m = e.target.getAttribute && e.target.getAttribute('data-mode'); if (m && !rec.on) setMode(m);
  });
  $('#shutter').addEventListener('click', function () {
    if (cam.mode === 'video') { if (rec.on) stopRecord(); else startRecord(); } else shoot();
  });

  /* ================= 照片仓库 ================= */
  var items = [], batch = [], MAX_ITEMS = 24, MAX_BYTES = 600 * 1048576, seq = 0;
  function sizeText(b) { return (b.size / 1048576).toFixed(1) + 'MB'; }

  function makeThumb(cv) {
    try {
      var s = 260 / Math.min(cv.width, cv.height), t = document.createElement('canvas');
      t.width = Math.max(1, Math.round(cv.width * s)); t.height = Math.max(1, Math.round(cv.height * s));
      t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
      var u = t.toDataURL('image/jpeg', 0.7); t.width = 0; return u;
    } catch (e) { D.warn('thumb', '缩略图失败 ' + e.message); return ''; }
  }
  function totalBytes() { return items.reduce(function (a, b) { return a + b.blob.size; }, 0); }
  function dropItem(old, why) {
    items = items.filter(function (x) { return x !== old; }); batch = batch.filter(function (x) { return x !== old; });
    try { URL.revokeObjectURL(old.url); } catch (e) { /* */ }
    D.info('store', '已丢弃一项(' + why + ')，' + (old.saved ? '已保存过' : '未保存'));
  }
  /* o: {blob, thumb, w, h, time, src, note, kind:'photo'|'video', dur, ext, code} */
  function addItem(o) {
    seq++;
    var ext = o.ext || '.jpg';
    var it = { id: 'i' + seq, blob: o.blob, url: URL.createObjectURL(o.blob), thumb: o.thumb || '', w: o.w, h: o.h, time: o.time, src: o.src, note: o.note || '',
      kind: o.kind || 'photo', dur: o.dur || 0, code: o.code || '', saved: false, name: 'WM_' + Util.fileStamp(o.time) + '_' + seq + ext };
    items.unshift(it);
    while (items.length > MAX_ITEMS || (items.length > 1 && totalBytes() > MAX_BYTES)) {
      var cand = null, i;
      for (i = items.length - 1; i > 0; i--) if (items[i].saved) { cand = items[i]; break; }
      if (!cand) cand = items[items.length - 1];
      if (cand === it) break;
      dropItem(cand, '数量或内存超限');
      if (!cand.saved) toast('暂存太多，已丢弃一项未保存的，请及时保存');
    }
    updateQueueUi();
    return it;
  }
  function removeItem(it) { dropItem(it, '手动删除'); updateQueueUi(); renderGrids(); }
  function unsaved() { return items.filter(function (x) { return !x.saved; }); }
  function updateQueueUi() {
    var b = $('#thumbBtn');
    b.style.backgroundImage = items.length && items[0].thumb ? 'url(' + items[0].thumb + ')' : 'none';
    $('#thumbCount').textContent = items.length;
    b.classList.toggle('zero', !items.length);
    var n = unsaved().length;
    $('#pendBar').hidden = n === 0;
    $('#pendTxt').textContent = '有 ' + n + ' 项还没存进相册';
  }
  function gridHtml(list) {
    return list.map(function (it) {
      return '<div class="it" data-id="' + it.id + '" style="background-image:url(' + it.thumb + ')">' + (it.saved ? '<em>已存</em>' : '') +
        (it.kind === 'video' ? '<b>▶ ' + mmss(it.dur) + '</b>' : '') +
        '<u>' + p2(it.time.getHours()) + ':' + p2(it.time.getMinutes()) + ' ' + esc(it.note) + '</u></div>';
    }).join('');
  }
  function renderGrids() {
    $('#galGrid').innerHTML = gridHtml(items);
    $('#galTitle').textContent = '已拍/已处理（' + items.length + '）';
    $('#alGrid').innerHTML = gridHtml(batch);
    $('#alRes').hidden = !batch.length;
    $('#alResTitle').textContent = '处理结果（' + batch.length + ' 项）';
  }
  function itemById(id) { return items.filter(function (x) { return x.id === id; })[0]; }
  ['#galGrid', '#alGrid'].forEach(function (sel) {
    $(sel).addEventListener('click', function (e) {
      var c = e.target.closest('.it'); if (!c) return;
      var it = itemById(c.getAttribute('data-id')); if (it) openViewer(it);
    });
  });
  $('#thumbBtn').addEventListener('click', function () {
    D.action('打开已拍列表', items.length + '项');
    if (!items.length) { toast('还没有照片'); return; }
    renderGrids(); $('#galSheet').hidden = false;
  });
  $('#pendSave').addEventListener('click', function () { saveItems(unsaved().reverse(), '待保存'); });

  /* ---------- 查看 / 保存 ---------- */
  var viewing = null, viewImg = $('#viewImg'), viewVid = $('#viewVid');
  function openViewer(it) {
    viewing = it;
    var isV = it.kind === 'video';
    viewImg.hidden = isV; viewVid.hidden = !isV;
    if (isV) { viewVid.src = it.url; } else { viewImg.src = it.url; }
    $('#viewInfo').textContent = it.name + ' · ' + (it.w + '×' + it.h) + ' · ' + sizeText(it.blob) + (isV ? ' · ' + mmss(it.dur) : '') + (it.saved ? ' · 已保存' : '') + (it.note ? ' · ' + it.note : '') + (it.code ? ' · 编号 ' + it.code : '');
    $('#viewTip').textContent = isV ? '点“保存到相册”，在弹出的菜单里选“存储视频”。' : '点“保存到相册”，在弹出的菜单里选“存储图像”。也可以长按上面的图片保存。';
    $('#viewer').hidden = false; D.action('查看', it.kind + ' ' + it.id);
  }
  function closeViewer() {
    $('#viewer').hidden = true;
    try { viewVid.pause(); viewVid.removeAttribute('src'); viewVid.load(); } catch (e) { /* */ }
    viewImg.removeAttribute('src'); viewing = null; renderGrids();
  }
  $('#viewClose').addEventListener('click', closeViewer);
  $('#viewDel').addEventListener('click', function () {
    if (!viewing) return; if (!confirm('删除这一项？（不会影响已保存到相册的）')) return;
    D.action('删除'); var it = viewing; closeViewer(); removeItem(it);
  });
  $('#viewSave').addEventListener('click', function () { if (viewing) saveItems([viewing], '单项'); });

  function downloadBlob(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) { /* */ } }, 4000);
  }
  function mimeOf(it) { return it.blob.type || (it.kind === 'video' ? 'video/mp4' : 'image/jpeg'); }
  function saveItems(list, label, auto) {
    if (!list.length) { toast('没有可保存的内容'); return; }
    var files;
    try { files = list.map(function (it) { return new File([it.blob], it.name, { type: mimeOf(it) }); }); }
    catch (e) { D.error('save', e); toast('保存失败：无法生成文件'); return; }
    D.action('保存到相册', label + ' ' + files.length + '项' + (auto ? '(自动)' : ''));
    var can = false;
    try { can = !!(navigator.canShare && navigator.share && navigator.canShare({ files: files })); } catch (e) { D.warn('save', 'canShare 异常 ' + e.message); }
    if (can) {
      navigator.share({ files: files }).then(function () {
        list.forEach(function (it) { it.saved = true; });
        D.info('save', '系统分享面板已完成'); toast('已交给系统。选了“存储图像/视频”，就已经在相册里了');
        updateQueueUi(); renderGrids();
        if (viewing) $('#viewInfo').textContent += ' · 已保存';
      }, function (e) {
        var n = e && e.name;
        if (n === 'AbortError') { D.info('save', '用户取消了分享面板'); return; }
        if (auto && n === 'NotAllowedError') { D.warn('save', '系统不允许自动弹出保存菜单，已放入待保存'); toast('系统不允许自动弹出，已放入“待保存”，点一键保存即可'); return; }
        D.error('save', e); if (!auto) fallbackSave(list);
      });
    } else { D.warn('save', '系统不支持分享文件，走备用方式'); if (!auto) fallbackSave(list); }
  }
  function fallbackSave(list) {
    if (list.length === 1) {
      if (!viewing) openViewer(list[0]);
      $('#viewTip').textContent = list[0].kind === 'video' ? '当前环境不能直接存相册：请点播放器右下角的“…”→ 下载。' : '请长按上面的照片，选“存储到照片”（或“添加到照片”）。';
      toast('请按页面提示手动保存');
    } else { zipItems(list); }
  }
  function zipItems(list) {
    if (!list.length) { toast('没有可打包的内容'); return; }
    D.action('打包ZIP', list.length + '项'); toast('正在打包…');
    Promise.all(list.map(function (it) { return it.blob.arrayBuffer().then(function (ab) { return { name: it.name, data: new Uint8Array(ab), date: it.time }; }); }))
      .then(function (files) {
        var zip = Util.buildZip(files), name = 'watermark_' + Util.fileStamp(new Date()) + '.zip';
        D.info('zip', '生成 ' + name + ' ' + sizeText(zip));
        downloadBlob(zip, name); toast('已生成ZIP，请在下载/文件里查看');
      })
      .catch(function (e) { D.error('zip', e); toast('打包失败，请改用“保存全部”'); });
  }
  $('#galSaveAll').addEventListener('click', function () { saveItems(items.slice().reverse(), '全部'); });
  $('#galZip').addEventListener('click', function () { zipItems(items.slice().reverse()); });
  $('#galClear').addEventListener('click', function () {
    var un = unsaved().length;
    if (!confirm(un ? '还有 ' + un + ' 项没保存，确定清空？' : '清空列表？（已保存的不受影响）')) return;
    D.action('清空列表', items.length + '项');
    items.forEach(function (it) { try { URL.revokeObjectURL(it.url); } catch (e) { /* */ } });
    items = []; batch = []; updateQueueUi(); renderGrids(); $('#galSheet').hidden = true;
  });
  $('#alSaveAll').addEventListener('click', function () { saveItems(batch.slice().reverse(), '补水印批量'); });
  $('#alZip').addEventListener('click', function () { zipItems(batch.slice().reverse()); });
  window.addEventListener('beforeunload', function (e) { if (unsaved().length) { e.preventDefault(); e.returnValue = ''; } });

  function afterCapture(it) {
    if (S.after === 'preview') openViewer(it);
    else if (S.after === 'share') saveItems([it], '拍完自动', true);
    else toast((it.kind === 'video' ? '视频' : '照片') + '已暂存（待保存 ' + unsaved().length + '）');
  }

  /* ---------- 拍照 ---------- */
  function flashAnim() {
    var f = $('#flash'); f.className = 'flash on';
    setTimeout(function () { f.className = 'flash off'; }, 60);
  }
  function shoot() {
    if (!cam.stream || !video.videoWidth || cam.busy) return;
    cam.busy = true; // 极短时间内禁止重复点击；拍完立刻回到可拍状态
    try {
      var d = new Date(), vw = video.videoWidth, vh = video.videoHeight, code = nextCode;
      nextCode = genCode();
      var sc = Math.min(1, MAX_SIDE / Math.max(vw, vh));
      var w = Math.round(vw * sc), h = Math.round(vh * sc);
      D.action('拍照', w + 'x' + h + ' 镜头=' + cam.facing);
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      WM.draw(ctx, w, h, wmInfo(d, undefined, code), wmOpts());
      flashAnim(); drawOverlay();
      var thumb = makeThumb(cv);
      cv.toBlob(function (blob) {
        cv.width = 0; cv.height = 0; cam.busy = false;
        if (!blob) { D.error('shoot', new Error('toBlob 返回空')); toast('拍照失败，请重试'); return; }
        var it = addItem({ blob: blob, thumb: thumb, w: w, h: h, time: d, src: 'live', kind: 'photo', code: code });
        D.info('shoot', '完成 ' + sizeText(blob));
        afterCapture(it);
      }, 'image/jpeg', S.quality);
    } catch (e) {
      cam.busy = false; D.error('shoot', e); toast('拍照出错，请重试');
    }
  }

  /* ---------- 录像（水印直接画进视频） ---------- */
  var rec = { on: false, stopping: false, mr: null, chunks: [], cv: null, layer: null, raf: 0, t0: 0, timer: 0, mime: '', audio: null, code: '', time: null, lastMin: -1, w: 0, h: 0, thumb: '' };
  function pickMime() {
    var c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    try { for (var i = 0; i < c.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) { /* */ }
    return '';
  }
  function extOf(mime) { return /mp4/i.test(mime || '') ? '.mp4' : '.webm'; }
  function vidSize(vw, vh) {
    var cap = S.vq === '720' ? 1280 : 1920, sc = Math.min(1, cap / Math.max(vw, vh));
    var w = Math.round(vw * sc), h = Math.round(vh * sc);
    return { w: w - (w % 2), h: h - (h % 2) };
  }
  function drawLayer(layer, W, H, time, addr, code) {
    var c = layer.getContext('2d'); c.clearRect(0, 0, W, H);
    WM.draw(c, W, H, wmInfo(time, addr, code), wmOpts());
  }
  function recUi(on) {
    $('#recBadge').hidden = !on;
    $('#shutter').classList.toggle('recording', on);
    $('#modeSeg').classList.toggle('off', on);
    $('#flip').disabled = on;
  }
  function startRecord() {
    if (!cam.stream || !video.videoWidth || rec.on || rec.starting) return;
    if (!window.MediaRecorder) { toast('这个系统不支持网页录像，请用“补水印”页的系统相机录'); D.warn('rec', '无 MediaRecorder'); return; }
    rec.starting = true;
    var mime = pickMime(), sz = vidSize(video.videoWidth, video.videoHeight);
    D.action('开始录像', sz.w + 'x' + sz.h + ' ' + (mime || '默认格式'));
    var begin = function (audioStream) {
      try {
        rec.time = new Date(); rec.code = nextCode; nextCode = genCode(); rec.w = sz.w; rec.h = sz.h; rec.mime = mime; rec.chunks = []; rec.thumb = '';
        rec.cv = document.createElement('canvas'); rec.cv.width = sz.w; rec.cv.height = sz.h;
        rec.layer = document.createElement('canvas'); rec.layer.width = sz.w; rec.layer.height = sz.h;
        var ctx = rec.cv.getContext('2d'); rec.lastMin = -1;
        var cs = rec.cv.captureStream(30);
        var tracks = cs.getVideoTracks().concat(audioStream ? audioStream.getAudioTracks() : []);
        rec.audio = audioStream;
        var opts = { videoBitsPerSecond: S.vq === '720' ? 4000000 : 8000000 };
        if (mime) opts.mimeType = mime;
        try { rec.mr = new MediaRecorder(new MediaStream(tracks), opts); } catch (e1) { D.warn('rec', 'MediaRecorder 参数不被接受，改用默认: ' + e1.message); rec.mr = new MediaRecorder(new MediaStream(tracks)); }
        rec.mr.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
        rec.mr.onerror = function (e) { D.error('rec', (e && e.error) || new Error('MediaRecorder 出错')); };
        rec.mr.onstop = finishRecord;
        rec.mr.start(1000);
        rec.on = true; rec.starting = false; rec.t0 = Date.now(); rec.stopping = false;
        recUi(true); $('#recTime').textContent = '00:00';
        rec.timer = setInterval(function () {
          var s = (Date.now() - rec.t0) / 1000; $('#recTime').textContent = mmss(s);
          if (s >= MAX_VIDEO_SEC) { toast('已录满 ' + MAX_VIDEO_SEC / 60 + ' 分钟，自动结束'); stopRecord(); }
        }, 250);
        var loop = function () {
          if (!rec.on) return;
          try {
            var now = new Date(), key = now.getHours() * 60 + now.getMinutes();
            if (key !== rec.lastMin) { rec.lastMin = key; drawLayer(rec.layer, sz.w, sz.h, now, undefined, rec.code); }
            ctx.drawImage(video, 0, 0, sz.w, sz.h);
            ctx.drawImage(rec.layer, 0, 0);
            if (!rec.thumb && Date.now() - rec.t0 > 500) rec.thumb = makeThumb(rec.cv);
          } catch (e2) { /* 单帧失败忽略 */ }
          rec.raf = requestAnimationFrame(loop);
        };
        loop();
        D.info('rec', '录像开始 音频=' + (audioStream && audioStream.getAudioTracks().length ? '有' : '无') + ' 格式=' + (rec.mr.mimeType || mime || '?'));
      } catch (e) {
        rec.starting = false; rec.on = false; recUi(false); D.error('rec', e); toast('无法开始录像：' + (e && e.name || '未知错误'));
        try { if (audioStream) audioStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e3) { /* */ }
      }
    };
    var md = navigator.mediaDevices;
    md.getUserMedia({ audio: true }).then(begin, function (e) {
      D.warn('rec', '麦克风不可用，录无声视频: ' + (e && e.name)); toast('没有麦克风权限，这段视频将没有声音'); begin(null);
    });
  }
  function stopRecord() {
    if (!rec.on || rec.stopping) return;
    rec.stopping = true; D.action('结束录像', mmss((Date.now() - rec.t0) / 1000));
    try { rec.mr.stop(); } catch (e) { D.error('rec', e); finishRecord(); }
  }
  function finishRecord() {
    try {
      cancelAnimationFrame(rec.raf); clearInterval(rec.timer);
      var dur = (Date.now() - rec.t0) / 1000, type = (rec.mr && rec.mr.mimeType) || rec.mime || 'video/mp4';
      var blob = new Blob(rec.chunks, { type: type });
      if (!rec.thumb) rec.thumb = makeThumb(rec.cv);
      if (rec.audio) rec.audio.getTracks().forEach(function (t) { t.stop(); });
      var o = { blob: blob, thumb: rec.thumb, w: rec.w, h: rec.h, time: rec.time, src: 'live', kind: 'video', dur: dur, ext: extOf(type), code: rec.code };
      rec.cv.width = 0; rec.layer.width = 0;
      rec.on = false; rec.stopping = false; rec.chunks = []; recUi(false);
      D.info('rec', '录像结束 ' + mmss(dur) + ' ' + sizeText(blob) + ' ' + type);
      if (blob.size < 2000) { D.error('rec', new Error('录像文件为空（' + blob.size + ' 字节）')); toast('录像失败：没有录到内容'); return; }
      afterCapture(addItem(o));
    } catch (e) { rec.on = false; rec.stopping = false; recUi(false); D.error('rec', e); toast('保存录像出错'); }
  }

  /* ================= 补水印（系统相机 / 相册；照片 + 视频） ================= */
  function addrById(id) { for (var i = 0; i < S.addrs.length; i++) if (S.addrs[i].id === id) return S.addrs[i]; return null; }
  function shortTxt(t, n) { var a = Array.from(t); return a.length > n ? a.slice(0, n).join('') + '…' : t; }
  /* 补水印的“地址用”下拉：每个常用地址一项 + 照片位置 + 手动输入 */
  function renderAlOptions() {
    try {
      var sel = $('#alAddr'), html = '';
      S.addrs.forEach(function (a) { html += '<option value="addr:' + esc(a.id) + '">' + esc(a.name + ' · ' + shortTxt(a.text, 10)) + '</option>'; });
      html += '<option value="photo">照片/视频里的位置（只到区县）</option><option value="manual">本次手动输入</option>';
      sel.innerHTML = html;
      var v = S.alAddr, ok = false;
      if (v === 'current' || v === '') v = S.addrs.length ? 'addr:' + (curAddr() ? curAddr().id : S.addrs[0].id) : 'manual';
      Array.prototype.forEach.call(sel.options, function (o) { if (o.value === v) ok = true; });
      if (!ok) v = S.addrs.length ? 'addr:' + S.addrs[0].id : 'manual';
      S.alAddr = v; sel.value = v;
      var fb = '<option value="">设置里当前选中的地址</option>';
      S.addrs.forEach(function (a) { fb += '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>'; });
      fb += '<option value="none">不显示地址</option>';
      $('#alFb').innerHTML = fb;
      if (S.alFb && S.alFb !== 'none' && !addrById(S.alFb)) S.alFb = '';
      $('#alFb').value = S.alFb;
      $('#alManualRow').hidden = v !== 'manual';
      $('#alExtraRow').hidden = v !== 'photo';
      $('#alFbRow').hidden = v !== 'photo';
      $('#alGpsTip').hidden = v !== 'photo';
      updateAlTip();
    } catch (e) { D.error('alopts', e); }
  }
  function updateAlTip() {
    var el = $('#alTip'), v = S.alAddr;
    if (v === 'photo') el.textContent = '有位置：地址 = 位置换算出的“省 市 区”' + (S.alExtra ? ' + 你填的补充文字' : '') + '（只到区县，靠近边界可能不准）。没带位置：如果填了补充文字，就只显示补充文字；没填则用“没带位置时”选的地址。';
    else if (v === 'manual') el.textContent = '这一批都显示你在上面填的地址。';
    else { var a = addrById(v.slice(5)); el.textContent = a ? '这一批都显示：' + a.text : '请先在“设置”里添加常用地址。'; }
  }
  /* 按设置决定一张照片/一个视频的地址。meta: {lat,lng} 或 null */
  function alAddrFor(meta, stat) {
    var mode = S.alAddr, extra = (S.alExtra || '').trim();
    if (mode === 'photo') {
      if (meta && meta.lat !== null && meta.lat !== undefined) {
        var r = Util.regionFromLatLng(meta.lat, meta.lng);
        if (r) return { text: r.text + (extra ? ' ' + extra : ''), note: '位置' };
        stat.noRegion++;
      } else stat.noGps++;
      if (extra) return { text: extra, note: '补充文字' };
      if (S.alFb === 'none') return { text: '', note: '无地址' };
      var fa = S.alFb ? addrById(S.alFb) : curAddr();
      return { text: fa ? fa.text : '', note: '备用地址' };
    }
    if (mode === 'manual') return { text: (S.alManual || '').trim(), note: '手动地址' };
    var a = addrById(String(mode).slice(5)) || curAddr();
    return { text: a ? a.text : '', note: a ? a.name : '无地址' };
  }
  function localInputValue(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  $('#alTime').addEventListener('change', function (e) {
    S.alTime = e.target.value; $('#alCustomRow').hidden = S.alTime !== 'custom';
    if (S.alTime === 'custom' && !S.alCustom) { S.alCustom = localInputValue(new Date()); $('#alCustom').value = S.alCustom; }
    saveSettings(); D.action('补水印时间来源', S.alTime);
  });
  $('#alCustom').addEventListener('change', function (e) { S.alCustom = e.target.value; saveSettings(); D.action('设置自定义时间'); });
  $('#alAddr').addEventListener('change', function (e) {
    S.alAddr = e.target.value; saveSettings(); renderAlOptions(); D.action('补水印地址来源', S.alAddr.indexOf('addr:') === 0 ? '常用地址' : S.alAddr);
  });
  $('#alFb').addEventListener('change', function (e) { S.alFb = e.target.value; saveSettings(); D.action('没带位置时的地址', S.alFb ? '已选' : '默认'); });
  $('#alManual').addEventListener('input', function (e) { S.alManual = e.target.value; saveSettings(); });
  $('#alExtra').addEventListener('input', function (e) { S.alExtra = e.target.value; saveSettings(); updateAlTip(); });

  $('#pickSys').addEventListener('click', function () { D.action('点击系统相机'); $('#fileSys').click(); });
  $('#camSys').addEventListener('click', function () { D.action('点击系统相机(拍照页)'); $('#fileSys').click(); });
  $('#pickAlbum').addEventListener('click', function () { D.action('点击从相册选择'); $('#fileAlbum').click(); });
  $('#fileSys').addEventListener('change', function (e) { var f = e.target.files; if (f && f.length) { goTab('album'); processFiles(f, 'sys'); } e.target.value = ''; });
  $('#fileAlbum').addEventListener('change', function (e) { var f = e.target.files; if (f && f.length) processFiles(f, 'album'); e.target.value = ''; });

  function isVideoFile(f) { return /^video\//i.test(f.type || '') || /\.(mov|mp4|m4v|webm)$/i.test(f.name || ''); }
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) { /* */ } reject(new Error('无法读取图片（格式不支持或文件损坏）')); };
      img.src = url;
    });
  }
  function toBlobP(cv, q) { return new Promise(function (res) { cv.toBlob(res, 'image/jpeg', q); }); }

  /* 决定水印时间。返回 {date, src:'meta'|'file'|'now'|'custom', exactSec:是否带真实秒数} */
  var TLABEL = { meta: '拍摄时间', file: '文件时间', now: '现在', custom: '自定义' };
  function pickTime(file, exTime, kind) {
    if (S.alTime === 'custom') { var c = new Date(S.alCustom); if (!isNaN(c.getTime())) return { date: c, src: 'custom', exactSec: false }; }
    if (S.alTime === 'now') return { date: new Date(), src: 'now', exactSec: true };
    if (exTime) return { date: exTime, src: 'meta', exactSec: exTime.getSeconds() !== 0 };
    if (kind === 'sys') return { date: new Date(), src: 'now', exactSec: true };
    return { date: file.lastModified ? new Date(file.lastModified) : new Date(), src: 'file', exactSec: file.lastModified ? new Date(file.lastModified).getSeconds() !== 0 : true };
  }

  function processPhoto(file, kind, stat) {
    return Util.readExif(file).then(function (ex) {
      var tp = pickTime(file, ex.time, kind), time = tp.date, code = genCode();
      if (tp.src === 'file') stat.fileTime++;
      var ad = alAddrFor(ex, stat);
      var note = TLABEL[tp.src] + '·' + ad.note;
      D.info('album', '照片 ' + (file.size / 1048576).toFixed(1) + 'MB EXIF时间=' + (ex.time ? '有' : '无') + ' 位置=' + (ex.lat !== null ? '有' : '无') + ' 时间来源=' + tp.src + ' 地址来源=' + ad.note + ' 地址字数=' + ad.text.length);
      return loadImage(file).then(function (li) {
        var img = li.img, nw = img.naturalWidth, nh = img.naturalHeight;
        if (!nw || !nh) { try { URL.revokeObjectURL(li.url); } catch (e) { /* */ } throw new Error('图片尺寸为0'); }
        var sc = Math.min(1, MAX_SIDE / Math.max(nw, nh), Math.sqrt(MAX_PIXELS / (nw * nh)));
        var w = Math.round(nw * sc), h = Math.round(nh * sc);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try { URL.revokeObjectURL(li.url); } catch (e) { /* */ }
        WM.draw(ctx, w, h, wmInfo(time, ad.text, code), wmOpts());
        var thumb = makeThumb(cv);
        return toBlobP(cv, S.quality).then(function (blob) {
          cv.width = 0; cv.height = 0;
          if (!blob) throw new Error('生成图片失败（可能是图片太大）');
          return addItem({ blob: blob, thumb: thumb, w: w, h: h, time: time, src: kind, note: note, kind: 'photo', code: code });
        });
      });
    });
  }

  /* 视频补水印：在页面里把原视频“播放”一遍，同时把画面+水印录成新视频（所以耗时=原视频时长，需保持页面在前台） */
  function processVideo(file, kind, onProg, stat) {
    return Util.readVideoMeta(file).then(function (meta) {
      var tp = pickTime(file, meta.time, kind), code = genCode();
      if (tp.src === 'file') stat.fileTime++;
      var ad = alAddrFor(meta, stat), addr = ad.text;
      // 水印时间从拍摄时间开始随播放走动；没有真实秒数就随机取一个起始秒
      var base = new Date(tp.date.getTime());
      if (!tp.exactSec) base.setSeconds(Math.floor(Math.random() * 60), 0);
      var time = base, note = '视频·' + TLABEL[tp.src] + '·' + ad.note;
      D.info('album', '视频 ' + (file.size / 1048576).toFixed(1) + 'MB ' + meta.info + ' 时间来源=' + tp.src + ' 起始秒=' + base.getSeconds() + ' 地址来源=' + ad.note + ' 地址字数=' + addr.length + ' 时间模式=' + S.alTime);
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file), v = document.createElement('video');
        var finished = false, mr = null, chunks = [], raf = 0, wd = 0, ac = null, cv = null, layer = null, thumb = '', lastT = -1, lastMove = Date.now();
        function cleanup() {
          cancelAnimationFrame(raf); clearInterval(wd);
          try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* */ }
          try { URL.revokeObjectURL(url); } catch (e) { /* */ }
          try { if (ac) ac.close(); } catch (e) { /* */ }
        }
        function fail(err) { if (finished) return; finished = true; cleanup(); try { if (mr && mr.state !== 'inactive') mr.stop(); } catch (e) { /* */ } reject(err); }
        v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
        v.onerror = function () { fail(new Error('无法读取这个视频（格式不支持或文件损坏）')); };
        v.onloadedmetadata = function () {
          try {
            var vw = v.videoWidth, vh = v.videoHeight, dur = v.duration;
            if (!vw || !vh) throw new Error('读不到视频尺寸');
            if (!isFinite(dur) || dur <= 0) throw new Error('读不到视频时长');
            if (dur > 600) throw new Error('视频超过10分钟，请先剪成较短的几段再处理');
            var sz = vidSize(vw, vh);
            cv = document.createElement('canvas'); cv.width = sz.w; cv.height = sz.h;
            layer = document.createElement('canvas'); layer.width = sz.w; layer.height = sz.h;
            drawLayer(layer, sz.w, sz.h, time, addr, code);
            var layerKey = Math.floor(base.getTime() / 60000);
            var ctx = cv.getContext('2d');
            var cs = cv.captureStream(30), tracks = cs.getVideoTracks(), hasAudio = false;
            try {
              var AC = window.AudioContext || window.webkitAudioContext;
              ac = new AC(); if (ac.resume) ac.resume();
              var srcN = ac.createMediaElementSource(v), dst = ac.createMediaStreamDestination();
              srcN.connect(dst); // 只连到录制端，不连扬声器：处理时静音
              var at = dst.stream.getAudioTracks(); if (at.length) { tracks = tracks.concat(at); hasAudio = true; }
            } catch (ea) { D.warn('album', '读取原视频声音失败，输出将无声: ' + ea.message); v.muted = true; }
            var mime = pickMime(), opts = { videoBitsPerSecond: S.vq === '720' ? 4000000 : 8000000 };
            if (mime) opts.mimeType = mime;
            try { mr = new MediaRecorder(new MediaStream(tracks), opts); } catch (e1) { mr = new MediaRecorder(new MediaStream(tracks)); }
            mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
            mr.onerror = function (e) { fail((e && e.error) || new Error('录制出错')); };
            mr.onstop = function () {
              if (finished) return; finished = true; cleanup();
              var type = mr.mimeType || mime || 'video/mp4', blob = new Blob(chunks, { type: type });
              if (blob.size < 2000) { reject(new Error('处理后的视频为空')); return; }
              var w = sz.w, h = sz.h; cv.width = 0; layer.width = 0;
              resolve(addItem({ blob: blob, thumb: thumb, w: w, h: h, time: time, src: kind, note: note, kind: 'video', dur: dur, ext: extOf(type), code: code }));
            };
            mr.start(1000);
            D.info('album', '视频处理开始 ' + sz.w + 'x' + sz.h + ' 时长' + mmss(dur) + ' 声音=' + (hasAudio ? '有' : '无') + ' 格式=' + (mr.mimeType || mime || '?'));
            v.onended = function () { setTimeout(function () { try { if (mr.state !== 'inactive') mr.stop(); } catch (e) { fail(e); } }, 400); };
            var p = v.play(); if (p && p.catch) p.catch(function (e) { fail(new Error('无法播放视频：' + (e && e.name))); });
            var loop = function () {
              if (finished) return;
              try {
                var cur = new Date(base.getTime() + v.currentTime * 1000), key = Math.floor(cur.getTime() / 60000);
                if (key !== layerKey) { layerKey = key; drawLayer(layer, sz.w, sz.h, cur, addr, code); }
                ctx.drawImage(v, 0, 0, sz.w, sz.h); ctx.drawImage(layer, 0, 0);
                if (!thumb && v.currentTime > Math.min(1, dur / 2)) thumb = makeThumb(cv);
                if (v.currentTime !== lastT) { lastT = v.currentTime; lastMove = Date.now(); }
                onProg(Math.min(1, v.currentTime / dur));
              } catch (e2) { /* 单帧失败忽略 */ }
              raf = requestAnimationFrame(loop);
            };
            loop();
            wd = setInterval(function () { if (!v.ended && Date.now() - lastMove > 15000) fail(new Error('视频处理卡住了（页面可能被切到了后台），请保持本页面在前台再试')); }, 1000);
          } catch (e) { fail(e); }
        };
        v.src = url;
      });
    });
  }

  var working = false, pending = null;
  function processFiles(fileList, kind) {
    if (working) { toast('正在处理上一批，请稍等'); return; }
    var files = Array.prototype.slice.call(fileList);
    if (S.alTime === 'custom' && isNaN(new Date(S.alCustom).getTime())) { toast('请先选好“自定义时间”'); return; }
    var nv = files.filter(isVideoFile).length;
    if (nv) {
      pending = { files: files, kind: kind };
      $('#alStartTxt').textContent = '已选 ' + files.length + ' 项，其中 ' + nv + ' 个视频。视频要在页面里“播放一遍”来加水印，所以耗时和视频一样长，处理期间请保持本页面在前台、不要锁屏。';
      $('#alStart').hidden = false; $('#alProg').hidden = true; D.action('等待确认开始处理', files.length + '项 含视频' + nv);
      return;
    }
    runBatch(files, kind);
  }
  $('#alStartBtn').addEventListener('click', function () {
    if (!pending) return; var p = pending; pending = null; $('#alStart').hidden = true; runBatch(p.files, p.kind);
  });
  function runBatch(files, kind) {
    working = true; batch = [];
    var stat = { noGps: 0, noRegion: 0, fileTime: 0, fail: 0, errs: [] };
    var prog = $('#alProg'); prog.hidden = false; renderGrids();
    D.action('补水印开始', (kind === 'sys' ? '系统相机' : '相册') + ' ' + files.length + '项');
    $('#pickSys').disabled = $('#pickAlbum').disabled = true;
    var chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () {
        var head = '处理中 ' + (i + 1) + ' / ' + files.length;
        prog.textContent = head + ' …';
        var job = isVideoFile(f) ?
          processVideo(f, kind, function (r) { prog.textContent = head + '（视频 ' + Math.round(r * 100) + '%，请保持本页面在前台）'; }, stat) :
          processPhoto(f, kind, stat);
        return job.then(function (it) { batch.push(it); renderGrids(); }, function (e) {
          stat.fail++; stat.errs.push(e && e.message); D.error('album', e);
        }).then(function () { return new Promise(function (r) { setTimeout(r, 20); }); });
      });
    });
    chain.then(function () {
      var msg = '完成：成功 ' + batch.length + ' 项';
      if (stat.fail) msg += '，失败 ' + stat.fail + ' 项（' + esc(stat.errs[0] || '') + '）';
      if (stat.fileTime) msg += '；⚠ ' + stat.fileTime + ' 项没读到拍摄时间，用了文件时间（可能不准，可改用“自定义时间”）';
      if (S.alAddr === 'photo') {
        if (stat.noGps) msg += '；' + stat.noGps + ' 项没带位置';
        if (stat.noRegion) msg += '；' + stat.noRegion + ' 项位置换算不出区县';
      }
      prog.textContent = msg + '。点“保存全部”存进相册。';
      D.info('album', msg);
      working = false; $('#pickSys').disabled = $('#pickAlbum').disabled = false; renderGrids(); updateQueueUi();
    }).catch(function (e) {
      D.error('album', e); working = false; $('#pickSys').disabled = $('#pickAlbum').disabled = false;
      prog.textContent = '处理出错，请点右上角“复制诊断报告”发给我。';
    });
  }

  /* ================= 其它 ================= */
  $('#resetCache').addEventListener('click', function () {
    D.action('清除缓存并刷新');
    var jobs = [];
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) { /* */ }
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) { /* */ }
    Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
  });

  D.setState(function () {
    var tr = cam.stream && cam.stream.getVideoTracks ? cam.stream.getVideoTracks()[0] : null, st = {};
    try { st = tr && tr.getSettings ? tr.getSettings() : {}; } catch (e) { /* */ }
    return {
      当前页面: curTab,
      相机: { 想开启: cam.want, 运行中: !!cam.stream, 镜头: cam.facing, 模式: cam.mode, 视频尺寸: video.videoWidth + 'x' + video.videoHeight, 轨道设置: st },
      录像: { 支持MediaRecorder: !!window.MediaRecorder, 选用格式: pickMime() || '(默认)', 正在录像: rec.on, 清晰度设置: S.vq },
      常用地址个数: S.addrs.length, 当前地址字数: curAddrText().length,
      水印: { 显示项: S.show, 大小: S.scale, 颜色: S.accent, 备注字数: S.note.length, 右侧文字字数: S.side.length },
      保存: { 照片质量: S.quality, 拍完之后: S.after },
      补水印: { 时间来源: S.alTime, 已填自定义时间: !!S.alCustom, 地址来源: String(S.alAddr).indexOf('addr:') === 0 ? '常用地址' : S.alAddr, 补充文字字数: S.alExtra.length, 手动地址字数: S.alManual.length, 处理中: working },
      暂存: { 总数: items.length, 其中视频: items.filter(function (x) { return x.kind === 'video'; }).length, 未保存: unsaved().length, 本批: batch.length, 占用MB: Math.round(totalBytes() / 1048576) },
      本地存储可用: storageOk,
      定位权限: '本程序从不请求定位',
      区县数据条数: window.REGION_DATA && REGION_DATA.e ? REGION_DATA.e.length : 0
    };
  });
  D.setSensitive(function () {
    var a = S.addrs.map(function (x) { return x.text; });
    a.push(S.note, S.side, S.alExtra, S.alManual);
    return a;
  });

  function init() {
    loadSettings();
    cam.facing = S.facing === 'user' ? 'user' : 'environment';
    $('#verTxt').textContent = 'v' + APP.version;
    $('#aboutTxt').textContent = APP.name + ' v' + APP.version + ' · 不使用定位，不上传任何照片、视频或地址 · 区县数据来源 cpca（MIT 许可）';
    syncSettingsUi(); renderAddrs(); drawPreview(); updateQueueUi();
    if (!window.WM || !window.Util) D.error('init', new Error('脚本没加载完整（wm.js 或 util.js）'));
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(function (v) { D.info('store', '申请持久存储: ' + v); }); } catch (e) { /* */ }
    try {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('sw.js').then(function () { D.info('sw', '离线缓存已注册'); }, function (e) { D.warn('sw', '离线缓存注册失败: ' + (e && e.message)); });
      }
    } catch (e) { D.warn('sw', '注册异常 ' + e.message); }
    D.info('init', '界面就绪');
  }
  init();
})();
