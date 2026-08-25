/* 座席表メーカー 画面まわり
   席の座標は「前からの段」で持つ（r=0 が最前列）。
   黒板が下のときは、表示のときだけ上下をひっくり返す。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'sakura-seat-v1';
  var NL = String.fromCharCode(10);   // 改行（エスケープを書かずに済ませる）

  var state = {
    names: [], cols: 6, rows: 6, board: 'top', mode: 'cross',
    sep: [], adj: [], fix: [],      // fix = [{name, col, fromFront, zone}]
    plans: [], cur: 0, seats: null
  };

  // ---- 名簿 ----
  function readNames() {
    return $('names').value.split('\n')
      .map(function (s) { return s.replace(/\s+$/, '').replace(/^\s+/, ''); })
      .filter(function (s) { return s.length; });
  }
  function refreshNames() {
    state.names = readNames();
    $('count').textContent = state.names.length + '人';
    refreshSeatInfo();
    document.querySelectorAll('select.nameSel').forEach(fillNames);
  }
  function refreshSeatInfo() {
    var c = +$('cols').value, r = +$('rows').value;
    state.cols = c; state.rows = r;
    var total = c * r, n = state.names.length;
    $('seatcount').textContent = total;
    var el = $('seatinfo');
    if (n > total) {
      el.innerHTML = '⚠ 席が足りません。横か縦をふやしてください。';
      el.style.color = '#d8453f';
    } else {
      el.textContent = n ? '空席は ' + (total - n) + '。' : '';
      el.style.color = '';
    }
  }
  function fillNames(sel) {
    var v = sel.value;
    sel.innerHTML = '<option value="">' + (sel.dataset.ph || '選ぶ') + '</option>' +
      state.names.map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
      }).join('');
    if (state.names.indexOf(v) >= 0) sel.value = v;
  }
  // ---- クラス名・文字づかい ----
  var GRADE_KANJI = { e: '%d年', j: '中%d', h: '高%d' };
  function className(kana) {
    var free = $('clsFree').value.trim();
    var g = $('grade').value, k = $('kumi').value, out = '';
    if (g) {
      var n = g.slice(1);
      if (g[0] === 'e') out += n + (kana ? 'ねん' : '年');
      else out += (g[0] === 'j' ? '中' : '高') + n;
    }
    // 「自分で書く」は“組”の代わり。学年が選ばれていれば「3年 さくら組」になる
    if (free) return out ? out + ' ' + free : free;
    if (k) out += k + (kana ? 'くみ' : '組');
    return out;
  }
  // ---- 名前の見せ方（表示だけ。判定は元の名前のまま） ----
  function nameMode() { var e = $('nameMode'); return e ? e.value : 'wrap'; }
  function displayName(raw) {
    var parts = String(raw).split(/[ 　]+/).filter(function (x) { return x.length; });
    if (parts.length < 2) return raw;
    var m = nameMode();
    if (m === 'sei') return parts[0];
    if (m === 'one') return parts.join(' ');
    return parts[0] + NL + parts.slice(1).join(' ');
  }
  // 印刷したときの1マスの大きさ(mm)から、印刷用の文字サイズを決める
  var PX_PER_MM = 96 / 25.4;
  var measureBox = null;
  function fitPrintSize(text, wmm, hmm, bold) {
    if (!measureBox) {
      measureBox = document.createElement('div');
      measureBox.style.cssText =
        'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre-line;line-height:1.2;';
      document.body.appendChild(measureBox);
    }
    var m = measureBox;
    m.style.fontFamily = getComputedStyle(document.body).fontFamily;
    m.style.width = wmm + 'mm';
    m.style.fontWeight = bold ? 'bold' : 'normal';
    m.textContent = text;
    var lines = text.split(String.fromCharCode(10)).length;
    var hpx = hmm * PX_PER_MM;
    var size = Math.min(hmm * 0.6 / lines, wmm * 0.4);
    for (var i = 0; i < 80 && size > 1.6; i++) {
      m.style.fontSize = size + 'mm';
      // 画面と同じ行数に収まっていること＝勝手に折り返させない
      var okLines = m.scrollHeight <= lines * size * 1.25 * PX_PER_MM + 1;
      if (okLines && m.scrollHeight <= hpx && m.scrollWidth <= m.clientWidth + 1) break;
      size -= 0.2;
    }
    return Math.round(size * 10) / 10;
  }

  // 枠に収まるまで字を小さくする
  function fitText(cell, span, base) {
    var size = base;
    span.style.fontSize = size + 'px';
    var w = cell.clientWidth - 6, h = cell.clientHeight - 4;
    while (size > 7 && (span.scrollWidth > w || span.scrollHeight > h)) {
      size -= 1; span.style.fontSize = size + 'px';
    }
  }

  function isKana() { var e = $('kana'); return e && e.value === 'kana'; }
  function titleWord() { return isKana() ? 'ざせきひょう' : '座席表'; }
  function boardWord() { return isKana() ? 'こ く ば ん' : '黒 板'; }
  function sheetTitle() {
    var kana = isKana(), c = className(kana);
    return (c ? c + ' ' : '') + titleWord();
  }
  function sakuraSvg(size) {
    var p = '';
    for (var i = 0; i < 5; i++)
      p += '<ellipse cx="50" cy="24" rx="13" ry="20" transform="rotate(' + (i * 72) + ' 50 50)"/>';
    return '<svg class="sakura-svg" width="' + size + '" height="' + size + '" viewBox="0 0 100 100" aria-hidden="true">' +
      '<g fill="#f6b8ce">' + p + '</g><circle cx="50" cy="50" r="7" fill="#e07a9f"/></svg>';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- 条件の行 ----
  function addPairRow(listId) {
    var wrap = document.createElement('div');
    wrap.className = 'pair';
    var a = document.createElement('select'); a.className = 'nameSel'; a.dataset.ph = 'Aさんを選ぶ';
    var b = document.createElement('select'); b.className = 'nameSel'; b.dataset.ph = 'Bさんを選ぶ';
    fillNames(a); fillNames(b);
    a.classList.add('ph'); b.classList.add('ph');
    [a, b].forEach(function (e) {
      e.addEventListener('change', function () { e.classList.toggle('ph', !e.value); });
    });
    var sep = document.createElement('span'); sep.textContent = 'と';
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'mini'; del.textContent = '削除';
    del.onclick = function () { wrap.remove(); };
    wrap.appendChild(a); wrap.appendChild(sep); wrap.appendChild(b); wrap.appendChild(del);
    $(listId).appendChild(wrap);
  }

  function addFixRow() {
    var wrap = document.createElement('div');
    wrap.className = 'pair';
    var n = document.createElement('select'); n.className = 'nameSel ph';
    n.dataset.ph = 'Aさんを選ぶ'; fillNames(n);
    n.addEventListener('change', function () { n.classList.toggle('ph', !n.value); });
    var kind = document.createElement('select');
    kind.innerHTML = '<option value="front">を 前のほうに</option>' +
      '<option value="back">を うしろのほうに</option>' +
      '<option value="seat">を この席に</option>';
    var col = document.createElement('select'); col.className = 'colSel'; col.hidden = true;
    var row = document.createElement('select'); row.className = 'rowSel'; row.hidden = true;
    var lab1 = document.createElement('span'); lab1.textContent = '左から'; lab1.hidden = true;
    var lab2 = document.createElement('span'); lab2.textContent = '番目・前から'; lab2.hidden = true;
    var lab3 = document.createElement('span'); lab3.textContent = '番目'; lab3.hidden = true;
    function fillNum() {
      col.innerHTML = ''; row.innerHTML = '';
      for (var i = 1; i <= state.cols; i++) col.add(new Option(i, i));
      for (var j = 1; j <= state.rows; j++) row.add(new Option(j, j));
    }
    fillNum();
    kind.onchange = function () {
      var on = kind.value === 'seat';
      [col, row, lab1, lab2, lab3].forEach(function (e) { e.hidden = !on; });
      if (on) fillNum();
    };
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'mini'; del.textContent = '削除';
    del.onclick = function () { wrap.remove(); };
    [n, kind, lab1, col, lab2, row, lab3, del].forEach(function (e) { wrap.appendChild(e); });
    $('fixList').appendChild(wrap);
  }

  // ---- 画面から条件を集める ----
  function collect() {
    var pairs = function (id) {
      return Array.prototype.map.call($(id).querySelectorAll('.pair'), function (w) {
        var s = w.querySelectorAll('select');
        return [s[0].value, s[1].value];
      }).filter(function (p) { return p[0] && p[1] && p[0] !== p[1]; });
    };
    var fix = {}, zone = {};
    Array.prototype.forEach.call($('fixList').querySelectorAll('.pair'), function (w) {
      var s = w.querySelectorAll('select');
      var name = s[0].value, kind = s[1].value;
      if (!name) return;
      if (kind === 'seat') {
        var c = +s[2].value, r = +s[3].value;
        fix[name] = (r - 1) * state.cols + (c - 1);
      } else zone[name] = kind;
    });
    return {
      names: state.names, cols: state.cols, rows: state.rows,
      mode: (document.querySelector('input[name=mode]:checked') || {}).value || 'cross',
      separate: pairs('sepList'), adjacent: pairs('adjList'),
      fixed: fix, zone: zone
    };
  }
  window.__seatCollect = collect;
  window.__seatState = state;

  // ---- 席替えを実行 ----
  function run() {
    refreshNames();
    var opt = collect();
    var msg = $('msg');
    if (!opt.names.length) {
      msg.innerHTML = '<div class="notice warn">名簿が空です。1行に1人ずつ入れてください。</div>';
      return;
    }
    if (opt.names.length > opt.cols * opt.rows) {
      msg.innerHTML = '<div class="notice warn">席が足りません。横か縦の数をふやしてください。</div>';
      return;
    }
    msg.innerHTML = '';
    var plans = Seating.generate(opt, 3, 2000);
    if (!plans.length) {
      var who = Seating.blame(opt);
      msg.innerHTML = '<div class="notice warn"><strong>条件がきつすぎて作れませんでした。</strong>' +
        (who ? '<br>' + esc(who) + ' を外すと作れます。' :
          '<br>「隣」の決め方をゆるくするか、条件をへらしてください。') + '</div>';
      return;
    }
    state.plans = plans; state.cur = 0; state.opt = opt;
    state.seats = plans[0].slice();
    $('result').hidden = false;
    drawTabs(); drawSheet(); printNote();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if ($('save').checked) save();
    else {
      msg.innerHTML = '<div class="notice">名簿の保存は<strong>オフ</strong>です。' +
        'ページを閉じたり読み込み直すと、入れた名簿は消えます。' +
        ' <button type="button" class="mini" id="saveNow">このパソコンに保存する</button></div>';
      $('saveNow').onclick = function () {
        $('save').checked = true; save(); msg.innerHTML = '';
      };
    }
  }

  function drawTabs() {
    var t = $('tabs'); t.innerHTML = '';
    state.plans.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = '案 ' + (i + 1);
      if (i === state.cur) b.className = 'on';
      b.onclick = function () {
        state.cur = i; state.seats = state.plans[i].slice();
        drawTabs(); drawSheet(); printNote();
      };
      t.appendChild(b);
    });
  }

  // ---- 座席表を描く ----
  function drawSheet() {
    var o = state.opt, cols = o.cols, rows = o.rows;
    $('shTitle').textContent = sheetTitle();
    $('shDate').textContent = $('dt').value || '';
    $('boardTop').hidden = (state.board !== 'top');
    $('boardBottom').hidden = (state.board !== 'bottom');
    $('boardTop').textContent = boardWord();
    $('boardBottom').textContent = boardWord();

    var g = $('grid');
    g.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
    g.innerHTML = '';
    var bad = {};
    Seating.violations(state.seats, o).forEach(function (v) {
      v.seats.forEach(function (i) { bad[i] = true; });
    });

    for (var dr = 0; dr < rows; dr++) {
      var r = (state.board === 'top') ? dr : rows - 1 - dr;
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        var name = state.seats[i];
        var d = document.createElement('div');
        d.className = 'seat' + (name ? '' : ' empty') + (bad[i] ? ' bad' : '');
        d.draggable = true;
        d.dataset.i = i;
        if (name) {
          var sp = document.createElement('span');
          sp.className = 'nm';
          sp.textContent = displayName(name);
          d.appendChild(sp);
        } else d.textContent = '空';
        g.appendChild(d);
      }
    }
    // 印刷で紙いっぱいに使う。席が少ないときは1マスを大きくする
    var avail = 140;                                   // A4よこ で座席に使える高さ(mm)の目安
    var mm = Math.max(11, Math.min(28, Math.round(avail / rows)));
    $('sheet').style.setProperty('--seatH', mm + 'mm');
    // 印刷したときの1マスの大きさ（用紙の幅から逆算）
    var pageW = ($('paper').value === 'landscape' ? 297 : 210) - 24
      - ($('deco').value === 'sakura' ? 12 : 0);
    var cellWmm = (pageW - (cols - 1) * 1.6) / cols;
    $('credit').hidden = !$('showCredit').checked;
    $('sheet').classList.toggle('bold', $('bold').checked);
    var base = $('bold').checked ? 22 : 17;
    g.querySelectorAll('.seat .nm').forEach(function (sp) {
      fitText(sp.parentNode, sp, base);
      sp.style.setProperty('--nmPrint',
        fitPrintSize(sp.textContent, cellWmm - 7, mm - 5, $('bold').checked) + 'mm');
    });
    bindDrag();
    drawViolations();
    drawDeco();
  }

  function drawViolations() {
    var vs = Seating.violations(state.seats, state.opt);
    var el = $('vio');
    if (!vs.length) { el.innerHTML = ''; return; }
    var lines = vs.map(function (v) {
      if (v.type === 'separate') return v.pair[0] + 'さんと' + v.pair[1] + 'さんが近くにいます';
      if (v.type === 'adjacent') return v.pair[0] + 'さんと' + v.pair[1] + 'さんが離れています';
      if (v.type === 'zone') return v.name + 'さんが指定した場所にいません';
      return v.name + 'さんが指定した席にいません';
    });
    el.innerHTML = '<div class="notice warn">' + lines.map(esc).join('<br>') +
      '<br><small>このままでも印刷できます。</small></div>';
  }

  // ---- ドラッグで入れ替え ----
  function bindDrag() {
    var from = null;
    $('grid').querySelectorAll('.seat').forEach(function (d) {
      d.addEventListener('dragstart', function (e) {
        from = +d.dataset.i; d.classList.add('drag');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(from));
      });
      d.addEventListener('dragend', function () { d.classList.remove('drag'); });
      d.addEventListener('dragover', function (e) { e.preventDefault(); });
      d.addEventListener('drop', function (e) {
        e.preventDefault();
        var to = +d.dataset.i;
        var src = from != null ? from : +e.dataTransfer.getData('text/plain');
        if (src === to || isNaN(src)) return;
        var t = state.seats[src]; state.seats[src] = state.seats[to]; state.seats[to] = t;
        from = null;
        drawSheet();
      });
    });
  }

  // ---- 印刷 ----
  function printNote() {
    var el = $('printNote'); if (!el) return;
    el.textContent = $('printWhat').value === 'all'
      ? '3案すべて（3ページ）を印刷します'
      : 'いま表示している 案' + (state.cur + 1) + ' を印刷します';
  }

  // 3案ぶんの座席表を作って、印刷用の入れ物に入れる
  function buildAll() {
    var box = $('printAll'); box.innerHTML = '';
    var keepSeats = state.seats;
    state.plans.forEach(function (p, i) {
      state.seats = p.slice();
      drawSheet();
      var c = $('sheet').cloneNode(true);
      c.querySelectorAll('[id]').forEach(function (e) { e.removeAttribute('id'); });
      c.removeAttribute('id');
      var ttl = c.querySelector('.sheet-title');
      if (ttl) ttl.textContent = ttl.textContent + '（案' + (i + 1) + '）';
      box.appendChild(c);
    });
    state.seats = keepSeats;
    drawSheet();
    document.body.classList.add('print-all');
  }

  function doPrint() {
    document.body.classList.toggle('landscape', $('paper').value === 'landscape');
    var st = document.getElementById('pageRule');
    if (!st) { st = document.createElement('style'); st.id = 'pageRule'; document.head.appendChild(st); }
    st.textContent = '@page{size:A4 ' + $('paper').value + ';margin:12mm}';
    if ($('printWhat').value === 'all' && state.plans.length) buildAll();
    window.print();
  }

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-all');
    $('printAll').innerHTML = '';
  });

  // ---- PNGで保存（自分で描くので外部の部品は使わない）----
  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t); x.lineTo(l + w - r, t); x.quadraticCurveTo(l + w, t, l + w, t + r);
    x.lineTo(l + w, t + h - r); x.quadraticCurveTo(l + w, t + h, l + w - r, t + h);
    x.lineTo(l + r, t + h); x.quadraticCurveTo(l, t + h, l, t + h - r);
    x.lineTo(l, t + r); x.quadraticCurveTo(l, t, l + r, t);
    x.closePath();
  }

  function pngSakura(x, cx, cy, r) {
    x.save(); x.translate(cx, cy);
    x.fillStyle = '#f6b8ce';
    for (var i = 0; i < 5; i++) {
      x.save(); x.rotate(i * Math.PI * 2 / 5);
      x.beginPath(); x.ellipse(0, -r * 0.5, r * 0.26, r * 0.4, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
    x.fillStyle = '#e07a9f';
    x.beginPath(); x.arc(0, 0, r * 0.14, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function doPng() {
    var o = state.opt, cols = o.cols, rows = o.rows;
    var deco = $('deco').value === 'sakura';
    var credit = $('showCredit').checked;
    var cw = 150, ch = 90, pad = 40, head = 70, boardH = 40;
    var W = pad * 2 + cols * cw;
    var H = pad * 2 + head + boardH + rows * ch + (deco ? 46 : 0) + (credit ? 28 : 0);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);

    x.fillStyle = '#333'; x.font = 'bold 28px sans-serif'; x.textBaseline = 'top';
    x.fillText(sheetTitle(), pad + (deco ? 42 : 0), pad - 10);
    if (deco) pngSakura(x, pad + 18, pad + 6, 30);
    x.font = '18px sans-serif'; x.fillStyle = '#777';
    var dt = $('dt').value || '';
    x.fillText(dt, W - pad - x.measureText(dt).width, pad - 4);

    var top = pad + head;
    function board(y) {
      x.fillStyle = '#3e5c4b';
      x.fillRect(pad, y, cols * cw, boardH - 12);
      x.fillStyle = '#fff'; x.font = '18px sans-serif'; x.textAlign = 'center';
      x.fillText(boardWord(), pad + cols * cw / 2, y + 3);
      x.textAlign = 'left';
    }
    var gy = top + (state.board === 'top' ? boardH : 0);
    if (state.board === 'top') board(top); else board(top + rows * ch + 6);

    for (var dr = 0; dr < rows; dr++) {
      var r = (state.board === 'top') ? dr : rows - 1 - dr;
      for (var c = 0; c < cols; c++) {
        var name = state.seats[r * cols + c];
        var px = pad + c * cw, py = gy + dr * ch;
        x.strokeStyle = '#c9c9c9'; x.lineWidth = 2;
        roundRect(x, px + 4, py + 4, cw - 8, ch - 8, 10); x.stroke();
        if (!name) continue;
        var lines = displayName(name).split(NL);
        var weight = $('bold').checked ? 'bold ' : '';
        var size = $('bold').checked ? 34 : 28;
        while (size > 9) {
          x.font = weight + size + 'px sans-serif';
          var wide = lines.some(function (t) { return x.measureText(t).width > cw - 20; });
          if (!wide && lines.length * size * 1.25 < ch - 16) break;
          size -= 1;
        }
        x.fillStyle = '#333'; x.font = weight + size + 'px sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        var lh = size * 1.25, top0 = py + ch / 2 - (lines.length - 1) * lh / 2;
        lines.forEach(function (t, li) { x.fillText(t, px + cw / 2, top0 + li * lh); });
        x.textAlign = 'left'; x.textBaseline = 'top';
      }
    }
    var footY = pad + head + boardH + rows * ch + 22;
    if (deco) {
      pngSakura(x, W / 2 - 40, footY, 22);
      pngSakura(x, W / 2, footY + 4, 30);
      pngSakura(x, W / 2 + 40, footY, 22);
    }
    if (credit) {
      x.font = '15px sans-serif'; x.fillStyle = '#c3b2ba'; x.textAlign = 'right';
      x.fillText('さくら先生のお道具箱　sakura-teachers.com', W - pad, H - pad - 8);
      x.textAlign = 'left';
    }
    var a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = (sheetTitle().replace(/\s/g, '') || '座席表') + '.png';
    a.click();
  }

  // ---- 保存（このパソコンの中だけ）----
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        names: $('names').value,
        grade: $('grade').value, kumi: $('kumi').value, clsFree: $('clsFree').value,
        cols: $('cols').value, rows: $('rows').value,
        board: $('board').value,
        mode: (document.querySelector('input[name=mode]:checked') || {}).value || 'cross',
        nameMode: $('nameMode').value, bold: $('bold').checked,
        showCredit: $('showCredit').checked
      }));
      showSaving();
    } catch (e) { }
  }
  function showSaving() {
    var n = state.names.length;
    $('savingLabel').textContent = $('save').checked && n
      ? '保存中：' + (className(false) || '名簿') + ' ' + n + '人' : '';
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return;
      $('names').value = d.names || '';
      $('grade').value = d.grade || ''; $('kumi').value = d.kumi || '';
      $('clsFree').value = d.clsFree || '';
      $('cols').value = d.cols || 6; $('rows').value = d.rows || 6;
      $('board').value = d.board || 'top';
      var mr = document.querySelector('input[name=mode][value="' + (d.mode || 'cross') + '"]');
      if (mr) mr.checked = true;
      if (d.nameMode) $('nameMode').value = d.nameMode;
      $('bold').checked = !!d.bold;
      if (d.showCredit !== undefined) $('showCredit').checked = !!d.showCredit;
      $('save').checked = true;
    } catch (e) { }
  }
  function clearSaved() {
    try { localStorage.removeItem(KEY); } catch (e) { }
    $('save').checked = false; showSaving();
    $('msg').innerHTML = '<div class="notice">このパソコンに保存していた名簿を消しました。</div>';
  }

  // ---- 起動 ----
  function init() {
    var d = new Date();
    $('dt').value = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    load();
    refreshNames();
    state.board = $('board').value;

    $('names').addEventListener('input', function () { refreshNames(); if ($('save').checked) save(); });
    ['cols', 'rows'].forEach(function (id) { $(id).addEventListener('input', refreshSeatInfo); });
    ['grade', 'kumi', 'clsFree'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        showSaving(); if (state.seats) drawSheet(); if ($('save').checked) save();
      });
    });
    $('kana').addEventListener('change', function () { if (state.seats) drawSheet(); });
    $('board').addEventListener('change', function () {
      state.board = $('board').value;
      if (state.seats) drawSheet();
    });
    $('addSep').onclick = function () { addPairRow('sepList'); };
    $('addAdj').onclick = function () { addPairRow('adjList'); };
    $('addFix').onclick = addFixRow;
    $('go').onclick = run;
    $('again').onclick = run;
    $('doPrint').onclick = doPrint;
    $('printWhat').addEventListener('change', printNote);
    $('doPng').onclick = doPng;
    $('save').addEventListener('change', function () {
      if ($('save').checked) save(); else { try { localStorage.removeItem(KEY); } catch (e) { } showSaving(); }
    });
    $('clear').onclick = clearSaved;
    $('deco').addEventListener('change', drawDeco);
    ['nameMode', 'bold', 'showCredit'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (state.seats) drawSheet();
        if ($('save').checked) save();
      });
    });
    document.querySelectorAll('input[name=mode]').forEach(function (r) {
      r.addEventListener('change', function () { if ($('save').checked) save(); });
    });
    $('pic').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) { $('decoImg').hidden = true; return; }
      var fr = new FileReader();
      fr.onload = function () { $('decoImg').src = fr.result; $('decoImg').hidden = false; };
      fr.readAsDataURL(f);
    });
    showSaving();
  }
  function drawDeco() {
    var on = $('deco').value === 'sakura';
    $('sheet').classList.toggle('sakura', on);
    $('decoLeft').innerHTML = on ? sakuraSvg(30) : '';
    $('decoBottom').innerHTML = on
      ? sakuraSvg(20) + sakuraSvg(28) + sakuraSvg(20) : '';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
