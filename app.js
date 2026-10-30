/* 水印相机主程序。不使用定位，不上传任何数据。 */
(function () {
  'use strict';
  var D = window.Diag || { info: function () {}, warn: function () {}, error: function () {}, action: function () {}, log: function () {}, setState: function () {}, setSensitive: function () {} };
  var APP = window.APP_INFO || { name: '水印相机', version: '?' };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ================= 设置存取 ================= */
  var KEY = 'wmcam.settings.v1';
  var storageOk = true, memStore = {};
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { storageOk = false; return memStore[k] || null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) { storageOk = false; memStore[k] = v; D.warn('store', '本地存储不可用: ' + (e && e.name)); } }

  var DEF = {
    v: 1, addrs: [], cur: '',
    show: { time: true, date: true, week: true, addr: true, note: false },
    note: '', side: '', accent: '#F5A623', scale: 1, quality: 0.92, autoPrev: true, facing: 'environment',
    alTime: 'photo', alAddr: 'current', alExtra: ''
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
        if (!Array.isArray(S.addrs)) S.addrs = [];
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
  function wmInfo(d, addrOverride) {
    return { time: d, addr: addrOverride !== undefined ? addrOverride : curAddrText(), note: S.note, side: S.side };
  }

  /* ================= 提示 ================= */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3000);
  }

  /* ================= 标签页 ================= */
  var curTab = 'cam';
  function goTab(name) {
    if (name === curTab) return;
    D.action('切换页面', name);
    var leaving = curTab; curTab = name;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
    $$('.tabbar button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    if (leaving === 'cam') stopStream();
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
    updateAlTip();
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
  var CHK = { shTime: 'time', shDate: 'date', shWeek: 'week', shAddr: 'addr', shNote: 'note' };
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
  $('#autoPrev').addEventListener('change', function (e) { S.autoPrev = e.target.checked; saveSettings(); D.action('拍完预览开关', S.autoPrev); });
  function syncSettingsUi() {
    $('#shTime').checked = S.show.time; $('#shDate').checked = S.show.date; $('#shWeek').checked = S.show.week;
    $('#shAddr').checked = S.show.addr; $('#shNote').checked = S.show.note;
    $('#noteTxt').value = S.note; $('#sideTxt').value = S.side; $('#scaleRng').value = S.scale;
    $('#qual').value = String(S.quality); $('#autoPrev').checked = S.autoPrev;
    $('#alTime').value = S.alTime; $('#alAddr').value = S.alAddr; $('#alExtra').value = S.alExtra;
    $('#alExtraRow').hidden = S.alAddr !== 'photo';
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
      WM.draw(ctx, W, H, wmInfo(new Date(), addr), wmOpts());
    } catch (e) { D.error('preview', e); }
  }

  /* ================= 相机 ================= */
  var video = $('#video'), frame = $('#frame'), ovl = $('#ovl'), stage = $('#stage');
  var cam = { stream: null, want: false, starting: false, facing: 'environment', busy: false, tick: 0 };
  var MAX_SIDE = 4096, MAX_PIXELS = 16000000;

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
      WM.draw(ctx, ovl.width, ovl.height, wmInfo(new Date()), wmOpts());
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
    cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; S.facing = cam.facing; saveSettings();
    D.action('切换镜头', cam.facing);
    if (cam.want) { stopStreamKeep(); camStart(); }
  });
  function stopStreamKeep() { try { if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); }); cam.stream = null; clearInterval(cam.tick); } catch (e) { /* */ } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (cam.stream) stopStream(); }
    else if (curTab === 'cam' && cam.want && !cam.stream) camStart();
  });

  /* ================= 照片仓库 ================= */
  var items = [], batch = [], MAX_ITEMS = 24, seq = 0;
  function sizeText(b) { return (b.size / 1048576).toFixed(1) + 'MB'; }

  function makeThumb(cv) {
    try {
      var s = 260 / Math.min(cv.width, cv.height), t = document.createElement('canvas');
      t.width = Math.max(1, Math.round(cv.width * s)); t.height = Math.max(1, Math.round(cv.height * s));
      t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
      var u = t.toDataURL('image/jpeg', 0.7); t.width = 0; return u;
    } catch (e) { D.warn('thumb', '缩略图失败 ' + e.message); return ''; }
  }
  function addItem(blob, cv, time, src, note) {
    var thumb = makeThumb(cv), w = cv.width, h = cv.height;
    cv.width = 0; cv.height = 0; // 尽快释放画布内存（iPhone 对画布总内存有限制）
    seq++;
    var it = { id: 'i' + seq, blob: blob, url: URL.createObjectURL(blob), thumb: thumb, w: w, h: h, time: time, src: src, note: note || '', saved: false,
      name: 'WM_' + Util.fileStamp(time) + '_' + seq + '.jpg' };
    items.unshift(it);
    while (items.length > MAX_ITEMS) {
      var old = items.pop(); try { URL.revokeObjectURL(old.url); } catch (e) { /* */ }
      batch = batch.filter(function (b) { return b !== old; });
      D.info('store', '超过' + MAX_ITEMS + '张，已丢弃最早的一张（未保存的会丢失）');
    }
    updateThumbBtn();
    return it;
  }
  function removeItem(it) {
    items = items.filter(function (x) { return x !== it; }); batch = batch.filter(function (x) { return x !== it; });
    try { URL.revokeObjectURL(it.url); } catch (e) { /* */ }
    updateThumbBtn(); renderGrids();
  }
  function updateThumbBtn() {
    var b = $('#thumbBtn');
    b.style.backgroundImage = items.length && items[0].thumb ? 'url(' + items[0].thumb + ')' : 'none';
    $('#thumbCount').textContent = items.length;
    b.classList.toggle('zero', !items.length);
  }
  function gridHtml(list) {
    return list.map(function (it) {
      return '<div class="it" data-id="' + it.id + '" style="background-image:url(' + it.thumb + ')">' + (it.saved ? '<em>已存</em>' : '') +
        '<u>' + p2(it.time.getHours()) + ':' + p2(it.time.getMinutes()) + ' ' + esc(it.note) + '</u></div>';
    }).join('');
  }
  function renderGrids() {
    $('#galGrid').innerHTML = gridHtml(items);
    $('#galTitle').textContent = '已拍/已处理照片（' + items.length + '）';
    $('#alGrid').innerHTML = gridHtml(batch);
    $('#alRes').hidden = !batch.length;
    $('#alResTitle').textContent = '处理结果（' + batch.length + ' 张）';
  }
  function itemById(id) { return items.filter(function (x) { return x.id === id; })[0]; }
  ['#galGrid', '#alGrid'].forEach(function (sel) {
    $(sel).addEventListener('click', function (e) {
      var c = e.target.closest('.it'); if (!c) return;
      var it = itemById(c.getAttribute('data-id')); if (it) openViewer(it);
    });
  });
  $('#thumbBtn').addEventListener('click', function () {
    D.action('打开已拍列表', items.length + '张');
    if (!items.length) { toast('还没有照片'); return; }
    renderGrids(); $('#galSheet').hidden = false;
  });

  /* ---------- 查看 / 保存 ---------- */
  var viewing = null;
  function openViewer(it) {
    viewing = it; $('#viewImg').src = it.url;
    $('#viewInfo').textContent = it.name + ' · ' + it.w + '×' + it.h + ' · ' + sizeText(it.blob) + (it.saved ? ' · 已保存' : '');
    $('#viewTip').textContent = '点“保存到相册”，在弹出的菜单里选“存储图像”。也可以长按上面的图片保存。';
    $('#viewer').hidden = false; D.action('查看照片', it.id);
  }
  function closeViewer() { $('#viewer').hidden = true; $('#viewImg').removeAttribute('src'); viewing = null; renderGrids(); }
  $('#viewClose').addEventListener('click', closeViewer);
  $('#viewDel').addEventListener('click', function () {
    if (!viewing) return; if (!confirm('删除这张照片？（不会影响已保存到相册的）')) return;
    D.action('删除照片'); var it = viewing; closeViewer(); removeItem(it);
  });
  $('#viewSave').addEventListener('click', function () { if (viewing) saveItems([viewing], '单张'); });

  function downloadBlob(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) { /* */ } }, 4000);
  }
  function saveItems(list, label) {
    if (!list.length) { toast('没有可保存的照片'); return; }
    var files;
    try { files = list.map(function (it) { return new File([it.blob], it.name, { type: 'image/jpeg' }); }); }
    catch (e) { D.error('save', e); toast('保存失败：无法生成文件'); return; }
    D.action('保存到相册', label + ' ' + files.length + '张');
    var can = false;
    try { can = !!(navigator.canShare && navigator.share && navigator.canShare({ files: files })); } catch (e) { D.warn('save', 'canShare 异常 ' + e.message); }
    if (can) {
      navigator.share({ files: files }).then(function () {
        list.forEach(function (it) { it.saved = true; });
        D.info('save', '系统分享面板已完成'); toast('已交给系统。若选了“存储图像”，照片就在相册里了'); renderGrids();
        if (viewing) $('#viewInfo').textContent += ' · 已保存';
      }, function (e) {
        if (e && e.name === 'AbortError') { D.info('save', '用户取消了分享面板'); return; }
        D.error('save', e); fallbackSave(list);
      });
    } else { D.warn('save', '系统不支持分享文件，走备用方式'); fallbackSave(list); }
  }
  function fallbackSave(list) {
    if (list.length === 1) {
      if (!viewing) openViewer(list[0]);
      $('#viewTip').textContent = '请长按上面的照片，选“存储到照片”（或“添加到照片”）。';
      toast('请长按照片保存');
    } else { zipItems(list); }
  }
  function zipItems(list) {
    if (!list.length) { toast('没有可打包的照片'); return; }
    D.action('打包ZIP', list.length + '张'); toast('正在打包…');
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
    var un = items.filter(function (x) { return !x.saved; }).length;
    if (!confirm(un ? '还有 ' + un + ' 张没保存，确定清空？' : '清空列表？（已保存的照片不受影响）')) return;
    D.action('清空列表', items.length + '张');
    items.forEach(function (it) { try { URL.revokeObjectURL(it.url); } catch (e) { /* */ } });
    items = []; batch = []; updateThumbBtn(); renderGrids(); $('#galSheet').hidden = true;
  });
  $('#alSaveAll').addEventListener('click', function () { saveItems(batch.slice().reverse(), '补水印批量'); });
  $('#alZip').addEventListener('click', function () { zipItems(batch.slice().reverse()); });

  /* ---------- 拍照 ---------- */
  function flashAnim() {
    var f = $('#flash'); f.className = 'flash on';
    setTimeout(function () { f.className = 'flash off'; }, 60);
  }
  function shoot() {
    if (!cam.stream || !video.videoWidth || cam.busy) return;
    cam.busy = true; $('#shutter').disabled = true;
    try {
      var d = new Date(), vw = video.videoWidth, vh = video.videoHeight;
      var sc = Math.min(1, MAX_SIDE / Math.max(vw, vh));
      var w = Math.round(vw * sc), h = Math.round(vh * sc);
      D.action('拍照', w + 'x' + h + ' 镜头=' + cam.facing);
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      WM.draw(ctx, w, h, wmInfo(d), wmOpts());
      flashAnim();
      cv.toBlob(function (blob) {
        cam.busy = false; if (cam.stream) $('#shutter').disabled = false;
        if (!blob) { D.error('shoot', new Error('toBlob 返回空')); toast('拍照失败，请重试'); return; }
        var it = addItem(blob, cv, d, 'live', '');
        D.info('shoot', '完成 ' + sizeText(blob));
        if (S.autoPrev) openViewer(it); else toast('已拍 ' + items.length + ' 张，点左下角缩略图可批量保存');
      }, 'image/jpeg', S.quality);
    } catch (e) {
      cam.busy = false; if (cam.stream) $('#shutter').disabled = false;
      D.error('shoot', e); toast('拍照出错，请重试');
    }
  }
  $('#shutter').addEventListener('click', shoot);

  /* ================= 补水印（系统相机 / 相册） ================= */
  function updateAlTip() {
    var el = $('#alTip');
    if (S.alAddr === 'photo') el.textContent = '地址 = 照片位置换算出的“省 市 区”' + (S.alExtra ? ' + 你填的补充文字' : '') + '，只精确到区县，靠近边界可能不准。';
    else el.textContent = curAddr() ? '地址来自设置页里选中的常用地址：' + curAddr().name : '还没设置常用地址，水印上将不显示地址（去“设置”添加）。';
  }
  $('#alTime').addEventListener('change', function (e) { S.alTime = e.target.value; saveSettings(); D.action('补水印时间来源', S.alTime); });
  $('#alAddr').addEventListener('change', function (e) {
    S.alAddr = e.target.value; saveSettings(); $('#alExtraRow').hidden = S.alAddr !== 'photo'; updateAlTip(); D.action('补水印地址来源', S.alAddr);
  });
  $('#alExtra').addEventListener('input', function (e) { S.alExtra = e.target.value; saveSettings(); updateAlTip(); });

  $('#pickSys').addEventListener('click', function () { D.action('点击系统相机'); $('#fileSys').click(); });
  $('#camSys').addEventListener('click', function () { D.action('点击系统相机(拍照页)'); $('#fileSys').click(); });
  $('#pickAlbum').addEventListener('click', function () { D.action('点击从相册选择'); $('#fileAlbum').click(); });
  $('#fileSys').addEventListener('change', function (e) { var f = e.target.files; if (f && f.length) { goTab('album'); processFiles(f, 'sys'); } e.target.value = ''; });
  $('#fileAlbum').addEventListener('change', function (e) { var f = e.target.files; if (f && f.length) processFiles(f, 'album'); e.target.value = ''; });

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) { /* */ } reject(new Error('无法读取图片（格式不支持或文件损坏）')); };
      img.src = url;
    });
  }
  function toBlobP(cv, q) { return new Promise(function (res) { cv.toBlob(res, 'image/jpeg', q); }); }

  function processOne(file, kind, stat) {
    return Util.readExif(file).then(function (ex) {
      var time;
      if (S.alTime === 'now') time = new Date();
      else if (ex.time) time = ex.time;
      else if (kind === 'sys') time = new Date();
      else time = file.lastModified ? new Date(file.lastModified) : new Date();
      var addr = curAddrText(), note = '常用地址';
      if (S.alAddr === 'photo') {
        if (ex.lat !== null) {
          var r = Util.regionFromLatLng(ex.lat, ex.lng);
          if (r) { addr = r.text + (S.alExtra ? ' ' + S.alExtra : ''); note = '照片位置'; }
          else { stat.noRegion++; note = '位置无法换算→常用地址'; }
        } else { stat.noGps++; note = '无位置→常用地址'; }
      }
      D.info('album', '读取 ' + (file.size / 1048576).toFixed(1) + 'MB EXIF时间=' + (ex.time ? '有' : '无') + ' 位置=' + (ex.lat !== null ? '有' : '无') + ' 地址来源=' + note);
      return loadImage(file).then(function (li) {
        var img = li.img, nw = img.naturalWidth, nh = img.naturalHeight;
        if (!nw || !nh) { try { URL.revokeObjectURL(li.url); } catch (e) { /* */ } throw new Error('图片尺寸为0'); }
        var sc = Math.min(1, MAX_SIDE / Math.max(nw, nh), Math.sqrt(MAX_PIXELS / (nw * nh)));
        var w = Math.round(nw * sc), h = Math.round(nh * sc);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try { URL.revokeObjectURL(li.url); } catch (e) { /* */ }
        WM.draw(ctx, w, h, wmInfo(time, addr), wmOpts());
        return toBlobP(cv, S.quality).then(function (blob) {
          if (!blob) throw new Error('生成图片失败（可能是图片太大）');
          return addItem(blob, cv, time, kind, note);
        });
      });
    });
  }

  var working = false;
  function processFiles(fileList, kind) {
    if (working) { toast('正在处理上一批，请稍等'); return; }
    var files = Array.prototype.slice.call(fileList);
    working = true; batch = [];
    var stat = { noGps: 0, noRegion: 0, fail: 0 };
    var prog = $('#alProg'); prog.hidden = false; renderGrids();
    D.action('补水印开始', (kind === 'sys' ? '系统相机' : '相册') + ' ' + files.length + '张');
    $('#pickSys').disabled = $('#pickAlbum').disabled = true;
    var chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () {
        prog.textContent = '处理中 ' + (i + 1) + ' / ' + files.length + ' …';
        return processOne(f, kind, stat).then(function (it) { batch.push(it); renderGrids(); }, function (e) {
          stat.fail++; D.error('album', e);
        }).then(function () { return new Promise(function (r) { setTimeout(r, 20); }); });
      });
    });
    chain.then(function () {
      var msg = '完成：成功 ' + batch.length + ' 张';
      if (stat.fail) msg += '，失败 ' + stat.fail + ' 张';
      if (stat.noGps) msg += '；' + stat.noGps + ' 张没带位置，已改用常用地址';
      if (stat.noRegion) msg += '；' + stat.noRegion + ' 张位置换算不出区县';
      prog.textContent = msg + '。点“保存全部”存进相册。';
      D.info('album', msg);
      working = false; $('#pickSys').disabled = $('#pickAlbum').disabled = false; renderGrids();
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
      相机: { 想开启: cam.want, 运行中: !!cam.stream, 镜头: cam.facing, 视频尺寸: video.videoWidth + 'x' + video.videoHeight, 轨道设置: st },
      常用地址个数: S.addrs.length, 当前地址字数: curAddrText().length,
      水印: { 显示项: S.show, 大小: S.scale, 颜色: S.accent, 备注字数: S.note.length, 右侧文字字数: S.side.length },
      保存: { 质量: S.quality, 拍完预览: S.autoPrev },
      补水印: { 时间来源: S.alTime, 地址来源: S.alAddr, 补充文字字数: S.alExtra.length },
      照片暂存: { 总数: items.length, 未保存: items.filter(function (x) { return !x.saved; }).length, 本批: batch.length },
      本地存储可用: storageOk,
      定位权限: '本程序从不请求定位',
      区县数据条数: window.REGION_DATA && REGION_DATA.e ? REGION_DATA.e.length : 0
    };
  });
  D.setSensitive(function () {
    var a = S.addrs.map(function (x) { return x.text; });
    a.push(S.note, S.side, S.alExtra);
    return a;
  });

  function init() {
    loadSettings();
    cam.facing = S.facing === 'user' ? 'user' : 'environment';
    $('#verTxt').textContent = 'v' + APP.version;
    $('#aboutTxt').textContent = APP.name + ' v' + APP.version + ' · 不使用定位，不上传任何照片或地址 · 区县数据来源 cpca（MIT 许可）';
    syncSettingsUi(); renderAddrs(); drawPreview(); updateThumbBtn();
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
