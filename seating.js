/* 桜ティーチャーズ 共通の配置エンジン
   座席表・班分け・当番表・ルーレットで使い回す。
   考え方：席を座標(c=横, r=前からの段)で持ち、
           「離す」「隣にする」を “距離◯以内に置く／置かない” の1本にまとめる。 */
(function (global) {
  'use strict';

  // ---- 隣の定義（全体で1つ選ぶ） ----
  // 'lr'    左右だけ
  // 'cross' 前後左右
  // 'king'  まわり全部（斜めも）
  function isNear(a, b, mode) {
    var dc = Math.abs(a.c - b.c), dr = Math.abs(a.r - b.r);
    if (dc === 0 && dr === 0) return false;
    if (mode === 'lr') return dr === 0 && dc === 1;
    if (mode === 'cross') return (dc + dr) === 1;
    return dc <= 1 && dr <= 1;
  }

  function pos(i, cols) { return { c: i % cols, r: Math.floor(i / cols) }; }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // 「前のほう」「うしろのほう」が何段ぶんか
  function zoneDepth(rows) { return rows <= 3 ? 1 : 2; }

  function inZone(i, cols, rows, zone) {
    var r = Math.floor(i / cols), d = zoneDepth(rows);
    if (zone === 'front') return r < d;
    if (zone === 'back') return r >= rows - d;
    return true;
  }

  // ---- 1回ぶんの配置を作る ----
  // opt = {names, cols, rows, mode, separate:[[a,b]], adjacent:[[a,b]], fixed:{name:index}, zone:{name:'front'|'back'}}
  function tryOnce(opt) {
    var cols = opt.cols, rows = opt.rows, total = cols * rows;
    var seats = new Array(total).fill(null);
    var used = {};                       // 席index -> true
    var placed = {};                     // 名前 -> 席index
    var rest = [];

    // 1. 席そのものを指定された人を先に置く
    for (var n in opt.fixed) {
      var idx = opt.fixed[n];
      if (idx == null || idx < 0 || idx >= total || used[idx]) return null;
      seats[idx] = n; used[idx] = true; placed[n] = idx;
    }

    var freeAll = [];
    for (var i = 0; i < total; i++) if (!used[i]) freeAll.push(i);
    shuffle(freeAll);

    // 2. 「隣にする」でつながる人をグループにまとめる（A-B, B-C なら {A,B,C}）
    var groupOf = {}, groups = [];
    (opt.adjacent || []).forEach(function (p) {
      var ga = groupOf[p[0]], gb = groupOf[p[1]];
      if (ga == null && gb == null) {
        var g = { members: [p[0], p[1]], edges: [p.slice()] };
        groups.push(g); groupOf[p[0]] = g; groupOf[p[1]] = g;
      } else if (ga && gb && ga !== gb) {
        ga.members = ga.members.concat(gb.members);
        ga.edges = ga.edges.concat(gb.edges); ga.edges.push(p.slice());
        gb.members.forEach(function (m) { groupOf[m] = ga; });
        groups.splice(groups.indexOf(gb), 1);
      } else {
        var g2 = ga || gb;
        if (!g2.members.includes(p[0])) { g2.members.push(p[0]); groupOf[p[0]] = g2; }
        if (!g2.members.includes(p[1])) { g2.members.push(p[1]); groupOf[p[1]] = g2; }
        g2.edges.push(p.slice());
      }
    });

    function seatOk(name, idx) {
      if (used[idx]) return false;
      var z = opt.zone[name];
      if (z && !inZone(idx, cols, rows, z)) return false;
      return true;
    }

    // 3. グループを置く（1人置いて、つながっている相手を隣へ）
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      var todo = g.members.filter(function (m) { return placed[m] == null; });
      var done = g.members.filter(function (m) { return placed[m] != null; });
      if (done.length === 0) {
        var first = todo.shift();
        var cand = freeAll.filter(function (ix) { return seatOk(first, ix); });
        if (!cand.length) return null;
        var pick = cand[Math.floor(Math.random() * cand.length)];
        seats[pick] = first; used[pick] = true; placed[first] = pick; done.push(first);
      }
      var guard = 0;
      while (todo.length && guard++ < 200) {
        var moved = false;
        for (var k = 0; k < todo.length; k++) {
          var name = todo[k];
          // つながっている相手ですでに置かれている人
          var anchors = g.edges.filter(function (e) { return e[0] === name || e[1] === name; })
            .map(function (e) { return e[0] === name ? e[1] : e[0]; })
            .filter(function (m) { return placed[m] != null; });
          if (!anchors.length) continue;
          var a = placed[anchors[0]], ap = pos(a, cols);
          var spots = [];
          for (var ix = 0; ix < total; ix++) {
            if (!seatOk(name, ix)) continue;
            if (isNear(ap, pos(ix, cols), opt.mode)) spots.push(ix);
          }
          if (!spots.length) return null;
          var s = spots[Math.floor(Math.random() * spots.length)];
          seats[s] = name; used[s] = true; placed[name] = s;
          todo.splice(k, 1); moved = true; break;
        }
        if (!moved) {
          var nm = todo.shift();
          var c2 = [];
          for (var ix2 = 0; ix2 < total; ix2++) if (seatOk(nm, ix2)) c2.push(ix2);
          if (!c2.length) return null;
          var s2 = c2[Math.floor(Math.random() * c2.length)];
          seats[s2] = nm; used[s2] = true; placed[nm] = s2;
        }
      }
    }

    // 4. 「前のほう／うしろのほう」だけ指定されている人
    opt.names.forEach(function (n) {
      if (placed[n] == null && opt.zone[n]) rest.push(n);
    });
    for (var q = 0; q < rest.length; q++) {
      var nm3 = rest[q];
      var c3 = [];
      for (var ix3 = 0; ix3 < total; ix3++) if (seatOk(nm3, ix3)) c3.push(ix3);
      if (!c3.length) return null;
      var s3 = c3[Math.floor(Math.random() * c3.length)];
      seats[s3] = nm3; used[s3] = true; placed[nm3] = s3;
    }

    // 5. 残りをランダムに
    var others = opt.names.filter(function (n) { return placed[n] == null; });
    shuffle(others);
    var freeNow = [];
    for (var f = 0; f < total; f++) if (!used[f]) freeNow.push(f);
    // 席は「前の段から」「その段の真ん中から外へ」の順に埋める。
    // ＝空席はうしろに残り、半端な段は左右に振り分けられて中央に寄る
    var mid = (cols - 1) / 2;
    freeNow.sort(function (a, b) {
      var ra = Math.floor(a / cols), rb = Math.floor(b / cols);
      if (ra !== rb) return ra - rb;
      var da = Math.abs((a % cols) - mid), db = Math.abs((b % cols) - mid);
      if (da !== db) return da - db;
      return a - b;
    });
    if (others.length > freeNow.length) return null;
    others.forEach(function (n, k2) { var ix = freeNow[k2]; seats[ix] = n; placed[n] = ix; });

    // 6. 全部の条件を満たしているか確かめる
    if (violations(seats, opt).length) return null;
    return seats;
  }

  // ---- 条件に反しているところを探す（画面で赤く光らせるのにも使う） ----
  function violations(seats, opt) {
    var cols = opt.cols;
    var at = {};
    seats.forEach(function (n, i) { if (n) at[n] = i; });
    var out = [];
    (opt.separate || []).forEach(function (p) {
      if (at[p[0]] == null || at[p[1]] == null) return;
      if (isNear(pos(at[p[0]], cols), pos(at[p[1]], cols), opt.mode))
        out.push({ type: 'separate', pair: p, seats: [at[p[0]], at[p[1]]] });
    });
    (opt.adjacent || []).forEach(function (p) {
      if (at[p[0]] == null || at[p[1]] == null) return;
      if (!isNear(pos(at[p[0]], cols), pos(at[p[1]], cols), opt.mode))
        out.push({ type: 'adjacent', pair: p, seats: [at[p[0]], at[p[1]]] });
    });
    for (var n in opt.zone) {
      if (at[n] == null) continue;
      if (!inZone(at[n], cols, opt.rows, opt.zone[n]))
        out.push({ type: 'zone', name: n, seats: [at[n]] });
    }
    for (var m in opt.fixed) {
      if (at[m] == null) continue;
      if (at[m] !== opt.fixed[m]) out.push({ type: 'fixed', name: m, seats: [at[m]] });
    }
    return out;
  }

  // ---- 何回か作って、いくつか案を返す ----
  function generate(opt, want, limit) {
    want = want || 3; limit = limit || 2000;
    var plans = [], keys = {};
    for (var i = 0; i < limit && plans.length < want; i++) {
      var s = tryOnce(opt);
      if (!s) continue;
      var k = s.join('|');
      if (keys[k]) continue;
      keys[k] = true; plans.push(s);
    }
    return plans;
  }


  // ---- 作れなかったとき、どの条件が原因かを名指しする ----
  function blame(opt) {
    var all = [];
    (opt.separate || []).forEach(function (p, i) {
      all.push({ kind: 'sep', i: i, label: '「' + p[0] + 'さんと' + p[1] + 'さんを離す」' });
    });
    (opt.adjacent || []).forEach(function (p, i) {
      all.push({ kind: 'adj', i: i, label: '「' + p[0] + 'さんと' + p[1] + 'さんを隣にする」' });
    });
    for (var n in opt.zone) {
      all.push({
        kind: 'zone', name: n,
        label: '「' + n + 'さんを' + (opt.zone[n] === 'front' ? '前のほう' : 'うしろのほう') + 'に」'
      });
    }
    for (var k = 0; k < all.length; k++) {
      var t = all[k];
      var o = Object.assign({}, opt);
      o.separate = (opt.separate || []).slice();
      o.adjacent = (opt.adjacent || []).slice();
      o.zone = Object.assign({}, opt.zone);
      if (t.kind === 'sep') o.separate.splice(t.i, 1);
      else if (t.kind === 'adj') o.adjacent.splice(t.i, 1);
      else delete o.zone[t.name];
      if (generate(o, 1, 400).length) return t.label;
    }
    return null;
  }

  // ---- 班に分ける ----
  // 班は「人」ではなく「席のかたまり」につく。
  // だからドラッグで人を入れ替えると、班もそのまま入れ替わる（机のかたまり＝班、という教室の形と同じ）。

  function groups(seats, cols, rows, size, style, board) {
    var g = new Array(cols * rows).fill(0);
    var c, r, i;

    // 縦の列ごとに1班
    if (style === 'col') {
      var no = 0;
      for (c = 0; c < cols; c++) {
        var has = false;
        for (r = 0; r < rows; r++) if (seats[r * cols + c]) has = true;
        if (!has) continue;
        no++;
        for (r = 0; r < rows; r++) if (seats[r * cols + c]) g[r * cols + c] = no;
      }
      return { map: g, count: no };
    }

    // 机のかたまり
    // 🔴机は横に2つくっつけるのが基本なので、**2列ずつ**をひとまとまりにして考える。
    //   そのまとまりの中を「左→右、上の段から下の段へ」の順に並べ、人数ぶん切る。
    //   こうすると3人班が前後をふくむ**かぎ型**になる（先生の実際の組み方）。
    //     1 1 | 3 3
    //     1 2 | 3 4
    //     2 2 | 4 4
    var members = [];
    for (var c0 = 0; c0 < cols; c0 += 2) {
      var wide = Math.min(2, cols - c0);

      var list = [];
      for (var t = 0; t < rows; t++) {
        // 黒板が下のときは、後ろの段が画面の上に見える。
        // 班の番号が画面の上から1・2・3…になるように、走る向きを変える
        var rr = (board === 'bottom') ? rows - 1 - t : t;
        for (var cc = c0; cc < c0 + wide; cc++) {
          var ii = rr * cols + cc;
          if (seats[ii]) list.push(ii);
        }
      }
      if (!list.length) continue;

      // このまとまりの中で、人数がなるべく同じになるように分ける
      // （30人を4人班にすると「4人が6班と2人が1班」になってしまうので、3人・3人に均す）
      var k = Math.max(1, Math.round(list.length / size));
      // 指定した人数より多い班は作らない（机が足りなくなるので）
      while (k < list.length && Math.ceil(list.length / k) > size) k++;
      // 🔴ひとりぼっちの班を作らない。
      //   35人を2人班にすると「2人が17班と1人が1班」になってしまう。
      //   班をひとつ減らして「3人が1班と2人が16班」にする（先生の組み方）
      while (k > 1 && Math.floor(list.length / k) < 2) k--;

      var base = Math.floor(list.length / k), rest = list.length % k, at = 0;
      for (var j = 0; j < k; j++) {
        var take = base + (j < rest ? 1 : 0);
        members.push(list.slice(at, at + take));
        at += take;
      }
    }

    members.forEach(function (m, idx) {
      m.forEach(function (s) { g[s] = idx + 1; });
    });
    return { map: g, count: members.length };
  }

  global.Seating = {
    isNear: isNear, pos: pos, shuffle: shuffle,
    zoneDepth: zoneDepth, inZone: inZone,
    generate: generate, violations: violations, blame: blame,
    groups: groups
  };
})(window);
