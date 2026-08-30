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
    plans: [], cur: 0, seats: null,
    sex: {},                        // 名前 -> 'm' / 'f'（名前をキーにするので名簿を貼り直しても残る）
    sample: false, sampleNames: [],  // サンプルは名簿欄に入れない（消す手間が出るので）
    grp: { on: false, size: 4, style: 'block', look: 'both', num: true },
    gmap: null, gcount: 0,
    gfix: {}                        // 先生が手で変えた班（席の番号 → 班の番号）
  };

  // 班の色（色の見分けがつきにくい方にも伝わる組み合わせ）
  // [線の色, うすい塗り, ぬりつぶしの塗り]
  // ⚠ぬりつぶしの塗りは、名前が読める濃さまでにとどめる。
  //   色ごとに明るさが違うので、濃さは1色ずつ決めてある
  // 赤・橙・黄・黄緑・緑・水色・青・紫・桃 の9色。
  // ［線の色, うすい塗り, ぬりつぶしの塗り, 色あい（色相）］
  // ⚠水色と青は色が近いので、明るさを変えてある
  var GCOL = [
    ['#EF6B6B', 'rgba(239,107,107,.14)', 'rgba(239,107,107,.29)', 0],   // 赤
    ['#3FBF88', 'rgba(63,191,136,.14)', 'rgba(63,191,136,.29)', 145],   // 緑
    ['#EF6BAE', 'rgba(239,107,174,.13)', 'rgba(239,107,174,.27)', 325], // 桃
    ['#4A8FD6', 'rgba(74,143,214,.14)', 'rgba(74,143,214,.28)', 220],   // 青
    ['#F2913F', 'rgba(242,145,63,.15)', 'rgba(242,145,63,.32)', 28],    // 橙
    ['#6FC9E8', 'rgba(111,201,232,.18)', 'rgba(111,201,232,.36)', 193], // 水色
    ['#8CC63F', 'rgba(140,198,63,.17)', 'rgba(140,198,63,.34)', 85],    // 黄緑
    ['#9B6BE0', 'rgba(155,107,224,.13)', 'rgba(155,107,224,.25)', 270], // 紫
    ['#E8B62A', 'rgba(232,182,42,.17)', 'rgba(232,182,42,.35)', 50]     // 黄
  ];

  // 班の番号の順に、上から色を使う。9班をこえたら赤にもどってくり返す。
  // ⚠となり合う班の色を計算で離す作りも試したが、取り下げた（2026-08-27 本人の判断）＝
  //   使われない色が出て見た目がさびしくなる／近い色がとなり合っても先生が番号を押して直せる／
  //   それより「3人班がちゃんとかぎ型になっている」ほうが大事
  function gcol(no) { return GCOL[(no - 1) % GCOL.length]; }

  // ---- 名簿 ----
  function readNames() {
    return $('names').value.split('\n')
      .map(function (s) { return s.replace(/\s+$/, '').replace(/^\s+/, ''); })
      .filter(function (s) { return s.length; });
  }
  function refreshNames() {
    var typed = readNames();
    if (state.sample && !typed.length) {
      state.names = state.sampleNames;
      $('count').textContent = 'サンプル ' + state.names.length + '人';
    } else {
      state.names = typed;
      $('count').textContent = state.names.length + '人';
    }
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
      el.textContent = n ? '空席は ' + (total - n) : '';
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
  // ---- 書体 ----
  // ⚠ 丸文字はWindows（HG丸ｺﾞｼｯｸM-PRO）とiPad・Mac（ヒラギノ丸ゴ ProN）だけ。
  //   無い機器では静かにゴシックになる（崩れはしない）
  var FONTS = {
    mincho: '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", "MS PMincho", serif',
    gothic: '"Yu Gothic", YuGothic, "Hiragino Sans", Meiryo, sans-serif',
    maru: '"HG丸ｺﾞｼｯｸM-PRO", HGMaruGothicMPRO, "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif'
  };
  function fontStack() {
    var v = $('font') ? $('font').value : 'gothic';
    return FONTS[v] || FONTS.gothic;
  }

  // ---- 文字の色（赤と緑は見分けにくいので、はじめは青系と赤紫系にしてある） ----
  var COLORS = [
    ['#333333', '黒'], ['#1f5fbf', '青'], ['#b02a7a', '赤紫'],
    ['#26418f', '紺'], ['#c4611a', 'だいだい'], ['#17724a', '緑'], ['#8a5a2b', '茶']
  ];

  // ---- サンプル（ひらがな35人・男女半々） ----
  // ⚠35人にしてあるのは、日本の1クラスが最大35人だから。
  //   少ない人数だと、実際の教室の埋まり方が伝わらない
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

  // 座席表に出す日付（「日付を入れない」のときは空）
  // ＝モニターに映すときは消して、紙に残すときだけ入れる、という使い分けのため
  function dateText() {
    return $('dtOff').checked ? '' : ($('dt').value || '');
  }

  function isKana() { var e = $('kana'); return e && e.value === 'kana'; }
  function titleWord() { return isKana() ? 'ざせきひょう' : '座席表'; }
  function boardWord() { return isKana() ? 'こ く ば ん' : '黒 板'; }
  function sheetTitle() {
    var kana = isKana(), c = className(kana);
    return (c ? c + ' ' : '') + titleWord();
  }
  function sexColor(name) {
    var g = state.sex[name];        // 指定していない人は色を付けない（黒のまま）
    if (g === 'm') return $('colM').value;
    if (g === 'f') return $('colF').value;
    return '';
  }

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

  // ---- 出席番号順（入力した順に並べる） ----
  function orderedSeats(opt) {
    var cols = opt.cols, rows = opt.rows, total = cols * rows;
    var seats = new Array(total).fill(null);
    var order = [], r, c, cc;
    // 縦か横か／左の列からか右の列からか（学校によって1番の席が逆になる）
    var dv = $('dir').value;
    var tate = (dv === 'v' || dv === 'vr');
    var migi = (dv === 'vr' || dv === 'hr');
    if (tate) {
      for (c = 0; c < cols; c++) {
        cc = migi ? cols - 1 - c : c;
        for (r = 0; r < rows; r++) order.push(r * cols + cc);
      }
    } else {
      for (r = 0; r < rows; r++) {
        for (c = 0; c < cols; c++) {
          cc = migi ? cols - 1 - c : c;
          order.push(r * cols + cc);
        }
      }
    }
    opt.names.forEach(function (n, i) { if (i < order.length) seats[order[i]] = n; });
    return seats;
  }

  // ---- 席替えを実行 ----
  function run(first) {
    // 名簿が空ならサンプルで動かす（初めての人に、何ができるかを1回で見せる）
    if (!readNames().length) {
      // 教室の形はそのまま。席に入る分だけサンプルを使う。
      // ⚠名簿欄には入れない＝自分の名簿を貼るとき、消す手間が要らない
      var room = (+$('cols').value) * (+$('rows').value);
      var use = SAMPLE.slice(0, Math.max(1, Math.min(SAMPLE.length, room)));
      state.sampleNames = use.map(function (x) { return x[0]; });
      use.forEach(function (x) { state.sex[x[0]] = x[1]; });
      state.sample = true;
    }
    refreshNames();
    renderSexList();
    state.gfix = {};                // 席替えをしたら、手で変えた班は白紙に戻す
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

    // 出席番号順のときは条件を使わず、答えは1つだけ
    if ($('order').value === 'number') {
      opt.separate = []; opt.adjacent = []; opt.fixed = {}; opt.zone = {};
      state.plans = [orderedSeats(opt)]; state.cur = 0; state.opt = opt;
      state.seats = state.plans[0].slice();
      $('result').hidden = false;
      drawTabs(); drawSheet(); printNote(); showSample();
      if (!first) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if ($('save').checked && !state.sample) save();
      return;
    }

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
    showSample();
    if (!first) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (state.sample) { /* サンプルは保存しない */ }
    else if ($('save').checked) save();
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
    t.hidden = state.plans.length < 2;
    if (t.hidden) return;
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
    $('shDate').textContent = dateText();
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

    // 班（席のかたまりに付ける。人を動かせば班も入れ替わる）
    var gm = null;
    if (state.grp.on) {
      var gr = Seating.groups(state.seats, cols, rows, state.grp.size, state.grp.style, state.board);
      gm = gr.map; state.gcount = gr.count;
      // 先生が手で変えたぶんを上からかぶせる
      for (var fk in state.gfix) {
        var fi = +fk;
        if (state.seats[fi]) {
          gm[fi] = state.gfix[fk];
          if (state.gfix[fk] > state.gcount) state.gcount = state.gfix[fk];
        }
      }
    } else state.gcount = 0;
    state.gmap = gm;

    for (var dr = 0; dr < rows; dr++) {
      var r = (state.board === 'top') ? dr : rows - 1 - dr;
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        var name = state.seats[i];
        var d = document.createElement('div');
        d.className = 'seat' + (name ? '' : ' empty') + (bad[i] ? ' bad' : '');
        // ⚠draggable は付けない。ブラウザ標準のドラッグが割り込んで、
        //   マウスで動かしたときに禁止マークが出てしまう（動かすのは下の自作の処理）
        d.dataset.i = i;
        if (gm && gm[i]) {
          var gc = gcol(gm[i]);
          d.classList.add('grp', 'g-' + state.grp.look);
          d.style.setProperty('--gLine', gc[0]);
          d.style.setProperty('--gFill', state.grp.look === 'fill' ? gc[2] : gc[1]);
          var gn = document.createElement('span');
          // 「班の番号を出す」を外しても、この画面では薄く残す（押して班を変えられるように）。
          // 紙・モニター・画像には出さない
          gn.className = 'gno' + (state.grp.num ? '' : ' dim');
          gn.textContent = gm[i];
          gn.title = '押すと、この席の班をえらべます';
          // 席を動かすほうの操作と混ざらないように、ここで止める
          gn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
          gn.addEventListener('click', openGroupPick);
          d.appendChild(gn);
        }
        if (name) {
          var sp = document.createElement('span');
          sp.className = 'nm';
          sp.textContent = displayName(name);
          var col = sexColor(name);
          if (col) sp.style.color = col;
          d.appendChild(sp);
        } else d.textContent = '空';
        g.appendChild(d);
      }
    }
    // 印刷で紙いっぱいに使う。席が少ないときは1マスを大きくする
    // 用紙の向きで、座席に使える高さ(mm)も1マスの上限も変わる
    var wide = $('paper').value === 'landscape';
    // 紙で座席に使える高さ(mm)と、1マスの上限(mm)。
    // ⚠A4横なら「210 − 余白24 − 見出しや黒板ぶん24」で約162mm使える。
    //   前は140mmしか割り当てず、22mmあまらせていた（紙だけ縮こまって見えた原因）
    var avail = wide ? 154 : 242;
    var cap = wide ? 36 : 46;
    var mm = Math.max(11, Math.min(cap, Math.round(avail / rows)));
    $('sheet').style.setProperty('--seatH', mm + 'mm');
    // 印刷したときの1マスの大きさ（用紙の幅から逆算）
    var pageW = ($('paper').value === 'landscape' ? 297 : 210) - 24;
    var cellWmm = (pageW - (cols - 1) * 1.6) / cols;
    $('credit').hidden = !$('showCredit').checked;
    $('sheet').classList.toggle('bold', $('bold').checked);
    $('sheet').classList.remove('f-mincho', 'f-gothic', 'f-maru');
    $('sheet').classList.add('f-' + ($('font') ? $('font').value : 'gothic'));
    var onScreen = document.body.classList.contains('screen');
    // 男女の色は画面では出したまま、紙では黒にする（既定）。
    // 班の色を付けると、男女の色まで乗って読みにくくなるため
    $('sheet').classList.toggle('sexprint', $('sexPrint').checked);
    var base = $('bold').checked ? 22 : 17;
    if (onScreen) {
      // 教室のモニターは遠くから見るので、マスの高さから逆算して大きく出す
      var one = g.querySelector('.seat');
      base = one ? Math.max(20, Math.floor(one.clientHeight * 0.52)) : 48;
    }
    g.querySelectorAll('.seat .nm').forEach(function (sp) {
      fitText(sp.parentNode, sp, base);
      sp.style.setProperty('--nmPrint',
        fitPrintSize(sp.textContent, cellWmm - 7, mm - 5, $('bold').checked) + 'mm');
    });
    var note = document.querySelector('.drag-note');
    if (note) {
      note.innerHTML = state.grp.on
        ? '席をドラッグすると、配置の移動ができます。<strong>班番号を押すと、席の班と色を変更できます</strong>'
        : '席をドラッグすると、配置の移動ができます';
    }
    bindDrag();
    drawViolations();
    drawDeco();
    fitSheet();
  }

  // ---- モニターに映す（教室の大きな画面に、座席表だけを出す）----
  function screenOn() {
    document.body.classList.add('screen');
    fitSheet();
    var el = document.documentElement;
    if (el.requestFullscreen) { try { el.requestFullscreen()['catch'](function () { }); } catch (e) { } }
    drawSheet();
    // 全画面になるまで少し間があるので、大きさを決め直す
    setTimeout(function () { if (state.seats) drawSheet(); }, 350);
  }

  function screenOff() {
    if (!document.body.classList.contains('screen')) return;
    document.body.classList.remove('screen');
    if (document.fullscreenElement && document.exitFullscreen) {
      try { document.exitFullscreen()['catch'](function () { }); } catch (e) { }
    }
    if (state.seats) drawSheet();
  }

  // ---- スマホでは、座席表ぜんぶを縮めて出す ----
  // ⚠マスの高さや文字だけ小さくすると、形が変わって縦長に見えてしまう。
  //   パソコンで見た形のまま、まるごと縮めるほうが伝わる（先生は作らないが、サンプルは必ずスマホで見る）
  var SHEET_W = 640;   // パソコンで見たときの幅
  function fitSheet() {
    var box = $('sheetBox'), sh = $('sheet');
    if (!box || !sh) return;
    var narrow = window.innerWidth <= 600 && !document.body.classList.contains('screen');
    if (!narrow) {
      sh.style.width = ''; sh.style.transform = ''; box.style.height = '';
      return;
    }
    var room = box.parentNode.clientWidth;
    // ⚠読みこみの途中はまだ幅が決まっていない。0のまま計算すると scale(0) になって消える
    if (!room || room <= 0) return;
    var scale = Math.min(1, room / SHEET_W);
    sh.style.width = SHEET_W + 'px';
    sh.style.transformOrigin = 'top left';
    sh.style.transform = 'scale(' + scale + ')';
    box.style.height = Math.ceil(sh.offsetHeight * scale) + 'px';
  }

  function showSample() {
    $('sheet').classList.toggle('sample', state.sample);   // 座席の上に SAMPLE の透かし
    var note = document.getElementById('sampleNote');
    if (state.sample) {
      if (!note) {
        note = document.createElement('p');
        note.id = 'sampleNote';
        note.className = 'hint noprint';
        note.style.marginTop = '8px';
        note.textContent = '上の欄に、自分のクラスの名簿を入れてください。サンプルは消えます。';
        $('sheet').parentNode.insertBefore(note, $('sheet').nextSibling);
      }
    } else if (note) {
      note.parentNode.removeChild(note);
    }
  }

  // ---- 班をえらぶ小さな窓 ----
  var pick = null;

  function closeGroupPick() {
    if (pick && pick.parentNode) pick.parentNode.removeChild(pick);
    pick = null;
  }

  // 班番号を押すと、その席のそばに班の一覧が開く
  function openGroupPick(e) {
    e.stopPropagation();
    closeGroupPick();
    var cell = this.parentNode;
    var i = +cell.dataset.i;
    var now = (state.gmap && state.gmap[i]) || 1;
    var max = Math.max(1, state.gcount);

    var box = document.createElement('div');
    box.className = 'gpick noprint';
    for (var n = 1; n <= max; n++) {
      (function (no) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = no;
        var c = gcol(no);
        b.style.borderColor = c[0];
        b.style.background = c[1];
        b.style.color = c[0];
        if (no === now) b.className = 'on';
        b.onclick = function (ev) {
          ev.stopPropagation();
          state.gfix[i] = no;
          closeGroupPick();
          drawSheet();
        };
        box.appendChild(b);
      })(n);
    }
    document.body.appendChild(box);
    pick = box;

    // 位置を決める。画面からはみ出さないようにする
    var onScreen = document.body.classList.contains('screen');
    var r = cell.getBoundingClientRect();
    var w = box.offsetWidth, h = box.offsetHeight;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
    var below = r.bottom + 6, above = r.top - h - 6;
    var top = (r.bottom + h + 12 > window.innerHeight && above > 8) ? above : below;
    box.style.position = onScreen ? 'fixed' : 'absolute';
    box.style.left = left + (onScreen ? 0 : window.scrollX) + 'px';
    box.style.top = top + (onScreen ? 0 : window.scrollY) + 'px';
  }

  function grpChanged() {
    state.gfix = {};                // 分け方が変わったら、手で変えたぶんは捨てる
    state.grp.size = Math.max(2, Math.min(8, +$('grpSize').value || 4));
    state.grp.style = $('grpStyle').value;
    state.grp.look = $('grpLook').value;
    state.grp.num = $('grpNum').checked;
    if (state.seats) drawSheet();
    if ($('save').checked && !state.sample) save();
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

  // ---- 席を動かす（マウスも指も同じ動き。離すとぱちっとはまる） ----
  var drag = null;

  function cellAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('seat')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function bindDrag() {
    $('grid').querySelectorAll('.seat').forEach(function (d) {
      d.addEventListener('pointerdown', dragStart);
      d.addEventListener('dragstart', function (e) { e.preventDefault(); });
    });
  }

  function dragStart(e) {
    closeGroupPick();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var d = e.currentTarget;
    drag = { el: d, from: +d.dataset.i, id: e.pointerId,
             x0: e.clientX, y0: e.clientY, active: false, ghost: null, over: null };
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

    // ぱちっとはまる
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
    }, 140);
    drag = null;
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

  function setPaper() {
    var st = document.getElementById('pageRule');
    if (!st) { st = document.createElement('style'); st.id = 'pageRule'; document.head.appendChild(st); }
    st.textContent = '@page{size:A4 ' + $('paper').value + ';margin:12mm}';
    document.body.classList.toggle('landscape', $('paper').value === 'landscape');
  }

  function doPrint() {
    setPaper();
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

  function doPng() {
    var o = state.opt, cols = o.cols, rows = o.rows;
    var icon = $('deco').value || '';
    var credit = $('showCredit').checked;
    var cw = 150, ch = 90, pad = 40, head = 70, boardH = 40;
    var W = pad * 2 + cols * cw;
    var H = pad * 2 + head + boardH + rows * ch + (credit ? 28 : 0);
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);

    x.font = '18px sans-serif';
    var dt = dateText();
    x.fillStyle = '#333'; x.font = 'bold 28px sans-serif'; x.textBaseline = 'top';
    var tx = pad + (icon ? 44 : 0);
    var dtw = dt ? x.measureText(dt).width + 20 : 0;
    x.fillText(sheetTitle(), tx, pad - 10, W - pad - tx - dtw);
    if (icon) { x.font = '30px sans-serif'; x.fillText(icon, pad, pad - 8); x.font = 'bold 28px sans-serif'; }
    x.font = '18px sans-serif'; x.fillStyle = '#777';
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
        var gi = state.gmap ? state.gmap[r * cols + c] : 0;
        roundRect(x, px + 4, py + 4, cw - 8, ch - 8, 10);
        var look = state.grp.look;
        if (gi && look !== 'none') {
          var gc = gcol(gi);
          if (look !== 'edge') {
            x.fillStyle = gc[look === 'fill' ? 2 : 1];
            x.fill();
          }
          if (look === 'fill') { x.strokeStyle = '#c9c9c9'; x.lineWidth = 2; }
          else { x.strokeStyle = gc[0]; x.lineWidth = 3; }
        } else {
          x.strokeStyle = '#c9c9c9'; x.lineWidth = 2;
        }
        x.stroke();
        if (gi && state.grp.num) {
          x.fillStyle = (look === 'none') ? '#555' : gcol(gi)[0];
          x.font = 'bold 17px sans-serif';
          x.fillText(String(gi), px + 14, py + 12);
        }
        if (!name) continue;
        var lines = displayName(name).split(NL);
        var weight = $('bold').checked ? 'bold ' : '';
        var size = $('bold').checked ? 34 : 28;
        while (size > 9) {
          x.font = weight + size + 'px ' + fontStack();
          var wide = lines.some(function (t) { return x.measureText(t).width > cw - 20; });
          if (!wide && lines.length * size * 1.25 < ch - 16) break;
          size -= 1;
        }
        x.fillStyle = ($('sexPrint').checked ? sexColor(name) : null) || '#333';
        x.font = weight + size + 'px ' + fontStack();
        x.textAlign = 'center'; x.textBaseline = 'middle';
        var lh = size * 1.25, top0 = py + ch / 2 - (lines.length - 1) * lh / 2;
        lines.forEach(function (t, li) { x.fillText(t, px + cw / 2, top0 + li * lh); });
        x.textAlign = 'left'; x.textBaseline = 'top';
      }
    }
    if (credit) {
      x.font = '15px sans-serif'; x.fillStyle = '#c3b2ba'; x.textAlign = 'right';
      x.fillText('さくら先生の座席表　sakura-teachers.com', W - pad, H - pad - 8);
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
        nameMode: $('nameMode').value, font: $('font').value, bold: $('bold').checked,
        showCredit: $('showCredit').checked,
        order: $('order').value, dir: $('dir').value,
        colM: $('colM').value, colF: $('colF').value,
        sexPrint: $('sexPrint').checked,
        dt: $('dt').value, dtOff: $('dtOff').checked,
        grp: state.grp,
        sex: (function () {              // いま名簿にある人だけ残す（去年の名前をためこまない）
          var out = {};
          state.names.forEach(function (n) { if (state.sex[n]) out[n] = state.sex[n]; });
          return out;
        })()
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
      if (d.font) $('font').value = d.font;
      $('bold').checked = !!d.bold;
      if (d.showCredit !== undefined) $('showCredit').checked = !!d.showCredit;
      if (d.order) $('order').value = d.order;
      if (d.dir) $('dir').value = d.dir;
      if (d.colM) $('colM').value = d.colM;
      if (d.colF) $('colF').value = d.colF;
      // ⚠前に保存した人は、この項目を持っていない。そのときは既定（オン）のままにする
      if (d.sexPrint !== undefined) $('sexPrint').checked = !!d.sexPrint;
      if (d.dt) $('dt').value = d.dt;
      if (d.dtOff) {
        $('dtOff').checked = true;
        $('dt').disabled = true;
      }
      state.sex = d.sex || {};
      if (d.grp) {
        state.grp = {
          on: !!d.grp.on,
          size: d.grp.size || 4,
          style: d.grp.style || 'block',
          look: d.grp.look || 'both',
          num: d.grp.num !== false
        };
        $('grpOn').checked = state.grp.on;
        $('grpOpts').hidden = !state.grp.on;
        $('grpNumWrap').hidden = !state.grp.on;
        $('grpSize').value = state.grp.size;
        $('grpStyle').value = state.grp.style;
        $('grpLook').value = state.grp.look;
        $('grpNum').checked = state.grp.num;
      }
      $('save').checked = true;
    } catch (e) { }
  }
  function clearSaved() {
    try { localStorage.removeItem(KEY); } catch (e) { }
    $('save').checked = false; showSaving();
    $('msg').innerHTML = '<div class="notice">このパソコンに保存していた名簿を消しました。</div>';
  }

  // ---- 起動 ----
  // 〇にi をひらく／とじる（PCはクリック、タブレット・スマホはタップ）
  function bindTips() {
    document.addEventListener('click', function (e) {
      var b = e.target;
      while (b && b !== document.body && !(b.classList && b.classList.contains('tip-btn'))) b = b.parentElement;
      if (!b || b === document.body) return;
      // 見出しが summary のとき
      // ・閉じているなら開く（説明も一緒に見える）
      // ・開いているなら閉じない（説明を読みたいだけなので）
      if (b.parentElement && b.parentElement.tagName === 'SUMMARY') {
        var det = b.parentElement.parentElement;
        if (det && det.tagName === 'DETAILS' && !det.open) det.open = true;
        e.preventDefault();
      }
      var head = b.parentElement;
      var body = head.nextElementSibling;
      // summary の次はまとまり（div.body）なので、その中の説明文を探す
      if (body && !body.classList.contains('tip-body')) body = body.querySelector('.tip-body');
      if (!body || !body.classList.contains('tip-body')) return;
      var willOpen = body.hidden;
      body.hidden = !willOpen;
      b.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  function orderChanged() {
    var byNumber = $('order').value === 'number';
    // 出席番号順のときだけ使う。ふだんは押せない形にして「あること」は見せておく
    $('dir').disabled = !byNumber;
    $('dirWrap').classList.toggle('off', !byNumber);
    $('orderNote').textContent = byNumber
      ? '入力した順にならべます。下の「詳しい条件」は不要です。'
      : '';
    // 出席番号順のときは条件が捨てられる（generate の手前で空にしている）。
    // 消さずに薄くする＝「あること」は見せて、触っても効かない誤解だけ防ぐ
    var cond = $('condBlock'); if (cond) cond.classList.toggle('off', byNumber);
    if ($('save').checked && !state.sample) save();
  }

  function init() {
    var d = new Date();
    $('dt').value = '作成日：' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    fillColorSelect($('colM'), '#1f5fbf');
    fillColorSelect($('colF'), '#b02a7a');
    load();
    refreshNames();
    state.board = $('board').value;
    bindTips();
    orderChanged();
    renderSexList();

    $('names').addEventListener('input', function () {
      if (readNames().length) state.sample = false;   // 自分の名簿を入れたらサンプルではなくなる
      showSample();
      refreshNames(); renderSexList();
      if ($('save').checked) save();
    });
    $('order').addEventListener('change', orderChanged);
    $('dir').addEventListener('change', orderChanged);
    $('dtOff').addEventListener('change', function () {
      $('dt').disabled = this.checked;
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    $('sexPrint').addEventListener('change', function () {
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    ['colM', 'colF'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        renderSexList();
        if (state.seats) drawSheet();
        if ($('save').checked && !state.sample) save();
      });
    });
    // 班
    $('grpOn').addEventListener('change', function () {
      state.grp.on = this.checked;
      $('grpOpts').hidden = !this.checked;
      $('grpNumWrap').hidden = !this.checked;
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    ['grpSize', 'grpStyle', 'grpLook', 'grpNum'].forEach(function (id) {
      $(id).addEventListener('input', grpChanged);
      $(id).addEventListener('change', grpChanged);
    });

    $('sexClear').onclick = function () {
      state.sex = {}; renderSexList();
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    };
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
    // ⚠run を直接わたさない。クリックの情報が第1引数に入って「初回」と間違われる
    $('go').onclick = function () { run(); };
    // ⚠「べつの案を出す」は座席表を見ながら押すので、画面を動かさない
    $('again').onclick = function () { run(true); };
    $('doPrint').onclick = doPrint;
    $('printWhat').addEventListener('change', printNote);
    // 🔴 用紙の向きで1マスの高さが変わる。描き直さないと、
    //    横で計算した高さのまま縦の紙に刷られてしまう
    $('paper').addEventListener('change', function () {
      setPaper();
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    setPaper();
    $('doPng').onclick = doPng;
    $('save').addEventListener('change', function () {
      if ($('save').checked) save(); else { try { localStorage.removeItem(KEY); } catch (e) { } showSaving(); }
    });
    $('clear').onclick = clearSaved;
    document.addEventListener('click', function (e) {
      if (pick && !pick.contains(e.target)) closeGroupPick();
    });
    $('screenOn').onclick = screenOn;
    $('screenOff').onclick = screenOff;
    // 全画面から抜けたとき（Esc・ブラウザのボタン）も、画面をもとに戻す
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement) screenOff();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeGroupPick(); screenOff(); }
    });
    window.addEventListener('resize', function () {
      if (document.body.classList.contains('screen') && state.seats) drawSheet();
      else fitSheet();
    });
    window.addEventListener('beforeprint', function () { fitSheet(); });
    // 画像や字体が出そろってから、もう一度あてはめ直す
    window.addEventListener('load', function () { fitSheet(); });
    $('deco').addEventListener('change', drawDeco);
    ['nameMode', 'font', 'bold', 'showCredit'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        if (state.seats) drawSheet();
        if ($('save').checked) save();
      });
    });
    document.querySelectorAll('input[name=mode]').forEach(function (r) {
      r.addEventListener('change', function () { if ($('save').checked) save(); });
    });
    showSaving();

    // ページを開いた時点で、もう座席表が見えているようにする。
    // 「このアプリ何？」と思った人は、まずスクロールする（とくにスマホ）。
    // 押す前に現物が見えていれば、それだけで伝わる。
    // ⚠名簿を保存している先生には、サンプルではなく自分の名簿で出す
    // トップの「完成サンプルを見る」から来た人には、班の色を付けて、名前は黒で見せる。
    // ⭐色より先に「班に分けられる」ことが伝わるので、見本としてはこの形がいちばん強い。
    // ⚠名簿を保存している先生には自分の名簿が出る。そのときは何もしない（設定を書き換えないため）
    if (/(^|[?&])demo=1(&|$)/.test(location.search) && !readNames().length) {
      $('grpOn').checked = true;
      $('grpOn').dispatchEvent(new Event('change'));
      $('colM').value = '#333333'; $('colF').value = '#333333';   // 男女の色を消す＝名前は黒
      renderSexList();
    }

    try { run(true); } catch (e) { }

    // ---- 「完成サンプルを見る」から来たとき ----
    // ⚠ #result は最初 hidden なので、ブラウザの目印飛び（#result）が効かない。自分で送る
    if (location.hash === '#result') {
      // ⚠ demo=1 では判断しない。index.html は ?v= が付けられず古いまま残ることがあるので、
      //   印が消えていても戻り道が出るように「#result で来たか」で見る（2026-08-30）
      var fromSample = true;
      if (fromSample) {
        // 🔴 見に来ただけの人を、道具の画面に置き去りにしない（2026-08-30 本人の指摘）。
        // ①「✕ とじる」でトップへ戻す
        var off = $('screenOff');
        if (off) off.addEventListener('click', function () { location.href = '../#seat'; });
        // ②映す画面を開かない端末（タブレットなど）むけに、戻り道を出しておく
        var back = document.createElement('p');
        back.className = 'back-top noprint';
        back.innerHTML = '<a href="../#seat">← トップにもどる</a>';
        var rr = $('result');
        if (rr) rr.insertBefore(back, rr.firstChild);
      }
      setTimeout(function () {
        var r = $('result');
        if (r && !r.hidden) r.scrollIntoView({ block: 'start' });
        // 🔴 端末を問わず、映す画面で見せる（2026-08-30 本人「タブレットもスクリーン表示でいいんじゃないの？」）。
        // ⭐こうすると「✕ とじる」が必ず出る＝どの端末でも戻り道が同じになる
        screenOn();
      }, 150);
    }

  }
  function drawDeco() {
    $('decoLeft').textContent = $('deco').value || '';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
