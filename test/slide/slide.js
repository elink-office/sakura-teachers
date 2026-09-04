/* 簡単スライド（/slide/）
   文字を大きくモニターに出す。2つの出し方＝「文字を出す」「発表者を出す」。
   🔴 名簿はサーバーに送らない。localStorage だけ。
   🔴 映す画面には広告を置かない（slide.css の注記も参照）。 */
(function(){
  "use strict";

  var KEY  = 'sakura-slide-v1';                 // このページの保存
  var KEYC = 'sakura-teachers-rosters-v1';     // 🔴 座席表・班分けと共通の名簿置き場

  var rows = [];        // {name,title,group,off}
  var groupOrder = [], groupOff = {};
  var origRows = [], origGroups = [];
  var slides = [], pos = 0;

  /* 「文字を出す」で並べる1枚ぶん。
     {type:'text', text:'…'}                     文字だけ
     {type:'pic',  url:'blob:…', name:'', text:''} 写真（＋重ねる文字）
     🔴 写真は保存しない（本人「保存なしでいい」2026-09-05）。
        ブラウザのメモリに置くだけなので、ページを閉じると消える。 */
  var sheets = [];

  var SAMPLE_TEXT =
    "今日のめあて/分数のたし算ができる\n" +
    "教科書 42ページ\n" +
    "となりの人と 話し合ってみよう\n" +
    "のこり 5分";

  var SAMPLE_LIST =
    "名前\t作品名\t班\n" +
    "さくら\tわたしの家族\t1班\n" +
    "たろう\tわたしの家族\t1班\n" +
    "はなこ\t海の生きものを/しらべて分かったこと\t2班\n" +
    "けんた\t海の生きものを/しらべて分かったこと\t2班\n" +
    "みく\t海の生きものを/しらべて分かったこと\t2班\n" +
    "そうた\tぼくの町のじまん\t3班\n" +
    "あおい\tぼくの町のじまん\t3班\n" +
    "ゆい\t大切な友だち\t4班\n" +
    "りく\t大切な友だち\t4班";

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s).replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }
  function kind(){
    var el = document.querySelector('input[name=kind]:checked');
    return el ? el.value : 'text';
  }

  /* ================= 共通の名簿（座席表・班分けと同じ置き場） ================= */
  function loadRosters(){
    try{
      var d = JSON.parse(localStorage.getItem(KEYC) || 'null');
      if (d && d.classes && d.classes.length) return d.classes;
    }catch(e){}
    return [];
  }
  /* 🔴 班分けページの保存から班を組み立てる。
     seats＝台の順に並んだ名前／sizes＝各台（班）の人数。切り分ければ班になる。
     ⚠座席表側の班は「座席の並びから計算」なので直接は取れない。使うのは group の保存。 */
  function groupsFromClass(c){
    var g = c && c.group;
    if (!g || !g.seats || !g.sizes) return null;
    var out = {}, k = 0;
    for (var i=0;i<g.sizes.length;i++){
      var n = g.sizes[i]|0;
      for (var j=0;j<n;j++){
        var nm = g.seats[k++];
        if (nm) out[nm] = (i+1) + '班';
      }
    }
    return out;
  }
  function fillClassSelect(){
    var cls = loadRosters();
    if (!cls.length){ $('clsBox').hidden = true; return; }
    var sel = $('clsSel');
    sel.innerHTML = '';
    cls.forEach(function(c,i){
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = (c.label || ('クラス'+(i+1))) + ((c.group && c.group.seats) ? '（班あり）' : '');
      sel.appendChild(o);
    });
    $('clsBox').hidden = false;
  }
  function loadFromClass(){
    var c = loadRosters()[parseInt($('clsSel').value,10)];
    if (!c) return;
    var names = String(c.names || '').split('\n')
      .map(function(s){ return s.trim(); })
      .filter(function(s){ return s !== ''; });
    if (!names.length){
      $('warn').textContent = 'このクラスに名前が入っていませんでした。';
      $('warn').hidden = false; return;
    }
    $('warn').hidden = true;
    var gmap = groupsFromClass(c) || {};
    var keep = {};                       // すでに入れた作品名は引き継ぐ
    rows.forEach(function(r){ if (r.title) keep[r.name] = r.title; });
    setRows(names.map(function(n){
      return { name:n, title:keep[n] || '', group:gmap[n] || '', off:false };
    }));
    $('paste').value = rows.map(function(r){
      return [r.name, r.title, r.group].join('\t').replace(/\t+$/,'');
    }).join('\n');
    drawList();
  }

  /* ================= 貼り付けを読む ================= */
  var HEAD = {
    name : ['名前','氏名','なまえ','名','児童名','生徒名','発表者','子どもの名前'],
    title: ['作品名','タイトル','題名','作文','題','作品','テーマ','題目','発表題'],
    group: ['班','グループ','チーム','はん','班名','グループ名','班番号']
  };
  function which(cell){
    var c = String(cell||'').trim();
    for (var k in HEAD){ for (var i=0;i<HEAD[k].length;i++){ if (c===HEAD[k][i]) return k; } }
    return null;
  }
  function looksLikeHeader(cells){
    for (var i=0;i<cells.length;i++){ if (which(cells[i])) return true; }
    return false;
  }
  function parse(text){
    var lines = String(text).replace(/\r/g,'').split('\n'), table = [];
    for (var i=0;i<lines.length;i++){
      if (lines[i].trim()==='') continue;
      var cells = lines[i].indexOf('\t')>=0 ? lines[i].split('\t') : lines[i].split(',');
      for (var j=0;j<cells.length;j++) cells[j] = cells[j].trim();
      table.push(cells);
    }
    if (!table.length) return [];
    var map = {name:0,title:1,group:-1}, start = 0;
    if (looksLikeHeader(table[0])){
      map = {name:-1,title:-1,group:-1};
      for (var c=0;c<table[0].length;c++){
        var k = which(table[0][c]);
        if (k && map[k]===-1) map[k] = c;
      }
      if (map.name===-1) map.name = 0;
      start = 1;
    }
    var out = [];
    for (var r=start;r<table.length;r++){
      var row = table[r];
      var nm = (map.name>=0?row[map.name]:'')||'';
      if (nm==='') continue;
      out.push({
        name : nm,
        title: (map.title>=0?row[map.title]:'')||'',
        group: (map.group>=0?row[map.group]:'')||'',
        off  : false
      });
    }
    return out;
  }
  function setRows(list){
    rows = list;
    groupOff = {}; groupOrder = [];
    rows.forEach(function(r){
      if (r.group && groupOrder.indexOf(r.group)<0) groupOrder.push(r.group);
    });
    origRows = rows.map(function(r){ return {name:r.name,title:r.title,group:r.group,off:false}; });
    origGroups = groupOrder.slice();
  }
  function hasGroup(){ return rows.some(function(r){ return r.group !== ''; }); }
  function mode(){
    var el = document.querySelector('input[name=mode]:checked');
    return (el && hasGroup()) ? el.value : 'one';
  }

  /* ================= 映す単位を組む ================= */
  function build(){
    slides = [];
    if (kind()==='text'){
      sheets.forEach(function(sh){
        slides.push({
          group:'', title:(sh.text||'').trim(), names:[],
          pic:(sh.type==='pic' ? sh.url : '')
        });
      });
      return;
    }
    if (mode()==='one'){
      rows.forEach(function(r){
        if (r.off) return;
        slides.push({ group:'', title:r.title, names:[r.name] });
      });
      return;
    }
    groupOrder.forEach(function(g){
      if (groupOff[g]) return;
      var mem = rows.filter(function(r){ return r.group===g && !r.off; });
      if (!mem.length) return;
      var t = '';
      for (var i=0;i<mem.length;i++){ if (mem[i].title){ t = mem[i].title; break; } }
      slides.push({ group:g, title:t, names:mem.map(function(m){ return m.name; }) });
    });
  }

  /* ================= 「文字を出す」の一覧 ================= */
  function drawSheets(){
    var box = $('sheets');
    if (!sheets.length){
      box.innerHTML = '<p class="empty">まだ何も入れていません。</p>';
      updateCount(); save(); return;
    }
    var h = '<table><tr><th class="idx">#</th><th class="pic">写真</th>'
          + '<th>出す文字（/ で改行）</th><th class="mv">順番</th><th class="del">消す</th></tr>';
    sheets.forEach(function(sh,i){
      h += '<tr><td class="idx">'+(i+1)+'</td>'
        +  '<td class="pic">'
        +    (sh.type==='pic'
              ? '<img class="thumb" src="'+esc(sh.url)+'" alt="">'
              : '<span class="members">—</span>')
        +  '</td>'
        +  '<td><input class="ttl" type="text" data-s="'+i+'" value="'+esc(sh.text||'')+'" placeholder="'
        +    (sh.type==='pic' ? '写真に重ねる文字（なくてもよい）' : '出す文字')+'"></td>'
        +  '<td class="mv">'
        +    '<button class="mvbtn" data-smv="'+i+'" data-d="-1"'+(i===0?' disabled':'')+'>▲</button> '
        +    '<button class="mvbtn" data-smv="'+i+'" data-d="1"'+(i===sheets.length-1?' disabled':'')+'>▼</button>'
        +  '</td>'
        +  '<td class="del"><button class="mvbtn" data-sdel="'+i+'">×</button></td></tr>';
    });
    h += '</table>';
    box.innerHTML = h;
    updateCount(); save();
  }

  function addLines(text){
    String(text).replace(/\r/g,'').split('\n').forEach(function(line){
      if (line.trim()==='') return;
      sheets.push({ type:'text', text:line.trim() });
    });
    $('lines').value = '';
    drawSheets();
  }

  /* ================= 名簿の一覧 ================= */
  function drawList(){
    var box = $('list');
    if (!rows.length){
      box.innerHTML = '<p class="empty">まだ名簿を読み込んでいません。</p>';
      $('modes').hidden = true; $('tools').hidden = true;
      updateCount(); save(); return;
    }
    $('modes').hidden = !hasGroup();
    $('tools').hidden = false;

    var h;
    if (mode()==='group'){
      h = '<table><tr><th class="chk">映す</th><th class="idx">#</th><th>班</th>'
        + '<th>作品名（/ で改行）</th><th>メンバー</th><th class="mv">順番</th></tr>';
      groupOrder.forEach(function(g,i){
        var mem = rows.filter(function(r){ return r.group===g; });
        var t = '';
        for (var k=0;k<mem.length;k++){ if (mem[k].title){ t = mem[k].title; break; } }
        var off = !!groupOff[g];
        h += '<tr class="'+(off?'off':'')+'">'
          + '<td class="chk"><input type="checkbox" data-g="'+esc(g)+'"'+(off?'':' checked')+'></td>'
          + '<td class="idx">'+(i+1)+'</td>'
          + '<td><b>'+esc(g)+'</b></td>'
          + '<td><input class="ttl" type="text" data-gt="'+esc(g)+'" value="'+esc(t)+'" placeholder="作品名"></td>'
          + '<td class="members">'+mem.map(function(m){ return esc(m.name); }).join('・')+'</td>'
          + '<td class="mv">'
          +   '<button class="mvbtn" data-gmv="'+i+'" data-d="-1"'+(i===0?' disabled':'')+'>▲</button> '
          +   '<button class="mvbtn" data-gmv="'+i+'" data-d="1"'+(i===groupOrder.length-1?' disabled':'')+'>▼</button>'
          + '</td></tr>';
      });
      h += '</table>';
    } else {
      var hasG = hasGroup();
      h = '<table><tr><th class="chk">映す</th><th class="idx">#</th><th>名前</th><th>作品名（/ で改行）</th>';
      if (hasG) h += '<th>班</th>';
      h += '<th class="mv">順番</th></tr>';
      rows.forEach(function(r,i){
        h += '<tr class="'+(r.off?'off':'')+'">'
          + '<td class="chk"><input type="checkbox" data-i="'+i+'"'+(r.off?'':' checked')+'></td>'
          + '<td class="idx">'+(i+1)+'</td>'
          + '<td><b>'+esc(r.name)+'</b></td>'
          + '<td><input class="ttl" type="text" data-t="'+i+'" value="'+esc(r.title)+'" placeholder="作品名"></td>';
        if (hasG) h += '<td>'+esc(r.group)+'</td>';
        h += '<td class="mv">'
          +   '<button class="mvbtn" data-mv="'+i+'" data-d="-1"'+(i===0?' disabled':'')+'>▲</button> '
          +   '<button class="mvbtn" data-mv="'+i+'" data-d="1"'+(i===rows.length-1?' disabled':'')+'>▼</button>'
          + '</td></tr>';
      });
      h += '</table>';
    }
    box.innerHTML = h;
    updateCount();
    save();
  }

  function updateCount(){
    build();
    var msg;
    if (kind()==='text'){
      if (!slides.length){
        msg = 'まだ何もありません。上の枠に文字を打って「入れる」を押すか、写真をえらんでください。';
      } else {
        var np = sheets.filter(function(s){ return s.type==='pic'; }).length;
        msg = slides.length + '枚 出します' + (np ? '（うち写真 '+np+'枚）' : '');
      }
    } else if (!rows.length){
      msg = '';
    } else if (mode()==='group'){
      msg = rows.length+'人／'+groupOrder.length+'班　→ 班ごとに '+slides.length+'回 映します';
      var offG = groupOrder.filter(function(g){ return groupOff[g]; }).length;
      if (offG) msg += '（'+offG+'班は映しません）';
    } else {
      msg = rows.length+'人　→ 1人ずつ '+slides.length+'回 映します';
      var offN = rows.filter(function(r){ return r.off; }).length;
      if (offN) msg += '（'+offN+'人は映しません）';
    }
    $('count').textContent = msg;
    $('start').disabled = (slides.length===0);
  }

  /* ================= 並べ替え ================= */
  function shuffleArr(a){
    for (var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1)), t = a[i]; a[i]=a[j]; a[j]=t;
    }
    return a;
  }
  function doShuffle(){ if (mode()==='group') shuffleArr(groupOrder); else shuffleArr(rows); drawList(); }
  function doReset(){
    rows = origRows.map(function(r){ return {name:r.name,title:r.title,group:r.group,off:false}; });
    groupOrder = origGroups.slice(); groupOff = {}; drawList();
  }
  function allOn(){ rows.forEach(function(r){ r.off=false; }); groupOff = {}; drawList(); }

  /* ================= 映す ================= */
  /* 🔴 写真があるときは、文字を「写真の中」に収める。
     ⚠写真は切らずに全部見せる（contain）ので、画面と写真の形が違うと上下または左右に余白ができる。
       文字の位置を画面基準にすると、下にしたとき写真の外へはみ出して見た目が崩れる。 */
  function fitBox(){
    var pic = $('pic'), stage = $('stage'), box = $('box');
    if (pic.hidden || !pic.naturalWidth || !pic.naturalHeight){ box.style.padding = ''; return; }
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var r  = Math.min(sw / pic.naturalWidth, sh / pic.naturalHeight);
    var padX = (sw - pic.naturalWidth  * r) / 2;
    var padY = (sh - pic.naturalHeight * r) / 2;
    box.style.padding = (padY + sh * 0.04) + 'px ' + (padX + sw * 0.04) + 'px';
  }

  function applyLook(){
    var f = $('font').value;
    var show = $('show');
    show.classList.remove('f-gothic','f-mincho','f-maru');
    show.classList.add('f-' + f);
    $('stage').setAttribute('data-pos', $('vpos').value);
  }

  function render(){
    var s = slides[pos];
    if (!s) return;

    // 写真（あれば）
    var pic = $('pic');
    if (s.pic){
      pic.hidden = false; $('stage').classList.add('hasPic');
      if (pic.getAttribute('src') !== s.pic) pic.src = s.pic;
      if (pic.complete) fitBox(); else pic.onload = fitBox;
    } else {
      pic.removeAttribute('src'); pic.hidden = true;
      $('stage').classList.remove('hasPic');
      $('box').style.padding = '';
    }

    $('group').textContent = s.group || '';

    var t = s.title || '';
    var box = $('title');
    box.innerHTML = '';
    // 🔴 "/" のところで改行する（先生が切る場所を自分で決められる・2026-09-05 本人）
    var parts = t.split('/'), longest = 0;
    parts.forEach(function(p,i){
      if (i>0) box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode(p.trim()));
      longest = Math.max(longest, p.trim().length);
    });
    // 文字の大きさは「いちばん長い行」で決める（改行しても小さくなりすぎない）
    box.setAttribute('data-len', longest<=8?'s':longest<=14?'m':longest<=24?'l':'xl');
    $('stage').classList.toggle('noTitle', t==='');

    var nb = $('name');
    nb.innerHTML = '';
    nb.setAttribute('data-n', s.names.length>=6 ? 'many' : String(s.names.length));
    s.names.forEach(function(n){
      var el = document.createElement('span'); el.textContent = n; nb.appendChild(el);
    });

    $('pos').textContent = (pos+1)+' / '+slides.length;
    $('prev').disabled = (pos===0);
    $('next').disabled = (pos===slides.length-1);
  }
  function openShow(){
    build();
    if (!slides.length) return;
    pos = 0;
    // 🔴 映す前に準備をたたむ。終わって戻ったとき、子どもに設定が見えないように（2026-09-05 本人）
    $('d1').open = false;
    applyLook();
    $('show').classList.add('on');
    render();
    if (document.documentElement.requestFullscreen){
      document.documentElement.requestFullscreen().catch(function(){});
    }
  }
  function closeShow(){
    $('show').classList.remove('on');
    document.body.classList.remove('hidebar');
    if (document.fullscreenElement && document.exitFullscreen){
      document.exitFullscreen().catch(function(){});
    }
  }
  function move(d){
    var n = pos+d; if (n<0 || n>=slides.length) return;
    pos = n; render();
  }

  /* ================= 保存（この端末のブラウザだけ） ================= */
  function save(){
    try{
      localStorage.setItem(KEY, JSON.stringify({
        kind: kind(), text: $('paste').value,
        // ⚠写真は保存しない（本人「保存なしでいい」）。文字の枚だけ残す
        sheets: sheets.filter(function(s){ return s.type==='text'; })
                      .map(function(s){ return {type:'text', text:s.text}; }),
        font: $('font').value, vpos: $('vpos').value,
        rows: rows, groupOrder: groupOrder, groupOff: groupOff,
        origRows: origRows, origGroups: origGroups,
        mode: (document.querySelector('input[name=mode]:checked')||{}).value || 'one'
      }));
    }catch(e){}
  }
  function load(){
    try{
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return;
      if (d.text)  $('paste').value = d.text;
      if (Array.isArray(d.sheets)) sheets = d.sheets;
      if (d.font) $('font').value = d.font;
      if (d.vpos) $('vpos').value = d.vpos;
      if (Array.isArray(d.rows) && d.rows.length){
        rows = d.rows;
        groupOrder = d.groupOrder || []; groupOff = d.groupOff || {};
        origRows = d.origRows || rows.slice(); origGroups = d.origGroups || groupOrder.slice();
        var m = document.querySelector('input[name=mode][value="'+(d.mode||'one')+'"]');
        if (m) m.checked = true;
      }
      var k = document.querySelector('input[name=kind][value="'+(d.kind||'text')+'"]');
      if (k) k.checked = true;
      switchKind();
      if (sheets.length || (Array.isArray(d.rows) && d.rows.length)) $('d1').open = false;
    }catch(e){}
  }

  /* ================= 出し方の切り替え ================= */
  function switchKind(){
    var t = (kind()==='text');
    $('paneText').hidden = !t;
    $('paneList').hidden = t;
    if (t) drawSheets(); else drawList();
  }

  /* ================= つなぐ ================= */
  Array.prototype.forEach.call(document.querySelectorAll('input[name=kind]'), function(el){
    el.addEventListener('change', function(){ switchKind(); save(); });
  });

  $('addText').addEventListener('click', function(){ addLines($('lines').value); });
  // Ctrl+Enter でも入れられる
  $('lines').addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); addLines($('lines').value); }
  });
  $('sampleText').addEventListener('click', function(){ addLines(SAMPLE_TEXT); });
  $('clearText').addEventListener('click', function(){
    // 写真のぶんはメモリを返してから消す
    sheets.forEach(function(s){ if (s.type==='pic' && s.url) URL.revokeObjectURL(s.url); });
    sheets = []; $('lines').value = ''; drawSheets();
  });

  // 写真を入れる。⚠どこにも送らない・保存もしない（メモリの中だけ）
  $('pics').addEventListener('change', function(e){
    var files = e.target.files;
    if (!files || !files.length) return;
    for (var i=0;i<files.length;i++){
      var f = files[i];
      if (f.type.indexOf('image/') !== 0) continue;
      sheets.push({ type:'pic', url:URL.createObjectURL(f), name:f.name, text:'' });
    }
    e.target.value = '';   // 同じ写真をもう一度選べるように
    drawSheets();
  });

  $('sheets').addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('.mvbtn') : null;
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-smv')){
      var i = parseInt(b.getAttribute('data-smv'),10);
      var j = i + parseInt(b.getAttribute('data-d'),10);
      if (j<0 || j>=sheets.length) return;
      var t = sheets[i]; sheets[i]=sheets[j]; sheets[j]=t;
    } else if (b.hasAttribute('data-sdel')){
      var k = parseInt(b.getAttribute('data-sdel'),10);
      if (sheets[k] && sheets[k].type==='pic' && sheets[k].url) URL.revokeObjectURL(sheets[k].url);
      sheets.splice(k,1);
    }
    drawSheets();
  });
  // ⚠文字の入力では描き直さない（描き直すとカーソルが飛ぶ）
  $('sheets').addEventListener('input', function(e){
    var el = e.target;
    if (!el.classList || !el.classList.contains('ttl')) return;
    if (!el.hasAttribute('data-s')) return;
    sheets[parseInt(el.getAttribute('data-s'),10)].text = el.value;
    updateCount(); save();
  });

  $('font').addEventListener('change', save);
  $('vpos').addEventListener('change', save);

  $('read').addEventListener('click', function(){
    var got = parse($('paste').value);
    if (!got.length){
      $('warn').textContent = '名前が読み取れませんでした。Excelの名前の列をコピーして貼り付けてください。';
      $('warn').hidden = false; return;
    }
    $('warn').hidden = true;
    setRows(got); drawList();
  });
  $('sample').addEventListener('click', function(){
    $('paste').value = SAMPLE_LIST; $('warn').hidden = true;
    setRows(parse(SAMPLE_LIST)); drawList();
  });
  $('clear').addEventListener('click', function(){
    $('paste').value = ''; rows = []; groupOrder = []; groupOff = {};
    origRows = []; origGroups = [];
    $('warn').hidden = true; drawList();
  });
  $('clsLoad').addEventListener('click', loadFromClass);

  $('shuffle').addEventListener('click', doShuffle);
  $('reset').addEventListener('click', doReset);
  $('allon').addEventListener('click', allOn);

  $('list').addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('.mvbtn') : null;
    if (!b || b.disabled) return;
    var d = parseInt(b.getAttribute('data-d'),10);
    if (b.hasAttribute('data-mv')){
      var i = parseInt(b.getAttribute('data-mv'),10), j = i+d;
      if (j<0 || j>=rows.length) return;
      var t = rows[i]; rows[i]=rows[j]; rows[j]=t;
    } else if (b.hasAttribute('data-gmv')){
      var gi = parseInt(b.getAttribute('data-gmv'),10), gj = gi+d;
      if (gj<0 || gj>=groupOrder.length) return;
      var g = groupOrder[gi]; groupOrder[gi]=groupOrder[gj]; groupOrder[gj]=g;
    }
    drawList();
  });
  $('list').addEventListener('change', function(e){
    var el = e.target;
    if (el.type !== 'checkbox') return;
    if (el.hasAttribute('data-i')) rows[parseInt(el.getAttribute('data-i'),10)].off = !el.checked;
    else if (el.hasAttribute('data-g')) groupOff[el.getAttribute('data-g')] = !el.checked;
    drawList();
  });
  // ⚠作品名の入力では描き直さない（描き直すとカーソルが飛ぶ）
  $('list').addEventListener('input', function(e){
    var el = e.target;
    if (!el.classList || !el.classList.contains('ttl')) return;
    if (el.hasAttribute('data-t')){
      rows[parseInt(el.getAttribute('data-t'),10)].title = el.value;
    } else if (el.hasAttribute('data-gt')){
      var g = el.getAttribute('data-gt');
      rows.forEach(function(r){ if (r.group===g) r.title = el.value; });
    }
    updateCount(); save();
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name=mode]'), function(el){
    el.addEventListener('change', drawList);
  });

  $('start').addEventListener('click', openShow);
  $('next').addEventListener('click', function(){ move(1); });
  $('prev').addEventListener('click', function(){ move(-1); });
  $('close').addEventListener('click', closeShow);

  document.addEventListener('keydown', function(e){
    if (!$('show').classList.contains('on')) return;
    if (e.key==='ArrowRight' || e.key===' ' || e.key==='Enter'){ e.preventDefault(); move(1); }
    else if (e.key==='ArrowLeft'){ e.preventDefault(); move(-1); }
    else if (e.key==='Escape'){ closeShow(); }
  });

  // 画面の向きや大きさが変わったら、写真の位置を測り直す
  window.addEventListener('resize', function(){
    if ($('show').classList.contains('on')) fitBox();
  });

  var hideTimer = null;
  document.addEventListener('mousemove', function(){
    if (!$('show').classList.contains('on')) return;
    document.body.classList.remove('hidebar');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){ document.body.classList.add('hidebar'); }, 2500);
  });

  fillClassSelect();
  load();
  switchKind();
})();
