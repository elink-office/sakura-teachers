/* 円卓の上座・下座
   ⚠ 名前は扱わない。「どこが上座か」だけを出すページ。
   🔴 会議室（/kaigishitsu/）と同じ作りにそろえてある（2026-08-31 本人）
      外の四角（壁）＝入口を押して置く／内の四角＝高砂などを置く／番号は手で入れ替えられる

   🔴 調べた決まり（2026-08-30・出典は仕様書）
   ── 卓そのものの順番 ──
     高砂に近い卓ほど上座。「テーブルの数字が小さいほど上座」
     同じ並びなら、中央に近いほど上
     高砂に向かって左が新郎のゲスト、右が新婦のゲスト（順位ではなく担当の分け方）
   ── 卓の中の席順 ──
     高砂に最も近い席が①。次が①の両どなり、そこから外へ交互
     ⚠「時計回りや反時計回りの配置はない」＝ぐるっと回さない
     高砂がないとき（中華料理店など）は、入口から最も遠い席が①
*/
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SIDES = ['top', 'right', 'bottom', 'left'];
  var OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  var DEG = { top: 0, right: 90, bottom: 180, left: 270 };
  var SLOTS = 3;
  var CANVAS = 720;                                   // 会場の図はいつも正方形
  var RATIO = { wide: 1.6, square: 1, tall: 0.62 };   // 部屋の横/縦の比

  var state = {
    shape: 'wide',
    tables: 8,
    per: 8,             // 既定の人数
    perBy: {},          // 卓ごとの人数（変えた卓だけ入る）
    pos: {},            // 手で動かした卓の位置（動かした卓だけ入る）
    lastCells: null, mainPt: null, IN: null,
    main: '高砂',
    mainWord: '',
    mainAt: { side: 'top', slot: 1 },
    doors: ['bottom:1'],
    wedding: false,
    pick: 1,          // 選んでいる卓
    picked: null,     // 入れ替えのために押している席
    nos: null,
    lastNos: null
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mainWord() {
    if (state.main === 'free') return state.mainWord || 'メインの席';
    return state.main;
  }
  function hasMain() { return state.main !== 'none'; }
  // ⚠ 卓ごとに人数は違う（2026-08-31 本人）。変えた卓だけ覚えておく
  function perOf(no) { return state.perBy[no] || state.per; }

  /* ---- 四角の辺を3つに分けた「マス」 ---- */
  function slotCenter(side, slot, R) {
    var w = R.w / SLOTS, h = R.h / SLOTS;
    if (side === 'top') return [R.x + w * (slot + 0.5), R.y];
    if (side === 'bottom') return [R.x + w * (slot + 0.5), R.y + R.h];
    if (side === 'left') return [R.x, R.y + h * (slot + 0.5)];
    return [R.x + R.w, R.y + h * (slot + 0.5)];
  }
  function slotRect(side, slot, R, T) {
    var c = slotCenter(side, slot, R);
    var w = R.w / SLOTS, h = R.h / SLOTS;
    if (side === 'top' || side === 'bottom') return { x: c[0] - w / 2, y: c[1] - T / 2, w: w, h: T };
    return { x: c[0] - T / 2, y: c[1] - h / 2, w: T, h: h };
  }

  /* 上座がどちらを向くか。高砂があるとき＝そちら。ないとき＝入口の反対 */
  function upSide() {
    if (hasMain()) return state.mainAt.side;
    var d = (state.doors[0] || 'bottom:1').split(':')[0];
    return OPP[d];
  }

  /* ============================================================
     会場ぜんたいの図
     ============================================================ */
  function place(u, v, IN, up) {
    if (up === 'top')    return [IN.x + u * IN.w, IN.y + v * IN.h];
    if (up === 'bottom') return [IN.x + u * IN.w, IN.y + IN.h - v * IN.h];
    if (up === 'left')   return [IN.x + v * IN.w, IN.y + u * IN.h];
    return [IN.x + IN.w - v * IN.w, IN.y + u * IN.h];
  }

  function layout(n, IN, up, mainPt) {
    var horiz = (up === 'top' || up === 'bottom');
    var acrossPx = horiz ? IN.w : IN.h;
    var depthPx = horiz ? IN.h : IN.w;
    var cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * acrossPx / depthPx))));
    var rows = Math.ceil(n / cols);

    // ⚠ 前の列から詰めると 9卓が 4・4・1 になって不格好。列ごとの数を均す
    var per = [], base = Math.floor(n / rows), rest = n % rows;
    for (var r = 0; r < rows; r++) per.push(base + (r < rest ? 1 : 0));

    var cells = [];
    for (var r2 = 0; r2 < rows; r2++) {
      var k2 = per[r2];
      // ⚠ 端に寄せすぎると、高砂の帯や入口と卓が重なる
      var v = (rows === 1) ? 0.5 : (0.26 + 0.62 * (r2 / (rows - 1)));
      for (var c = 0; c < k2; c++) cells.push({ row: r2, u: (c + 0.5) / k2, v: v });
    }

    cells.forEach(function (c) { var p = place(c.u, c.v, IN, up); c.x = p[0]; c.y = p[1]; });

    // 🔴 卓の大きさは「自動で並べたときの間隔」から先に決めて、あとは動かさない
    //   ⚠以前は動かしたあとの間隔で計算していたので、
    //     ドラッグ中に円が伸び縮みして気持ち悪かった（2026-08-31 本人の指摘）
    var maxR = 999;
    for (var i0 = 0; i0 < cells.length; i0++) {
      for (var j0 = i0 + 1; j0 < cells.length; j0++) {
        var d0 = Math.hypot(cells[i0].x - cells[j0].x, cells[i0].y - cells[j0].y);
        if (d0 / 2 - 6 < maxR) maxR = d0 / 2 - 6;
      }
    }
    if (!isFinite(maxR)) maxR = 70;
    var rFixed = Math.max(20, Math.min(48, maxR));

    // 手で動かした卓は、その位置を使う。
    // ⭐番号は「高砂からの距離」で決めているので、動かせば番号も自動でつけ直される
    cells.forEach(function (c, i) {
      var q = state.pos[i];
      if (q) { c.x = q[0]; c.y = q[1]; }
    });

    // 🔴 番号＝高砂からの「近さ」順（2026-08-31 本人）。
    //   ⚠以前は「列ごと → 中央に近い順」だった。列が3つ以上あると、
    //     前の列のいちばん端より、次の列の中央のほうが高砂に近いことがある。
    //     資料の言葉（高砂に近い卓ほど上座）どおりにするなら、斜めも見て距離で並べる。
    //   同じ距離なら「向かって左」が先（左上右下）
    var leftIsSmallU = (up === 'top' || up === 'right');
    cells.forEach(function (c) { c.d = Math.hypot(c.x - mainPt[0], c.y - mainPt[1]); });
    cells.sort(function (a, b) {
      if (Math.abs(a.d - b.d) > 4) return a.d - b.d;
      return leftIsSmallU ? (a.u - b.u) : (b.u - a.u);
    });
    return { cells: cells, r: rFixed };
  }

  function drawVenue() {
    var W = CANVAS, H = CANVAS;
    var svg = $('venue');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // ⚠ 部屋を図のふちに寄せすぎると、壁にまたがる入口がはみ出して切れる
    var rat = RATIO[state.shape], full = W - 52;
    var rw = (rat >= 1) ? full : full * rat;
    var rh = (rat >= 1) ? full / rat : full;
    var ROOM = { x: (W - rw) / 2, y: (H - rh) / 2, w: rw, h: rh };
    var IN = { x: ROOM.x + 40, y: ROOM.y + 40, w: ROOM.w - 80, h: ROOM.h - 80 };
    var up = upSide();
    var mainPt = hasMain()
      ? slotCenter(state.mainAt.side, state.mainAt.slot, IN)
      : slotCenter(up, 1, IN);
    var lay = layout(state.tables, IN, up, mainPt);
    state.lastCells = lay.cells; state.mainPt = mainPt; state.IN = IN;

    var p = [];
    p.push('<rect class="v-room" x="' + ROOM.x + '" y="' + ROOM.y + '" width="' + ROOM.w + '" height="' + ROOM.h + '" rx="10"></rect>');
    if (hasMain()) {
      p.push('<rect class="e-inner" x="' + IN.x + '" y="' + IN.y + '" width="' + IN.w + '" height="' + IN.h + '" rx="8"></rect>');
    }

    // 押せるマス（壁＝入口／内側＝高砂など）
    SIDES.forEach(function (side) {
      for (var k = 0; k < SLOTS; k++) {
        var r1 = slotRect(side, k, ROOM, 34);
        p.push('<rect class="k-hit" data-kind="door" data-side="' + side + '" data-slot="' + k +
          '" x="' + r1.x + '" y="' + r1.y + '" width="' + r1.w + '" height="' + r1.h + '" rx="6"></rect>');
        if (hasMain()) {
          var r2 = slotRect(side, k, IN, 34);
          p.push('<rect class="k-hit" data-kind="main" data-side="' + side + '" data-slot="' + k +
            '" x="' + r2.x + '" y="' + r2.y + '" width="' + r2.w + '" height="' + r2.h + '" rx="6"></rect>');
        }
      }
    });

    // 高砂など
    if (hasMain()) {
      var mr = slotRect(state.mainAt.side, state.mainAt.slot, IN, 34);
      var hz = (state.mainAt.side === 'top' || state.mainAt.side === 'bottom');
      var px0 = hz ? mr.w * 0.08 : 0, py0 = hz ? 0 : mr.h * 0.08;
      p.push('<rect class="v-main" x="' + (mr.x + px0) + '" y="' + (mr.y + py0) +
        '" width="' + (mr.w - px0 * 2) + '" height="' + (mr.h - py0 * 2) + '" rx="7"></rect>');
      p.push('<text class="v-main-label" x="' + (mr.x + mr.w / 2) + '" y="' + (mr.y + mr.h / 2) + '">' +
        esc(mainWord()) + '</text>');
    }

    // 入口（何か所でも）。⚠長い辺でも短い辺でも同じ大きさ
    state.doors.forEach(function (d) {
      var a = d.split(':'), side = a[0], slot = +a[1];
      var c = slotCenter(side, slot, ROOM);
      var hz2 = (side === 'top' || side === 'bottom');
      var dw = hz2 ? 84 : 36, dh = hz2 ? 28 : 84;
      p.push('<rect class="v-door" x="' + (c[0] - dw / 2) + '" y="' + (c[1] - dh / 2) +
        '" width="' + dw + '" height="' + dh + '" rx="6"></rect>');
      p.push('<text class="v-door-label" x="' + c[0] + '" y="' + c[1] + '">入口</text>');
    });

    // 新郎側・新婦側
    if (state.wedding && hasMain()) {
      var leftIsSmallU = (up === 'top' || up === 'right');
      if (up === 'top' || up === 'bottom') {
        p.push('<line class="v-split" x1="' + (IN.x + IN.w / 2) + '" y1="' + IN.y +
          '" x2="' + (IN.x + IN.w / 2) + '" y2="' + (IN.y + IN.h) + '"></line>');
        p.push('<text class="v-side" x="' + (IN.x + IN.w * (leftIsSmallU ? 0.25 : 0.75)) + '" y="' + (IN.y - 8) + '">新郎側</text>');
        p.push('<text class="v-side" x="' + (IN.x + IN.w * (leftIsSmallU ? 0.75 : 0.25)) + '" y="' + (IN.y - 8) + '">新婦側</text>');
      } else {
        p.push('<line class="v-split" x1="' + IN.x + '" y1="' + (IN.y + IN.h / 2) +
          '" x2="' + (IN.x + IN.w) + '" y2="' + (IN.y + IN.h / 2) + '"></line>');
        p.push('<text class="v-side" x="' + (IN.x + IN.w / 2) + '" y="' + (IN.y - 8) + '">' + (leftIsSmallU ? '新郎側' : '新婦側') + '</text>');
        p.push('<text class="v-side" x="' + (IN.x + IN.w / 2) + '" y="' + (IN.y + IN.h + 20) + '">' + (leftIsSmallU ? '新婦側' : '新郎側') + '</text>');
      }
    }

    // 卓
    lay.cells.forEach(function (c, i) {
      var no = i + 1;
      // ⚠ ①卓に印を付けない。選んでいる卓の印と2か所になって分かりにくい（本人の指摘）
      var cls = 'v-table' + (no === state.pick ? ' on' : '');
      p.push('<g class="v-hit" data-no="' + no + '">');
      p.push('<circle class="' + cls + '" cx="' + c.x + '" cy="' + c.y + '" r="' + lay.r + '"></circle>');
      p.push('<text class="v-no" x="' + c.x + '" y="' + c.y + '" style="font-size:' + Math.round(lay.r * 0.75) + 'px">' + no + '</text>');
      p.push('</g>');
    });

    svg.innerHTML = p.join('');

    var why = hasMain()
      ? '<strong>' + esc(mainWord()) + 'に近い卓ほど上座</strong>です。'
      : '<strong>入口から遠い卓ほど上座</strong>です。';
    $('venueNote').innerHTML = why + '1卓が最も上、' + state.tables + '卓が末席。同じ並びなら中央に近いほど上です。';
  }

  /* ============================================================
     選んだ卓の中
     ============================================================ */
  var TW = 520, TC = TW / 2, GAP = 66;   // ⚠GAPを広げる＝卓の円が小さくなる（本人の指摘）

  function order(n) {
    var ks = [0];
    for (var j = 1; ks.length < n; j++) { if (ks.length < n) ks.push(-j); if (ks.length < n) ks.push(j); }
    return ks.slice(0, n);
  }

  function drawTable() {
    var n = perOf(state.pick);
    var svg = $('fig');
    var rSeats = Math.min(190, 80 + n * 11);
    var rTable = rSeats - GAP;
    // 🔴 その卓から見た高砂の「方向」に①を置く（2026-08-31 本人）。
    //   例＝右端の卓なら、高砂は左上にある。①もその向きに来る
    var base = DEG[upSide()];
    var me = state.lastCells && state.lastCells[state.pick - 1];
    if (me && state.mainPt) {
      var dx = state.mainPt[0] - me.x, dy = state.mainPt[1] - me.y;
      if (Math.hypot(dx, dy) > 1) base = Math.atan2(dx, -dy) * 180 / Math.PI;
    }
    var step = 360 / n;
    var ks = order(n);
    var rad = function (d) { return d * Math.PI / 180; };

    var pts = ks.map(function (k) {
      var a = rad(base + k * step);
      return [TC + Math.sin(a) * rSeats, TC - Math.cos(a) * rSeats];
    });
    var nos = (state.nos && state.nos.length === n) ? state.nos : pts.map(function (_, i) { return i + 1; });
    state.lastNos = nos;

    var R = Math.max(13, Math.min(26, (2 * Math.PI * rSeats / n) / 2 - 4));
    var p = [];
    p.push('<circle class="e-table" cx="' + TC + '" cy="' + TC + '" r="' + rTable + '"></circle>');
    p.push('<text class="e-table-label" x="' + TC + '" y="' + (TC + 6) + '">' + state.pick + '卓</text>');
    var ax = TC + Math.sin(rad(base)) * (TW / 2 - 14);
    var ay = TC - Math.cos(rad(base)) * (TW / 2 - 14);
    p.push('<text class="e-up-label" x="' + ax + '" y="' + ay + '">' +
      (hasMain() ? esc(mainWord()) : '入口の反対') + 'の側</text>');

    pts.forEach(function (pt, i) {
      var no = nos[i];
      var cls = 'e-seat' + (no === 1 ? ' top' : '') + (state.picked === i ? ' picked' : '');
      p.push('<circle class="' + cls + '" data-i="' + i + '" cx="' + pt[0] + '" cy="' + pt[1] + '" r="' + R + '"></circle>');
      p.push('<text class="e-no" data-i="' + i + '" x="' + pt[0] + '" y="' + pt[1] +
        '" style="font-size:' + Math.round(R * 0.9) + 'px">' + no + '</text>');
    });
    svg.innerHTML = p.join('');

    $('figNote').innerHTML = '<strong>' + state.pick + '卓の中</strong>。' +
      (hasMain() ? esc(mainWord()) + 'に最も近い席が①' : '入口から最も遠い席が①') +
      '。②は①の左どなり、③は右どなりです。';
  }

  function draw() { drawVenue(); drawTable(); }

  /* ---- 操作 ---- */
  function clearSwap() {
    state.nos = null; state.picked = null;
    $('swapReset').hidden = true; $('swapNote').textContent = '';
  }
  function seatClicked(i) {
    if (state.picked === null) state.picked = i;
    else if (state.picked === i) state.picked = null;
    else {
      var nos = (state.nos || state.lastNos).slice();
      var a = nos[state.picked]; nos[state.picked] = nos[i]; nos[i] = a;
      state.nos = nos; state.picked = null;
      $('swapReset').hidden = false; $('swapNote').textContent = '　入れ替えました';
    }
    draw();
  }
  function mark(wrap, b) {
    [].forEach.call(wrap.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
  }
  function mainChanged() {
    state.main = $('mainSel').value;
    $('freeWrap').hidden = (state.main !== 'free');
    $('weddingWrap').hidden = !hasMain();
    $('mainHint').textContent = hasMain()
      ? esc(mainWord()) + 'に近い卓と席が上座になります。内側の点線を押すと動かせます。'
      : '入口から遠い卓と席が上座になります。';
    clearSwap(); draw();
  }
  function sheetTitle() { return $('pRoom').checked ? ($('roomName').value || '').trim() : ''; }
  function printMeta() {
    var d = new Date();
    $('pDateOut').textContent = $('pDate').checked
      ? (d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日') : '';
    $('pSiteOut').textContent = $('pName').checked ? 'さくらツール　sakura-tools.com' : '';
    $('printTitle').textContent = sheetTitle();
  }

  function init() {
    $('shapeDirs').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.shape = b.dataset.v; mark(this, b); state.pos = {}; clearSwap(); draw();
    });
    $('tables').addEventListener('input', function () {
      state.tables = Math.max(1, Math.min(12, +this.value || 8));
      state.pos = {};   // ⚠卓の数が変わったら、手で動かした位置は白紙に戻す
      if (state.pick > state.tables) state.pick = 1;
      $('per').value = perOf(state.pick);
      clearSwap(); draw();
    });
    $('per').addEventListener('input', function () {
      // ⚠ここで変えるのは「選んでいる卓」の人数だけ
      state.perBy[state.pick] = Math.max(4, Math.min(12, +this.value || 8));
      clearSwap(); draw();
    });
    $('mainSel').addEventListener('change', mainChanged);
    $('mainFree').addEventListener('input', function () { state.mainWord = this.value; draw(); });
    $('wedding').addEventListener('change', function () { state.wedding = this.checked; draw(); });
    $('swapReset').addEventListener('click', function () { clearSwap(); draw(); });
    $('posReset').addEventListener('click', function () { state.pos = {}; clearSwap(); draw(); });

    // 🔴 卓はドラッグで動かせる（2026-08-31 本人「会場によってこんなにきれいに並ばない」）
    //   ⚠指でもマウスでも同じ（pointer）。少しでも動いたら「動かした」とみなし、
    //     動いていなければ「押した＝その卓を選ぶ」にする
    (function () {
      var svg = $('venue'), drag = null;
      var toSvg = function (e) {
        var b = svg.getBoundingClientRect();
        var vb = svg.viewBox.baseVal;
        return [(e.clientX - b.left) / b.width * vb.width, (e.clientY - b.top) / b.height * vb.height];
      };
      svg.addEventListener('pointerdown', function (e) {
        var g = e.target.closest && e.target.closest('.v-hit');
        if (!g) return;
        var i = +g.dataset.no - 1;
        drag = { i: i, from: toSvg(e), moved: false };
        svg.setPointerCapture(e.pointerId);
      });
      svg.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var p = toSvg(e);
        if (!drag.moved && Math.hypot(p[0] - drag.from[0], p[1] - drag.from[1]) < 6) return;
        drag.moved = true;
        var IN = state.IN;
        // ⚠部屋の中からはみ出さないようにする
        state.pos[drag.i] = [
          Math.max(IN.x, Math.min(IN.x + IN.w, p[0])),
          Math.max(IN.y, Math.min(IN.y + IN.h, p[1]))
        ];
        clearSwap(); draw();
      });
      svg.addEventListener('pointerup', function (e) {
        if (drag) { try { svg.releasePointerCapture(e.pointerId); } catch (x) { } }
        drag = null;
      });
      svg.addEventListener('pointercancel', function () { drag = null; });
    })();

    // 会場の図＝壁を押すと入口、内側を押すと高砂、卓を押すと下の図が変わる
    $('venue').addEventListener('click', function (e) {
      var el = e.target;
      var g = el.closest ? el.closest('.v-hit') : null;
      if (g) { state.pick = +g.dataset.no; $('per').value = perOf(state.pick); clearSwap(); draw(); return; }
      if (!el.dataset || !el.dataset.side) return;
      var key = el.dataset.side + ':' + el.dataset.slot;
      if (el.dataset.kind === 'door') {
        var at = state.doors.indexOf(key);
        if (at >= 0) { if (state.doors.length > 1) state.doors.splice(at, 1); }
        else state.doors.push(key);
      } else {
        state.mainAt = { side: el.dataset.side, slot: +el.dataset.slot };
      }
      clearSwap(); draw();
    });
    // 卓の中の図＝席を2つ押すと入れ替え
    $('fig').addEventListener('click', function (e) {
      var el = e.target;
      if (el && el.dataset && el.dataset.i !== undefined) seatClicked(+el.dataset.i);
    });

    $('pDate').addEventListener('change', printMeta);
    $('pName').addEventListener('change', printMeta);
    $('pRoom').addEventListener('change', function () {
      $('roomName').disabled = !this.checked; printMeta();
    });
    $('roomName').addEventListener('input', printMeta);
    $('doPrint').addEventListener('click', function () { printMeta(); window.print(); });

    mainChanged(); printMeta();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
