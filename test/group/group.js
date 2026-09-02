/* 理科室・図工室の座席表（/group/）
   台は「短い辺が黒板を向いた縦長」。座るのは長い辺に2人ずつ、
   5人めからは黒板から遠いほうの短い辺に回り込む（本人 2026-09-01）。

   席は t*6+s の通し番号で持つ（t=台、s=台の中の席）。
     s = 0 左上 / 1 右上 / 2 左下 / 3 右下 / 4 短辺の左 / 5 短辺の右
   黒板が下のときは、描くときだけ180度まわす（持ち方は変えない）。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var NL = String.fromCharCode(10);
  var KEY = 'sakura-group-v1';                     // 画面の保存（1つだけ）
  // 🔴 名簿の置き場は座席表・席次表と共通（2026-08-31）。設定だけツールごとに分ける
  var KEYC = 'sakura-teachers-rosters-v1';
  var KEYOLD = 'sakura-seat-classes-v1';           // いちばん古い置き場。開いたときに引き継ぐ
  var MAXC = 20;                                   // 名簿は20件まで（専科は10クラス持つ。2026-09-01 本人）
  var SLOT = 6;                                    // 1台の席は最大6

  var state = {
    names: [], sex: {}, leaders: {}, lastRaw: null,
    tcols: 2, tnum: 'auto', gsize: 5, board: 'top', order: 'random',
    sep: [], adj: [],
    sizes: [], plans: [], cur: 0, seats: null,
    pendingSeats: null,
    sample: false, sampleNames: []
  };

  // 班の色（座席表と同じ組み合わせ。色の見分けがつきにくい方にも伝わる）
  // ［線の色, うすい塗り］
  var GCOL = [
    ['#EF6B6B', 'rgba(239,107,107,.14)'],
    ['#3FBF88', 'rgba(63,191,136,.14)'],
    ['#EF6BAE', 'rgba(239,107,174,.13)'],
    ['#4A8FD6', 'rgba(74,143,214,.14)'],
    ['#F2913F', 'rgba(242,145,63,.15)'],
    ['#6FC9E8', 'rgba(111,201,232,.18)'],
    ['#8CC63F', 'rgba(140,198,63,.17)'],
    ['#9B6BE0', 'rgba(155,107,224,.13)'],
    ['#E8B62A', 'rgba(232,182,42,.17)']
  ];
  function gcol(no) { return GCOL[(no - 1) % GCOL.length]; }

  var COLORS = [
    ['#333333', '黒'], ['#1f5fbf', '青'], ['#b02a7a', '赤紫'],
    ['#26418f', '紺'], ['#c4611a', 'だいだい'], ['#17724a', '緑'], ['#8a5a2b', '茶']
  ];
  var FONTS = {
    mincho: '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", "MS PMincho", serif',
    gothic: '"Yu Gothic", YuGothic, "Hiragino Sans", Meiryo, sans-serif',
    maru: '"HG丸ｺﾞｼｯｸM-PRO", HGMaruGothicMPRO, "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif'
  };
  function fontStack() { return FONTS[$('font').value] || FONTS.gothic; }

  var SAMPLE = [
    ['あおい', 'f'], ['はると', 'm'], ['ひなた', 'f'], ['そうた', 'm'],
    ['ゆい', 'f'], ['りく', 'm'], ['さくら', 'f'], ['かいと', 'm'],
    ['めい', 'f'], ['ゆうと', 'm'], ['こはる', 'f'], ['そら', 'm'],
    ['あかり', 'f'], ['れん', 'm'], ['みお', 'f'], ['たくみ', 'm'],
    ['のあ', 'f'], ['はやと', 'm'], ['いちか', 'f'], ['けんと', 'm'],
    ['ゆあ', 'f'], ['ゆうき', 'm'], ['りん', 'f'], ['そうすけ', 'm'],
    ['あん', 'f'], ['あさひ', 'm'], ['ひまり', 'f'], ['りひと', 'm'],
    ['つむぎ', 'f'], ['はるき', 'm'], ['いろは', 'f'], ['ゆうま', 'm'],
    ['すみれ', 'f'], ['そうま', 'm'], ['ことは', 'f']
  ];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- 名簿を読む（座席表と同じ読み方。Excelから何列でも貼れる）----
  function isLeadName(s) { return /^★/.test(s) || /★$/.test(s); }
  function stripLead(s) { return s.replace(/^★[ 　]*/, '').replace(/[ 　]*★$/, ''); }
  var SEX_M = /^(男|男子|おとこ|オトコ|男の子|[MmＭｍ])$/;
  var SEX_F = /^(女|女子|おんな|オンナ|女の子|[FfＦｆ])$/;
  var MARK_ONLY = /^(★|☆|班長|リーダー|リーダー格)$/;
  var NUM_ONLY = /^[0-9０-９]+$/;
  var HEAD_WORD = /^(番号|出席番号|No\.?|№|氏名|名前|生徒名|児童名|性別|男女|班長|リーダー|リーダー格|班|グループ|備考|メモ|学年|組)$/i;
  var LEAD_NUM = /^[0-9０-９]+[ 　]+/;
  var TAIL_SEX = /[ 　]+(男子|女子|男|女)$/;

  function parseLine(line) {
    var cells = line.split(/[\t,，]/)
      .map(function (x) { return x.replace(/^[\s　]+/, '').replace(/[\s　]+$/, ''); })
      .filter(function (x) { return x.length; });
    var out = { name: '', lead: false, sex: '' };
    if (cells.length && cells.every(function (c) { return HEAD_WORD.test(c); })) return out;
    if (cells.length === 1) {
      var one = cells[0].replace(LEAD_NUM, '');
      var m = one.match(TAIL_SEX);
      if (m) {
        out.sex = (m[1].charAt(0) === '女') ? 'f' : 'm';
        one = one.replace(TAIL_SEX, '');
      }
      cells = one.length ? [one] : [];
    }
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (MARK_ONLY.test(c)) { out.lead = true; continue; }
      if (SEX_M.test(c)) { out.sex = 'm'; continue; }
      if (SEX_F.test(c)) { out.sex = 'f'; continue; }
      if (NUM_ONLY.test(c)) continue;
      if (!out.name) out.name = c;
    }
    if (isLeadName(out.name)) { out.lead = true; out.name = stripLead(out.name); }
    return out;
  }

  function readNames() {
    var out = [], lead = {};
    var raw = $('names').value;
    var fresh = (raw !== state.lastRaw);
    raw.split('\n').forEach(function (line) {
      var p = parseLine(line);
      if (!p.name) return;
      out.push(p.name);
      if (p.lead) lead[p.name] = true;
      if (fresh && p.sex) state.sex[p.name] = p.sex;
    });
    state.lastRaw = raw;
    state.leaders = lead;
    return out;
  }

  function refreshNames() {
    var typed = readNames();
    if (!typed.length) {
      state.sample = true;
      state.names = state.sampleNames;
      $('count').textContent = 'サンプル ' + state.names.length + '人';
    } else {
      state.sample = false;
      state.names = typed;
      $('count').textContent = state.names.length + '人';
    }
    refreshRoom();
    document.querySelectorAll('select.nameSel').forEach(fillNames);
    renderSexList();
  }

  function fillNames(sel) {
    var v = sel.value;
    sel.innerHTML = '<option value="">' + (sel.dataset.ph || '選ぶ') + '</option>' +
      state.names.map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
      }).join('');
    if (state.names.indexOf(v) >= 0) sel.value = v;
    sel.classList.toggle('ph', !sel.value);
  }

  // ---- 台の数と、1台ずつの人数を決める ----
  // 🔴 5人ずつに分けて、あまりが出たぶんは6人に「回り込む」。
  //   それでも5人に足りないときだけ4人の台ができる（2026-09-01 本人）
  function distribute(n, T) {
    var base = Math.floor(n / T), rem = n % T, out = [];
    for (var i = 0; i < T; i++) out.push(base + (i < rem ? 1 : 0));
    return out;
  }
  function capOf(cols) { return cols === 2 ? 8 : 9; }   // 2列×4段 ／ 3列×3段
  function planRoom(n) {
    var cols = state.tcols, cap = capOf(cols), T;
    if (state.tnum === 'auto') {
      var size = state.gsize;
      var T0 = Math.floor(n / size), rem = n - T0 * size;
      if (T0 < 1) T = 1;
      else if (rem === 0) T = T0;
      else if (rem <= T0 && size < SLOT) T = T0;    // あまりを1人ずつ足す＝6人の台になる
      else T = T0 + 1;                             // 足りないぶんは新しい台（4人の台）
      if (T > cap) T = cap;
    } else {
      T = Math.min(parseInt(state.tnum, 10) || 1, cap);
    }
    if (T < 1) T = 1;
    return { T: T, sizes: distribute(n, T), cols: cols, rows: Math.ceil(T / cols) };
  }

  function countWord(sizes) {
    var c = {};
    sizes.forEach(function (s) { c[s] = (c[s] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return b - a; })
      .map(function (k) { return k + '人が' + c[k] + '台'; }).join('・');
  }

  // 入りきらないときの言い方は、原因によって変える
  function overWord() {
    if (state.tnum !== 'auto') return '1台が7人以上になります。台の数をふやしてください。';
    if (state.tcols === 2) return '2列では48人までです。台のならびを3列にしてください。';
    return '3列でも54人までです。人数を減らしてください。';
  }

  function refreshRoom() {
    state.tcols = +$('tcols').value;
    state.tnum = $('tnum').value;
    state.gsize = +$('gsize').value;
    state.order = $('order').value;
    state.board = $('board').value;
    var n = state.names.length, p = planRoom(n), el = $('tnote');
    state.sizes = p.sizes;
    $('tinfo').textContent = n ? p.T + '班' : '－';
    $('gsize').disabled = (state.tnum !== 'auto');
    var over = p.sizes.filter(function (s) { return s > SLOT; }).length;
    if (!n) { el.textContent = ''; el.style.color = ''; return; }
    if (over) {
      el.innerHTML = '⚠ ' + overWord();
      el.style.color = '#d8453f';
      return;
    }
    el.style.color = '';
    var t = n + '人を ' + countWord(p.sizes) + '（' + p.cols + '列×' + p.rows + '段）';
    if (state.order === 'number') t += '。名簿の順にならべます（下の条件は使いません）。';
    el.textContent = t;
  }

  // ---- 条件 ----
  function addPairRow(listId, a0, b0) {
    var wrap = document.createElement('div');
    wrap.className = 'pair';
    var a = document.createElement('select'); a.className = 'nameSel'; a.dataset.ph = 'Aさんを選ぶ';
    var b = document.createElement('select'); b.className = 'nameSel'; b.dataset.ph = 'Bさんを選ぶ';
    fillNames(a); fillNames(b);
    if (a0) { a.value = a0; } if (b0) { b.value = b0; }
    [a, b].forEach(function (e) {
      e.classList.toggle('ph', !e.value);
      e.addEventListener('change', function () { e.classList.toggle('ph', !e.value); });
    });
    var sep = document.createElement('span'); sep.textContent = 'と';
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'mini'; del.textContent = '削除';
    del.onclick = function () { wrap.remove(); };
    wrap.appendChild(a); wrap.appendChild(sep); wrap.appendChild(b); wrap.appendChild(del);
    $(listId).appendChild(wrap);
  }
  function readPairs(listId) {
    var out = [];
    $(listId).querySelectorAll('.pair').forEach(function (w) {
      var s = w.querySelectorAll('select');
      if (s[0].value && s[1].value && s[0].value !== s[1].value) out.push([s[0].value, s[1].value]);
    });
    return out;
  }

  // ---- 班を作る ----
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 「同じ班にする」でつながっている人を、ひとかたまりにする
  function makeClusters(names, adj) {
    var idx = {}, par = [];
    names.forEach(function (n, i) { idx[n] = i; par.push(i); });
    function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    adj.forEach(function (p) {
      if (idx[p[0]] == null || idx[p[1]] == null) return;
      var a = find(idx[p[0]]), b = find(idx[p[1]]);
      if (a !== b) par[b] = a;
    });
    var map = {};
    names.forEach(function (n, i) {
      var r = find(i);
      (map[r] = map[r] || []).push(n);
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function sexOf(n) { return state.sex[n] || ''; }

  // 1回ぶん作る。できなければ null
  function buildOnce(sizes, sepMap) {
    var tabs = sizes.map(function () { return []; });
    var cl = makeClusters(state.names, state.adj);
    shuffle(cl);
    cl.sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < cl.length; i++) {
      var g = cl[i], best = [], ok = [];
      for (var t = 0; t < tabs.length; t++) {
        if (tabs[t].length + g.length > sizes[t]) continue;
        ok.push(t);
        var clash = g.some(function (n) {
          return tabs[t].some(function (m) { return sepMap[n] && sepMap[n][m]; });
        });
        if (!clash) best.push(t);
      }
      var pool = best.length ? best : ok;
      if (!pool.length) return null;               // 入る台が無い＝条件がきつすぎる
      // 男女と班長で、いちばん片寄らない台を選ぶ（同じ点なら運まかせ）
      var scored = pool.map(function (t) { return { t: t, s: localCost(tabs[t], g) + Math.random() }; });
      scored.sort(function (a, b) { return a.s - b.s; });
      tabs[scored[0].t] = tabs[scored[0].t].concat(g);
    }
    return tabs;
  }

  function localCost(tab, add) {
    var c = 0;
    if ($('sexBal').checked) {
      var m = 0, f = 0;
      tab.concat(add).forEach(function (n) {
        if (sexOf(n) === 'm') m++; else if (sexOf(n) === 'f') f++;
      });
      c += Math.abs(m - f);
    }
    var L = tab.concat(add).filter(function (n) { return state.leaders[n]; }).length;
    if (L > 1) c += (L - 1) * 4;
    return c;
  }

  function scoreTabs(tabs, sepMap) {
    var s = 0, at = {};
    tabs.forEach(function (t, i) { t.forEach(function (n) { at[n] = i; }); });
    state.sep.forEach(function (p) { if (at[p[0]] != null && at[p[0]] === at[p[1]]) s += 1000; });
    state.adj.forEach(function (p) { if (at[p[0]] != null && at[p[0]] !== at[p[1]]) s += 1000; });
    var bal = $('sexBal').checked;
    tabs.forEach(function (t) {
      var m = 0, f = 0, L = 0;
      t.forEach(function (n) {
        if (sexOf(n) === 'm') m++; else if (sexOf(n) === 'f') f++;
        if (state.leaders[n]) L++;
      });
      if (bal) s += Math.abs(m - f) * 2;
      if (L > 1) s += (L - 1) * 6;
    });
    return s;
  }

  // 台の中の席にならべる（t*6+s の通し番号に入れる）
  function seatOut(tabs) {
    var seats = [];
    tabs.forEach(function (t, i) {
      var mem = t.slice();
      if (state.order === 'number') {
        mem.sort(function (a, b) { return state.names.indexOf(a) - state.names.indexOf(b); });
      } else {
        shuffle(mem);
      }
      for (var s = 0; s < SLOT; s++) seats[i * SLOT + s] = mem[s] || null;
    });
    return seats;
  }

  function run(keepPlan) {
    refreshNames();
    var n = state.names.length;
    if (!n) { note('名簿を入れてください。'); return; }
    refreshRoom();
    var sizes = state.sizes;
    if (sizes.some(function (s) { return s > SLOT; })) {
      note(overWord(), true);
      return;
    }
    state.sep = readPairs('sepList');
    state.adj = readPairs('adjList');

    // 名簿の順のときは、上から順に切るだけ（条件は使わない）
    if (state.order === 'number') {
      var tabs = [], k = 0;
      sizes.forEach(function (sz) { tabs.push(state.names.slice(k, k + sz)); k += sz; });
      state.plans = [seatOut(tabs)];
    } else {
      var sepMap = {};
      state.sep.forEach(function (p) {
        (sepMap[p[0]] = sepMap[p[0]] || {})[p[1]] = true;
        (sepMap[p[1]] = sepMap[p[1]] || {})[p[0]] = true;
      });
      var got = [], seen = {};
      for (var i = 0; i < 240 && got.length < 60; i++) {
        var t2 = buildOnce(sizes, sepMap);
        if (!t2) continue;
        var sig = t2.map(function (t) { return t.slice().sort().join(','); }).join('|');
        if (seen[sig]) continue;
        seen[sig] = true;
        got.push({ tabs: t2, s: scoreTabs(t2, sepMap) });
      }
      if (!got.length) {
        note('この条件では作れませんでした。「同じ班にする」の人数が、1台の人数をこえていないか確かめてください。', true);
        return;
      }
      got.sort(function (a, b) { return a.s - b.s; });
      state.plans = got.slice(0, 3).map(function (g) { return seatOut(g.tabs); });
    }
    state.cur = keepPlan ? Math.min(state.cur, state.plans.length - 1) : 0;
    state.seats = state.plans[state.cur].slice();
    $('result').hidden = false;
    $('msg').innerHTML = '';
    drawTabs();
    drawSheet();
    if ($('save').checked) save();
  }

  function note(t, warn) {
    $('msg').innerHTML = '<div class="notice' + (warn ? ' warn' : '') + '">' + esc(t) + '</div>';
  }

  function drawTabs() {
    var box = $('tabs');
    box.innerHTML = '';
    if (state.plans.length < 2) return;
    state.plans.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = '案' + (i + 1);
      if (i === state.cur) b.className = 'on';
      b.onclick = function () {
        state.cur = i;
        state.seats = state.plans[i].slice();
        drawTabs(); drawSheet();
        if ($('save').checked) save();
      };
      box.appendChild(b);
    });
  }

  // ---- 描く ----
  var POS = [[1, 1], [1, 3], [2, 1], [2, 3]];      // 通常（黒板が上）
  var POSF = [[2, 3], [2, 1], [1, 3], [1, 1]];     // 180度まわしたとき

  function className2(kana) {
    var free = $('clsFree').value.trim();
    var g = $('grade').value, k = $('kumi').value, out = '';
    if (g) {
      var n = g.slice(1);
      if (g[0] === 'e') out += n + '年'; else out += '中' + n;
    }
    if (free) return out ? out + ' ' + free : free;
    if (k) out += k + '組';
    return out;
  }
  function roomWord() { return $('room').value.trim(); }
  function sheetTitle() {
    var c = className2(), r = roomWord();
    return (c ? c + ' ' : '') + (r ? r + ' ' : '') + '座席表';
  }
  function dateText() { return $('dtOff').checked ? '' : ($('dt').value || ''); }
  function nameMode() { return $('nameMode').value; }
  function displayName(raw) {
    var parts = String(raw).split(/[ 　]+/).filter(function (x) { return x.length; });
    if (parts.length < 2) return raw;
    var m = nameMode();
    if (m === 'sei') return parts[0];
    if (m === 'one') return parts.join(' ');
    return parts[0] + NL + parts.slice(1).join(' ');
  }
  function sexColor(n) {
    var g = state.sex[n];
    if (g === 'm') return $('colM').value;
    if (g === 'f') return $('colF').value;
    return '';
  }

  function drawSheet() {
    var box = $('roomBox'), sheet = $('sheet');
    var cols = state.tcols, T = state.sizes.length, rows = Math.ceil(T / cols);
    var flip = (state.board !== 'top');
    var look = $('glook').value;
    var showNo = $('gnum').checked;
    var mark = $('leadMark').checked;

    sheet.className = 'sheet f-' + $('font').value +
      ($('sexPrint').checked ? ' sexprint' : '') + (state.sample ? ' sample' : '');
    $('shTitle').textContent = sheetTitle();
    $('shDate').textContent = dateText();
    $('decoLeft').textContent = $('deco').value || '';
    $('credit').hidden = !$('showCredit').checked;
    $('boardTop').hidden = flip;
    $('boardBottom').hidden = !flip;

    box.className = 'room g-' + look;
    box.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
    box.innerHTML = '';

    var hasEdge = state.sizes.some(function (s) { return s > 4; });
    for (var p = 0; p < rows * cols; p++) {
      var t = flip ? (rows * cols - 1 - p) : p;
      var cell = document.createElement('div');
      if (t >= T) { cell.className = 'tbl-none'; box.appendChild(cell); continue; }
      cell.className = 'tbl' + (flip ? ' flip' : '');
      var col = gcol(t + 1);
      if (look !== 'none') {
        cell.style.setProperty('--gLine', col[0]);
        cell.style.setProperty('--gFill', look === 'edge' ? '#fff' : col[1]);
      }
      var main = document.createElement('div');
      main.className = 'main';
      var body = document.createElement('div');
      body.className = 'body';
      if (showNo) {
        var no = document.createElement('span');
        no.className = 'tno';
        no.innerHTML = (t + 1) + '<small>班</small>';
        body.appendChild(no);
      }
      main.appendChild(body);
      var sz = state.sizes[t];
      for (var s = 0; s < Math.min(sz, 4); s++) {
        var pos = (flip ? POSF : POS)[s];
        var d = seatEl(t * SLOT + s, mark);
        d.style.gridRow = pos[0];
        d.style.gridColumn = pos[1];
        main.appendChild(d);
      }
      cell.appendChild(main);
      if (hasEdge) {
        var edge = document.createElement('div');
        edge.className = 'edge';
        var list = [];
        if (sz > 4) list.push(4);
        if (sz > 5) list.push(5);
        if (flip) list.reverse();
        list.forEach(function (s2) { edge.appendChild(seatEl(t * SLOT + s2, mark)); });
        cell.appendChild(edge);
      }
      box.appendChild(cell);
    }
    fitAll();
    bindDrag();
    drawInfo();
  }

  function seatEl(i, mark) {
    var d = document.createElement('div');
    var nm = state.seats ? state.seats[i] : null;
    d.className = 'gseat' + (nm ? '' : ' empty') +
      (nm && mark && state.leaders[nm] ? ' is-leader' : '');
    d.dataset.i = i;
    var sp = document.createElement('span');
    sp.className = 'nm';
    sp.textContent = nm ? displayName(nm) : '';
    if (nm) {
      var c = sexColor(nm);
      if (c) sp.style.color = c;
    }
    d.appendChild(sp);
    return d;
  }

  // 全員そろえて、いちばん小さい字に合わせる（座席表と同じ考え方）
  function fitAll() {
    var cells = $('roomBox').querySelectorAll('.gseat');
    if (!cells.length) return;
    var size = 17;
    cells.forEach(function (c) {
      var sp = c.querySelector('.nm');
      if (!sp.textContent) return;
      var w = c.clientWidth - 6, h = c.clientHeight - 4, s = size;
      sp.style.fontSize = s + 'px';
      while (s > 8 && (sp.scrollWidth > w || sp.scrollHeight > h)) {
        s -= 1; sp.style.fontSize = s + 'px';
      }
      if (s < size) size = s;
    });
    cells.forEach(function (c) {
      c.querySelector('.nm').style.fontSize = size + 'px';
    });
  }

  // 条件を守れなかったところ・班長のいない班を出す
  function drawInfo() {
    var box = $('vio');
    if (!state.seats) { box.innerHTML = ''; return; }
    var at = {}, out = [];
    state.seats.forEach(function (n, i) { if (n) at[n] = Math.floor(i / SLOT); });
    var bad = [];
    state.sep.forEach(function (p) {
      if (at[p[0]] != null && at[p[0]] === at[p[1]]) bad.push(p[0] + 'さんと' + p[1] + 'さんが同じ班');
    });
    state.adj.forEach(function (p) {
      if (at[p[0]] != null && at[p[1]] != null && at[p[0]] !== at[p[1]]) bad.push(p[0] + 'さんと' + p[1] + 'さんが別の班');
    });
    if (bad.length) out.push('<div class="notice warn">条件どおりにできなかったところ：' + esc(bad.join('／')) + '</div>');

    var L = Object.keys(state.leaders).length;
    if (L) {
      var T = state.sizes.length, none = [];
      for (var t = 0; t < T; t++) {
        var has = false;
        for (var s = 0; s < SLOT; s++) {
          var n2 = state.seats[t * SLOT + s];
          if (n2 && state.leaders[n2]) has = true;
        }
        if (!has) none.push((t + 1) + '班');
      }
      if (none.length) out.push('<div class="notice">班長がいない班：' + esc(none.join('・')) + '</div>');
    }
    box.innerHTML = out.join('');
  }

  // ---- 男女 ----
  function fillColorSelect(sel, val) {
    sel.innerHTML = COLORS.map(function (c) {
      return '<option value="' + c[0] + '">' + c[1] + '</option>';
    }).join('');
    sel.value = val;
  }
  function renderSexList() {
    var box = $('sexList');
    if (!box) return;
    box.innerHTML = '';
    state.names.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      var g = state.sex[n];
      b.className = 'chip' + (g ? ' ' + g : '');
      b.textContent = n;
      var mk = document.createElement('span');
      mk.className = 'mk';
      mk.textContent = g === 'm' ? '男' : g === 'f' ? '女' : '－';
      b.appendChild(mk);
      var col = sexColor(n);
      if (col) b.style.color = col;
      b.onclick = function () {
        var cur = state.sex[n];
        if (!cur) state.sex[n] = 'm';
        else if (cur === 'm') state.sex[n] = 'f';
        else delete state.sex[n];
        renderSexList();
        if (state.seats) drawSheet();
        if ($('save').checked) save();
      };
      box.appendChild(b);
    });
  }

  // ---- つまんで入れかえ ----
  var drag = null;
  function cellAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('gseat')) return el;
      el = el.parentElement;
    }
    return null;
  }
  function bindDrag() {
    $('roomBox').querySelectorAll('.gseat').forEach(function (d) {
      d.addEventListener('pointerdown', dragStart);
      d.addEventListener('dragstart', function (e) { e.preventDefault(); });
    });
  }
  function dragStart(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var d = e.currentTarget;
    drag = {
      el: d, from: +d.dataset.i, id: e.pointerId,
      x0: e.clientX, y0: e.clientY, active: false, ghost: null, over: null
    };
    try { d.setPointerCapture(e.pointerId); } catch (err) { }
    d.addEventListener('pointermove', dragMove);
    d.addEventListener('pointerup', dragEnd);
    d.addEventListener('pointercancel', dragEnd);
  }
  function lift(x, y) {
    var r = drag.el.getBoundingClientRect();
    var gh = document.createElement('div');
    gh.className = 'drag-ghost';
    gh.style.width = r.width + 'px';
    gh.style.height = r.height + 'px';
    gh.style.left = r.left + 'px';
    gh.style.top = r.top + 'px';
    gh.innerHTML = drag.el.innerHTML;
    document.body.appendChild(gh);
    drag.ghost = gh;
    drag.dx = x - r.left;
    drag.dy = y - r.top;
    drag.active = true;
    drag.el.classList.add('lift');
  }
  function dragMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return;
      lift(drag.x0, drag.y0);
    }
    e.preventDefault();
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
    drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    var t = cellAt(e.clientX, e.clientY);
    if (t !== drag.over) {
      if (drag.over) drag.over.classList.remove('over');
      drag.over = t;
      if (t) t.classList.add('over');
    }
  }
  function dragEnd() {
    if (!drag) return;
    var d = drag.el;
    d.removeEventListener('pointermove', dragMove);
    d.removeEventListener('pointerup', dragEnd);
    d.removeEventListener('pointercancel', dragEnd);
    try { d.releasePointerCapture(drag.id); } catch (err) { }
    if (!drag.active) { drag = null; return; }
    var target = drag.over, gh = drag.ghost, from = drag.from;
    if (target) target.classList.remove('over');
    var to = target ? +target.dataset.i : from;
    var rect = (target || d).getBoundingClientRect();
    gh.classList.add('snap');
    gh.style.left = rect.left + 'px';
    gh.style.top = rect.top + 'px';
    setTimeout(function () {
      if (gh.parentNode) gh.parentNode.removeChild(gh);
      d.classList.remove('lift');
      if (to !== from) {
        var t2 = state.seats[from]; state.seats[from] = state.seats[to]; state.seats[to] = t2;
      }
      drawSheet();
      if ($('save').checked) save();
    }, 140);
    drag = null;
  }

  // ---- 紙（1枚の絵にしてから印刷する）----
  // 🔴 画面のCSSで紙に収めようとしない。端末ごとの余白が分からず、はみ出す。
  //   絵を1枚つくって、紙の形に合わせて余白を足す＝必ず1ページに収まる
  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t); x.lineTo(l + w - r, t); x.quadraticCurveTo(l + w, t, l + w, t + r);
    x.lineTo(l + w, t + h - r); x.quadraticCurveTo(l + w, t + h, l + w - r, t + h);
    x.lineTo(l + r, t + h); x.quadraticCurveTo(l, t + h, l, t + h - r);
    x.lineTo(l, t + r); x.quadraticCurveTo(l, t, l + r, t);
    x.closePath();
  }

  function buildSheetCanvas(k, flipPaper) {
    k = k || 1;
    var cols = state.tcols, T = state.sizes.length, rows = Math.ceil(T / cols);
    var flip = flipPaper;
    var look = $('glook').value, showNo = $('gnum').checked, mark = $('leadMark').checked;
    var credit = $('showCredit').checked, icon = $('deco').value || '';
    var hasEdge = state.sizes.some(function (s) { return s > 4; });

    var sw = 128, sh = 58, tw = 104, gap = 5;
    var th = sh * 2 + gap;
    var CW = sw * 2 + tw + gap * 2;
    var CH = th + (hasEdge ? sh + gap : 0);
    var gx = 20, gy = 24, pad = 40, head = 66, boardH = 40;
    var W = pad * 2 + cols * CW + (cols - 1) * gx;
    var H = pad * 2 + head + boardH + rows * CH + (rows - 1) * gy + (credit ? 26 : 0);

    var cv = document.createElement('canvas');
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    var x = cv.getContext('2d');
    x.scale(k, k);
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);

    // 見出し
    var dt = dateText();
    x.fillStyle = '#333'; x.font = 'bold 28px sans-serif'; x.textBaseline = 'top';
    var tx = pad + (icon ? 44 : 0);
    var dtw = dt ? x.measureText(dt).width + 20 : 0;
    x.fillText(sheetTitle(), tx, pad - 10, W - pad - tx - dtw);
    if (icon) { x.font = '30px sans-serif'; x.fillText(icon, pad, pad - 8); }
    x.font = '18px sans-serif'; x.fillStyle = '#777';
    x.fillText(dt, W - pad - x.measureText(dt).width, pad - 4);

    // 黒板
    var top = pad + head;
    var boardY = flip ? (top + rows * CH + (rows - 1) * gy + 6) : top;
    x.fillStyle = '#3e5c4b';
    x.fillRect(pad, boardY, W - pad * 2, boardH - 12);
    x.fillStyle = '#fff'; x.font = '18px sans-serif'; x.textAlign = 'center';
    x.fillText('黒 板', W / 2, boardY + 3);
    x.textAlign = 'left';

    var gyTop = top + (flip ? 0 : boardH);

    // 名前の大きさは、先に全員ぶんを測っていちばん小さいものにそろえる
    var nameSize = 26;
    (state.seats || []).forEach(function (nm) {
      if (!nm) return;
      var ls = displayName(nm).split(NL), sz = nameSize;
      while (sz > 9) {
        x.font = 'bold ' + sz + 'px ' + fontStack();
        var over = ls.some(function (t2) { return x.measureText(t2).width > sw - 14; });
        if (!over && ls.length * sz * 1.25 < sh - 10) break;
        sz -= 1;
      }
      if (sz < nameSize) nameSize = sz;
    });

    function seatBox(i, l, t2) {
      var nm = state.seats[i];
      roundRect(x, l, t2, sw, sh, 8);
      x.fillStyle = '#fff'; x.fill();
      x.strokeStyle = seatLine; x.lineWidth = 2; x.stroke();
      if (!nm) return;
      var lines = displayName(nm).split(NL);
      x.fillStyle = '#333';
      x.font = 'bold ' + nameSize + 'px ' + fontStack();
      x.textAlign = 'center'; x.textBaseline = 'middle';
      var lh = nameSize * 1.25, t0 = t2 + sh / 2 - (lines.length - 1) * lh / 2;
      lines.forEach(function (s2, li) { x.fillText(s2, l + sw / 2, t0 + li * lh); });
      x.textAlign = 'left'; x.textBaseline = 'top';
      if (mark && state.leaders[nm]) {
        x.fillStyle = '#E0A800';
        x.font = 'bold 15px sans-serif';
        x.fillText('★', l + sw - 17, t2 + 3);
      }
    }
    var seatLine = '#c9c9c9';

    for (var p = 0; p < rows * cols; p++) {
      var t = flip ? (rows * cols - 1 - p) : p;
      if (t >= T) continue;
      var cr = Math.floor(p / cols), cc = p % cols;
      var ox = pad + cc * (CW + gx), oy = gyTop + cr * (CH + gy);
      var col = gcol(t + 1);
      seatLine = (look === 'none') ? '#c9c9c9' : col[0];
      // 台
      var bx = ox + sw + gap, by = oy + (flip && hasEdge ? sh + gap : 0);
      roundRect(x, bx, by, tw, th, 8);
      if (look !== 'none' && look !== 'edge') {
        x.fillStyle = col[1]; x.fill();
      } else {
        x.fillStyle = '#fff'; x.fill();
      }
      x.strokeStyle = (look === 'none') ? '#c9c9c9' : col[0];
      x.lineWidth = 3; x.stroke();
      if (showNo) {
        x.fillStyle = (look === 'none') ? '#555' : col[0];
        x.font = 'bold 26px sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(String(t + 1), bx + tw / 2, by + th / 2 - 8);
        x.font = '15px sans-serif';
        x.fillText('班', bx + tw / 2, by + th / 2 + 15);
        x.textAlign = 'left'; x.textBaseline = 'top';
      }
      // 長い辺の4人
      var sz = state.sizes[t];
      for (var s = 0; s < Math.min(sz, 4); s++) {
        var pos = (flip ? POSF : POS)[s];
        var l2 = ox + (pos[1] === 1 ? 0 : sw + tw + gap * 2);
        var t3 = by + (pos[0] === 1 ? 0 : sh + gap);
        seatBox(t * SLOT + s, l2, t3);
      }
      // 短い辺（黒板から遠いほう）
      if (sz > 4) {
        var list = [4];
        if (sz > 5) list.push(5);
        if (flip) list.reverse();
        var ey = flip ? oy : (by + th + gap);
        var totalW = list.length * sw + (list.length - 1) * gap;
        var ex = ox + (CW - totalW) / 2;
        list.forEach(function (s2, li) { seatBox(t * SLOT + s2, ex + li * (sw + gap), ey); });
      }
    }

    if (credit) {
      x.font = '15px sans-serif'; x.fillStyle = '#c3b2ba'; x.textAlign = 'right';
      x.fillText('さくら先生の座席表　sakura-teachers.com', W - pad, H - pad - 6);
      x.textAlign = 'left';
    }
    if (state.sample) {
      x.save();
      x.translate(W / 2, H / 2); x.rotate(-18 * Math.PI / 180);
      x.fillStyle = 'rgba(229,143,174,0.22)';
      x.font = 'bold ' + Math.round(W / 6) + 'px sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('SAMPLE', 0, 0);
      x.restore();
    }
    return cv;
  }

  // 🔴 絵を紙の形に合わせる。
  //   ⚠iPadは印刷のとき幅だけを見て縮める。高さの指定は効かない。
  //     なので絵のほうを、紙より少し横長にしておく
  function padToAspect(src, ratio) {
    var w = src.width, h = src.height, W = w, H = h;
    if (w / h < ratio) W = Math.round(h * ratio); else H = Math.round(w / ratio);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.drawImage(src, Math.round((W - w) / 2), 0);
    return cv;
  }

  function setPaper() {
    var st = $('pageRule');
    if (!st) { st = document.createElement('style'); st.id = 'pageRule'; document.head.appendChild(st); }
    st.textContent = '@page{size:A4 ' + $('paper').value + ';margin:10mm}';
  }
  function paperFlip() {
    // 🔴 紙だけ先生の向きにする（画面は変えない）。
    //   ⚠「入れ替える」ではなく「先生の向きに決める」。座席表と同じ考え方（2026-08-31）
    if ($('printTeacher').checked) return true;
    return (state.board !== 'top');
  }
  function buildPrintImage() {
    var wide = $('paper').value === 'landscape';
    var cv = padToAspect(buildSheetCanvas(2, paperFlip()), wide ? 1.50 : 0.75);
    var wrap = $('printImgWrap');
    wrap.innerHTML = '';
    wrap.appendChild(cv);
    document.body.classList.add('print-img');
  }
  var printScrollY = 0;
  function doPrint() {
    if (!state.seats) { note('先に「班を作る」を押してください。'); return; }
    printScrollY = window.scrollY || window.pageYOffset || 0;
    setPaper();
    try { buildPrintImage(); } catch (e) { }
    window.print();
  }
  // ⚠ ブラウザの印刷（Ctrl+P）から入ってきたときも、絵を作ってから出す
  window.addEventListener('beforeprint', function () {
    if (!state.seats) return;
    if ($('printImgWrap').innerHTML) return;
    setPaper();
    try { buildPrintImage(); } catch (e) { }
  });
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-img');
    $('printImgWrap').innerHTML = '';
    setTimeout(function () { window.scrollTo(0, printScrollY); }, 0);
    setTimeout(function () { window.scrollTo(0, printScrollY); }, 250);
  });
  function doPng() {
    if (!state.seats) { note('先に「班を作る」を押してください。'); return; }
    var cv = buildSheetCanvas(1, state.board !== 'top');
    var a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = (sheetTitle().replace(/\s/g, '') || '座席表') + '.png';
    a.click();
  }

  // ---- 保存 ----
  function snapshot() {
    return {
      names: $('names').value,
      grade: $('grade').value, kumi: $('kumi').value, clsFree: $('clsFree').value,
      room: $('room').value, nameMode: $('nameMode').value,
      tcols: $('tcols').value, tnum: $('tnum').value, gsize: $('gsize').value,
      board: $('board').value, order: $('order').value,
      sep: readPairs('sepList'), adj: readPairs('adjList'),
      sex: state.sex,
      sexBal: $('sexBal').checked, sexPrint: $('sexPrint').checked,
      colM: $('colM').value, colF: $('colF').value,
      font: $('font').value, glook: $('glook').value, deco: $('deco').value,
      dt: $('dt').value, dtOff: $('dtOff').checked,
      gnum: $('gnum').checked, leadMark: $('leadMark').checked,
      showCredit: $('showCredit').checked,
      paper: $('paper').value, printTeacher: $('printTeacher').checked,
      // ⚠サンプルは残さない。名簿を入れていない人の画面が、次に開いたとき居座ってしまう
      seats: (state.sample || !state.seats) ? null : state.seats.slice(),
      sizes: state.sizes.slice()
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) { }
    showSaving();
  }
  function showSaving() {
    var el = $('savingLabel');
    if (!$('save').checked) { el.textContent = ''; return; }
    el.textContent = '保存しました';
    setTimeout(function () { el.textContent = ''; }, 1400);
  }
  function applySnap(d) {
    if (!d) return;
    function set(id, v) { if (v != null && $(id)) $(id).value = v; }
    function chk(id, v) { if (v != null && $(id)) $(id).checked = !!v; }
    set('names', d.names); set('grade', d.grade); set('kumi', d.kumi);
    set('clsFree', d.clsFree); set('room', d.room); set('nameMode', d.nameMode);
    set('tcols', d.tcols); set('tnum', d.tnum); set('gsize', d.gsize);
    set('board', d.board); set('order', d.order);
    set('colM', d.colM); set('colF', d.colF);
    set('font', d.font); set('glook', d.glook); set('deco', d.deco);
    set('dt', d.dt); set('paper', d.paper);
    chk('sexBal', d.sexBal); chk('sexPrint', d.sexPrint); chk('dtOff', d.dtOff);
    chk('gnum', d.gnum); chk('leadMark', d.leadMark); chk('showCredit', d.showCredit);
    chk('printTeacher', d.printTeacher);
    state.sex = d.sex || {};
    $('sepList').innerHTML = ''; $('adjList').innerHTML = '';
    state.lastRaw = d.names;          // 貼り直しとみなさない＝男女の指定を消さない
    refreshNames();
    (d.sep || []).forEach(function (p) { addPairRow('sepList', p[0], p[1]); });
    (d.adj || []).forEach(function (p) { addPairRow('adjList', p[0], p[1]); });
    if ((d.sep && d.sep.length) || (d.adj && d.adj.length)) $('condBlock').open = true;
    state.board = $('board').value;
    refreshRoom();
    // ⚠ 席は作り直さない。作り直すと、保存したときと違う並びが出る
    if (d.seats && d.sizes && d.sizes.length) {
      state.sizes = d.sizes.slice();
      state.seats = d.seats.slice();
      state.plans = [state.seats.slice()];
      state.cur = 0;
      state.sep = readPairs('sepList'); state.adj = readPairs('adjList');
      $('result').hidden = false;
      drawTabs(); drawSheet();
    }
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return false;
      $('save').checked = true;
      applySnap(d);
      return true;
    } catch (e) { return false; }
  }

  // ---- 名簿の置き場（座席表・席次表と共通）----
  function loadStore() {
    try {
      var d = JSON.parse(localStorage.getItem(KEYC) || 'null');
      if (d && d.classes) return d;
      var old = JSON.parse(localStorage.getItem(KEYOLD) || 'null');
      if (old && old.classes && old.classes.length) {
        var st = {
          v: 2, classes: old.classes.map(function (c) {
            return {
              id: c.id, label: c.label,
              names: (c.d && c.d.names) || '',
              seat: c.d || null, seki: null, group: null,
              recs: c.recs || []
            };
          })
        };
        saveStore(st);
        return st;
      }
      return { v: 2, classes: [] };
    } catch (e) { return { v: 2, classes: [] }; }
  }
  function saveStore(st) {
    try { localStorage.setItem(KEYC, JSON.stringify(st)); return true; }
    catch (e) {
      $('msg2').innerHTML = '<div class="notice warn">保存できませんでした。' +
        'ブラウザの空きが足りないようです。古い名簿を消してから、もう一度お試しください。</div>';
      return false;
    }
  }
  function drawClasses() {
    var st = loadStore(), keep = $('clsSel').value;
    var opt = '<option value="">－</option>' + st.classes.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.label) + '</option>';
    }).join('');
    $('clsSel').innerHTML = opt;
    $('clsSel2').innerHTML = opt;
    if (keep) { $('clsSel').value = keep; $('clsSel2').value = keep; }
    $('clsCount').textContent = st.classes.length
      ? st.classes.length + '／' + MAXC + '件'
      : '0／' + MAXC + '件・まだ保存していません';
    $('quickLoad').hidden = !st.classes.length;
  }
  function findClass(st, id) {
    for (var i = 0; i < st.classes.length; i++) if (st.classes[i].id === id) return st.classes[i];
    return null;
  }
  function clsNew() {
    var st = loadStore();
    if (st.classes.length >= MAXC) {
      alert('名簿は' + MAXC + '件までです。いらないものを消してから保存してください。');
      return;
    }
    var def = className2() || (roomWord() || '名簿');
    var label = prompt('名前を付けて保存します。', def);
    if (label == null) return;
    label = label.trim();
    if (!label) return;
    var same = null;
    st.classes.forEach(function (c) { if (c.label === label) same = c; });
    if (same) {
      if (!confirm('同じ名前の名簿があります。差し替えますか。')) return;
      same.names = $('names').value;
      same.group = snapshot();
    } else {
      st.classes.push({
        id: 'g' + Date.now(), label: label,
        names: $('names').value, seat: null, seki: null, group: snapshot(), recs: []
      });
    }
    if (!saveStore(st)) return;
    drawClasses();
    var last = same || st.classes[st.classes.length - 1];
    $('clsSel').value = last.id; $('clsSel2').value = last.id;
    msg2('「' + label + '」を保存しました。');
  }
  function clsSave() {
    var st = loadStore(), c = findClass(st, $('clsSel').value);
    if (!c) { alert('上書きする名簿を選んでください。'); return; }
    if (!confirm('「' + c.label + '」を、いまの画面で上書きします。よろしいですか。')) return;
    c.names = $('names').value;
    c.group = snapshot();
    if (!saveStore(st)) return;
    msg2('「' + c.label + '」を上書きしました。');
  }
  function clsDel() {
    var st = loadStore(), c = findClass(st, $('clsSel').value);
    if (!c) { alert('消す名簿を選んでください。'); return; }
    if (!confirm('「' + c.label + '」を消します。座席表メーカー・席次表メーカーからも消えます。もとには戻せません。')) return;
    st.classes = st.classes.filter(function (x) { return x.id !== c.id; });
    if (!saveStore(st)) return;
    drawClasses();
    msg2('「' + c.label + '」を消しました。');
  }
  function clsLoad(id) {
    var st = loadStore(), c = findClass(st, id);
    if (!c) { alert('呼び出す名簿を選んでください。'); return; }
    if (!confirm('「' + c.label + '」を読み込みます。いま画面にあるものは消えます。よろしいですか。')) return;
    // ⚠ほかのツールだけで保存したものは、この設定が空。そのときは名簿だけ入れる
    var d = c.group ? JSON.parse(JSON.stringify(c.group)) : {};
    d.names = c.names != null ? c.names : (d.names || '');
    d.seats = c.group ? c.group.seats : null;
    applySnap(d);
    if ($('save').checked) save();
    msg2('「' + c.label + '」を読み込みました。');
  }
  function clsClearAll() {
    if (!confirm('この機器から、保存した名簿を全部消します。座席表メーカー・席次表メーカーからも消えます。もとには戻せません。')) return;
    try { localStorage.removeItem(KEYC); } catch (e) { }
    drawClasses();
    msg2('保存した名簿を全部消しました。');
  }
  function msg2(t) {
    $('msg2').innerHTML = '<div class="notice">' + esc(t) + '</div>';
    setTimeout(function () { $('msg2').innerHTML = ''; }, 4000);
  }

  // ---- ⓘボタン ----
  function bindTips() {
    document.addEventListener('click', function (e) {
      var b = e.target;
      while (b && b !== document.body && !(b.classList && b.classList.contains('tip-btn'))) b = b.parentElement;
      if (!b || b === document.body) return;
      if (b.parentElement && b.parentElement.tagName === 'SUMMARY') {
        var det = b.parentElement.parentElement;
        if (det && det.tagName === 'DETAILS' && !det.open) det.open = true;
        e.preventDefault();
      }
      var head = b.parentElement;
      var body = head.nextElementSibling;
      if (body && !body.classList.contains('tip-body')) body = body.querySelector('.tip-body');
      if (!body || !body.classList.contains('tip-body')) return;
      var willOpen = body.hidden;
      body.hidden = !willOpen;
      b.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  function paperNote() {
    var wide = $('paper').value === 'landscape';
    var three = state.tcols === 3;
    $('paperNote').textContent =
      (three && !wide) ? '3列のときは、用紙を横にすると大きく出ます。'
        : (!three && wide) ? '2列のときは、用紙を縦にすると大きく出ます。' : '';
  }

  // ---- 起動 ----
  function init() {
    state.sampleNames = SAMPLE.map(function (s) { return s[0]; });
    SAMPLE.forEach(function (s) { if (!state.sex[s[0]]) state.sex[s[0]] = s[1]; });
    fillColorSelect($('colM'), '#1f5fbf');
    fillColorSelect($('colF'), '#b02a7a');
    bindTips();

    $('names').addEventListener('input', function () {
      refreshNames();
      if ($('save').checked) save();
    });
    ['tcols', 'tnum', 'gsize', 'order'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        refreshRoom(); paperNote();
        // 🔴 部屋の形を変えたら、その場で作り直す（2026-09-02 本人「5人にしても変わらない」）。
        //   ⚠②の説明だけ変わって、下の座席表が前のままだと「効いていない」ように見える。
        //     ならぶ向きを選んだ瞬間に反映した 2026-08-31 と同じ考え方
        if (state.seats) run(true);
        else if ($('save').checked) save();
      });
    });
    $('board').addEventListener('change', function () {
      state.board = $('board').value;
      if (state.seats) drawSheet();
      if ($('save').checked) save();
    });
    ['nameMode', 'font', 'glook', 'deco', 'dt', 'room', 'grade', 'kumi', 'clsFree',
      'colM', 'colF'].forEach(function (id) {
        $(id).addEventListener('change', function () {
          if (state.seats) drawSheet();
          if (id === 'colM' || id === 'colF') renderSexList();
          if ($('save').checked) save();
        });
      });
    $('dt').addEventListener('input', function () { if (state.seats) drawSheet(); });
    $('room').addEventListener('input', function () { if (state.seats) drawSheet(); });
    ['dtOff', 'gnum', 'leadMark', 'showCredit', 'sexPrint'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (state.seats) drawSheet();
        if ($('save').checked) save();
      });
    });
    $('sexBal').addEventListener('change', function () { if ($('save').checked) save(); });
    $('sexClear').addEventListener('click', function () {
      state.sex = {};
      renderSexList();
      if (state.seats) drawSheet();
      if ($('save').checked) save();
    });
    $('paper').addEventListener('change', function () {
      paperNote();
      if ($('save').checked) save();
    });
    $('printTeacher').addEventListener('change', function () { if ($('save').checked) save(); });

    $('addSep').onclick = function () { addPairRow('sepList'); };
    $('addAdj').onclick = function () { addPairRow('adjList'); };
    $('go').onclick = function () { run(false); };
    $('again').onclick = function () { run(false); };
    $('doPrint').onclick = doPrint;
    $('doPng').onclick = doPng;

    $('save').addEventListener('change', function () {
      if ($('save').checked) save();
      else { try { localStorage.removeItem(KEY); } catch (e) { } $('savingLabel').textContent = ''; }
    });
    $('clsNew').onclick = clsNew;
    $('clsSave').onclick = clsSave;
    $('clsDel').onclick = clsDel;
    $('clsClearAll').onclick = clsClearAll;
    $('clsLoad2').onclick = function () { clsLoad($('clsSel2').value); };
    $('clsSel').addEventListener('change', function () { $('clsSel2').value = $('clsSel').value; });
    $('clsSel2').addEventListener('change', function () { $('clsSel').value = $('clsSel2').value; });

    window.addEventListener('resize', function () { if (state.seats) fitAll(); });

    drawClasses();
    refreshNames();
    load();
    // 🔴 復元したあとに、もう一度書き戻す。
    //   ⚠これを入れないと「2回目に開くと消える」（座席表・席次表で起きた 2026-08-31）
    if ($('save').checked) save();
    paperNote();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
