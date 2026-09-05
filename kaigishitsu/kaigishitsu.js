/* 会議室の上座・下座（ロの字・コの字・対面）
   ⚠ 名前は扱わない。「どこが上座か」だけを出すページ。
   ⚠ 完璧を目指さない。**参考まで**の図（2026-08-31 本人）。
      合わないときは、番号を2つ押して入れ替えてもらう。

   🔴 調べた決まり（2026-08-31・5サイトで確認。出典は仕様書）
     見るもの（スクリーン・ホワイトボード・モニター）… その正面が上座（見やすい席が上座）
     人が座る席（議長席）                            … そのとなりが上座
     なし                                            … 入口から最も遠い辺の中央
     番号は上座から、左どなり・右どなりの順に外へ交互
     ⚠ 細かい順は資料によって書き方が違う。①と最後が要点

   🔴 図の作り（2026-08-31 本人の案）
     外の四角（壁）  … 入口を置く場所。押すと付く／もう一度押すと消える
     内の四角        … スクリーン等を置く場所
     各辺は3つに分けてある。⚠細かくしても上座は「辺」で決まるので答えは変わらない。
       会場と“だいたい”合わせて、印刷したときに分かりやすくするためのもの
*/
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SIDES = ['top', 'right', 'bottom', 'left'];
  var OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  var SLOTS = 3;
  // 🔴 外の枠は固定。中の部屋だけ形が変わる（2026-08-31 本人）
  //   ⚠以前は形を変えるたびに図そのものの大きさが変わって、画面がガタついた
  var CANVAS = 720;                       // 図はいつも正方形
  var RATIO = { wide: 1.6, square: 1, tall: 0.62 };   // 部屋の横/縦の比

  var state = {
    shape: 'tall',
    style: 'ro',
    n: 12,
    front: 'スクリーン',
    frontWord: '',
    frontAt: { side: 'top', slot: 1 },
    doors: ['bottom:1'],
    picked: null,
    nos: null,
    lastNos: null
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function frontKind() {
    if (state.front === 'none') return 'none';
    if (state.front === '議長席') return 'chair';
    return 'view';
  }
  function frontWord() {
    if (state.front === 'free') return state.frontWord || '前方';
    return state.front;
  }

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
  function sideCenter(side, R) { return slotCenter(side, 1, R); }

  /* ---- 席を置く道すじ ---- */
  function seatPath(t, style, openSide) {
    var OFF = 38;
    var x1 = t.x - OFF, y1 = t.y - OFF, x2 = t.x + t.w + OFF, y2 = t.y + t.h + OFF;
    var seg = {
      top: [[x1, y1], [x2, y1]], right: [[x2, y1], [x2, y2]],
      bottom: [[x2, y2], [x1, y2]], left: [[x1, y2], [x1, y1]]
    };
    if (style === 'face') {
      return (t.w >= t.h)
        ? { segs: [seg.top, seg.bottom], cyclic: false }
        : { segs: [seg.left, seg.right], cyclic: false };
    }
    if (style === 'ko') {
      var order = { top: ['right', 'bottom', 'left'], right: ['bottom', 'left', 'top'],
                    bottom: ['left', 'top', 'right'], left: ['top', 'right', 'bottom'] };
      return { segs: order[openSide].map(function (k) { return seg[k]; }), cyclic: false };
    }
    return { segs: [seg.top, seg.right, seg.bottom, seg.left], cyclic: true };
  }

  function spread(path, n) {
    var lens = path.segs.map(function (s) { return Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]); });
    var total = lens.reduce(function (a, b) { return a + b; }, 0);
    var counts = lens.map(function (L) { return Math.max(0, Math.round(n * L / total)); });
    var diff = n - counts.reduce(function (a, b) { return a + b; }, 0);
    for (var i = 0; diff !== 0 && i < 80; i++) {
      var k = i % counts.length;
      if (diff > 0) { counts[k]++; diff--; } else if (counts[k] > 0) { counts[k]--; diff++; }
    }
    var pts = [];
    path.segs.forEach(function (s, si) {
      for (var j = 0; j < counts[si]; j++) {
        var u = (j + 0.5) / counts[si];
        pts.push([s[0][0] + (s[1][0] - s[0][0]) * u, s[0][1] + (s[1][1] - s[0][1]) * u]);
      }
    });
    return pts;
  }

  /* ---- 番号 ---- */
  function numbering(pts, cyclic, upSide, target) {
    var best = 0, bestS = -Infinity;
    // ⚠ 同じ点数のときの先後。
    //   資料は「上座から見て右側が2番目」（エッサム／Business Chat Master）。
    //   上座の人は部屋の中心を向いて座るので、その人の右手＝図では
    //     上座が上の辺なら「図の左」、下の辺なら「図の右」になる。
    //   ⚠「向かって左」と書いてある資料もあるが、上座が上の辺のときは同じ場所を指す。
    var leftFirst = function (a, b) {
      if (upSide === 'top') return a[0] < b[0];
      if (upSide === 'bottom') return a[0] > b[0];
      if (upSide === 'left') return a[1] > b[1];
      return a[1] < b[1];
    };
    pts.forEach(function (p, i) {
      var sc = -Math.hypot(p[0] - target[0], p[1] - target[1]);
      if (sc > bestS + 2) { bestS = sc; best = i; }
      else if (Math.abs(sc - bestS) <= 2 && leftFirst(p, pts[best])) { bestS = Math.max(bestS, sc); best = i; }
    });
    var n = pts.length, out = new Array(n), used = {}, ks = [0];
    for (var j = 1; ks.length < n * 2 + 2; j++) { ks.push(-j); ks.push(j); }
    var no = 1;
    for (var m = 0; m < ks.length && no <= n; m++) {
      var idx = best + ks[m];
      if (cyclic) idx = ((idx % n) + n) % n;
      else if (idx < 0 || idx >= n) continue;
      if (used[idx]) continue;
      used[idx] = true; out[idx] = no++;
    }
    return out;
  }

  /* ---- 描く ---- */
  function draw() {
    var W = CANVAS, H = CANVAS;
    var svg = $('fig');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // 部屋＝枠の中に、選んだ形で収める（枠の大きさは変わらない）
    // ⚠ 部屋の枠を図のふちに寄せすぎると、壁にまたがる入口が図の外にはみ出して切れる
    //   （2026-08-31 本人「短辺側の入口の辺が切れる」。実測で x=-4 になっていた）
    var rat = RATIO[state.shape], full = W - 52;
    var rw = (rat >= 1) ? full : full * rat;
    var rh = (rat >= 1) ? full / rat : full;
    var ROOM = { x: (W - rw) / 2, y: (H - rh) / 2, w: rw, h: rh };
    var IN = { x: ROOM.x + 40, y: ROOM.y + 40, w: ROOM.w - 80, h: ROOM.h - 80 };
    // ① 机ごと中央に寄せる（2026-08-31 本人）。
    //   ⚠固定の余白だと、正方形のとき真ん中が大きく空いて間延びする。短いほうの辺の比で取る
    var inset = Math.max(84, Math.min(IN.w, IN.h) * 0.22);
    var t = { x: IN.x + inset, y: IN.y + inset, w: IN.w - inset * 2, h: IN.h - inset * 2 };

    var kind = frontKind();
    var path = seatPath(t, state.style, state.frontAt.side);
    var pts = spread(path, state.n);

    var upSide, target;
    if (kind === 'view') {
      upSide = OPP[state.frontAt.side];
      target = sideCenter(upSide, IN);
    } else if (kind === 'chair') {
      upSide = state.frontAt.side;
      target = slotCenter(state.frontAt.side, state.frontAt.slot, IN);
    } else {
      // 入口から最も遠い辺（入口が何か所あってもいいように、いちばん近い入口までの距離で見る）
      var dPts = state.doors.map(function (d) {
        var a = d.split(':'); return slotCenter(a[0], +a[1], ROOM);
      });
      var far = 'top', farD = -1;
      SIDES.forEach(function (s) {
        var c = sideCenter(s, IN);
        var dmin = Math.min.apply(null, dPts.map(function (q) { return Math.hypot(c[0] - q[0], c[1] - q[1]); }));
        if (dmin > farD) { farD = dmin; far = s; }
      });
      upSide = far; target = sideCenter(far, IN);
    }
    var nos = (state.nos && state.nos.length === pts.length)
      ? state.nos : numbering(pts, path.cyclic, upSide, target);
    state.lastNos = nos;

    var p = [];
    p.push('<rect class="v-room" x="' + ROOM.x + '" y="' + ROOM.y + '" width="' + ROOM.w + '" height="' + ROOM.h + '" rx="10"></rect>');
    // 内の点線＝スクリーン等を置く線。⚠「なし」のときは置けないので出さない
    if (kind !== 'none') {
      p.push('<rect class="k-inner" x="' + IN.x + '" y="' + IN.y + '" width="' + IN.w + '" height="' + IN.h + '" rx="8"></rect>');
    }

    // 押せるマス（壁＝入口／内側＝前にあるもの）
    SIDES.forEach(function (side) {
      for (var k = 0; k < SLOTS; k++) {
        var r1 = slotRect(side, k, ROOM, 34);
        p.push('<rect class="k-hit" data-kind="door" data-side="' + side + '" data-slot="' + k +
          '" x="' + r1.x + '" y="' + r1.y + '" width="' + r1.w + '" height="' + r1.h + '" rx="6"></rect>');
        if (kind !== 'none') {
          var r2 = slotRect(side, k, IN, 34);
          p.push('<rect class="k-hit" data-kind="front" data-side="' + side + '" data-slot="' + k +
            '" x="' + r2.x + '" y="' + r2.y + '" width="' + r2.w + '" height="' + r2.h + '" rx="6"></rect>');
        }
      }
    });

    // 前にあるもの
    if (kind !== 'none') {
      var fr = slotRect(state.frontAt.side, state.frontAt.slot, IN, 34);
      var hz = (state.frontAt.side === 'top' || state.frontAt.side === 'bottom');
      var px0 = hz ? fr.w * 0.10 : 0, py0 = hz ? 0 : fr.h * 0.10;
      p.push('<rect class="k-front" x="' + (fr.x + px0) + '" y="' + (fr.y + py0) +
        '" width="' + (fr.w - px0 * 2) + '" height="' + (fr.h - py0 * 2) + '" rx="7"></rect>');
      p.push('<text class="k-front-label" x="' + (fr.x + fr.w / 2) + '" y="' + (fr.y + fr.h / 2) + '">' +
        esc(frontWord()) + '</text>');
    }

    // 入口
    state.doors.forEach(function (d) {
      var a = d.split(':'), side = a[0], slot = +a[1];
      // ⚠ 長い辺でも短い辺でも、入口の大きさは同じにする（本人の指摘）
      var c = slotCenter(side, slot, ROOM);
      var hz2 = (side === 'top' || side === 'bottom');
      var dw = hz2 ? 84 : 36, dh = hz2 ? 28 : 84;   // ⚠縦の入口は「入口」の字が入る幅にする
      p.push('<rect class="v-door" x="' + (c[0] - dw / 2) + '" y="' + (c[1] - dh / 2) +
        '" width="' + dw + '" height="' + dh + '" rx="6"></rect>');
      p.push('<text class="v-door-label" x="' + c[0] + '" y="' + c[1] + '">入口</text>');
    });

    p.push(deskShape(t));

    // 席。⚠ 丸の大きさは「となりの席との間隔」から決める
    var gap = 999;
    for (var gi = 1; gi < pts.length; gi++) {
      var dd = Math.hypot(pts[gi][0] - pts[gi - 1][0], pts[gi][1] - pts[gi - 1][1]);
      if (dd > 1 && dd < gap) gap = dd;
    }
    var R = Math.max(11, Math.min(24, gap / 2 - 3));
    pts.forEach(function (pt, i) {
      var no = nos[i];
      var cls = 'e-seat' + (no === 1 ? ' top' : (no === state.n ? ' low' : '')) +
        (state.picked === i ? ' picked' : '');
      p.push('<circle class="' + cls + '" data-i="' + i + '" cx="' + pt[0] + '" cy="' + pt[1] + '" r="' + R + '"></circle>');
      p.push('<text class="e-no" data-i="' + i + '" x="' + pt[0] + '" y="' + pt[1] +
        '" style="font-size:' + Math.round(R * 0.9) + 'px">' + no + '</text>');
    });

    svg.innerHTML = p.join('');

    var name = { ro: 'ロの字', ko: 'コの字', face: '対面' }[state.style];
    var why = (kind === 'view')
      ? '<strong>' + esc(frontWord()) + 'を正面から見る席が上座</strong>です（見やすい席が上座）。'
      : (kind === 'chair')
        ? '<strong>' + esc(frontWord()) + 'に最も近い席が上座</strong>です。'
        : '<strong>入口から最も遠い席が上座</strong>です。';
    // ⚠ここは短く。スマホでは図と設定のあいだに入るので、長いと邪魔になる（本人の指摘）
    $('figNote').innerHTML = name + '。' + why + '①が上座、' + state.n + '番が下座です。';
  }

  function deskShape(t) {
    var b = 24;
    var bars = {
      top: '<rect class="k-desk" x="' + t.x + '" y="' + t.y + '" width="' + t.w + '" height="' + b + '" rx="4"></rect>',
      bottom: '<rect class="k-desk" x="' + t.x + '" y="' + (t.y + t.h - b) + '" width="' + t.w + '" height="' + b + '" rx="4"></rect>',
      left: '<rect class="k-desk" x="' + t.x + '" y="' + t.y + '" width="' + b + '" height="' + t.h + '" rx="4"></rect>',
      right: '<rect class="k-desk" x="' + (t.x + t.w - b) + '" y="' + t.y + '" width="' + b + '" height="' + t.h + '" rx="4"></rect>'
    };
    if (state.style === 'face') return (t.w >= t.h) ? bars.top + bars.bottom : bars.left + bars.right;
    var keys = SIDES.filter(function (k) { return state.style !== 'ko' || k !== state.frontAt.side; });
    return keys.map(function (k) { return bars[k]; }).join('');
  }

  // 紙のいちばん上に出る見出し。⚠自由に書ける（「会議室」以外の呼び方もあるため）
  function sheetTitle() {
    return $('pRoom').checked ? ($('roomName').value || '').trim() : '';
  }
  // 右上の日付・右下のサイト名（座席表と同じ置き方）
  function printMeta() {
    var d = new Date();
    $('pDateOut').textContent = $('pDate').checked
      ? (d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日') : '';
    $('pSiteOut').textContent = $('pName').checked
      ? 'さくらツール　sakura-tools.com' : '';
    $('printTitle').textContent = sheetTitle();
  }

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
      $('swapReset').hidden = false;
      $('swapNote').textContent = '　入れ替えました';
    }
    draw();
  }
  function mark(wrap, b) {
    [].forEach.call(wrap.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
  }
  function bindPicker(id, fn) {
    var wrap = $(id);
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      fn(b, wrap); clearSwap(); draw();
    });
  }
  function frontChanged() {
    state.front = $('frontSel').value;
    $('freeWrap').hidden = (state.front !== 'free');
    var k = frontKind();
    // ⚠ 操作の説明は減らすが、「どこが上座になるか」は残す（2026-08-31 本人）
    $('frontHint').textContent = (k === 'view')
      ? '正面から見る席が上座になります。内側の点線を押すと動かせます。'
      : (k === 'chair')
        ? '議長席のとなりが上座になります。内側の点線を押すと動かせます。'
        : '入口から最も遠い席が上座になります。';
    clearSwap(); draw();
  }

  function init() {
    bindPicker('shapeDirs', function (b, w) { state.shape = b.dataset.v; mark(w, b); });
    bindPicker('styleDirs', function (b, w) { state.style = b.dataset.v; mark(w, b); });
    $('num').addEventListener('input', function () {
      state.n = Math.max(4, Math.min(12, +this.value || 12)); clearSwap(); draw();
    });
    $('frontSel').addEventListener('change', frontChanged);
    $('frontFree').addEventListener('input', function () { state.frontWord = this.value; draw(); });
    $('swapReset').addEventListener('click', function () { clearSwap(); draw(); });
    $('pName').addEventListener('change', printMeta);
    $('pDate').addEventListener('change', printMeta);
    $('pRoom').addEventListener('change', function () {
      $('roomName').disabled = !this.checked; printMeta();
    });
    $('roomName').addEventListener('input', printMeta);
    $('doPrint').addEventListener('click', function () { printMeta(); window.print(); });
    printMeta();

    // 🔴 図を押して置く。壁＝入口、内側＝前にあるもの、丸＝番号の入れ替え
    $('fig').addEventListener('click', function (e) {
      var el = e.target;
      if (!el || !el.dataset) return;
      if (el.dataset.i !== undefined) { seatClicked(+el.dataset.i); return; }
      if (!el.dataset.side) return;
      var key = el.dataset.side + ':' + el.dataset.slot;
      if (el.dataset.kind === 'door') {
        var at = state.doors.indexOf(key);
        if (at >= 0) { if (state.doors.length > 1) state.doors.splice(at, 1); }   // ⚠全部は消さない
        else state.doors.push(key);
      } else {
        state.frontAt = { side: el.dataset.side, slot: +el.dataset.slot };
      }
      clearSwap(); draw();
    });

    frontChanged();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
