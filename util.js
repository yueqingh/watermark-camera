/* 工具：读取照片里的拍摄时间/位置（EXIF）、离线区县查询、ZIP 打包、文件名。 */
(function () {
  'use strict';

  function p2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------- EXIF：只读 JPEG 的 拍摄时间 与 GPS ---------- */
  function parseExif(buf) {
    var out = { time: null, lat: null, lng: null };
    try {
      var dv = new DataView(buf);
      if (dv.byteLength < 12 || dv.getUint16(0) !== 0xFFD8) return out;
      var off = 2, tiff = -1;
      while (off + 4 < dv.byteLength) {
        var mk = dv.getUint16(off);
        if ((mk & 0xFF00) !== 0xFF00) break;
        var len = dv.getUint16(off + 2);
        if (mk === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) { tiff = off + 10; break; }
        if (mk === 0xFFDA) break;
        off += 2 + len;
      }
      if (tiff < 0) return out;
      var le = dv.getUint16(tiff) === 0x4949;
      function u16(o) { return dv.getUint16(o, le); }
      function u32(o) { return dv.getUint32(o, le); }
      function ascii(o, n) {
        var s = '';
        for (var i = 0; i < n; i++) { var c = dv.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); }
        return s;
      }
      function ifd(start) {
        var res = {};
        if (start + 2 > dv.byteLength) return res;
        var cnt = u16(start);
        for (var i = 0; i < cnt; i++) {
          var e = start + 2 + i * 12;
          if (e + 12 > dv.byteLength) break;
          res[u16(e)] = { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 };
        }
        return res;
      }
      function dataOff(ent) {
        var size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[ent.type] || 1;
        return (size * ent.count <= 4) ? ent.valOff : tiff + u32(ent.valOff);
      }
      function rationals(ent, n) {
        var o = dataOff(ent), r = [];
        for (var i = 0; i < n; i++) {
          var a = u32(o + i * 8), b = u32(o + i * 8 + 4);
          r.push(b ? a / b : 0);
        }
        return r;
      }
      var ifd0 = ifd(tiff + u32(tiff + 4));
      if (ifd0[0x8769]) {
        var ex = ifd(tiff + u32(ifd0[0x8769].valOff));
        var te = ex[0x9003] || ex[0x9004];
        if (te) {
          var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii(dataOff(te), te.count));
          if (m && +m[1] > 1990) out.time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        }
      }
      if (!out.time && ifd0[0x0132]) {
        var m2 = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii(dataOff(ifd0[0x0132]), ifd0[0x0132].count));
        if (m2 && +m2[1] > 1990) out.time = new Date(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], +m2[6]);
      }
      if (ifd0[0x8825]) {
        var g = ifd(tiff + u32(ifd0[0x8825].valOff));
        if (g[2] && g[4] && g[1] && g[3]) {
          var la = rationals(g[2], 3), lo = rationals(g[4], 3);
          var latRef = ascii(g[1].valOff, 1), lngRef = ascii(g[3].valOff, 1);
          var lat = la[0] + la[1] / 60 + la[2] / 3600;
          var lng = lo[0] + lo[1] / 60 + lo[2] / 3600;
          if (latRef === 'S') lat = -lat;
          if (lngRef === 'W') lng = -lng;
          if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng; }
        }
      }
    } catch (e) {
      if (window.Diag) Diag.warn('exif', '读取失败: ' + e.message);
    }
    return out;
  }

  function readExif(file) {
    return new Promise(function (resolve) {
      try {
        var r = new FileReader();
        r.onload = function () { resolve(parseExif(r.result)); };
        r.onerror = function () { resolve({ time: null, lat: null, lng: null }); };
        r.readAsArrayBuffer(file.slice(0, 262144));
      } catch (e) { resolve({ time: null, lat: null, lng: null }); }
    });
  }

  /* ---------- 离线区县查询（最近中心点） ---------- */
  function regionFromLatLng(lat, lng) {
    try {
      var R = window.REGION_DATA;
      if (!R || !R.e) return null;
      var best = null, bd = 1e18, cosl = Math.cos(lat * Math.PI / 180);
      for (var i = 0; i < R.e.length; i++) {
        var e = R.e[i];
        var dx = (e[0] - lng) * cosl, dy = e[1] - lat;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) return null;
      var km = Math.sqrt(bd) * 111;
      if (km > 80) return null; // 离任何区县中心都太远：多半不在中国范围内
      var pre = R.p[best[2]];
      return { text: pre + ' ' + best[3], km: Math.round(km) };
    } catch (e) { return null; }
  }

  /* ---------- ZIP（仅存储，不压缩；JPEG 本来就已压缩） ---------- */
  var CRC = null;
  function crc32(u8) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function buildZip(files) { // files: [{name, data:Uint8Array, date}]
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nm = enc.encode(f.name), d = f.date || new Date();
      var dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      var tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      var crc = crc32(f.data), sz = f.data.length;
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, tm, true); h.setUint16(12, dt, true);
      h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, tm, true); c.setUint16(14, dt, true);
      c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
      c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, nm);
      offset += 30 + nm.length + sz;
    });
    var csize = 0;
    central.forEach(function (b) { csize += b.byteLength !== undefined ? b.byteLength : b.length; });
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: 'application/zip' });
  }

  function fileStamp(d) {
    return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  window.Util = { readExif: readExif, regionFromLatLng: regionFromLatLng, buildZip: buildZip, fileStamp: fileStamp, p2: p2 };
})();
