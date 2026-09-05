/* 座席表メーカー 画面まわり
   席の座標は「前からの段」で持つ（r=0 が最前列）。
   黒板が下のときは、表示のときだけ上下をひっくり返す。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'sakura-seat-v1';
  var NL = String.fromCharCode(10);   // 改行（エスケープを書かずに済ませる）
  // 🔴 クラスと記録の置き場（2026-08-31）。KEY（前回のつづき）とは別に持つ。
  //   ⚠KEY は「閉じても消えない前回のつづき」、KEYC は「先生が名前を付けて残すもの」
  // 🔴 KEYC は座席表と席次表で**共通**（2026-08-31 本人「一緒に使える」）。
  //   名簿は1つ。設定と記録だけツールごとに分けて持つ。
  //     { id, label, names, seat:{設定}, seki:{設定}, recs:[座席表の記録] }
  //   ⚠置き場はドメイン単位なので、/seat/ で保存したものを /seki/ から読める
  var KEYC = 'sakura-tools-rosters-v1';
  var KEYOLD = 'sakura-seat-classes-v1';   // 前の置き場。初回に引き継いで、そのまま残しておく
  // 🔴 10 → 20 に増やした（2026-09-01 本人）。理科室・図工室の専科は10クラスほど受け持つ。
  //   ⚠3つのツールで同じ置き場を見ているので、上限は seat / seki / group を同時に直す
  var MAXC = 20;   // 名簿は20件まで
  var MAXR = 20;   // 記録は20件まで（月1回とはかぎらないため。2026-08-31 本人）

  var state = {
    names: [], cols: 6, rows: 6, board: 'top', mode: 'cross',
    sep: [], adj: [], fix: [],      // fix = [{name, col, fromFront, zone}]
    plans: [], cur: 0, seats: null,
    sex: {},                        // 名前 -> 'm' / 'f'（名前をキーにするので名簿を貼り直しても残る）
    sample: false, sampleNames: [],  // サンプルは名簿欄に入れない（消す手間が出るので）
    grp: { on: false, size: 4, style: 'block', look: 'both', num: true, mark: false, ignoreLead: false },
    gmap: null, gcount: 0,
    gfix: {},                       // 先生が手で変えた班（席の番号 → 班の番号）
    leaders: {},                    // ★（班に1人ずつにする人）名前 -> true。名簿の★＋条件でえらんだ人
    nums: {},                       // 出席番号 名前 -> '12'（名簿に番号が無ければ名簿の順）
    numOn: false,                   // 席に出席番号を出すか（出席番号順をえらぶと自動で入る）
    hist: [],                       // 「1つ戻す」用。入れ替える前の並びを積んでいく
    lastRaw: null,                  // 前に読んだ名簿の文字列（男女を入れ直しすぎないため）
    avoid: { on: false, back: 3 }   // 前の班と同じメンバーをさける／何回さかのぼるか
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
  // 🔴 班長の印は ★ だけ（2026-08-31 本人「そんな何個も受け付けなくても」）。
  //   ⚠名前の前でも後ろでもよい。手で後から付けるときは後ろのほうが書きやすい
  //   ⚠★を外してから名前として扱う。外さないと男女の指定（名前がキー）が別人になる
  function isLeadName(s) { return /^★/.test(s) || /★$/.test(s); }
  function stripLead(s) { return s.replace(/^★[ 　]*/, '').replace(/[ 　]*★$/, ''); }
  // 🔴 Excelから何列でも貼れるようにする（2026-08-31 本人）。
  //   Excelのコピペは【タブ区切り】なので、タブで分けて1つずつ見分ける。
  //     ・数字だけ   … 出席番号とみなして捨てる
  //     ・★ ☆ 班長  … 班長の印
  //     ・男 女 男子 女子 M F … 男女
  //     ・残ったうちの最初 … 名前
  //   ⚠**列の順番は問わない**。先生によって並びがちがうため（本人「列を分ける人もいる」）
  //   ⚠名前が数字だけということは無いので、数字を捨てても困らない
  var SEX_M = /^(男|男子|おとこ|オトコ|男の子|[MmＭｍ])$/;
  var SEX_F = /^(女|女子|おんな|オンナ|女の子|[FfＦｆ])$/;
  var MARK_ONLY = /^(★|☆|班長|リーダー|リーダー格)$/;
  var NUM_ONLY = /^[0-9０-９]+$/;
  // ⚠Excelの見出し行（番号・氏名・性別…）ごと貼る人がいる。
  //   ぜんぶが見出しの言葉なら、その行はとばす（「番号」という名前の子ができてしまう）
  var HEAD_WORD = /^(番号|出席番号|No\.?|№|氏名|名前|生徒名|児童名|性別|男女|班長|リーダー|リーダー格|班|グループ|備考|メモ|学年|組)$/i;
  // 手で「11 佐藤 はなこ 男」のように空白で区切って書く人むけ
  var LEAD_NUM = /^[0-9０-９]+[ 　]+/;
  var TAIL_SEX = /[ 　]+(男子|女子|男|女)$/;
  // 🔴 出席番号は捨てずに持っておく（2026-09-03 本人・現場の先生の要望）。
  //   ⚠これまでは「数字だけの列＝出席番号」を読み捨てていた（名前だけあればよかったため）。
  //     席に出すようになったので、拾って out.num に入れる。名前の判定は今までどおり
  function toHalf(s) {
    return s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  }
  function parseLine(line) {
    // ⚠タブは名簿の欄に打てないので、カンマでも列に分ける（2026-09-01 本人）。
    //   ⚠空白は区切りにしない。名前に空白が入る（やまだ たろう）ため
    var cells = line.split(/[\t,，]/)
      .map(function (x) { return x.replace(/^[\s　]+/, '').replace(/[\s　]+$/, ''); })
      .filter(function (x) { return x.length; });
    var out = { name: '', lead: false, sex: '', num: '' };
    if (cells.length && cells.every(function (c) { return HEAD_WORD.test(c); })) return out;
    if (cells.length === 1) {
      var one = cells[0];
      // 「11 佐藤 はなこ」の先頭の数字＝出席番号。外す前に控えておく
      var ln = one.match(LEAD_NUM);
      if (ln) { out.num = toHalf(ln[0].replace(/[ 　]+$/, '')); one = one.replace(LEAD_NUM, ''); }
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
      // ⚠数字だけの列は出席番号。いちばん最初のものを使う（2つあることは無いが念のため）
      if (NUM_ONLY.test(c)) { if (!out.num) out.num = toHalf(c); continue; }
      if (!out.name) out.name = c;
    }
    if (isLeadName(out.name)) { out.lead = true; out.name = stripLead(out.name); }
    return out;
  }
  // 🔴 保存のために、条件の行をそのまま読む（2026-09-03）
  function readPairRows(listId) {
    var out = [], el = $(listId);
    if (!el) return out;
    Array.prototype.forEach.call(el.querySelectorAll('.pair'), function (w) {
      var sel = w.querySelectorAll('select');
      if (sel[0].value && sel[1].value) out.push([sel[0].value, sel[1].value]);
    });
    return out;
  }
  function readFixRows() {
    var out = [], el = $('fixList');
    if (!el) return out;
    Array.prototype.forEach.call(el.querySelectorAll('.pair'), function (w) {
      var sel = w.querySelectorAll('select');
      if (!sel[0].value) return;
      out.push({
        name: sel[0].value, kind: sel[1].value,
        col: sel[2] ? sel[2].value : '', row: sel[3] ? sel[3].value : ''
      });
    });
    return out;
  }
  function readLeadRows() {
    var out = [], el = $('leadList');
    if (!el) return out;
    Array.prototype.forEach.call(el.querySelectorAll('select.nameSel'), function (x) {
      if (x.value) out.push(x.value);
    });
    return out;
  }

  // 「詳しい条件」の「班に1人ずつにする人」でえらんだ人（名簿の★と同じ扱い）
  function condLeaders() {
    var out = {}, el = $('leadList');
    if (!el) return out;
    Array.prototype.forEach.call(el.querySelectorAll('select.nameSel'), function (s) {
      if (s.value) out[s.value] = true;
    });
    return out;
  }
  function readNames() {
    var out = [], lead = {}, nums = {}, seq = 0;
    // ⚠男女を入れるのは、名簿を貼り直したときだけ。
    //   毎回入れ直すと、③で手で変えたぶんが元にもどってしまう
    var raw = $('names').value;
    var fresh = (raw !== state.lastRaw);
    raw.split('\n').forEach(function (line) {
      var p = parseLine(line);
      if (!p.name) return;
      out.push(p.name);
      seq++;
      // 名簿に番号があればその番号。無ければ名簿にならんでいる順（1・2・3…）
      nums[p.name] = p.num || String(seq);
      if (p.lead) lead[p.name] = true;
      if (fresh && p.sex) state.sex[p.name] = p.sex;
    });
    state.lastRaw = raw;
    state.nums = nums;
    // 名簿に★を書かずに、条件のほうでえらんだ人も合わせる（2026-09-03）
    var cl = condLeaders();
    for (var k in cl) lead[k] = true;
    state.leaders = lead;
    return out;
  }
  function hasLeaders() { for (var k in state.leaders) return true; return false; }
  function refreshNames() {
    var typed = readNames();
    if (state.sample && !typed.length) {
      state.names = state.sampleNames;
      // サンプルにも出席番号を付けておく（並んでいる順）
      var sn = {};
      state.names.forEach(function (n, i) { sn[n] = String(i + 1); });
      state.nums = sn;
      $('count').textContent = 'サンプル ' + state.names.length + '人';
    } else {
      state.names = typed;
      $('count').textContent = state.names.length + '人';
    }
    refreshSeatInfo();
    document.querySelectorAll('select.nameSel').forEach(fillNames);
  }
  function clampNum(v, dflt) {
    var n = parseInt(v, 10);
    if (!n || n < 2) n = dflt;
    if (n > 8) n = 8;
    return String(n);
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
        'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;line-height:1.2;';
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
  // 学年・組のとなりに月（2026-08-31 本人の要望）
  function monthWord(kana) {
    var m = $('month') ? $('month').value : '';
    return m ? m + (kana ? 'がつ' : '月') : '';
  }
  function sheetTitle() {
    var kana = isKana(), c = className(kana), m = monthWord(kana);
    return (c ? c + ' ' : '') + (m ? m + ' ' : '') + titleWord();
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
  // 🔴 条件の行は「値ごと」作れるようにする（2026-09-03 本人）。
  //   本人「②を名簿と一緒に全部保存した方が、理科室と一緒だからいい」
  //   ⚠保存から戻すときは、まだ名簿を読む前のことがある。
  //     その名前が選べないと消えてしまうので、無ければ option を自分で足す
  function pickName(sel, name) {
    if (!name) return;
    var has = false, i;
    for (i = 0; i < sel.options.length; i++) if (sel.options[i].value === name) has = true;
    if (!has) sel.add(new Option(name, name));
    sel.value = name;
    sel.classList.remove('ph');
  }
  function addPairRow(listId, a0, b0) {
    var wrap = document.createElement('div');
    wrap.className = 'pair';
    var a = document.createElement('select'); a.className = 'nameSel'; a.dataset.ph = 'Aさんを選ぶ';
    var b = document.createElement('select'); b.className = 'nameSel'; b.dataset.ph = 'Bさんを選ぶ';
    fillNames(a); fillNames(b);
    a.classList.add('ph'); b.classList.add('ph');
    pickName(a, a0); pickName(b, b0);
    [a, b].forEach(function (e) {
      e.addEventListener('change', function () {
        e.classList.toggle('ph', !e.value);
        if ($('save').checked && !state.sample) save();
      });
    });
    var sep = document.createElement('span'); sep.textContent = 'と';
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'mini'; del.textContent = '削除';
    del.onclick = function () {
      wrap.remove();
      if ($('save').checked && !state.sample) save();
    };
    wrap.appendChild(a); wrap.appendChild(sep); wrap.appendChild(b); wrap.appendChild(del);
    $(listId).appendChild(wrap);
  }

  function addFixRow(d) {
    d = d || {};
    var wrap = document.createElement('div');
    wrap.className = 'pair';
    var n = document.createElement('select'); n.className = 'nameSel ph';
    n.dataset.ph = 'Aさんを選ぶ'; fillNames(n);
    pickName(n, d.name);
    n.addEventListener('change', function () {
      n.classList.toggle('ph', !n.value);
      if ($('save').checked && !state.sample) save();
    });
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
      if ($('save').checked && !state.sample) save();
    };
    // 保存から戻す（「この席に」なら列と段も）
    if (d.kind) {
      kind.value = d.kind;
      if (d.kind === 'seat') {
        [col, row, lab1, lab2, lab3].forEach(function (e) { e.hidden = false; });
        if (d.col) col.value = d.col;
        if (d.row) row.value = d.row;
      }
    }
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'mini'; del.textContent = '削除';
    del.onclick = function () {
      wrap.remove();
      if ($('save').checked && !state.sample) save();
    };
    [n, kind, lab1, col, lab2, row, lab3, del].forEach(function (e) { wrap.appendChild(e); });
    $('fixList').appendChild(wrap);
  }

  // 🔴 ★（班に1人ずつにする人）を、名簿を書きかえずにえらぶ（2026-09-03 本人）。
  //   ⚠名簿の★と合わせて効く。消したいときは、この行を削除する
  function addLeadRow(name) {
    var wrap = document.createElement('div');
    wrap.className = 'pair';
    var n = document.createElement('select'); n.className = 'nameSel ph';
    n.dataset.ph = '人をえらぶ'; fillNames(n);
    // 保存から戻すとき。⚠この時点ではまだ名簿を読み込んでいないことがあるので、
    //   その名前を自分で足してからえらぶ（あとで名簿が入れば、そのまま残る）
    if (name) {
      var has = false, i;
      for (i = 0; i < n.options.length; i++) if (n.options[i].value === name) has = true;
      if (!has) n.add(new Option(name, name));
      n.value = name;
      n.classList.remove('ph');
    }
    n.addEventListener('change', function () {
      n.classList.toggle('ph', !n.value);
      leadChanged();
    });
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'mini'; del.textContent = '削除';
    del.onclick = function () { wrap.remove(); leadChanged(); };
    wrap.appendChild(n); wrap.appendChild(del);
    $('leadList').appendChild(wrap);
    updateLeadCount();
  }
  // えらび直したら、その場で散らし直す（席替えを押し直さなくてよい）
  function leadChanged() {
    refreshNames();
    if (state.seats && state.opt) {
      state.seats = spreadLeaders(state.seats);
      drawSheet();
    }
    updateLeadCount();
  }
  // ★を気にせず班に分ける、を入れたときの案内（2026-09-03）
  function leadIgnoreNote() {
    var el = $('leadIgnoreNote'); if (!el) return;
    var on = $('leadIgnore') ? $('leadIgnore').checked : false;
    el.hidden = !on;
    if (on) el.innerHTML = '今表示している座席は、★の人が1人になる設定になっています。' +
      '「★を気にせず班に分ける」にチェックを入れたら、<strong>もう一度「席替えする」を押すのがおすすめです。</strong>';
  }

  // 🔴 何人えらんでいるかだけを、ボタンの右に出す（2026-09-03 本人）。
  //   ⚠班の数と見くらべる文は出さない。本人「班じゃないこともあるから」
  //     ＝★を班分け以外の目じるしに使う先生がいる。
  //   （★のいない班の知らせは、これまでどおり④の知らせに出る）
  function updateLeadCount() {
    var n = Object.keys(condLeaders()).length;
    var el = $('leadCount');
    if (el) el.textContent = n ? n + '人選択中' : '';
    // 🔴 ④にも、★が何でどこでえらぶのかを出す（2026-09-03 本人「？を読まずに理解できるように」）。
    //   ⚠下の2つのチェックの**両方**にかかるので、チェックの上に1行だけ置く
    var w = $('leadWhat');
    if (w) w.innerHTML = '★＝②<strong>「詳しい条件」</strong>の中の<strong>「班に1人ずつにする人」</strong>で設定することができます。' +
      '今★は<strong>' + n + '人</strong>です';
  }

  // ============================================================
  //  班長・前の班・クラスの保存（2026-08-31）
  // ============================================================

  // 席の並びから「班ごとのメンバー（名前）」を作る。
  // ⚠班は必ず生徒の向き（黒板が上）で数える。表示の向きで数えると中身が変わってしまう
  function groupMembers(seats, opt) {
    opt = opt || state.opt;
    if (!opt || !state.grp.on) return [];
    var gr = Seating.groups(seats, opt.cols, opt.rows, state.grp.size, state.grp.style, 'top');
    var mem = {}, i, g, out = [];
    for (i = 0; i < seats.length; i++) {
      g = gr.map[i];
      if (g && seats[i]) (mem[g] = mem[g] || []).push(seats[i]);
    }
    for (g in mem) out.push(mem[g]);
    return out;
  }

  // ---- 班長をなるべく1班に1人ずつ散らす ----
  // 席をまるごと組み直すのではなく、「班長が2人いる班」と「0人の班」で人を入れ替える。
  // ⚠こうすると班のかたち（3人班のかぎ型など）は崩れない。中身の人だけが入れ替わる
  // ⚠条件（離す・隣にする・席を決める）を壊さない相手を先に探す。
  //   どうしても壊れるときは班長を優先する＝そのときは赤い印で先生に見える
  function spreadLeaders(seats) {
    // 🔴「★を気にせず班に分ける」なら、何もしない（2026-09-03 知り合いの先生の要望）
    if (state.grp.ignoreLead) return seats;
    if (!state.grp.on || !hasLeaders() || !state.opt) return seats;
    var o = state.opt, s2 = seats.slice(), loop, i;
    for (loop = 0; loop < 30; loop++) {
      var gr = Seating.groups(s2, o.cols, o.rows, state.grp.size, state.grp.style, 'top');
      var cnt = {}, seatsOf = {}, g;
      for (i = 0; i < s2.length; i++) {
        g = gr.map[i];
        if (!g || !s2[i]) continue;
        (seatsOf[g] = seatsOf[g] || []).push(i);
        if (state.leaders[s2[i]]) cnt[g] = (cnt[g] || 0) + 1;
      }
      var over = null, zero = null;
      for (g in seatsOf) {
        if ((cnt[g] || 0) >= 2 && over === null) over = g;
        if (!(cnt[g] || 0) && zero === null) zero = g;
      }
      if (over === null || zero === null) break;   // 散らし終わった／これ以上は無理
      var from = seatsOf[over].filter(function (k) { return state.leaders[s2[k]]; });
      var to = seatsOf[zero].filter(function (k) { return s2[k] && !state.leaders[s2[k]]; });
      if (!from.length || !to.length) break;
      var before = Seating.violations(s2, o).length, done = false, a, b;
      for (a = 0; a < from.length && !done; a++) {
        for (b = 0; b < to.length && !done; b++) {
          var t = s2.slice(), x = t[from[a]];
          t[from[a]] = t[to[b]]; t[to[b]] = x;
          if (Seating.violations(t, o).length <= before) { s2 = t; done = true; }
        }
      }
      if (!done) {   // 条件をどうしても壊すときは、班長を優先して1回だけ動かす
        var t2 = s2.slice(), y = t2[from[0]];
        t2[from[0]] = t2[to[0]]; t2[to[0]] = y; s2 = t2;
      }
    }
    return s2;
  }

  // ---- クラスと記録の置き場 ----
  function loadStore() {
    try {
      var d = JSON.parse(localStorage.getItem(KEYC) || 'null');
      if (d && d.classes) return d;
      // ⚠前の置き場に入っているぶんを引き継ぐ（先生の保存を消さない）
      var old = JSON.parse(localStorage.getItem(KEYOLD) || 'null');
      if (old && old.classes && old.classes.length) {
        var st = {
          v: 2, classes: old.classes.map(function (c) {
            return {
              id: c.id, label: c.label,
              names: (c.d && c.d.names) || '',
              seat: c.d || null, seki: null,
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
      ($('msg2') || $('msg')).innerHTML = '<div class="notice warn">保存できませんでした。' +
        'ブラウザの空きが足りないようです。古い記録を消してから、もう一度お試しください。</div>';
      return false;
    }
  }
  function curClass(st) {
    st = st || loadStore();
    var id = ($('clsSel') && $('clsSel').value) ||
      ($('clsSel2') ? $('clsSel2').value : '') || '';
    if (!id) return null;
    for (var i = 0; i < st.classes.length; i++) if (st.classes[i].id === id) return st.classes[i];
    return null;
  }
  // 記録は新しいものが先頭。だから recs[0] が「前回」
  function prevRec() {
    var c = curClass();
    return (c && c.recs && c.recs.length) ? c.recs[0] : null;
  }

  // 直近の記録から「同じ班だった組み合わせ」を集める。新しいものほど重い
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function pastPairs(back) {
    var c = curClass(), out = {};
    if (!c || !c.recs) return out;
    var n = Math.min(back, c.recs.length);
    for (var k = 0; k < n; k++) {
      var w = n - k;                                  // 直近がいちばん重い
      (c.recs[k].gmem || []).forEach(function (mem) {
        for (var i = 0; i < mem.length; i++)
          for (var j = i + 1; j < mem.length; j++) {
            var key = pairKey(mem[i], mem[j]);
            out[key] = (out[key] || 0) + w;
          }
      });
    }
    return out;
  }
  // 前の班とどれだけ重なっているか。小さいほど良い案
  function planScore(seats, pairs, opt) {
    var sc = 0;
    groupMembers(seats, opt).forEach(function (m) {
      for (var i = 0; i < m.length; i++)
        for (var j = i + 1; j < m.length; j++) sc += (pairs[pairKey(m[i], m[j])] || 0);
    });
    return sc;
  }

  // 画面に出すための情報（班長のいない班／前回も同じ班／前回と同じ席）
  function checkInfo(gm) {
    var out = { noLead: [], dup: {}, dupText: [], same: 0, sizeNote: null };
    var i, g, mem = {}, seats = state.seats;
    if (!seats) return out;
    if (gm) {
      for (i = 0; i < seats.length; i++) {
        g = gm[i];
        if (g && seats[i]) (mem[g] = mem[g] || []).push(seats[i]);
      }
      // 🔴 指定した人数の班にならなかったときだけ知らせる（2026-09-02 本人）。
      //   ⚠決め打ちで出さない。**実際にできた班を数えて**、届かなかったときだけ。
      //   理由＝机のかたまりは2列ずつの帯で切るので、帯の人数が指定で割り切れないと
      //     「多い班は作らない」の決まりで人数が落ちる（35人・6列だと帯が12人＝5人班にならない）
      //   ⚠「縦の列ごと」は人数で切っていないので出さない
      if (state.grp.style !== 'col') {
        var mx = 0, tot = 0;
        for (g in mem) { if (mem[g].length > mx) mx = mem[g].length; tot += mem[g].length; }
        // ⚠そもそも人数が足りないときは出さない（見れば分かることなので）
        if (mx && tot >= state.grp.size && mx < state.grp.size)
          out.sizeNote = { want: state.grp.size, got: mx };
      }
      if (hasLeaders()) {
        for (g in mem) {
          var has = mem[g].some(function (n) { return state.leaders[n]; });
          if (!has) out.noLead.push(+g);
        }
        out.noLead.sort(function (a, b) { return a - b; });
      }
      // 前の班と重なっている人
      if (state.avoid.on) {
        var pairs = pastPairs(state.avoid.back);
        for (g in mem) {
          var m = mem[g];
          for (i = 0; i < m.length; i++)
            for (var j = i + 1; j < m.length; j++)
              if (pairs[pairKey(m[i], m[j])]) {
                out.dup[m[i]] = true; out.dup[m[j]] = true;
                out.dupText.push(m[i] + 'さんと' + m[j] + 'さん（' + g + '班）');
              }
        }
      }
    }
    return out;
  }
  // 前回の記録と席が同じ人
  function sameSeatMap() {
    var r = prevRec();
    if (!r || !r.seats || !state.seats) return null;
    if (r.seats.length !== state.seats.length) return null;
    var out = {}, hit = 0, all = 0;
    for (var i = 0; i < state.seats.length; i++) {
      if (!state.seats[i]) continue;
      all++;
      if (r.seats[i] === state.seats[i]) { out[i] = true; hit++; }
    }
    // ⚠記録した直後や、記録を呼び出した直後は「同じ座席表そのもの」。
    //   ここで「全員が前回と同じ席です」と出すと意味が分からないので、そのときは出さない
    if (!hit || hit === all) return null;
    return out;
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
    // 🔴「隣の条件は設定しない」のチェックが入っているあいだは、
    //   離す・隣にするの条件そのものを使わない（2026-09-03 本人）。
    //   ⚠ラジオの4つ目にしていたのをやめて、チェックの下に3つを置く形にした。
    //     本人「4つが同列だと、ボタンを変えたら設定が変わるってのが想像しにくい」
    var off = $('modeOff') ? $('modeOff').checked : false;
    var uiMode = (document.querySelector('input[name=mode]:checked') || {}).value || 'cross';
    return {
      names: state.names, cols: state.cols, rows: state.rows,
      mode: uiMode,
      separate: off ? [] : pairs('sepList'), adjacent: off ? [] : pairs('adjList'),
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
    clearHist();                    // ここから先は別の並び。「1つ戻す」も白紙にする
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

    // 🔴 前の班と同じメンバーをさける（2026-08-31 本人の要望）。
    //   たくさん作って、前の班との重なりがいちばん少ないものから3つ選ぶ。
    //   ⚠ゼロにできないことがある。そのときは重なった人を画面に出す（黙って出さない）
    var pairs = (state.avoid.on && state.grp.on) ? pastPairs(state.avoid.back) : null;
    var plans = Seating.generate(opt, pairs ? 40 : 3, pairs ? 5000 : 2000);
    if (!plans.length) {
      var who = Seating.blame(opt);
      msg.innerHTML = '<div class="notice warn"><strong>条件がきつすぎて作れませんでした。</strong>' +
        (who ? '<br>' + esc(who) + ' を外すと作れます。' :
          '<br>「隣」の決め方をゆるくするか、条件をへらしてください。') + '</div>';
      return;
    }
    state.opt = opt;
    // 🔴🔴 班長を先に散らしてから、前の班との重なりを数える（2026-09-02 本人）。
    //   ⚠前は順番が逆だった＝重なりの少ない案を選んだあとに班長を入れ替えていたので、
    //     せっかく避けたペアが、班長の入れ替えで戻ることがあった。
    //   本人「班長はひとつの班に1人が原則。それが守られる形で」
    //   ＝班長を1人ずつにするのが先。そのうえで、重なりのいちばん少ないものを選ぶ
    //   ⚠ hasLeaders() が偽なら spreadLeaders は何もしないので、★を使わない先生は今までどおり
    plans = plans.map(function (pl) { return spreadLeaders(pl); });
    if (pairs) {
      plans = plans.map(function (pl) { return { s: pl, sc: planScore(pl, pairs, opt) }; })
        .sort(function (a, b) { return a.sc - b.sc; })
        .slice(0, 3).map(function (x) { return x.s; });
    }
    state.plans = plans; state.cur = 0;
    state.seats = plans[0].slice();
    $('result').hidden = false;
    drawTabs(); drawSheet(); printNote();
    showSample();
    if (!first) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (state.sample) { /* サンプルは保存しない */ }
    else if ($('save').checked) save();
    else {
      // 🔴 ボタンは置かない（2026-09-01 本人）。
      //   ⚠ここで押したことが⑦とつながっていると分かるのは、作った側だけ。
      //     場所を教えるだけにして、切り替えは⑦でしてもらう
      msg.innerHTML = '<div class="notice">ページを閉じたり読み込み直すと、入れた名簿は消えます。' +
        '残したいときは、下の<strong>⑦ 画面の保存</strong>でチェックを入れてください。</div>';
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
      // 🔴 班は「生徒の向き（黒板が上）」で一度だけ作る（2026-08-31 本人）。
      //   ⚠見えている向きで作り直すと、黒板を下にしたとき班の中身が変わってしまう
      //     （人だけ動いて班が付いてこない）。表示だけ回せば、班も人といっしょに回る。
      //   規則＝黒板が前。前から1班。窓（西）側から1班2班。
      //     先生の向きでは前が下・窓が右になるので、1班は右下に来る＝規則はそのまま成り立つ
      //   ⚠ 共通の seating.js は席次表も読んでいるので、あちらは変えない
      var gr = Seating.groups(state.seats, cols, rows, state.grp.size, state.grp.style, 'top');
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

    // 前回の記録とのくらべ（画面だけ。紙・モニター・画像には出さない）
    var chk = checkInfo(gm), samap = sameSeatMap();

    // 🔴 黒板を下にする＝教卓から見た向き＝紙を180度まわした形（2026-08-31 本人）
    //   本人「スクリーンが上で生徒用は左上が1なら、スクリーンが下になった時に右下が1」
    //   ⚠ 上下だけ返すと鏡になる。左右も入れ替える
    var flip = (state.board !== 'top');
    for (var dr = 0; dr < rows; dr++) {
      var r = flip ? rows - 1 - dr : dr;
      for (var c = 0; c < cols; c++) {
        var sc = flip ? cols - 1 - c : c;
        var i = r * cols + sc;
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
          // ⚠クラス名を 'lead' にしてはいけない。style.css の .lead（リード文＝灰色・小さい字）が
          //   座席にまで効いて、名前が灰色になり、文字の大きさまで変わってしまう（2026-08-31）
          // ⚠班に分けていないときは★を出さない（2026-09-03 本人が発見）。
          //   これまでは「★を座席表に出す」のチェックが残っていると、班を外しても★だけ出ていた
          if (state.grp.on && state.grp.mark && state.leaders[name]) d.classList.add('is-leader');
          if (samap && samap[i]) d.classList.add('same');          // 前回と同じ席
          if (chk.dup[name]) d.classList.add('dup');               // 前回も同じ班
          var sp = document.createElement('span');
          sp.className = 'nm';
          sp.textContent = displayName(name);
          var col = sexColor(name);
          if (col) sp.style.color = col;
          d.appendChild(sp);
          // 🔴 出席番号は左下（2026-09-03）。班番号＝左上・★＝右上とぶつからない場所
          if (state.numOn && state.nums[name]) {
            var no = document.createElement('span');
            no.className = 'no';
            no.textContent = state.nums[name];
            d.appendChild(no);
          }
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
    // 🔴 端末によって紙の余白がちがう（とくにタブレットは倍率を指定できない）。
    //   ⚠こちらで正解を決められないので、⑤で「印刷の大きさ」を選べるようにした（2026-09-01）
    var sc = 1;   // ⚠「印刷の大きさ」は外した（2026-09-01 本人「とにかく1ページに収める」）
    var avail = (wide ? 154 : 242) * sc;
    var cap = (wide ? 36 : 46) * sc;
    var mm = Math.max(11, Math.min(cap, Math.round(avail / rows)));
    // 紙の高さいっぱいに広げるための下限（mm）。⚠vh は使わない（タブレットで紙からはみ出す）
    $('sheet').style.setProperty('--sheetMin', Math.round((wide ? 170 : 255) * sc) + 'mm');
    $('sheet').style.setProperty('--seatH', mm + 'mm');
    // 印刷したときの1マスの大きさ（用紙の幅から逆算）
    var pageW = ($('paper').value === 'landscape' ? 297 : 210) - 24;
    var cellWmm = (pageW - (cols - 1) * 1.6) / cols;
    $('credit').hidden = !$('showCredit').checked;
    $('sheet').classList.toggle('bold', $('bold').checked);
    // 名前の位置（ひらがなだけのクラスは左のほうが読みやすい）
    $('sheet').classList.toggle('al-left', $('nameAlign') && $('nameAlign').value === 'left');
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
    // 🔴 モニターでは班番号と★も名前に合わせて大きくする（2026-08-31 本人「小さすぎる」）。
    //   ⚠決め打ちの大きさにすると、マスが小さいときに番号のほうが名前より大きくなる
    $('sheet').style.setProperty('--markSize', Math.max(11, Math.round(base * 0.34)) + 'px');
    // 🔴 マスごとに大きさを決めると、名前の長さでばらつく（2026-09-01 本人）。
    //   ⚠**いちばん小さくなったものに全部そろえる。**
    //     一覧して名前を探す表なので、大きさがちがうと目が迷う
    // 🔴⚠かくしているあいだは測らない（2026-09-01 本人）。
    //   マスの幅も高さもゼロになるので、極端に小さい大きさで決まってしまう。
    //   見せたときに測り直す（toggleMask のほうで drawSheet を呼ぶ）
    var nms = [], minPx = 9999, minMm = 9999;
    if (g.clientWidth >= 10) {
    g.querySelectorAll('.seat .nm').forEach(function (sp) {
      fitText(sp.parentNode, sp, base);
      var px = parseFloat(sp.style.fontSize) || base;
      if (px < minPx) minPx = px;
      var pm = fitPrintSize(sp.textContent, cellWmm - 7, mm - 5, $('bold').checked);
      if (pm < minMm) minMm = pm;
      nms.push(sp);
    });
    nms.forEach(function (sp) {
      sp.style.fontSize = minPx + 'px';
      sp.style.setProperty('--nmPrint', minMm + 'mm');
    });
    }
    // ⚠この一文は毎回ここで書きかえている。HTML側を直しても出ない（2026-09-03 に気づいた）
    var note = document.querySelector('.drag-note');
    if (note) {
      // 🔴 文はこれだけ（2026-09-03 本人の指定）。
      //   ⚠長押しのことも「1つ戻す」のことも、ここには書かない。
      //     長押しは④の説明に、戻すのはこの文のすぐ左のボタンにある
      note.innerHTML = state.grp.on
        ? '席はマグネットのように入れ替えができます。<strong>班番号を押すと、席の班と色を変更できます</strong>。'
        : '席はマグネットのように入れ替えができます。';
    }
    drawCheck(chk, samap);
    updateLeadCount();          // 班の数が決まったので、★の人数の案内も出し直す
    bindDrag();
    drawViolations();
    drawDeco();
    fitSheet();
  }

  // 班長のいない班／前回も同じ班／前回と同じ席 を、まとめて知らせる。
  // ⚠黙って結果だけ出さない。避けきれないことがあるので、そのまま伝えて先生に直してもらう
  function drawCheck(chk, samap) {
    var el = $('gInfo');
    if (!el) return;
    var li = [];
    // ⚠文言は本人が書いたもの（2026-09-02）。勝手に言い換えない
    if (chk.sizeNote)
      li.push('<strong>' + chk.sizeNote.want + '人の班になりません</strong>：' +
        '2列ずつのまとまりで分けているからです。' + chk.sizeNote.want + '人班にしたい場合は、' +
        '教室の形を変更するか、マスの左上の班の番号を押して班を変更してください。');
    // ⚠「★を気にせず班に分ける」ときは出さない（気にしないと決めた人に見せる意味がない）
    if (chk.noLead.length && !state.grp.ignoreLead)
      li.push('<strong>★の人がいない班</strong>：' + chk.noLead.join('班・') + '班');
    if (chk.dupText.length) {
      // ⚠多いと一行が長くなりすぎるので、6組までにして残りは数で言う
      var show = chk.dupText.slice(0, 6).map(esc).join('／');
      var rest = chk.dupText.length - 6;
      li.push('<strong>前回も同じ班</strong>：' + show + (rest > 0 ? '　ほか' + rest + '組' : ''));
    }
    if (samap) {
      var n = 0, k;
      for (k in samap) n++;
      li.push('<strong>前回と同じ席</strong>：' + n + '人（黄色い枠）');
    }
    el.innerHTML = li.length ? '<div class="notice">' + li.join('<br>') + '</div>' : '';
  }

  // 🔴 座席表をかくす（2026-08-31 本人）。
  //   モニターに映す前に、パソコンの画面で子どもにネタバレしないようにするため。
  //   ⚠かくすのは画面だけ。モニター・印刷・画像にはちゃんと出る
  function toggleMask() {
    var sh = $('sheet'), b = $('hideSheet');
    if (!sh || !b) return;
    var on = !sh.classList.contains('masked');
    sh.classList.toggle('masked', on);
    b.textContent = on ? '👀 座席表を見せる' : '🙈 座席表をかくす';
    // ⚠見せたときに測り直す。かくしているあいだは幅がゼロで、正しく測れない
    if (!on && state.seats) { try { drawSheet(); } catch (e) { } }
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
          pushHist();               // 「1つ戻す」で、班を変える前にもどせるように
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
    var oldSize = state.grp.size, oldStyle = state.grp.style;
    state.grp.size = Math.max(2, Math.min(8, +$('grpSize').value || 4));
    state.grp.style = $('grpStyle').value;
    // 班の組み方が変わったら、班長も散らし直す（色や番号だけの変更では動かさない）
    if (state.seats && (oldSize !== state.grp.size || oldStyle !== state.grp.style))
      state.seats = spreadLeaders(state.seats);
    state.grp.look = $('grpLook').value;
    state.grp.num = $('grpNum').checked;
    state.grp.mark = $('leadMark') ? $('leadMark').checked : false;
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

  // ---- 1つ戻す（2026-09-03 本人・現場の先生「手が当たっただけで入れ替わって困る」） ----
  //   ⚠押すたびに1回ずつ、入れ替えた順にさかのぼる。
  //     「席替えする」を押し直したら白紙にもどす（そこから先は別の並びなので）
  function pushHist() {
    if (!state.seats) return;
    var g = {};
    for (var k in state.gfix) g[k] = state.gfix[k];
    state.hist.push({ seats: state.seats.slice(), gfix: g });
    if (state.hist.length > 50) state.hist.shift();
    updateUndo();
  }
  function clearHist() { state.hist = []; updateUndo(); }
  function updateUndo() {
    var b = $('undo'); if (b) b.disabled = !state.hist.length;
  }
  function undoOnce() {
    var h = state.hist.pop();
    if (!h) { updateUndo(); return; }
    state.seats = h.seats.slice();
    state.gfix = h.gfix;
    drawSheet();
    updateUndo();
    if ($('save').checked && !state.sample) save();
  }

  // ---- 席を動かす（離すとぱちっとはまる） ----
  // 🔴 マウスはすぐ動く／画面を触ったときは長押ししてから動く（2026-09-03 本人・現場の先生）。
  //   ⚠タブレットでスクロールしようとして席が入れ替わる、という声。
  //     PCでも画面を触れる機種は同じだったので、「PCか否か」ではなく
  //     「マウスか指か」で分ける（pointerType で分かる）
  var drag = null;
  var HOLD_MS = 350;                // これだけ押し続けたら持ち上がる（2026-09-03 本人「もう少し早く」）

  // 🔴 持ち上がったあとは、ページのスクロールを止める（2026-09-03 本人）。
  //   本人「縦に動かそうとするとスクロールも一緒に動いてしまう」。
  //   ⚠ touch-action:manipulation は「スクロールしてよい」なので、指を縦に動かすと
  //     席とページが両方動く。pointermove の preventDefault だけでは止まらない。
  //   ⚠ touchmove を **passive:false** で受けて打ち消すのが確実。
  //     長押しのあいだ指は止まっているので、この時点ではスクロールがまだ始まっておらず、打ち消せる
  function blockScroll(e) { if (e.cancelable) e.preventDefault(); }
  function scrollLock(on) {
    if (on) document.addEventListener('touchmove', blockScroll, { passive: false });
    else document.removeEventListener('touchmove', blockScroll, { passive: false });
  }

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
    var byMouse = (e.pointerType === 'mouse');
    drag = { el: d, from: +d.dataset.i, id: e.pointerId,
             x0: e.clientX, y0: e.clientY, active: false, ghost: null, over: null,
             byMouse: byMouse, ready: byMouse, timer: null };
    d.addEventListener('pointermove', dragMove);
    d.addEventListener('pointerup', dragEnd);
    d.addEventListener('pointercancel', dragEnd);
    if (byMouse) {
      try { d.setPointerCapture(e.pointerId); } catch (err) { }
      return;
    }
    // 指・ペンは長押しだけ。
    // ⚠つかまえる（setPointerCapture）のも長押しが決まってから。
    //   先につかまえると、スクロールにゆずれなくなる
    drag.timer = setTimeout(function () {
      if (!drag) return;
      drag.timer = null;
      drag.ready = true;
      try { drag.el.setPointerCapture(drag.id); } catch (err) { }
      scrollLock(true);              // ここから先はページを動かさない
      lift(drag.x0, drag.y0);
      // 持ち上がった合図。⚠対応していない機器では何も起きない（それでよい。浮いて見える）
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { }
    }, HOLD_MS);
  }

  // 何もせずに手を離す（スクロールにゆずる）
  function dropDrag() {
    if (!drag) return;
    if (drag.timer) clearTimeout(drag.timer);
    scrollLock(false);
    var d = drag.el;
    d.removeEventListener('pointermove', dragMove);
    d.removeEventListener('pointerup', dragEnd);
    d.removeEventListener('pointercancel', dragEnd);
    try { d.releasePointerCapture(drag.id); } catch (err) { }
    drag = null;
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
      var far = Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0);
      // 長押しが決まる前に指が動いた＝スクロールしたいということ。席には手を付けない
      if (!drag.ready) { if (far > 10) dropDrag(); return; }
      if (far < 6) return;
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
    if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; }
    scrollLock(false);
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
        pushHist();                 // 入れ替える前の並びを残す（↩ 1つ戻す）
        var t2 = state.seats[from]; state.seats[from] = state.seats[to]; state.seats[to] = t2;
      }
      drawSheet();
    }, 140);
    drag = null;
  }

  // ---- 印刷 ----
  // ⚠「印刷するもの」は外した（2026-09-01 本人）。案は上のタブでえらぶ
  function printNote() {
    var el = $('printNote'); if (!el) return;
    el.textContent = ($('printWhat') && $('printWhat').value === 'all')
      ? ''
      : '';
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

  var printScrollY = 0;
  var printBW = false;      // 紙だけ黒にするか（画面はそのまま）
  function doPrint() {
    printBW = !!($('printBW') && $('printBW').checked);
    // 🔴 印刷の画面を閉じたあと、ページの先頭に飛ばない（2026-09-01 本人・タブレット）。
    //   ⚠印刷のあいだ中身をいったん隠すので、そのまま戻すと位置を見失う
    printScrollY = window.scrollY || window.pageYOffset || 0;
    setPaper();
    // 🔴 紙だけ先生の向きにする（画面は変えない）。2026-08-31 本人「印刷の時にそうしたい」
    // ⚠ 紙が終わったら必ず戻す（afterprint）。戻さないと画面が回ったままになる
    var teacher = $('printTeacher') && $('printTeacher').checked;
    if (teacher && state.board !== 'bottom') {
      printKeepBoard = state.board;
      state.board = 'bottom';
      drawSheet();
    }
    if ($('printWhat') && $('printWhat').value === 'all' && state.plans.length) buildAll();
    else if ((!$('printWay') || $('printWay').value === 'img') && state.seats) {
      // 🔴 画面と同じ絵を1枚作って、それだけを印刷する。
      //   ⚠3案まとめて印刷のときは、今までどおり文字のまま
      //   🔴⚠**<img> を使わない。**画像の読み込みを待つと、そのあいだに
      //     「指で押した直後」という資格が切れて、iPadが印刷を受け付けない（2026-09-01）。
      //     canvas をそのまま置けば読み込みが要らないので、押したその場で印刷できる
      try {
        var wrap = $('printImgWrap');
        var wideP = $('paper').value === 'landscape';
        // A4よこ＝1.41、たて＝0.71。紙より少し横長にしておくと、幅で合わせたときに縦が余る。
        // ⚠横長にしすぎると左右の余白が増えて、本体が小さくなる（2026-09-01 本人「用紙いっぱいにしたかった」）。
        //   1.55 は「紙いっぱいに近く、かつはみ出さない」ぎりぎりの値
        var cv = padToAspect(buildSheetCanvas(2), wideP ? 1.50 : 0.75);
        wrap.innerHTML = '';
        wrap.appendChild(cv);
        document.body.classList.add('print-img');
      } catch (e) { }
    }
    window.print();
  }
  var printKeepBoard = null;

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-all');
    printBW = false;
    document.body.classList.remove('print-img');
    if ($('printImgWrap')) $('printImgWrap').innerHTML = '';
    $('printAll').innerHTML = '';
    if (printKeepBoard) { state.board = printKeepBoard; printKeepBoard = null; drawSheet(); }
    // ⚠ 描き直しが終わってから戻す。すぐ戻すと、まだ高さが足りずに効かない
    setTimeout(function () { window.scrollTo(0, printScrollY); }, 0);
    setTimeout(function () { window.scrollTo(0, printScrollY); }, 250);
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

  // 🔴 座席表を1枚の絵にする（2026-09-01）。
  //   k を大きくすると解像度が上がる（描き方は同じ。ものさしを拡大するだけ）
  //   ⚠印刷はこの絵でおこなう＝**紙に収める計算をブラウザにまかせられる**。
  //     端末ごとの余白がわからなくても、必ず1ページに収まる
  function buildSheetCanvas(k) {
    k = k || 1;
    var o = state.opt, cols = o.cols, rows = o.rows;
    var icon = $('deco').value || '';
    var credit = $('showCredit').checked;
    var cw = 150, ch = 90, pad = 40, head = 70, boardH = 40;
    var W = pad * 2 + cols * cw;
    var H = pad * 2 + head + boardH + rows * ch + (credit ? 28 : 0);
    var cv = document.createElement('canvas');
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    var x = cv.getContext('2d');
    x.scale(k, k);                     // ⭐これだけで、以下の描き方は一切変えずに済む
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
    // ⚠先に全員ぶんを測って、いちばん小さい大きさにそろえる（画面と同じ考え方）
    var weight0 = $('bold').checked ? 'bold ' : '';
    var nameSize = $('bold').checked ? 34 : 28;
    (state.seats || []).forEach(function (nm) {
      if (!nm) return;
      var ls = displayName(nm).split(NL), sz = nameSize;
      while (sz > 9) {
        x.font = weight0 + sz + 'px ' + fontStack();
        var over = ls.some(function (tx) { return x.measureText(tx).width > cw - 20; });
        if (!over && ls.length * sz * 1.25 < ch - 16) break;
        sz -= 1;
      }
      if (sz < nameSize) nameSize = sz;
    });

    var gy = top + (state.board === 'top' ? boardH : 0);
    if (state.board === 'top') board(top); else board(top + rows * ch + 6);

    var flipP = (state.board !== 'top');
    for (var dr = 0; dr < rows; dr++) {
      var r = flipP ? rows - 1 - dr : dr;
      for (var c = 0; c < cols; c++) {
        var sc = flipP ? cols - 1 - c : c;
        var name = state.seats[r * cols + sc];
        var px = pad + c * cw, py = gy + dr * ch;
        var gi = state.gmap ? state.gmap[r * cols + sc] : 0;
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
        var size = nameSize;              // ⚠全員そろえる（先に測ってある）
        // ⚠印刷だけ黒にしたいときがある（画面は色つきのまま）。2026-09-01 本人
        x.fillStyle = ((!printBW && $('sexPrint').checked) ? sexColor(name) : null) || '#333';
        x.font = weight + size + 'px ' + fontStack();
        x.textAlign = 'center'; x.textBaseline = 'middle';
        var lh = size * 1.25, top0 = py + ch / 2 - (lines.length - 1) * lh / 2;
        lines.forEach(function (t, li) { x.fillText(t, px + cw / 2, top0 + li * lh); });
        x.textAlign = 'left'; x.textBaseline = 'top';
      }
    }
    if (credit) {
      x.font = '15px sans-serif'; x.fillStyle = '#c3b2ba'; x.textAlign = 'right';
      x.fillText('さくらツール　sakura-tools.com', W - pad, H - pad - 8);
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
  // 🔴 絵を紙の形に合わせる（2026-09-01）。
  //   ⚠iPadは印刷のとき**幅だけを見て縮める**。高さの指定（max-height）は効かない。
  //     なので**絵のほうを、紙より少し横長にしておく**。
  //     そうすれば幅で合わせたときに、縦は自然に余る＝はみ出さない
  //   ⚠白い余白は左右に付ける。上下には付けない（紙の上ぞろえにするため）
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
  function doPng() {
    var cv = buildSheetCanvas(1);
    var a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = (sheetTitle().replace(/\s/g, '') || '座席表') + '.png';
    a.click();
  }

  // ---- 保存（使ってる機器の中だけ）----
  // 保存する一式。前回のつづき・クラス・記録で同じものを使う
  function snapshot() {
    return {
        names: $('names').value,
        grade: $('grade').value, kumi: $('kumi').value, clsFree: $('clsFree').value,
        month: $('month') ? $('month').value : '',
        cols: $('cols').value, rows: $('rows').value,
        board: $('board').value,
        mode: (document.querySelector('input[name=mode]:checked') || {}).value || 'cross',
        modeOff: $('modeOff') ? $('modeOff').checked : true,
        // ⚠ grp の中に入れずに、ここに置く（grp は席次表とも形をそろえてあるため）
        // 🔴 ②の条件は**ぜんぶ名簿と一緒に保存する**（2026-09-03 本人）。
        //   本人「逆にね、②を名簿と一緒に全部保存した方が、理科室と一緒だからいい」
        //   ＝理科室（group）と同じ形にそろえた。⑧の名簿ごとの保存にも自動で入る
        //     （クラス保存は snapshot() をそのまま持つ作りのため）
        cond: {
          sep: readPairRows('sepList'),
          adj: readPairRows('adjList'),
          fix: readFixRows(),
          leads: readLeadRows()
        },
        numOn: $('numOn') ? $('numOn').checked : false,
        nameMode: $('nameMode').value, nameAlign: $('nameAlign') ? $('nameAlign').value : 'center',
        font: $('font').value, bold: $('bold').checked,
        showCredit: $('showCredit').checked,
        printTeacher: $('printTeacher') ? $('printTeacher').checked : true,
        printBW: $('printBW') ? $('printBW').checked : false,
        printScale: $('printScale') ? $('printScale').value : '1',
        printWay: $('printWay') ? $('printWay').value : 'img',
        // 🔴 座席表もいっしょに残す（2026-08-31 本人「⑦は画面の保存」）。
        //   ⚠サンプルは残さない。名簿を入れていない人の画面が、次に開いたとき居座ってしまう
        seats: (state.sample || !state.seats) ? null : state.seats.slice(),
        order: $('order').value, dir: $('dir').value,
        colM: $('colM').value, colF: $('colF').value,
        sexPrint: $('sexPrint').checked,
        dt: $('dt').value, dtOff: $('dtOff').checked,
        grp: state.grp,
        avoid: state.avoid,
        sex: (function () {              // いま名簿にある人だけ残す（去年の名前をためこまない）
          var out = {};
          state.names.forEach(function (n) { if (state.sex[n]) out[n] = state.sex[n]; });
          return out;
        })()
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); showSaving(); } catch (e) { }
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
      applySnap(d);
      // 座席表は画面の組み立てが終わってから出す（init のいちばん最後）
      state.pendingSeats = (d.seats && d.seats.length) ? d.seats : null;
      $('save').checked = true;
    } catch (e) { }
  }
  // 保存した一式を画面に戻す（前回のつづき・クラス・記録で共通）
  function applySnap(d) {
    try {
      $('names').value = d.names || '';
      $('grade').value = d.grade || ''; $('kumi').value = d.kumi || '';
      $('clsFree').value = d.clsFree || '';
      if ($('month')) $('month').value = d.month || '';
      // ⚠えらぶ形にしたので、前に保存した 9 以上は入らない。8 におさめる
      $('cols').value = clampNum(d.cols, 6); $('rows').value = clampNum(d.rows, 6);
      $('board').value = d.board || 'top';
      // ⚠前に保存した人は 'cross' などを持っている。そのままにする（勝手に外さない）。
      //   ⚠一時期 'none' で保存していた版がある。そのときは既定（前後左右）にもどす
      var dm = d.mode || 'cross';
      if (dm === 'none') dm = 'cross';
      var mr = document.querySelector('input[name=mode][value="' + dm + '"]');
      if (mr) mr.checked = true;
      // ⚠この項目を持っていない人（前の版）は「設定しない」にしておく
      if ($('modeOff')) $('modeOff').checked = (d.modeOff === undefined) ? true : !!d.modeOff;
      modeChanged();
      // 🔴 ②の条件を戻す（⚠いったん空にしてから入れ直す。二重に増えるのを防ぐ）
      var c = d.cond || {};
      if ($('sepList')) {
        $('sepList').innerHTML = '';
        (c.sep || []).forEach(function (x) { addPairRow('sepList', x[0], x[1]); });
      }
      if ($('adjList')) {
        $('adjList').innerHTML = '';
        (c.adj || []).forEach(function (x) { addPairRow('adjList', x[0], x[1]); });
      }
      if ($('fixList')) {
        $('fixList').innerHTML = '';
        (c.fix || []).forEach(function (x) { addFixRow(x); });
      }
      if ($('leadList')) {
        $('leadList').innerHTML = '';
        (c.leads || []).forEach(function (nm) { addLeadRow(nm); });
        updateLeadCount();
      }
      // 条件が1つでも入っていたら、②の「詳しい条件」を開いておく（気づいてもらうため）
      if ($('condBlock') && ((c.sep && c.sep.length) || (c.adj && c.adj.length) ||
          (c.fix && c.fix.length) || (c.leads && c.leads.length))) $('condBlock').open = true;
      // ⚠前に保存した人はこの項目を持っていない。そのときは既定（出さない）のまま
      if (d.numOn !== undefined && $('numOn')) {
        $('numOn').checked = !!d.numOn;
        state.numOn = !!d.numOn;
        state.numTouched = true;      // 前に決めたとおりにする
      }
      if (d.nameMode) $('nameMode').value = d.nameMode;
      if (d.nameAlign && $('nameAlign')) $('nameAlign').value = d.nameAlign;
      if (d.font) $('font').value = d.font;
      $('bold').checked = !!d.bold;
      if (d.showCredit !== undefined) $('showCredit').checked = !!d.showCredit;
      // ⚠前に保存した人はこの項目を持っていない。そのときは既定（オン）のまま
      if (d.printTeacher !== undefined && $('printTeacher'))
        $('printTeacher').checked = !!d.printTeacher;
      if (d.printBW !== undefined && $('printBW')) $('printBW').checked = !!d.printBW;
      if (d.printScale && $('printScale')) $('printScale').value = d.printScale;
      if (d.printWay && $('printWay')) $('printWay').value = d.printWay;
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
          num: d.grp.num !== false,
          mark: !!d.grp.mark,
          ignoreLead: !!d.grp.ignoreLead
        };
        if ($('leadIgnore')) $('leadIgnore').checked = state.grp.ignoreLead;
        leadIgnoreNote();
        $('grpOn').checked = state.grp.on;
        $('grpOpts').hidden = !state.grp.on;
        $('grpNumWrap').hidden = !state.grp.on;
        $('grpSize').value = state.grp.size;
        $('grpStyle').value = state.grp.style;
        $('grpLook').value = state.grp.look;
        $('grpNum').checked = state.grp.num;
        if ($('leadMark')) $('leadMark').checked = state.grp.mark;
      }
      state.avoid = { on: !!(d.avoid && d.avoid.on), back: (d.avoid && d.avoid.back) || 3 };
      if ($('grpAvoid')) $('grpAvoid').checked = state.avoid.on;
      if ($('grpBack')) $('grpBack').value = state.avoid.back;
    } catch (e) { }
  }
  function clearSaved() {
    try { localStorage.removeItem(KEY); } catch (e) { }
    $('save').checked = false; showSaving();
    ($('msg2') || $('msg')).innerHTML = '<div class="notice">この機器に保存していた画面を消しました。</div>';
  }

  // ---- クラスと記録の画面まわり ----
  // 保存まわりの知らせは⑦と⑧のあいだに出す（席替えボタンの下だと何の話か分からない）
  function note(t) {
    var el = $('msg2') || $('msg');
    el.innerHTML = '<div class="notice">' + t + '</div>';
  }

  function refreshClsUI() {
    var st = loadStore(), sel = $('clsSel');
    if (!sel) return;
    var keep = sel.value;
    [sel, $('clsSel2')].forEach(function (el) {
      if (!el) return;
      el.innerHTML = '<option value="">－</option>';
      // 🔴 簡単スライドで作った「文字のセット」は名簿ではないので出さない（2026-09-05）
      st.classes.forEach(function (c) {
        if (c.kind === 'slide') return;
        var o = document.createElement('option');
        o.value = c.id; o.textContent = c.label;
        el.appendChild(o);
      });
      el.value = keep;
      if (el.selectedIndex < 0) el.value = '';
    });
    // ⚠残したものが無いうちは、①の呼び出し欄を出さない
    if ($('quickLoad')) $('quickLoad').hidden = !st.classes.length;
    var nCls = st.classes.filter(function (c) { return c.kind !== 'slide'; }).length;
    $('clsCount').textContent = nCls
      ? nCls + '／' + MAXC + '件'
      : '0／' + MAXC + '件・まだ保存していません';
    refreshRecUI();
  }
  // ①と⑧の2か所にえらぶ欄があるので、両方そろえる
  function setCls(id) {
    [$('clsSel'), $('clsSel2')].forEach(function (el) { if (el) el.value = id; });
  }
  function refreshRecUI() {
    var c = curClass(), sel = $('recSel');
    if (!sel) return;
    sel.innerHTML = '<option value="">－</option>';
    var recs = (c && c.recs) || [];
    recs.forEach(function (r, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = r.label + '（' + r.at + '）';
      sel.appendChild(o);
    });
    $('recCount').textContent = recs.length + '／' + MAXR + '件';
    var el = $('avoidNote');
    if (el) el.textContent = !c ? 'クラスをえらぶと使えます。'
      : recs.length ? '「' + c.label + '」の記録が ' + recs.length + ' 件あります。'
        : 'まだ記録がありません。記録が1件たまると使えるようになります。';
  }

  // 呼び出したあと、画面をその状態に組み直す
  function afterRestore(seats, quiet) {
    state.sample = false;
    state.seats = null;               // ⚠先に空にする（orderChanged が席替えし直すのを防ぐ）
    state.gfix = {};
    refreshNames(); renderSexList(); refreshSeatInfo(); orderChanged();
    state.board = $('board').value;
    var opt = collect();
    state.opt = opt;
    if (seats && seats.length === opt.cols * opt.rows) {
      state.plans = [seats.slice()]; state.cur = 0; state.seats = seats.slice();
      $('result').hidden = false;
      drawTabs(); drawSheet(); printNote(); showSample();
      if (!quiet) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      $('result').hidden = true; state.plans = [];
    }
    showSaving();
  }

  function doClsNew() {
    var st = loadStore();
    var name = prompt('名簿の名前を入れてください', className(false) || '名簿');
    if (name === null) return;
    name = (name || '').replace(/^\s+|\s+$/g, '');
    if (!name) return;
    // ⚠同じ名前で押し直すと2件になってしまう。同じ名前があったら上書きするか聞く
    for (var i = 0; i < st.classes.length; i++) {
      if (st.classes[i].label === name) {
        if (!confirm('「' + name + '」はすでにあります。上書きしますか。' +
          '（中の記録はそのまま残ります）')) return;
        st.classes[i].names = $('names').value;
        st.classes[i].seat = snapshot();
        if (!saveStore(st)) return;
        refreshClsUI();
        setCls(st.classes[i].id);
        refreshRecUI();
        note('「' + name + '」を上書きしました。');
        return;
      }
    }
    if (st.classes.length >= MAXC) {
      alert('名簿は' + MAXC + '件までです。いらないものを消してから保存してください。');
      return;
    }
    var id = 'c' + (new Date().getTime());
    st.classes.push({
      id: id, label: name, names: $('names').value,
      seat: snapshot(), seki: null, recs: []
    });
    if (!saveStore(st)) return;
    refreshClsUI();
    setCls(id);
    refreshRecUI();
    note('「' + name + '」として保存しました。');
  }
  function doClsSave() {
    var st = loadStore(), c = curClass(st);
    if (!c) { alert('先に、保存した名簿をえらんでください。はじめて残すときは「新しい名前で保存」です。'); return; }
    c.names = $('names').value;
    c.seat = snapshot();
    if (!saveStore(st)) return;
    note('「' + c.label + '」を今の内容で上書きしました。');
  }
  function doClsLoad() {
    var c = curClass();
    if (!c) { alert('先に、保存した名簿をえらんでください。'); return; }
    if (!confirm('「' + c.label + '」を入れます。' +
      'いま画面にある名簿と座席表は消えます。よろしいですか。')) return;
    // ⚠席次表だけで保存したものは seat が空。そのときも名簿だけは入れる
    var d = c.seat ? JSON.parse(JSON.stringify(c.seat)) : {};
    d.names = c.names || d.names || '';
    applySnap(d);
    afterRestore(null);
    note('「' + c.label + '」を入れました。<strong>「席替えする」を押してください。</strong>');
  }
  function doClsDel() {
    var st = loadStore(), c = curClass(st);
    if (!c) { alert('先に、消したい保存した名簿をえらんでください。'); return; }
    if (!confirm('「' + c.label + '」を消します。' +
      'その中の記録と、席次表で使っている設定も一緒に消えます。よろしいですか。')) return;
    st.classes = st.classes.filter(function (x) { return x.id !== c.id; });
    if (!saveStore(st)) return;
    setCls('');
    refreshClsUI();
    note('「' + c.label + '」を消しました。');
  }

  function doRecSave() {
    var st = loadStore(), c = curClass(st);
    if (!c) { alert('先に、保存した名簿をえらんでください。'); return; }
    if (!state.seats) { alert('先に席替えをしてください。'); return; }
    if (state.sample) { alert('サンプルは記録できません。名簿を入れてから席替えしてください。'); return; }
    c.recs = c.recs || [];
    if (c.recs.length >= MAXR) {
      alert('記録は' + MAXR + '件までです。古い記録を消してから、もう一度お試しください。');
      return;
    }
    var d0 = new Date();
    var stamp = (d0.getMonth() + 1) + '/' + d0.getDate();
    // ⚠同じ日に何件も作る先生がいる（夏休み前にまとめて、など）。
    //   日付だけだと見分けがつかないので、案の番号も入れておく
    var def = (($('month') && $('month').value) ? $('month').value + '月' : stamp) +
      ' 案' + (state.cur + 1);
    var label = prompt('記録の名前を入れてください', def);
    if (label === null) return;
    label = (label || '').replace(/^\s+|\s+$/g, '') || def;
    // 同じ名前があったら差し替えるか聞く（押し間違いで同じものが2件できないように）
    for (var k = 0; k < c.recs.length; k++) {
      if (c.recs[k].label === label) {
        if (!confirm('「' + label + '」はすでにあります。差し替えますか。')) return;
        c.recs.splice(k, 1);
        break;
      }
    }
    // ⭐新しいものを先頭に置く＝recs[0] がいつも「前回」
    c.recs.unshift({
      label: label, at: stamp, d: snapshot(),
      seats: state.seats.slice(),
      gmem: groupMembers(state.seats)
    });
    if (!saveStore(st)) return;
    refreshRecUI();
    note('「' + c.label + '　' + label + '」を記録しました。');
    drawSheet();
  }
  function doRecLoad() {
    var c = curClass(), i = $('recSel').value;
    if (!c || i === '') { alert('呼び出す記録をえらんでください。'); return; }
    var r = c.recs[+i];
    if (!r) return;
    if (!confirm('「' + r.label + '」の座席を表示します。' +
      'いま画面にある座席表は消えます。よろしいですか。')) return;
    applySnap(r.d);
    afterRestore(r.seats);
    note('「' + r.label + '」の座席を表示しました。');
  }
  function doRecDel() {
    var st = loadStore(), c = curClass(st), i = $('recSel').value;
    if (!c || i === '') { alert('消す記録をえらんでください。'); return; }
    var r = c.recs[+i];
    if (!r) return;
    if (!confirm('「' + r.label + '」を消します。よろしいですか。')) return;
    c.recs.splice(+i, 1);
    if (!saveStore(st)) return;
    refreshRecUI();
    note('「' + r.label + '」を消しました。');
  }
  function clearAllCls() {
    if (!confirm('保存したクラスと記録を全部消します。もとに戻せません。よろしいですか。')) return;
    try { localStorage.removeItem(KEYC); } catch (e) { }
    setCls('');
    refreshClsUI();
    note('保存したクラスと記録を全部消しました。');
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

  // 「隣の条件は設定しない」のチェックで、中身ごと開け閉めする（2026-09-03 本人）
  var MODE_NOTE = {
    lr: '横にならんだ<strong>左右の席だけ</strong>を「隣」とみなします。',
    cross: '<strong>前後左右の4つの席</strong>を「隣」とみなします。',
    king: 'ななめもふくめた<strong>まわり8つの席</strong>を「隣」とみなします。いちばんきつい決め方です。'
  };
  function modeChanged() {
    var off = $('modeOff') ? $('modeOff').checked : false;
    var box = $('modeBox');
    if (box) box.hidden = off;
    var m = (document.querySelector('input[name=mode]:checked') || {}).value || 'cross';
    var note = $('modeNote');
    if (note) note.innerHTML = MODE_NOTE[m] || '';
  }

  function orderChanged() {
    var byNumber = $('order').value === 'number';
    // 🔴 出席番号順をえらんだら、席の出席番号も自動で出す（2026-09-03 本人）。
    //   ⚠先生が自分でチェックを触ったあとは、こちらから入れ直さない
    if (byNumber && !state.numTouched && $('numOn') && !$('numOn').checked) {
      $('numOn').checked = true;
      state.numOn = true;
    }
    // 出席番号順のときだけ使う。ふだんは押せない形にして「あること」は見せておく
    $('dir').disabled = !byNumber;
    $('dirWrap').classList.toggle('off', !byNumber);
    $('orderNote').textContent = byNumber
      ? '入力した順にならべます。下の「詳しい条件」は不要です。'
      : '';
    // 出席番号順のときは条件が捨てられる（generate の手前で空にしている）。
    // 消さずに薄くする＝「あること」は見せて、触っても効かない誤解だけ防ぐ
    var cond = $('condBlock'); if (cond) cond.classList.toggle('off', byNumber);
    // 🔴 出席番号順のときは班長の指定が効かない（入れ替えると番号順が崩れるため）。
    //   ⚠メッセージは出さない。薄くするだけ（2026-08-31 本人「使えないのはわかってると思う」）
    var lw = $('leadWrap'); if (lw) lw.classList.toggle('off', byNumber);
    if ($('save').checked && !state.sample) save();
    // 🔴 選んだ瞬間に並べ直す（2026-08-31 本人）。
    //   ⚠以前は「作る」を押すまで反映されず、本人でも「効いていない」と勘違いした。
    //     人数・列数・グループは選んだ瞬間に変わるのに、ここだけ押し直しが要るのが原因。
    //   ⚠ドラッグで手を加えた並びは消えるが、向きを変えるのは作り始めの段階なので、
    //     順番が逆になることは少ないと判断した（本人の判断）
    //   ⚠ run(true) にすると画面が飛ばない（run() だと結果まで一気にスクロールする）
    if (state.seats) { try { run(true); } catch (e) { } }
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
    if ($('hideSheet')) $('hideSheet').onclick = toggleMask;
    if ($('printScale')) $('printScale').addEventListener('change', function () {
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    if ($('nameAlign')) $('nameAlign').addEventListener('change', function () {
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
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
      // 🔴🔴 班に分けた「その瞬間」にも★を散らす（2026-09-03 本人の指摘で判明）。
      //   ⚠これが無いと、班を使わずに席替えしたあとで班に分けたとき、
      //     ★が2人の班と0人の班ができたままになる。
      //     （席替えのときだけ散らしていた＝班が無い状態では散らしようがなかった）
      if (state.seats && this.checked) state.seats = spreadLeaders(state.seats);
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    ['grpSize', 'grpStyle', 'grpLook', 'grpNum', 'leadMark'].forEach(function (id) {
      if (!$(id)) return;
      $(id).addEventListener('input', grpChanged);
      $(id).addEventListener('change', grpChanged);
    });

    if ($('sexClear')) $('sexClear').onclick = function () {
      state.sex = {}; renderSexList();
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    };
    ['cols', 'rows'].forEach(function (id) { $(id).addEventListener('input', refreshSeatInfo); });
    ['grade', 'kumi', 'clsFree', 'month'].forEach(function (id) {
      if (!$(id)) return;
      ['input', 'change'].forEach(function (ev) {
        $(id).addEventListener(ev, function () {
          showSaving(); if (state.seats) drawSheet(); if ($('save').checked) save();
        });
      });
    });

    // 🔴 前の班と同じメンバーをさける（2026-08-31）
    if ($('grpAvoid')) $('grpAvoid').addEventListener('change', function () {
      state.avoid.on = this.checked;
      $('avoidOpts').hidden = !this.checked;
      if ($('save').checked && !state.sample) save();
    });
    if ($('grpBack')) $('grpBack').addEventListener('change', function () {
      state.avoid.back = +this.value || 3;
      if ($('save').checked && !state.sample) save();
    });

    // ---- クラスと記録 ----
    if ($('clsSel')) {
      // ①と⑧の2か所に同じえらぶ欄がある。かたほうを変えたら、もう片方もそろえる
      var syncCls = function (from, to) {
        return function () { if ($(to)) $(to).value = $(from).value; refreshRecUI(); };
      };
      $('clsSel').addEventListener('change', syncCls('clsSel', 'clsSel2'));
      if ($('clsSel2')) $('clsSel2').addEventListener('change', syncCls('clsSel2', 'clsSel'));
      if ($('clsLoad2')) $('clsLoad2').onclick = doClsLoad;
      $('clsSave').onclick = doClsSave;
      $('clsNew').onclick = doClsNew;
      $('clsDel').onclick = doClsDel;
      $('recLoad').onclick = doRecLoad;
      $('recSave').onclick = doRecSave;
      $('recDel').onclick = doRecDel;
      $('clsClearAll').onclick = clearAllCls;
      refreshClsUI();
    }
    $('kana').addEventListener('change', function () { if (state.seats) drawSheet(); });
    $('board').addEventListener('change', function () {
      state.board = $('board').value;
      if (state.seats) drawSheet();
    });
    $('addSep').onclick = function () { addPairRow('sepList'); };
    $('addAdj').onclick = function () { addPairRow('adjList'); };
    // ⚠ addFixRow をそのまま渡さない。クリックの情報が第1引数に入ってしまう
    $('addFix').onclick = function () { addFixRow(); };
    // ⚠ addLeadRow をそのまま渡さない。クリックの情報が第1引数（名前）に入ってしまう
    if ($('addLead')) $('addLead').onclick = function () { addLeadRow(); };
    if ($('undo')) $('undo').onclick = undoOnce;
    // 🔴「隣」の考え方（2026-09-03）。チェックを外すと、3つの選びと設定の欄が出てくる
    if ($('modeOff')) $('modeOff').addEventListener('change', function () {
      modeChanged();
      if ($('save').checked && !state.sample) save();
    });
    document.querySelectorAll('input[name=mode]').forEach(function (r) {
      r.addEventListener('change', function () {
        modeChanged();
        if ($('save').checked && !state.sample) save();
      });
    });
    modeChanged();
    // 🔴「★を気にせず班に分ける」（2026-09-03 知り合いの先生の要望）
    if ($('leadIgnore')) $('leadIgnore').addEventListener('change', function () {
      state.grp.ignoreLead = this.checked;
      // ⭐入れたとき＝すでに散らした並びは元にもどせないので、押し直してもらう。
      //   外したとき＝その場で散らし直せるので、案内はいらない
      if (!this.checked && state.seats && state.opt)
        state.seats = spreadLeaders(state.seats);
      leadIgnoreNote();
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });

    // 🔴 席に出席番号を出す（2026-09-03）
    if ($('numOn')) $('numOn').addEventListener('change', function () {
      state.numOn = this.checked;
      state.numTouched = true;       // 自分で決めた人には、こちらから入れ直さない
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    // ⚠run を直接わたさない。クリックの情報が第1引数に入って「初回」と間違われる
    $('go').onclick = function () { run(); };
    // ⚠「べつの案を出す」は座席表を見ながら押すので、画面を動かさない
    $('again').onclick = function () { run(true); };
    $('doPrint').onclick = doPrint;
    if ($('printWhat')) $('printWhat').addEventListener('change', printNote);
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
    if ($('clear')) $('clear').onclick = clearSaved;
    // 🔴 チェックを外す＝保存をやめる＝その場で消す（2026-08-31 本人）。
    //   ⚠外しただけで残っていると、「消したつもり」で名簿が残ってしまう
    $('save').addEventListener('change', function () {
      if (this.checked) { save(); $('msg').innerHTML = ''; }
      else clearSaved();
    });
    // 保存してあった座席表を出す（画面の組み立てが終わったこのタイミングで）
    if (state.pendingSeats) {
      var ps = state.pendingSeats; state.pendingSeats = null;
      try { afterRestore(ps, true); } catch (e) { }
      // 🔴 組み立ての途中で「席がない状態」がいったん保存されてしまう（orderChanged などが save を呼ぶ）。
      //   ⚠これを書き戻さないと、2回目に開いたときに座席表が消える（2026-08-31 検証で見つけた）
      if ($('save').checked) { try { save(); } catch (e) { } }
    }
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

    // 🔴 書体が読み込まれてから、文字の大きさを測り直す（2026-09-01 本人「安定しない」）。
    //   ⚠読み込み前に測ると、代わりの書体の幅で計算してしまい、マスごとにばらつく。
    //     「何か操作するとそろう」のは、そのとき測り直しているから
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (state.seats) { try { drawSheet(); } catch (e) { } }
      });
    }
    window.addEventListener('load', function () {
      if (state.seats) { try { drawSheet(); } catch (e) { } }
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

    // 🔴 保存してあった座席表を戻したときは、ここで作り直さない（2026-08-31 検証で見つけた）。
    //   ⚠この行は「開いた時点で現物が見えているように」入れたもの。
    //     復元のあとに走ると、せっかく戻した並びを別のものに書きかえてしまう
    if (!state.seats) { try { run(true); } catch (e) { } }

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
