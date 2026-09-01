/* 席次表メーカー 画面まわり（/seki/）
   ⚠ 座席表（/seat/）とは別ファイル。ここを直しても座席表は影響を受けない。
   席の座標は「前からの列」で持つ（r=0 が最前列）。
   前方が下のときは、表示のときだけ上下をひっくり返す。
   🔴 配置エンジン(Seating)には、名前ではなく重複しないふだ（p1,p2…）をわたす。
      同姓同名がいても混ざらないようにするため。表示するときに中身を引く。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'sakura-seki-v1';

  var state = {
    names: [], cols: 6, rows: 5, board: 'top', mode: 'cross',
    people: {},                     // ふだ(p1,p2…) -> {no,name,kana,org,title}
    colRoles: [],                   // 貼り付けた列の役割。['no','name','kana','org']など
    colSig: '',                     // 列の見出しを描き直すかどうかの目印
    firstRow: null,                 // 列の中身を見本として見せる
    sep: [], adj: [], fix: [],
    plans: [], cur: 0, seats: null,
    sample: false, sampleCount: 0,
    // サンプルは名簿欄に入れない（消す手間が出るので）
    grp: { on: false, size: 4, style: 'org', look: 'both', num: true },
    gmap: null, gcount: 0,
    gfix: {}                        // 手で変えたグループ（席の番号 → グループの番号）
  };

  // 班の色（色の見分けがつきにくい方にも伝わる組み合わせ）
  // [線の色, うすい塗り, ぬりつぶしの塗り]
  // ⚠ぬりつぶしの塗りは、名前が読める濃さまでにとどめる。
  //   色ごとに明るさが違うので、濃さは1色ずつ決めてある
  // 赤・橙・黄・黄緑・緑・水色・青・紫・桃 の9色。
  // ［線の色, うすい塗り, ぬりつぶしの塗り, 色あい（色相）］
  // ⚠水色と青は色が近いので、明るさを変えてある
  // 🔴 席次表は印刷が主役なので、座席表よりずっと薄くしてある（本人の判断）。
  //    紙は画面より濃く出るうえ、1マスに4行入るので、塗りが濃いと名前が読みにくい。
  //    ⚠ 座席表(/seat/)の色はそのまま。ここを薄くしても向こうには影響しない
  var GCOL = [
    ['#EF6B6B', 'rgba(239,107,107,.06)', 'rgba(239,107,107,.13)', 0],   // 赤
    ['#3FBF88', 'rgba(63,191,136,.06)', 'rgba(63,191,136,.13)', 145],   // 緑
    ['#EF6BAE', 'rgba(239,107,174,.055)', 'rgba(239,107,174,.12)', 325],// 桃
    ['#4A8FD6', 'rgba(74,143,214,.06)', 'rgba(74,143,214,.13)', 220],   // 青
    ['#F2913F', 'rgba(242,145,63,.07)', 'rgba(242,145,63,.15)', 28],    // 橙
    ['#6FC9E8', 'rgba(111,201,232,.08)', 'rgba(111,201,232,.17)', 193], // 水色
    ['#8CC63F', 'rgba(140,198,63,.075)', 'rgba(140,198,63,.16)', 85],   // 黄緑
    ['#9B6BE0', 'rgba(155,107,224,.055)', 'rgba(155,107,224,.12)', 270],// 紫
    ['#E8B62A', 'rgba(232,182,42,.08)', 'rgba(232,182,42,.17)', 50]     // 黄
  ];

  // 班の番号の順に、上から色を使う。9班をこえたら赤にもどってくり返す。
  // ⚠となり合う班の色を計算で離す作りも試したが、取り下げた（2026-08-27 本人の判断）＝
  //   使われない色が出て見た目がさびしくなる／近い色がとなり合っても先生が番号を押して直せる／
  //   それより「3人班がちゃんとかぎ型になっている」ほうが大事
  function gcol(no) { return GCOL[(no - 1) % GCOL.length]; }
  // 🔴 グループは数字ではなく記号（A・B・C…）にする。
  //    右上の通し番号と見分けられなくなるため
  function glabel(n) {
    var out = '', v = n;
    while (v > 0) { out = String.fromCharCode(65 + (v - 1) % 26) + out; v = Math.floor((v - 1) / 26); }
    return out;
  }

  // ---- 名簿（Excelから複数の列をそのまま貼れる） ----
  // 1行1人。列はタブ区切り（Excelからのコピーはタブで区切られる）。
  // ⚠ 会社と大学の両方で通る名前にしてある。
  //   同じ階層のものを1つの行にまとめる＝会社名と大学名／役職と学部・学科
  // 🔴 並びは「席次表に出てくる上から下」の順にそろえる。
  //    名前は出るときも下なので、ここでも下。よく使うから上、という並べ方はやめた（本人の指摘）
  var ROLES = [
    ['no', '社員番号・学籍番号'],
    ['org', '会社名・大学名'],
    ['title', '役職・学部・学科'],
    ['kana', 'ふりがな'],
    ['name', '名前'],
    ['', '使わない']
  ];
  // 役職らしい言葉／所属らしい言葉。⚠「部長」を先に見ないと「部」で所属と判定してしまう
  var RE_TITLE = /(社長|会長|専務|常務|取締役|本部長|部長|次長|課長|係長|主任|主査|室長|店長|支店長|所長|園長|校長|教頭|教授|准教授|講師|助教|学長|学部長|代表|理事|顧問|参与|リーダー|マネージャー|担当)$/;
  var RE_ORG = /(株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|\(有\)|（有）|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|医療法人|学校法人|宗教法人|法人|協議会|協会|組合|連合会|機構|財団|社団|学科|学部|研究科|事業部|センター|支店|営業所|本社|本部|支社|工場|製作所|工業|産業|商事|商会|商店|物産|銀行|信用金庫|保険|建設|運輸|病院|クリニック|薬局|大学|高等学校|高校|中学校|小学校|学園|学院|事務所|グループ|チーム|部$|課$|室$|係$|科$|会$|社$)/;

  function readRows() {
    return $('names').value.split('\n')
      .filter(function (s) { return s.trim().length; })
      .map(function (s) {
        return s.split('\t').map(function (c) { return c.trim(); });
      });
  }
  // 貼り付けた列が何なのか、自動で当たりをつける
  function guessRoles(rows) {
    var n = 0;
    rows.forEach(function (r) { if (r.length > n) n = r.length; });
    var roles = new Array(n), used = {}, cols = [], i;
    for (i = 0; i < n; i++) {
      roles[i] = '';
      cols.push(rows.map(function (r) { return (r[i] || '').trim(); })
        .filter(function (v) { return v.length; }));
    }
    function mark(i, role) { if (!used[role]) { roles[i] = role; used[role] = 1; } }
    function most(list, re) {
      var hit = list.filter(function (s) { return re.test(s); }).length;
      return hit >= list.length * 0.5;
    }
    // 漢字の入った列があるか＝そこが名前だとすれば、ひらがなの列はふりがなだと言える。
    // ⚠ これを見ないと、ひらがなで書かれた名簿の「名前」をふりがなにしてしまう
    var kanji = /[\u4e00-\u9fff]/;
    var hasKanji = cols.some(function (v) {
      return v.length && v.filter(function (t) { return kanji.test(t); }).length >= v.length * 0.5;
    });
    for (i = 0; i < n; i++) {
      var v = cols[i];
      if (!v.length) continue;
      // 数字だけ → 番号
      if (v.every(function (s) { return /^[0-9０-９\-‐]+$/.test(s); })) { mark(i, 'no'); continue; }
      // カタカナだけ → ふりがな
      if (v.every(function (s) { return /^[ァ-ヶー・\u3000 ]+$/.test(s); })) { mark(i, 'kana'); continue; }
      // ひらがなだけ → ふりがな（ただし、漢字の名前が別の列にあるときだけ）
      if (hasKanji && v.every(function (s) { return /^[ぁ-んー・\u3000 ]+$/.test(s); })) { mark(i, 'kana'); continue; }
      if (most(v, RE_TITLE)) { mark(i, 'title'); continue; }
      if (most(v, RE_ORG)) { mark(i, 'org'); continue; }
    }
    // 残っている列のうち、いちばん「人の名前らしい」列を名前にする。
    // ⚠ ただ左から選ぶと、長い法人名の列を名前にしてしまうことがある
    //    （「一般社団法人さくら地域振興協議会」を名前と判定した実例あり）
    //    人の名前は短く、姓と名のあいだに空白が入ることが多い、という見分け方
    function nameScore(list) {
      if (!list.length) return -1;
      var hit = list.filter(function (t) {
        var len = t.replace(/[ \u3000]/g, '').length;
        return len <= 8 && (/[ \u3000]/.test(t) || len <= 4);
      }).length;
      return hit / list.length;
    }
    if (!used['name']) {
      var best = -1, bestScore = -1;
      for (i = 0; i < n; i++) {
        if (roles[i] || !cols[i].length) continue;
        var sc = nameScore(cols[i]);
        if (sc > bestScore) { bestScore = sc; best = i; }   // 同点なら左が勝つ
      }
      if (best >= 0) mark(best, 'name');
    }
    // 全部の列に役割が付いてしまって名前が無いときは、番号・ふりがな以外を名前にゆずる
    if (!used['name']) {
      for (i = 0; i < n; i++) {
        if (roles[i] && roles[i] !== 'no' && roles[i] !== 'kana') {
          used[roles[i]] = 0; roles[i] = 'name'; used['name'] = 1; break;
        }
      }
    }
    // それでも余っている列は、所属として使う
    for (i = 0; i < n; i++) { if (!roles[i] && !used['org']) { mark(i, 'org'); break; } }
    return roles;
  }

  // 名簿 → ふだ（p1,p2…）と中身
  function buildPeople() {
    var rows = readRows();
    if (!rows.length && state.sample) {
      state.people = {}; state.names = [];
      SAMPLE.slice(0, state.sampleCount || SAMPLE.length).forEach(function (s, i) {
        var id = 'p' + (i + 1);
        state.people[id] = { id: id, no: s[0], name: s[1], kana: s[2], org: s[3], title: s[4] };
        state.names.push(id);
      });
      state.firstRow = null;
      renderColMap(0);
      return;
    }
    var n = 0;
    rows.forEach(function (r) { if (r.length > n) n = r.length; });
    // 列の数が変わった＝貼り直した、とみなして割り当てをやり直す
    if (state.colRoles.length !== n) state.colRoles = guessRoles(rows);
    var roles = state.colRoles, idx = {};
    roles.forEach(function (r, i) { if (r && idx[r] === undefined) idx[r] = i; });
    state.people = {}; state.names = [];
    rows.forEach(function (r, i) {
      function get(k) { return idx[k] === undefined ? '' : (r[idx[k]] || '').trim(); }
      var nm = get('name');
      if (!nm && n === 1) nm = (r[0] || '').trim();
      var id = 'p' + (i + 1);
      state.people[id] = {
        id: id,
        no: get('no') || String(i + 1),
        name: nm || ('（' + (i + 1) + '）'),
        kana: get('kana'), org: get('org'), title: get('title')
      };
      state.names.push(id);
    });
    state.firstRow = rows[0] || null;
    renderColMap(n);
  }

  // 貼り付けた列の役割を選び直す欄
  function renderColMap(n) {
    var wrap = $('colMapWrap'), box = $('colMap');
    if (!wrap || !box) return;
    wrap.hidden = (n < 2);
    if (n < 2) { box.innerHTML = ''; state.colSig = ''; return; }
    var sig = n + '|' + state.colRoles.join(',') + '|' + (state.firstRow || []).join(',');
    if (sig === state.colSig) return;      // 変わっていなければ描き直さない
    state.colSig = sig;
    box.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var d = document.createElement('div');
      d.className = 'colcell';
      var head = document.createElement('div');
      head.className = 'colhead';
      head.textContent = (state.firstRow && state.firstRow[i]) || ('列' + (i + 1));
      var s = document.createElement('select');
      s.dataset.col = i;
      s.innerHTML = ROLES.map(function (r) {
        return '<option value="' + r[0] + '">' + r[1] + '</option>';
      }).join('');
      s.value = state.colRoles[i] || '';
      s.addEventListener('change', function () {
        var ci = +this.dataset.col, val = this.value;
        // 同じ役割を2つの列には持たせない。選び直したら、もう一方は「使わない」に
        if (val) state.colRoles.forEach(function (r, k) { if (k !== ci && r === val) state.colRoles[k] = ''; });
        state.colRoles[ci] = val;
        state.colSig = '';
        refreshNames();
        if (state.seats) drawSheet();
        if ($('save').checked && !state.sample) save();
      });
      d.appendChild(head); d.appendChild(s);
      box.appendChild(d);
    }
  }

  function refreshNames() {
    buildPeople();
    $('count').textContent = (state.sample ? 'サンプル ' : '') + state.names.length + '人';
    // サンプルで動いている間だけ案内を出す（自分の名簿を貼ったら消す）
    // ⚠ id は sampleNote にしない（座席表の下に出す案内が同じ id を使っていて、消し合う）
    var sn = $('emptyNote'); if (sn) sn.style.display = state.sample ? '' : 'none';
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
      state.names.map(function (id) {
        return '<option value="' + esc(id) + '">' + esc(nameOf(id)) + '</option>';
      }).join('');
    if (state.names.indexOf(v) >= 0) sel.value = v;
  }
  // 画面に出す文の中の「ふだ」を、人の名前に戻す
  function humanize(text) {
    var s = String(text);
    state.names.forEach(function (id) { s = s.split(id).join(nameOf(id)); });
    return s;
  }
  // ---- 文字の色（席次表は全体で1色。行ごとには分けない） ----
  var INKS = [
    ['#222222', '黒'], ['#26418f', '紺'], ['#1f5fbf', '青'],
    ['#17724a', '緑'], ['#8a5a2b', '茶'], ['#7a2431', 'えんじ']
  ];
  function inkColor() { var e = $('ink'); return (e && e.value) || '#222222'; }
  function fillInkSelect(sel, val) {
    sel.innerHTML = INKS.map(function (c) {
      return '<option value="' + c[0] + '">' + c[1] + '</option>';
    }).join('');
    sel.value = val || INKS[0][0];
  }

  // ---- サンプル（研修の席次表。番号・名前・ふりがな・所属・役職） ----
  // ⚠ 4つの行が全部そろった形を見せたいので、所属と役職まで入れてある
  var SAMPLE = [
    ['1', '山田 太郎', 'ヤマダ タロウ', '株式会社さくら商事', '部長'],
    ['2', '佐藤 花子', 'サトウ ハナコ', '株式会社さくら商事', '課長'],
    ['3', '鈴木 一郎', 'スズキ イチロウ', '株式会社さくら商事', '主任'],
    ['4', '高橋 美咲', 'タカハシ ミサキ', '株式会社さくら商事', ''],
    ['5', '田中 健太', 'タナカ ケンタ', '株式会社さくら商事', ''],
    ['6', '伊藤 里奈', 'イトウ リナ', '株式会社さくら商事', ''],
    ['7', '渡辺 大輔', 'ワタナベ ダイスケ', '桜川工業株式会社', '本部長'],
    ['8', '中村 由美', 'ナカムラ ユミ', '桜川工業株式会社', '課長'],
    ['9', '小林 翔', 'コバヤシ ショウ', '桜川工業株式会社', '主任'],
    ['10', '加藤 彩', 'カトウ アヤ', '桜川工業株式会社', ''],
    ['11', '吉田 剛', 'ヨシダ ツヨシ', '桜川工業株式会社', ''],
    ['12', '山本 千夏', 'ヤマモト チナツ', '桜川工業株式会社', ''],
    ['13', '佐々木 誠', 'ササキ マコト', 'みどり物産株式会社', '取締役'],
    ['14', '松本 香織', 'マツモト カオリ', 'みどり物産株式会社', '部長'],
    ['15', '井上 拓也', 'イノウエ タクヤ', 'みどり物産株式会社', '係長'],
    ['16', '木村 麻衣', 'キムラ マイ', 'みどり物産株式会社', ''],
    ['17', '林 直樹', 'ハヤシ ナオキ', 'みどり物産株式会社', ''],
    ['18', '清水 恵子', 'シミズ ケイコ', 'みどり物産株式会社', ''],
    ['19', '斎藤 亮', 'サイトウ リョウ', '株式会社ひまわり社', '室長'],
    ['20', '山口 智子', 'ヤマグチ トモコ', '株式会社ひまわり社', '主任'],
    ['21', '森 隆之', 'モリ タカユキ', '株式会社ひまわり社', ''],
    ['22', '池田 亜紀', 'イケダ アキ', '株式会社ひまわり社', ''],
    ['23', '橋本 康平', 'ハシモト コウヘイ', '株式会社ひまわり社', ''],
    ['24', '石川 瞳', 'イシカワ ヒトミ', '株式会社ひまわり社', ''],
    ['25', '前田 修一', 'マエダ シュウイチ', '青葉技研株式会社', '所長'],
    ['26', '藤田 沙織', 'フジタ サオリ', '青葉技研株式会社', '課長'],
    ['27', '岡田 亮太', 'オカダ リョウタ', '青葉技研株式会社', ''],
    ['28', '長谷川 愛', 'ハセガワ アイ', '青葉技研株式会社', ''],
    ['29', '村上 大地', 'ムラカミ ダイチ', '青葉技研株式会社', ''],
    ['30', '近藤 涼子', 'コンドウ リョウコ', '青葉技研株式会社', '']
  ];

  // ---- 会議名・研修名（自由記入のみ。学年・組は席次表では使わない） ----
  function className() {
    return $('clsFree').value.trim();
  }
  // ---- 1マスの中身 ----
  // 🔴 日本の席札は、名前がいちばん下・いちばん大きい。この形を初期値にしてある
  function personOf(id) { return state.people[id] || null; }
  function nameOf(id) { var p = personOf(id); return p ? p.name : String(id); }
  function honor() { var e = $('honor'); return e ? e.value : ''; }
  function nameWithHonor(p) {
    if (!p) return '';
    var h = honor();
    return p.name + (h ? ' ' + h : '');
  }
  // 🔴 行の出し入れは、チェックではなく大きさの「なし」で決める。
  //    初めて見た人にチェックは伝わりにくい（本人の指摘）
  function shown(id) { var e = $(id); return !e || e.value !== 'none'; }
  function sz(id, def) {
    var e = $(id); if (!e) return def;
    var v = parseFloat(e.value);
    return isNaN(v) ? def : v;      // 「なし」のときは既定値（高さの計算では使わない）
  }
  // 名簿にその項目が1人でも入っているか（空の行は場所を取らせない）
  function hasField(k) {
    for (var id in state.people) { if (state.people[id][k]) return true; }
    return false;
  }
  // ふりがな（名簿がカタカナでも、ひらがなに直して出せる）
  function toHira(v) {
    return String(v).replace(/[\u30a1-\u30f6]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    });
  }
  function kanaText(v) {
    return ($('kanaStyle') && $('kanaStyle').value === 'hira') ? toHira(v) : v;
  }
  // 番号の見せ方（1／①／(1)／No.1）
  // 🔴 番号は「右上のしるし」だけでなく「いちばん上の行」にも置ける。
  //    学籍番号・社員番号は通し番号ではないので、行として名前の上に出したい（本人の指摘）
  function numPos() { var e = $('numPos'); return e ? e.value : 'corner'; }
  function numOn() { return numPos() !== 'none'; }
  // 出さないときは、見せ方と大きさを選べなくする（「日付を入れない」と同じ見せ方）
  function numStyleChanged() {
    var on = numOn();
    if ($('szNo')) $('szNo').disabled = !on;
    if ($('szNoWrap')) $('szNoWrap').classList.toggle('off', !on);
  }
  // ⚠ 丸数字などの飾りはやめた。学籍番号・社員番号は桁が多く、
  //   丸で囲むと読みにくくなるだけだった（本人の判断）
  function numText(v) { return String(v); }
  // 1マスに積む行を、上から順に返す
  // 🔴 通し番号はここに入れない。右上のしるしとして、マスの角に置く
  //    （左上のグループ記号と逆サイド）
  // 所属の行だけは、はみ出すぶんを自動で詰める（名前まで小さくしないため）
  function orgSize() {
    return (state.orgFit != null) ? state.orgFit : sz('szOrg', .5);
  }
  function cellLines(p) {
    if (!p) return [];
    var out = [];
    // 「いちばん上の行」のときだけ、番号をマスの中に積む（右上のときは buildNo が描く）
    if (numPos() === 'line' && hasField('no')) {
      out.push({ k: 'no', t: p.no ? numText(p.no) : '', m: sz('szNo', .52), dim: true });
    }
    // 🔴 名簿にその項目のある人が1人でもいれば、無い人も空の行にして場所を残す。
    //    そうしないと、役職のある人と無い人で名前の高さがずれる（本人の指摘）
    if (shown('szOrg') && hasField('org')) out.push({ k: 'org', t: p.org || '', m: orgSize() });
    if (shown('szTtl') && hasField('title')) out.push({ k: 'ttl', t: p.title || '', m: sz('szTtl', .5) });
    if (shown('szKana') && hasField('kana')) out.push({ k: 'kana', t: p.kana ? kanaText(p.kana) : '', m: sz('szKana', .44), dim: true });
    // ⚠ クラス名は 'nm' にしない。共通の print.css に .seat .nm への指定があり、
    //    紙で名前の大きさと色が上書きされてしまう
    // 🔴 名前は必ず1行。姓と名のあいだで切ると、席札として不自然に見える（本人の判断）。
    //    横幅に入りきらないときは、折り返さずに文字を小さくして収める
    out.push({ k: 'nam', t: nameWithHonor(p), m: 1, b: true });
    return out;
  }
  function buildCellP(p) {
    var box = document.createElement('span');
    box.className = 'cell';
    cellLines(p).forEach(function (L) {
      var s = document.createElement('span');
      s.className = 'ln ' + L.k;
      s.textContent = L.t;
      box.appendChild(s);
    });
    return box;
  }
  function buildCell(id) { return buildCellP(personOf(id)); }
  // 右上の通し番号
  function buildNo(p) {
    if (numPos() !== 'corner' || !p || !p.no) return null;
    var sn = document.createElement('span');
    sn.className = 'sno';
    sn.textContent = numText(p.no);
    return sn;
  }
  // 1マスが何行ぶんの高さになるか（文字の大きさを決めるのに使う）
  // 1マスに積む行の数（高さを決めるのに使う）
  function lineCount() {
    var n = 1;
    if (numPos() === 'line' && hasField('no')) n++;
    if (shown('szOrg') && hasField('org')) n++;
    if (shown('szTtl') && hasField('title')) n++;
    if (shown('szKana') && hasField('kana')) n++;
    return n;
  }
  function totalEm() {
    var ms = [1];
    if (numPos() === 'line' && hasField('no')) ms.push(sz('szNo', .52));
    if (shown('szOrg') && hasField('org')) ms.push(orgSize());
    if (shown('szTtl') && hasField('title')) ms.push(sz('szTtl', .5));
    if (shown('szKana') && hasField('kana')) ms.push(sz('szKana', .44));
    var t = 0;
    ms.forEach(function (m) { t += m * 1.15; });
    return t + 0.12 * (ms.length - 1);
  }
  // 紙の寸法(mm)を画面の単位に直すための係数
  var PX_PER_MM = 96 / 25.4;
  var measureBox = null;
  // 紙に刷るときの文字の大きさ(mm)。
  // ⚠ 画面の見え方から逆算しない（画面の幅で結果が変わってしまうため）。
  //    いちばん長い行が紙の1マスに収まるところまで小さくする
  function printCellMM(wmm, hmm, lineEm) {
    if (!measureBox) {
      measureBox = document.createElement('div');
      measureBox.style.cssText =
        'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;line-height:1.15;';
      document.body.appendChild(measureBox);
    }
    var m = measureBox;
    // ⚠ 画面の既定の書体ではなく、実際に出す書体で測る。
    //   ちがう書体で測ると幅を読みちがえて、紙で名前が切れる（本人の指摘）
    m.style.fontFamily = fontStack();
    m.style.whiteSpace = 'nowrap';
    m.style.width = 'auto';
    var worst = 0;      // 文字を1mmにしたときに、いちばん幅を使う行が何mmになるか
    Object.keys(state.people).forEach(function (id) {
      cellLines(state.people[id]).forEach(function (L) {
        if (!L.t) return;
        m.style.fontWeight = (L.b && $('bold').checked) ? 'bold' : 'normal';
        m.style.fontSize = '10mm';
        m.textContent = L.t;
        var w = (m.scrollWidth / PX_PER_MM) / 10 * L.m;
        if (w > worst) worst = w;
      });
    });
    // ⚠ わずかに小さめに出す。ぴったりに合わせると、機器によって端が切れる
    var byW = worst > 0 ? (wmm - 5) / worst : 99;
    var byH = (hmm - 3) / lineEm;
    return Math.floor(Math.max(1.6, Math.min(byW, byH)) * 10) / 10;
  }

  // 座席表に出す日付（「日付を入れない」のときは空）
  // ＝モニターに映すときは消して、紙に残すときだけ入れる、という使い分けのため
  function dateText() {
    return $('dtOff').checked ? '' : ($('dt').value || '');
  }

  // 書体。画面と紙はCSSで当てているが、画像(PNG)は自分で描くので指定が要る
  // ⚠ 丸文字はWindows（HG丸ｺﾞｼｯｸM-PRO）とiPad・Mac（ヒラギノ丸ゴ ProN）だけ。
  //   無い機器ではゴシックになる（崩れはしない）
  var FONTS = {
    mincho: '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", "MS PMincho", serif',
    gothic: '"Yu Gothic", YuGothic, "Hiragino Sans", Meiryo, sans-serif',
    maru: '"HG丸ｺﾞｼｯｸM-PRO", HGMaruGothicMPRO, "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif'
  };
  function fontStack() {
    var v = $('font') ? $('font').value : 'gothic';
    return FONTS[v] || FONTS.gothic;
  }

  // 前方にあるもの（座席表の「黒板」にあたる）。
  // えらんだもののほか、自分で書ける＝「入口　　ホワイトボード　　入口」のような並べ方もできる
  function frontWord() {
    var sel = $('frontWord'), free = $('frontFree');
    if (sel && sel.value === '') return '';        // 「出さない」をえらんだら、書いてあっても出さない
    var t = free ? free.value.trim() : '';
    return t || (sel ? sel.value : '');
  }
  // 自分で書いたときは、字間を広げない（書いた空白の間隔をそのまま出すため）
  function frontIsFree() {
    var sel = $('frontWord'), free = $('frontFree');
    return !!(sel && sel.value !== '' && free && free.value.trim());
  }
  function sheetTitle() {
    var c = className();
    return (c ? c + ' ' : '') + '席次表';
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

  // 🔴 所属ごとに色を分ける（部署・学科）。
  //    ⚠ 机のかたまりと違って、色は「席」ではなく「人」に付く。
  //      席を動かすと、色もついて動く（部署の色なので、そのほうが正しい）
  // ⚠ どの項目で分けるかを選べるようにしてある。
  //   学科を「役職」の行に置いた人でも、そのままグループ分けできるようにするため
  function groupsByField(key) {
    var order = [], map = [];
    state.names.forEach(function (id) {
      var v = state.people[id] && state.people[id][key];
      if (v && order.indexOf(v) < 0) order.push(v);
    });
    state.seats.forEach(function (id, i) {
      var v = id && state.people[id] && state.people[id][key];
      map[i] = v ? order.indexOf(v) + 1 : 0;
    });
    return { map: map, count: order.length };
  }

  // ---- 席替えを実行 ----
  function run(first) {
    // 名簿が空ならサンプルで動かす（初めての人に、何ができるかを1回で見せる）
    if (!readRows().length) {
      // 会場の形はそのまま。席に入る分だけサンプルを使う。
      // ⚠名簿欄には入れない＝自分の名簿を貼るとき、消す手間が要らない
      var room = (+$('cols').value) * (+$('rows').value);
      state.sample = true;
      state.sampleCount = Math.max(1, Math.min(SAMPLE.length, room));
    }
    refreshNames();
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
      drawTabs(); drawSheet(); showSample();
      if (!first) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if ($('save').checked && !state.sample) save();
      return;
    }

    var plans = Seating.generate(opt, 3, 2000);
    if (!plans.length) {
      var who = Seating.blame(opt);
      msg.innerHTML = '<div class="notice warn"><strong>条件がきつすぎて作れませんでした。</strong>' +
        (who ? '<br>' + esc(humanize(who)) + ' を外すと作れます。' :
          '<br>「隣」の決め方をゆるくするか、条件をへらしてください。') + '</div>';
      return;
    }
    state.plans = plans; state.cur = 0; state.opt = opt;
    state.seats = plans[0].slice();
    $('result').hidden = false;
    drawTabs(); drawSheet();
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
        drawTabs(); drawSheet();
      };
      t.appendChild(b);
    });
  }

  // ---- 座席表を描く ----
  function drawSheet() {
    var o = state.opt, cols = o.cols, rows = o.rows;
    // 🔴 行を出し入れすると、上の座席表の高さが変わる＝下の設定欄ごと動いてしまう。
    //    ページの位置ではなく「いま触っているメニュー」を画面の同じ場所に留める
    var anchor = document.activeElement;
    if (!anchor || anchor === document.body || !anchor.getBoundingClientRect) anchor = null;
    var keepTop = anchor ? anchor.getBoundingClientRect().top : 0;
    var keepY = window.scrollY;
    $('shTitle').textContent = sheetTitle();
    $('shDate').textContent = dateText();
    var fw = frontWord();
    $('boardTop').hidden = (state.board !== 'top') || !fw;
    $('boardBottom').hidden = (state.board !== 'bottom') || !fw;
    $('boardTop').textContent = fw;
    $('boardBottom').textContent = fw;
    var freeWord = frontIsFree();
    $('boardTop').classList.toggle('free', freeWord);
    $('boardBottom').classList.toggle('free', freeWord);

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
      var byField = { org: 'org', title: 'title' }[state.grp.style];
      var gr = byField
        ? groupsByField(byField)
        : Seating.groups(state.seats, cols, rows, state.grp.size, state.grp.style, 'top');
      // 🔴 グループは「前方が上」の向きで一度だけ作る（2026-08-31 本人）。
      //   見えている向きで作り直すと、前方を下にしたとき中身が変わってしまう。
      //   ⚠ 共通の seating.js は座席表も読んでいるので、あちらは変えない
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

    // 🔴 紙の寸法は、マスを作る前に決める。
    //    名前を1行にするか2行にするかで中身が変わるので、先に決めておく必要がある
    var wide = $('paper').value === 'landscape';
    var pageH = (wide ? 210 : 297) - 24;          // 上下の余白 12mm ずつ
    var reserve = 12                              // 見出しと日付
      + (frontWord() ? 9 : 0)                     // 前方の帯
      + ($('showCredit').checked ? 8 : 0)         // 右下のサイト名
      + 8;   // 念のための余裕。⚠ 実測すると見出し・帯・サイト名で 35mm ほど使うので、
             //    ここが足りないと 1mm ほどはみ出して2ページ目ができる
    var gapMM = 1.6 * (rows - 1);                 // マスとマスのすきま（6px）
    var mm = Math.max(10, Math.min(60, (pageH - reserve - gapMM) / rows));
    mm = Math.round(mm * 10) / 10;
    var pageW = (wide ? 297 : 210) - 24;
    var cellWmm = (pageW - (cols - 1) * 1.6) / cols;
    $('sheet').style.setProperty('--seatH', mm + 'mm');

    state.orgFit = null;      // 所属の自動縮小は、毎回まっさらから決め直す

    // 🔴 前方を下にする＝登壇者から見た向き＝紙を180度まわした形（2026-08-31 本人）
    //   ⚠ 上下だけ返すと鏡になる。左右も入れ替える
    //   ⭐ 受付は入口＝後ろにいて参加者と同じ向きなので、回った図が要るのは登壇者だけ
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
          gn.textContent = glabel(gm[i]);
          gn.title = '押すと、この席のグループをえらべます';
          // 席を動かすほうの操作と混ざらないように、ここで止める
          gn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
          gn.addEventListener('click', openGroupPick);
          d.appendChild(gn);
        }
        if (name) {
          var sn = buildNo(personOf(name));
          if (sn) d.appendChild(sn);
          d.appendChild(buildCell(name));
        }
        g.appendChild(d);
      }
    }
    $('credit').hidden = !$('showCredit').checked;
    var sh = $('sheet');
    sh.classList.toggle('bold', $('bold').checked);
    // 行ごとの大きさ・書体・文字の色（席次表は全体で1色）
    sh.style.setProperty('--sNo', sz('szNo', .52));
    sh.style.setProperty('--sOrg', sz('szOrg', .5));
    sh.style.setProperty('--sTtl', sz('szTtl', .5));
    sh.style.setProperty('--sKana', sz('szKana', .44));
    sh.style.setProperty('--ink', inkColor());
    sh.classList.remove('f-mincho', 'f-gothic', 'f-maru');
    sh.classList.add('f-' + ($('font') ? $('font').value : 'gothic'));

    // 🔴 1マスずつ大きさを変えず、いちばん小さいものに全部そろえる。
    //    席次表は「1枚出して終わり」なので、そろっているほうが整って見える
    var lineEm = totalEm();
    // 🔴 画面の1マスの高さは「行の数」だけで決める。
    //    文字の大中小で高さまで動くと、選ぶたびに画面がガタッとずれる（本人の指摘）
    sh.style.setProperty('--seatScreenH',
      Math.max(58, Math.min(150, 32 + 22 * (lineCount() - 1))) + 'px');
    var one = g.querySelector('.seat');
    var seatHpx = one ? one.clientHeight : 60;
    var base = Math.max(7, Math.floor((seatHpx - 8) / lineEm));
    var minSize = base;
    var cells = g.querySelectorAll('.seat .cell');
    // ⚠ 幅の判定から所属だけ外す。所属は下で別に詰めるので、
    //    ここに入れると長い会社名のせいで名前まで小さくなってしまう
    function overWide(cl) {
      var lns = cl.querySelectorAll('.ln');
      for (var k = 0; k < lns.length; k++) {
        if (lns[k].classList.contains('org')) continue;
        if (lns[k].scrollWidth > cl.clientWidth + 1) return true;
      }
      return false;
    }
    cells.forEach(function (cl) {
      var s = base, host = cl.parentNode;
      cl.style.fontSize = s + 'px';
      var h = host.clientHeight - 4;
      while (s > 6 && (overWide(cl) || cl.scrollHeight > h)) {
        s -= 1; cl.style.fontSize = s + 'px';
      }
      if (s < minSize) minSize = s;
    });
    cells.forEach(function (cl) { cl.style.fontSize = minSize + 'px'; });

    // 🔴 所属の行だけを詰める。いちばん長い会社名に合わせて、全部を同じ大きさにそろえる
    var selOrg = sz('szOrg', .5), over = 1;
    g.querySelectorAll('.seat .ln.org').forEach(function (o) {
      var inner = o.parentNode.clientWidth;
      if (inner > 0 && o.scrollWidth > inner) {
        var ratio = o.scrollWidth / inner;
        if (ratio > over) over = ratio;
      }
    });
    state.orgFit = (over > 1) ? Math.max(.18, selOrg / over) : selOrg;
    sh.style.setProperty('--sOrg', state.orgFit);
    var printMM = printCellMM(cellWmm, mm, lineEm);
    sh.style.setProperty('--cellPrint', printMM + 'mm');
    // 🔴 人数で決め打ちせず、実際に小さくなったときだけ知らせる。
    //    同じ100人でも、用紙の向きと列の数で読めたり読めなかったりするため
    var pn = $('printNote');
    if (pn) {
      pn.innerHTML = (printMM < 3.5)
        ? '⚠ 紙にすると名前が <b>' + printMM + 'mm</b> になります。' +
          'フリガナや役職を「なし」にするか、用紙の向きを変えると大きくなります。'
        : '';
      pn.className = 'hint' + (printMM < 3.5 ? ' warn-note' : '');
    }
    // 右上の通し番号は、マスの中身とは別に大きさを決める
    var noR = sz('szNo', .52);
    sh.style.setProperty('--snoSize', Math.max(9, Math.round(minSize * noR)) + 'px');
    sh.style.setProperty('--snoPrint', (Math.round(printMM * noR * 10) / 10) + 'mm');
    var note = document.querySelector('.drag-note');
    if (note) {
      note.innerHTML = state.grp.on
        ? '席をドラッグすると、配置の移動ができます。<strong>グループ記号を押すと、席のグループと色を変更できます</strong>'
        : '席をドラッグすると、配置の移動ができます';
    }
    bindDrag();
    drawViolations();
    drawDeco();
    fitSheet();
    drawPreview();
    if (anchor && document.contains(anchor)) {
      var moved = anchor.getBoundingClientRect().top - keepTop;
      if (Math.abs(moved) > 1) window.scrollBy(0, moved);
    } else if (Math.abs(window.scrollY - keepY) > 1) {
      window.scrollTo(0, keepY);
    }
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
        note.textContent = '上の欄に名簿を貼り付けてください。サンプルは消えます。';
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
        b.textContent = glabel(no);
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

  // 所属ごとのときは人数を指定しない（所属の数でグループが決まる）
  function grpStyleChanged() {
    var w = $('grpSizeWrap'), v = $('grpStyle').value;
    // 項目で分けるときは人数を指定しない（項目の数でグループが決まる）
    if (w) w.hidden = (v === 'org' || v === 'title');
  }
  function grpChanged() {
    state.gfix = {};                // 分け方が変わったら、手で変えたぶんは捨てる
    grpStyleChanged();
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
      if (v.type === 'separate') return nameOf(v.pair[0]) + 'さんと' + nameOf(v.pair[1]) + 'さんが近くにいます';
      if (v.type === 'adjacent') return nameOf(v.pair[0]) + 'さんと' + nameOf(v.pair[1]) + 'さんが離れています';
      if (v.type === 'zone') return nameOf(v.name) + 'さんが指定した場所にいません';
      return nameOf(v.name) + 'さんが指定した席にいません';
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
  function setPaper() {
    var st = document.getElementById('pageRule');
    if (!st) { st = document.createElement('style'); st.id = 'pageRule'; document.head.appendChild(st); }
    st.textContent = '@page{size:A4 ' + $('paper').value + ';margin:12mm}';
    document.body.classList.toggle('landscape', $('paper').value === 'landscape');
  }

  // 席次表は1枚出して終わり。いま見えているものをそのまま刷る
  function doPrint() {
    setPaper();
    // 🔴 紙だけ登壇者の向きにする（画面は変えない）。2026-08-31 本人
    // ⚠ 紙が終わったら必ず戻す（afterprint）。戻さないと画面が回ったままになる
    var stage = $('printStage') && $('printStage').checked;
    if (stage && state.board !== 'bottom') {
      printKeepBoard = state.board;
      state.board = 'bottom';
      drawSheet();
    }
    window.print();
  }
  var printKeepBoard = null;
  window.addEventListener('afterprint', function () {
    if (printKeepBoard) { state.board = printKeepBoard; printKeepBoard = null; drawSheet(); }
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
    var cw = 200, ch = 120, pad = 40, head = 70, boardH = 40;
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
      x.fillStyle = '#5b5b5b';      // 会社で使う紙なので、緑ではなくグレー
      x.fillRect(pad, y, cols * cw, boardH - 12);
      x.fillStyle = '#fff'; x.font = '18px sans-serif'; x.textAlign = 'center';
      x.fillText(frontWord(), pad + cols * cw / 2, y + 3);
      x.textAlign = 'left';
    }
    var gy = top + (state.board === 'top' ? boardH : 0);
    if (frontWord()) { if (state.board === 'top') board(top); else board(top + rows * ch + 6); }

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
          x.fillText(glabel(gi), px + 14, py + 12);
        }
        // 右上の通し番号
        var pno = personOf(name);
        if (name && numPos() === 'corner' && pno && pno.no) {
          x.fillStyle = '#666666';
          x.font = Math.round(17 * (sz('szNo', .52) / .52)) + 'px sans-serif';
          x.textAlign = 'right';
          x.fillText(numText(pno.no), px + cw - 14, py + 12);
          x.textAlign = 'left';
        }
        if (!name) continue;
        var ls = cellLines(personOf(name));
        if (!ls.length) continue;
        var bold = $('bold').checked;
        var em = 0;
        ls.forEach(function (L) { em += L.m * 1.25; });
        var size = Math.min((ch - 20) / em, 44);
        while (size > 8) {
          var over = ls.some(function (L) {
            x.font = (L.b && bold ? 'bold ' : '') + Math.round(size * L.m) + 'px ' + fontStack();
            return x.measureText(L.t).width > cw - 20;
          });
          if (!over) break;
          size -= 1;
        }
        x.textAlign = 'center'; x.textBaseline = 'middle';
        var totH = 0;
        ls.forEach(function (L) { totH += size * L.m * 1.25; });
        var yy = py + ch / 2 - totH / 2;
        ls.forEach(function (L) {
          var fs = Math.round(size * L.m);
          x.font = (L.b && bold ? 'bold ' : '') + fs + 'px ' + fontStack();
          x.fillStyle = L.dim ? '#666666' : inkColor();
          x.fillText(L.t, px + cw / 2, yy + size * L.m * 1.25 / 2);
          yy += size * L.m * 1.25;
        });
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
    a.download = (sheetTitle().replace(/\s/g, '') || '席次表') + '.png';
    a.click();
  }

  // ---- 保存（使ってる機器の中だけ）----
  // ============================================================
  //  名簿の保存（座席表と共通の置き場）2026-08-31
  //  ⚠置き場はドメイン単位。/seat/ で保存した名簿をここからも読める。
  //    名簿は1つ。設定だけツールごとに分けて持つ
  //      { id, label, names, seat:{設定}, seki:{設定}, recs:[座席表の記録] }
  //  ⚠席次表は「1枚出して終わり」なので、決まった座席の記録はここには置かない
  // ============================================================
  var KEYC = 'sakura-teachers-rosters-v1';
  var KEYOLD = 'sakura-seat-classes-v1';
  var MAXC = 10;

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
              seat: c.d || null, seki: null, recs: c.recs || []
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
      $('msg').innerHTML = '<div class="notice warn">保存できませんでした。' +
        'ブラウザの空きが足りないようです。いらない名簿を消してから、もう一度お試しください。</div>';
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
  function setCls(id) {
    [$('clsSel'), $('clsSel2')].forEach(function (el) { if (el) el.value = id; });
  }
  function note(x) { $('msg').innerHTML = '<div class="notice">' + x + '</div>'; }

  function refreshClsUI() {
    var st = loadStore(), sel = $('clsSel');
    if (!sel) return;
    var keep = sel.value;
    [sel, $('clsSel2')].forEach(function (el) {
      if (!el) return;
      el.innerHTML = '<option value="">－</option>';
      st.classes.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id; o.textContent = c.label;
        el.appendChild(o);
      });
      el.value = keep;
      if (el.selectedIndex < 0) el.value = '';
    });
    if ($('quickLoad')) $('quickLoad').hidden = !st.classes.length;
    $('clsCount').textContent = st.classes.length
      ? st.classes.length + '／' + MAXC + '件'
      : '0／' + MAXC + '件・まだ保存していません';
  }

  // 呼び出したあと、画面を組み直す
  function afterRestore() {
    state.sample = false;
    state.seats = null;
    refreshNames();
    state.board = $('board').value;
    numStyleChanged();
    grpStyleChanged();
    orderChanged();
    drawPreview();
    $('result').hidden = true;
    state.plans = [];
    showSaving();
  }

  function doClsNew() {
    var st = loadStore();
    var name = prompt('名簿の名前を入れてください', className() || '名簿');
    if (name === null) return;
    name = (name || '').replace(/^[\s　]+|[\s　]+$/g, '');
    if (!name) return;
    for (var i = 0; i < st.classes.length; i++) {
      if (st.classes[i].label === name) {
        if (!confirm('「' + name + '」はすでにあります。上書きしますか。')) return;
        st.classes[i].names = $('names').value;
        st.classes[i].seki = snapshot();
        if (!saveStore(st)) return;
        refreshClsUI(); setCls(st.classes[i].id);
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
      seat: null, seki: snapshot(), recs: []
    });
    if (!saveStore(st)) return;
    refreshClsUI(); setCls(id);
    note('「' + name + '」として保存しました。');
  }
  function doClsSave() {
    var st = loadStore(), c = curClass(st);
    if (!c) { alert('上書きする名簿をえらんでください。はじめて残すときは「新しく保存」です。'); return; }
    c.names = $('names').value;
    c.seki = snapshot();
    if (!saveStore(st)) return;
    note('「' + c.label + '」を今の内容で上書きしました。');
  }
  function doClsLoad() {
    var c = curClass();
    if (!c) { alert('呼び出す名簿をえらんでください。'); return; }
    if (!confirm('「' + c.label + '」を入れます。' +
      'いま画面にある名簿と席次表は消えます。よろしいですか。')) return;
    // ⚠座席表だけで保存したものは seki が空。そのときも名簿だけは入れる
    var d = c.seki ? JSON.parse(JSON.stringify(c.seki)) : {};
    d.names = c.names || d.names || '';
    applySnap(d);
    afterRestore();
    note('「' + c.label + '」を入れました。<strong>「席次表を作る」を押してください。</strong>');
  }
  function doClsDel() {
    var st = loadStore(), c = curClass(st);
    if (!c) { alert('消す名簿をえらんでください。'); return; }
    if (!confirm('「' + c.label + '」を消します。' +
      '座席表で使っている記録も一緒に消えます。よろしいですか。')) return;
    st.classes = st.classes.filter(function (x) { return x.id !== c.id; });
    if (!saveStore(st)) return;
    setCls(''); refreshClsUI();
    note('「' + c.label + '」を消しました。');
  }
  function clearAllCls() {
    if (!confirm('保存した名簿を全部消します。もとには戻せません。よろしいですか。')) return;
    try { localStorage.removeItem(KEYC); } catch (e) { }
    setCls(''); refreshClsUI();
    note('保存した名簿を全部消しました。');
  }

  // 保存する一式。⑦（前回のつづき）と⑧（名前を付けて保存）で同じものを使う
  function snapshot() {
    return {
        names: $('names').value,
        clsFree: $('clsFree').value,
        colRoles: state.colRoles,
        cols: $('cols').value, rows: $('rows').value,
        board: $('board').value, frontWord: $('frontWord').value,
        paper: $('paper').value,
        frontFree: $('frontFree').value,
        mode: (document.querySelector('input[name=mode]:checked') || {}).value || 'cross',
        bold: $('bold').checked, showCredit: $('showCredit').checked,
        order: $('order').value, dir: $('dir').value,
        honor: $('honor').value, numPos: $('numPos').value,
        kanaStyle: $('kanaStyle').value,
        font: $('font').value, ink: $('ink').value, deco: $('deco').value,
        sizes: {
          no: $('szNo').value, org: $('szOrg').value,
          ttl: $('szTtl').value, kana: $('szKana').value
        },
        dt: $('dt').value, dtOff: $('dtOff').checked,
        grp: state.grp,
        // 🔴 席次表そのものも残す（2026-08-31 本人「⑦は画面の保存でいい」）。
        //   ⚠これが無いと、開くたびに作り直しになる＝ランダムだと並びが変わる
        //   ⚠サンプルは残さない。名簿を入れていない人の画面が次に居座る
        seats: (state.sample || !state.seats) ? null : state.seats.slice()
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); showSaving(); } catch (e) { }
  }
  function showSaving() {
    var n = state.names.length;
    $('savingLabel').textContent = $('save').checked && n && !state.sample
      ? '保存中：' + (className() || '名簿') + ' ' + n + '人' : '';
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return;
      applySnap(d);
      // 席次表は画面の組み立てが終わってから出す（init のいちばん最後）
      state.pendingSeats = (d.seats && d.seats.length) ? d.seats : null;
      $('save').checked = true;
    } catch (e) { }
  }
  // 保存した一式を画面に戻す（⑦・⑧で共通）
  function applySnap(d) {
    try {
      $('names').value = d.names || '';
      $('clsFree').value = d.clsFree || '';
      if (d.colRoles && d.colRoles.length) state.colRoles = d.colRoles;
      $('cols').value = d.cols || 6; $('rows').value = d.rows || 5;
      $('board').value = d.board || 'top';
      if (d.frontWord !== undefined) $('frontWord').value = d.frontWord;
      if (d.paper) $('paper').value = d.paper;
      if (d.frontFree) $('frontFree').value = d.frontFree;
      var mr = document.querySelector('input[name=mode][value="' + (d.mode || 'cross') + '"]');
      if (mr) mr.checked = true;
      $('bold').checked = !!d.bold;
      if (d.showCredit !== undefined) $('showCredit').checked = !!d.showCredit;
      if (d.order) $('order').value = d.order;
      if (d.dir) $('dir').value = d.dir;
      if (d.honor !== undefined) $('honor').value = d.honor;
      // ⚠ 前は「見せ方」に「なし」が入っていた。そのころ保存した人は、位置の「なし」に読みかえる
      if (d.numPos) $('numPos').value = d.numPos;
      else if (d.numStyle === 'none') $('numPos').value = 'none';
      numStyleChanged();
      if (d.kanaStyle) $('kanaStyle').value = d.kanaStyle;
      if (d.font) $('font').value = d.font;
      if (d.ink) $('ink').value = d.ink;
      if (d.deco !== undefined) $('deco').value = d.deco;
      if (d.sizes) {
        if (d.sizes.no) $('szNo').value = d.sizes.no;
        if (d.sizes.org) $('szOrg').value = d.sizes.org;
        if (d.sizes.ttl) $('szTtl').value = d.sizes.ttl;
        if (d.sizes.kana) $('szKana').value = d.sizes.kana;
      }
      if (d.dt) $('dt').value = d.dt;
      if (d.dtOff) {
        $('dtOff').checked = true;
        $('dt').disabled = true;
      }
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
        grpStyleChanged();
        $('grpLook').value = state.grp.look;
        $('grpNum').checked = state.grp.num;
      }
    } catch (e) { }
  }
  function clearSaved() {
    try { localStorage.removeItem(KEY); } catch (e) { }
    $('save').checked = false; showSaving();
    $('msg').innerHTML = '<div class="notice">この機器に保存していた名簿を消しました。</div>';
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
      ? '下の「詳しい条件」は不要です。'
      : 'ランダムに並べます。3つの案が出るので、見比べて選べます。';
    // 名簿順のときは条件が捨てられる（generate の手前で空にしている）。
    // 消さずに薄くする＝「あること」は見せて、触っても効かない誤解だけ防ぐ
    var cond = $('condBlock'); if (cond) cond.classList.toggle('off', byNumber);
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
    fillInkSelect($('ink'), '#222222');
    load();
    refreshNames();
    state.board = $('board').value;
    bindTips();
    orderChanged();
    numStyleChanged();
    grpStyleChanged();
    drawPreview();

    $('names').addEventListener('input', function () {
      // 自分の名簿を貼ったらサンプルではなくなる。列の割り当ても一度やり直す
      if (readRows().length) { state.sample = false; state.colRoles = []; state.colSig = ''; }
      showSample();
      refreshNames();
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
    // 1マスの中身（行の出し入れ・大きさ・敬称・番号の見せ方・書体・文字の色）
    ['szNo', 'szOrg', 'szTtl', 'szKana',
      'honor', 'numPos', 'kanaStyle', 'font', 'ink', 'frontWord'].forEach(function (id) {
        var e = $(id); if (!e) return;
        e.addEventListener('change', function () {
          numStyleChanged();
          drawPreview();
          if (state.seats) drawSheet();
          if ($('save').checked && !state.sample) save();
        });
      });
    // 班
    $('grpOn').addEventListener('change', function () {
      state.grp.on = this.checked;
      $('grpOpts').hidden = !this.checked;
      $('grpNumWrap').hidden = !this.checked;
      // ⚠ 分け方などを画面から読み直す。
      //   読まないと、はじめて入れたときだけ既定の分け方で出てしまう
      state.grp.style = $('grpStyle').value;
      state.grp.look = $('grpLook').value;
      state.grp.num = $('grpNum').checked;
      state.grp.size = Math.max(2, Math.min(8, +$('grpSize').value || 4));
      grpStyleChanged();
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    ['grpSize', 'grpStyle', 'grpLook', 'grpNum'].forEach(function (id) {
      $(id).addEventListener('input', grpChanged);
      $(id).addEventListener('change', grpChanged);
    });

    ['cols', 'rows'].forEach(function (id) { $(id).addEventListener('input', refreshSeatInfo); });
    $('frontFree').addEventListener('input', function () {
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
    $('clsFree').addEventListener('input', function () {
      showSaving();
      if (state.seats) drawSheet();
      if ($('save').checked && !state.sample) save();
    });
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
    // 🔴 用紙の向きで1マスの高さが変わる。描き直さないと、
    //    横で計算した高さのまま縦の紙に刷られて、半分ほどで終わってしまう（本人の指摘）
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
    if ($('clsSel')) {
      var syncCls = function (from, to) {
        return function () { if ($(to)) $(to).value = $(from).value; };
      };
      $('clsSel').addEventListener('change', syncCls('clsSel', 'clsSel2'));
      if ($('clsSel2')) $('clsSel2').addEventListener('change', syncCls('clsSel2', 'clsSel'));
      if ($('clsLoad2')) $('clsLoad2').onclick = doClsLoad;
      $('clsNew').onclick = doClsNew;
      $('clsSave').onclick = doClsSave;
      $('clsDel').onclick = doClsDel;
      $('clsClearAll').onclick = clearAllCls;
      refreshClsUI();
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
    window.addEventListener('resize', function () {
      if (document.body.classList.contains('screen') && state.seats) drawSheet();
      else fitSheet();
    });
    window.addEventListener('beforeprint', function () { fitSheet(); });
    // 画像や字体が出そろってから、もう一度あてはめ直す
    window.addEventListener('load', function () { fitSheet(); });
    $('deco').addEventListener('change', drawDeco);
    ['bold', 'showCredit'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        drawPreview();
        if (state.seats) drawSheet();
        if ($('save').checked && !state.sample) save();
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
    // 🔴 保存してあった席次表があれば、作り直さずにそのまま出す（2026-08-31）。
    //   ⚠作り直すと、ランダムのときに前と違う並びになる
    if (state.pendingSeats) {
      var ps = state.pendingSeats; state.pendingSeats = null;
      try {
        state.sample = false;
        var opt = collect();
        if (ps.length === opt.cols * opt.rows) {
          state.opt = opt; state.plans = [ps.slice()]; state.cur = 0; state.seats = ps.slice();
          $('result').hidden = false;
          drawTabs(); drawSheet(); showSample();
          // 🔴 組み立ての途中で「席がない状態」がいったん保存されてしまう。
          //   ⚠書き戻さないと、2回目に開いたときに作り直しになる（2026-08-31 検証で見つけた）
          if ($('save').checked) { try { save(); } catch (e3) { } }
        } else run(true);
      } catch (e) { try { run(true); } catch (e2) { } }
    } else {
      try { run(true); } catch (e) { }
    }

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
        if (off) off.addEventListener('click', function () { location.href = '../#seki'; });
        // ②映す画面を開かない端末（タブレットなど）むけに、戻り道を出しておく
        var back = document.createElement('p');
        back.className = 'back-top noprint';
        back.innerHTML = '<a href="../#seki">← トップにもどる</a>';
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
  // ⑦ 設定のとなりに出す見本。大中小を押すと、その場で見た目が変わる
  var PREV = {
    id: '__prev', no: '12', name: '山田 太郎',
    kana: 'ヤマダ タロウ', org: '株式会社さくら商事', title: '部長'
  };
  function drawPreview() {
    var seat = $('prevSeat'), sh = $('prevSheet');
    if (!seat || !sh) return;
    sh.style.setProperty('--sNo', sz('szNo', .52));
    sh.style.setProperty('--sOrg', orgSize());
    sh.style.setProperty('--sTtl', sz('szTtl', .5));
    sh.style.setProperty('--sKana', sz('szKana', .44));
    sh.style.setProperty('--ink', inkColor());
    sh.style.setProperty('--snoSize', Math.round(26 * sz('szNo', .52)) + 'px');
    sh.classList.remove('f-mincho', 'f-gothic', 'f-maru');
    sh.classList.add('f-' + ($('font') ? $('font').value : 'gothic'));
    sh.classList.toggle('bold', $('bold') ? $('bold').checked : true);
    seat.innerHTML = '';
    var sn = buildNo(PREV);
    if (sn) seat.appendChild(sn);
    var cell = buildCellP(PREV);
    cell.style.fontSize = '26px';
    seat.appendChild(cell);
  }

  function drawDeco() {
    $('decoLeft').textContent = $('deco').value || '';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
