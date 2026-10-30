/* 水印绘制：左下角大时间 + 彩色竖线 + 日期/星期 + 地址，右侧可选竖排文字。
   实时预览和最终保存用的是同一个函数，所以所见即所得。 */
(function () {
  'use strict';
  var FAM = '-apple-system,"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",sans-serif';
  var TIME_FAM = '"DIN Condensed","Avenir Next Condensed","Helvetica Neue","Arial Narrow",' + FAM;
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function p2(n) { return n < 10 ? '0' + n : '' + n; }

  /* 按像素宽度折行（中文逐字，英文数字遇到空格/逗号优先断） */
  function wrap(ctx, text, maxW) {
    var lines = [], cur = '';
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        lines.push(cur);
        cur = ch === ' ' ? '' : ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = Array.from(text);
    while (t.length > 1 && ctx.measureText(t.join('') + '…').width > maxW) t.pop();
    return t.join('') + '…';
  }

  /* info: {time: Date, addr: string, note: string, side: string}
     o: {scale, accent, show:{time,date,week,addr,note}} */
  function draw(ctx, W, H, info, o) {
    o = o || {};
    var show = o.show || {};
    var S = Math.min(W, H);
    var u = S / 1080 * (o.scale || 1);
    var accent = o.accent || '#F5A623';
    var d = info.time || new Date();

    var timeStr = p2(d.getHours()) + ':' + p2(d.getMinutes());
    var dateStr = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    var weekStr = '星期' + WEEK[d.getDay()];

    var sTime = show.time !== false;
    var sDate = show.date !== false;
    var sWeek = show.week !== false;
    var sAddr = show.addr !== false;
    var sNote = !!show.note;

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 5 * u;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1.5 * u;
    ctx.fillStyle = '#fff';

    var M = 30 * u;       // 左边距
    var B = 34 * u;       // 下边距
    var capH = 100 * u;   // 大时间数字高度
    var fs = 32 * u;      // 地址字号
    var lh = fs * 1.34;   // 行高
    var dfs = 33 * u;     // 日期字号

    /* 地址 + 备注 行 */
    var lines = [];
    ctx.font = '500 ' + fs + 'px ' + FAM;
    var maxW = W - M - 100 * u;
    if (maxW > W * 0.82) maxW = W * 0.82;
    if (sAddr && info.addr) lines = lines.concat(wrap(ctx, info.addr, maxW));
    if (sNote && info.note) lines = lines.concat(wrap(ctx, info.note, maxW));
    if (lines.length > 4) { lines = lines.slice(0, 4); lines[3] = fitText(ctx, lines[3] + '…', maxW); }

    var yBottom = H - B;
    var lastBase = yBottom - 0.22 * fs;
    var n = lines.length;
    for (var i = 0; i < n; i++) {
      ctx.fillText(lines[i], M, lastBase - (n - 1 - i) * lh);
    }
    var firstTop = n ? (lastBase - (n - 1) * lh - 0.9 * fs) : yBottom;
    var gap = n ? 22 * u : 0;
    var timeBottom = firstTop - gap;
    var timeTop = timeBottom - capH;

    var x = M;
    if (sTime) {
      var tf = capH / 0.70;
      ctx.font = '700 ' + tf + 'px ' + TIME_FAM;
      var refW = ctx.measureText('00:00').width;
      var targetW = 1.8 * capH;
      var sx = refW > 0 ? Math.max(0.4, Math.min(1.1, targetW / refW)) : 0.6;
      ctx.save();
      ctx.translate(x, timeBottom);
      ctx.scale(sx, 1);
      ctx.fillText(timeStr, 0, 0);
      ctx.restore();
      x += ctx.measureText(timeStr).width * sx + 22 * u;
      if (sDate || sWeek) {
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = accent;
        ctx.fillRect(x, timeTop, 4.5 * u, capH);
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.fillStyle = '#fff';
        x += 4.5 * u + 22 * u;
      }
    }
    if (sDate || sWeek) {
      ctx.font = '500 ' + dfs + 'px ' + FAM;
      if (sTime) {
        if (sDate && sWeek) {
          ctx.fillText(dateStr, x, timeTop + dfs * 0.86);
          ctx.fillText(weekStr, x, timeBottom - dfs * 0.05);
        } else {
          ctx.fillText(sDate ? dateStr : weekStr, x, timeTop + capH / 2 + dfs * 0.36);
        }
      } else {
        // 没有大时间时，日期和星期放在地址上方
        var yy = timeBottom;
        if (sWeek) { ctx.fillText(weekStr, x, yy); yy -= dfs * 1.35; }
        if (sDate) ctx.fillText(dateStr, x, yy);
      }
    }

    /* 右侧竖排文字（向上阅读） */
    if (info.side) {
      var sfs = 26 * u;
      ctx.font = '500 ' + sfs + 'px ' + FAM;
      var sideMax = H * 0.5;
      var txt = fitText(ctx, info.side, sideMax);
      ctx.save();
      ctx.translate(W - 24 * u, H * 0.6);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  window.WM = { draw: draw, weekText: function (d) { return '星期' + WEEK[d.getDay()]; } };
})();
