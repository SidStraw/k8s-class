// 介面：任務面板、編輯器、終端機、叢集視覺化。遊戲邏輯都在 sim.js／shell.js／levels.js。
(function () {
  'use strict';
  const G = window.K8sGame;
  const S = G.sim;
  const $ = (s) => document.querySelector(s);
  const STORE = 'k8s-helm-training-v1';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  function md(src) {
    const lines = String(src).split('\n');
    let h = '';
    let para = [];
    const flush = () => {
      if (para.length) h += para.join('<br>');
      para = [];
    };
    for (let i = 0; i < lines.length; ) {
      if (lines[i].startsWith('```')) {
        flush();
        const buf = [];
        for (i++; i < lines.length && !lines[i].startsWith('```'); i++) buf.push(lines[i]);
        i++;
        h += '<pre class="code">' + esc(buf.join('\n')) + '</pre>';
      } else if (lines[i].startsWith('|')) {
        flush();
        const rows = [];
        for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        h += '<table class="t"><thead><tr>' + rows[0].map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.slice(1).map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
      } else para.push(inline(lines[i++]));
    }
    flush();
    return h;
  }

  const state = { idx: 0, level: null, w: null, file: null, hist: [], hpos: 0, shown: {}, miss: 0, learnOpen: true, save: { done: {}, real: {}, last: null, tour: 0 } };
  try {
    Object.assign(state.save, JSON.parse(localStorage.getItem(STORE) || '{}'));
  } catch (e) {
    /* 沒有儲存空間也能玩，只是不記進度 */
  }
  const persist = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state.save));
    } catch (e) {
      /* 同上 */
    }
  };
  const isDone = (lv) => !!state.save.done[lv.id];
  const playable = G.levels.filter((l) => l.type !== 'final');

  // ---------- 關卡載入 ----------
  function load(idx) {
    state.idx = Math.max(0, Math.min(G.levels.length - 1, idx));
    const lv = (state.level = G.levels[state.idx]);
    state.save.last = lv.id;
    persist();
    state.shown = {};
    state.miss = 0;
    state.learnOpen = true;
    state.file = null;
    const staged = lv.type === 'quiz' || lv.type === 'final';
    $('#ide').hidden = staged;
    $('#viz').hidden = staged;
    $('#stage').hidden = !staged;
    $('#main').classList.toggle('wide', staged);
    $('#btn-reset').hidden = staged;
    if (staged) {
      state.w = null;
      state.answers = {};
      state.tried = {};
      if (lv.type === 'quiz') renderQuiz();
      else renderFinal();
    } else {
      state.w = G.startLevel(lv);
      $('#term-out').textContent = '';
      print('# ' + lv.id + ' ' + lv.title + '。這是模擬環境，放心亂試；弄壞了按右上角「重設本關」。', 'opts');
      const first = Object.keys(state.w.files).find((f) => /\.ya?ml$/.test(f) && !/base\//.test(f));
      renderFiles();
      openFile(null);
      if (first && lv.id !== '1-1') openFile(first, true);
      $('#cmd').focus();
      if (state.save.tour < 2) showTour(2);
    }
    renderAll();
    $('#mission').scrollTop = 0;
    $('#stage').scrollTop = 0;
  }
  function renderAll() {
    renderTop();
    renderMission();
    if (state.w) {
      renderViz();
      renderFiles();
    }
  }
  function renderTop() {
    const w = state.w;
    const ctx = $('#ctx');
    ctx.hidden = !w;
    if (w) {
      ctx.textContent = 'context：' + w.ctx;
      ctx.classList.toggle('gke', w.ctx !== 'orbstack');
      $('#prompt').textContent = '(' + w.ctx + ') shop $';
    }
    $('#progress').textContent = '進度 ' + playable.filter(isDone).length + '／' + playable.length;
  }

  // ---------- 任務面板 ----------
  function solutionHtml(step, i) {
    return step.sol
      .map((s, j) => {
        if (typeof s === 'object') return '<button type="button" class="sol-cmd file" data-sol="' + i + ':' + j + '">' + (s.write ? '把 ' + esc(s.write) + ' 改成完成版（點我套用）' : '在 ' + esc(s.edit) + ' 把「' + esc(s.find) + '」改成「' + esc(s.to) + '」（點我套用）') + '</button>';
        const cmd = typeof s === 'function' ? s(state.w) : s;
        return '<button type="button" class="sol-cmd" data-cmd="' + esc(cmd) + '">' + esc(cmd) + '</button>';
      })
      .join('');
  }
  const HINT_TERM = '這一步在**下方的終端機**完成：把步驟裡灰底的指令打進去，按 Enter。也可以直接**點灰底的指令**，它會自動填進終端機。指令裡的 `<名稱>` 要換成實際的名稱（點右邊面板的 Pod 可以貼上）。';
  const HINT_EDIT = '這一步要改檔案：在中間上方的檔案清單點檔名，直接在右邊修改（會自動儲存，右上角會顯示 YAML 格式對不對）。改完再到終端機執行 `kubectl apply`。真的卡住就按「看解答」，可以一鍵套用。';
  function stepWhere(st) {
    if (st.where) return st.where;
    const edits = st.sol.some((x) => typeof x === 'object');
    const cmds = st.sol.some((x) => typeof x !== 'object');
    return edits && cmds ? '編輯器＋終端機' : edits ? '編輯器' : '終端機';
  }
  function renderMission() {
    const lv = state.level;
    const ch = G.chapters[lv.ch];
    let h = '<div class="eyebrow">第 ' + ch.id + ' 章　' + esc(ch.title) + '　·　' + esc(ch.env) + '</div><h1>' + esc(lv.id === 'final' ? lv.title : lv.id + '　' + lv.title) + '</h1>';
    const next = '<button type="button" class="next" data-next="1">' + (state.idx + 1 < G.levels.length ? '下一關 →' : '回到關卡地圖') + '</button>';
    if (lv.type === 'quiz') {
      const n = lv.questions.filter((q, i) => state.answers[i] === q.answer).length;
      h += '<p class="muted">' + (lv.progressive ? '右邊一次出現一張卡片：先讀觀念，再回答下面的小問題，答對才會出現下一張。' : '右邊每一題選一個答案，答對會出現解說。') + '答錯可以重選，不會扣分。</p>';
      h += '<ol class="steps">';
      lv.questions.forEach((q, i) => {
        const cls = state.answers[i] === q.answer ? 'done' : i === n ? 'cur' : 'todo';
        h += '<li class="' + cls + '">' + esc(q.topic || '第 ' + (i + 1) + ' 題') + '</li>';
      });
      h += '</ol>';
      if (n === lv.questions.length) h += '<div class="done-box"><h3>完成</h3>' + md(lv.outro || '') + '</div>' + next;
    } else if (lv.type === 'final') {
      h += '<div class="intro">右邊是研究報告整理的 10 項「最小可行程度」。模擬器能讓你把流程和錯誤的長相練熟，但每一項都要在真的環境親手做過才算數。</div>';
    } else {
      const w = state.w;
      if (lv.intro) h += '<div class="intro">' + md(lv.intro) + '</div>';
      if (lv.learn) {
        h += '<details class="learn"' + (state.learnOpen ? ' open' : '') + '><summary>本關新觀念（先看這裡）</summary><dl>' + lv.learn.map((x) => '<dt>' + esc(x[0]) + '</dt><dd>' + md(x[1]) + '</dd>').join('') + '</dl></details>';
      }
      h += '<h2 class="steps-h">步驟 <span class="muted">' + Math.min(w.step + 1, lv.steps.length) + '／' + lv.steps.length + '</span></h2><ol class="steps">';
      lv.steps.forEach((st, i) => {
        const cls = i < w.step ? 'done' : i === w.step ? 'cur' : 'todo';
        h += '<li class="' + cls + '">';
        if (cls === 'cur') h += '<span class="where">在「' + esc(stepWhere(st)) + '」操作</span>';
        h += md(st.text);
        if (cls === 'cur' && st.parts) h += '<div class="parts"><div class="parts-h">拆解這個指令</div>' + st.parts.map((p) => '<div><code>' + esc(p[0]) + '</code><span>' + inline(p[1]) + '</span></div>').join('') + '</div>';
        if (cls !== 'todo' && (st.why || st.read)) h += '<div class="why">' + md([st.why, st.read].filter(Boolean).join('\n\n')) + '</div>';
        if (cls === 'cur') {
          const lvl = state.shown[i] || 0;
          h += '<div class="step-actions">';
          if (lvl < 1) h += '<button type="button" class="ghost" data-hint="' + i + '">卡住了？給我提示</button>';
          if (lvl < 2) h += '<button type="button" class="ghost" data-solbtn="' + i + '">看解答</button>';
          h += '</div>';
          if (lvl >= 1) h += '<div class="hint">' + md((st.hint ? st.hint + '\n\n' : '') + (stepWhere(st) === '終端機' ? HINT_TERM : stepWhere(st) === '檔案區' ? '在中間上方的檔案清單，點一下檔名就會開啟。' : HINT_EDIT)) + '</div>';
          if (lvl >= 2) h += '<div class="sol">解答。點一下指令會填進終端機（再按 Enter 執行）：' + solutionHtml(st, i) + '</div>';
        }
        h += '</li>';
      });
      h += '</ol>';
      if (w.step >= lv.steps.length) {
        h += '<div class="done-box"><h3>過關</h3>' + md(lv.outro || '') + '</div>';
        if (lv.real) h += '<div class="real"><h3>實機挑戰：在真的 OrbStack 上重做一次</h3><pre>' + esc(lv.real.join('\n')) + '</pre></div>';
        h += next;
      }
    }
    $('#mission').innerHTML = h;
  }
  $('#mission').addEventListener('toggle', (e) => {
    if (e.target.classList && e.target.classList.contains('learn')) state.learnOpen = e.target.open;
  }, true);
  $('#mission').addEventListener('click', (e) => {
    const code = e.target.closest('li.cur code');
    if (code && state.w && /^(kubectl|docker|orb|curl|gcloud|git|sim|cat|ls|help)\b/.test(code.textContent)) {
      $('#cmd').value = code.textContent;
      $('#cmd').focus();
      return;
    }
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.hint) state.shown[t.dataset.hint] = 1;
    else if (t.dataset.solbtn) state.shown[t.dataset.solbtn] = 2;
    else if (t.dataset.cmd) {
      $('#cmd').value = t.dataset.cmd;
      $('#cmd').focus();
      return;
    } else if (t.dataset.sol) {
      const [i, j] = t.dataset.sol.split(':').map(Number);
      const s = state.level.steps[i].sol[j];
      const w = state.w;
      const path = s.write || s.edit;
      w.files[path] = s.write ? s.content : w.files[path].replace(s.find, s.to);
      openFile(path, true);
      print('✎ 已把解答套用到 ' + path + '，記得 kubectl apply。', 'okmsg');
      afterChange();
      return;
    } else if (t.dataset.next) {
      if (state.idx + 1 < G.levels.length) load(state.idx + 1);
      else openMap();
      return;
    }
    renderMission();
  });

  // ---------- 檔案與編輯器 ----------
  function renderFiles() {
    const files = Object.keys(state.w.files).sort();
    let h = '';
    let prev = [];
    for (const f of files) {
      const parts = f.split('/');
      const dirs = parts.slice(0, -1);
      dirs.forEach((d, i) => {
        if (prev[i] !== d || prev.slice(0, i).join('/') !== dirs.slice(0, i).join('/')) h += '<div class="dir" style="padding-left:' + (6 + i * 12) + 'px">' + esc(d) + '/</div>';
      });
      prev = dirs;
      h += '<button type="button" data-file="' + esc(f) + '" class="' + (f === state.file ? 'on' : '') + '" style="padding-left:' + (6 + dirs.length * 12) + 'px">' + esc(parts[parts.length - 1]) + '</button>';
    }
    $('#files').innerHTML = h;
  }
  function validateFile() {
    const el = $('#file-status');
    const f = state.file;
    el.className = '';
    if (!f) return (el.textContent = '');
    if (!/\.ya?ml$/.test(f)) return (el.textContent = '已自動儲存');
    try {
      S.yaml.loadAll(state.w.files[f]);
      el.textContent = '已自動儲存 · YAML 格式正確';
      el.className = 'ok';
    } catch (e) {
      el.textContent = 'YAML 第 ' + (e.mark ? e.mark.line + 1 : '?') + ' 行有問題：' + (e.reason || '格式錯誤');
      el.className = 'bad';
    }
  }
  function openFile(f, silent) {
    state.file = f;
    const ed = $('#editor');
    ed.disabled = !f;
    ed.value = f ? state.w.files[f] : '';
    $('#file-name').textContent = f || '點左邊的檔案來開啟';
    if (f && !silent) state.w.opened[f] = true;
    validateFile();
    renderFiles();
    if (f && !silent) afterChange();
  }
  $('#files').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-file]');
    if (b) openFile(b.dataset.file);
  });
  let debounce = null;
  $('#editor').addEventListener('input', () => {
    if (!state.file) return;
    state.w.files[state.file] = $('#editor').value;
    validateFile();
    clearTimeout(debounce);
    debounce = setTimeout(afterChange, 400);
  });
  $('#editor').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const ed = e.target;
    const s = ed.selectionStart;
    ed.setRangeText('  ', s, ed.selectionEnd, 'end');
    ed.dispatchEvent(new Event('input'));
  });

  // ---------- 終端機 ----------
  function print(text, cls) {
    const out = $('#term-out');
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  }
  function printResult(r) {
    if (!r.out) return;
    // 模擬器的旁白（💡 開頭）和真實工具的輸出分開上色。
    let buf = [];
    let tip = false;
    const flush = () => {
      if (buf.length) print(buf.join('\n'), tip ? 'tip' : r.ok ? '' : 'err');
      buf = [];
    };
    for (const line of r.out.split('\n')) {
      const isTip = line.startsWith('💡');
      if (isTip !== tip) flush();
      tip = isTip;
      buf.push(line);
    }
    flush();
  }
  function afterChange() {
    const lv = state.level;
    const w = state.w;
    if (!w || !lv.steps) return;
    const before = w.step;
    const n = G.advance(lv, w);
    if (n) {
      for (let i = before; i < w.step; i++) print('✓ 步驟 ' + (i + 1) + ' 完成', 'okmsg');
      if (w.step >= lv.steps.length) {
        print('★ ' + lv.id + ' 過關！左邊有重點整理與下一關。', 'okmsg');
        state.save.done[lv.id] = true;
        persist();
      }
      renderMission();
      const cur = $('#mission .steps li.cur') || $('#mission .done-box');
      if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    renderTop();
    renderViz();
  }
  function exec(line) {
    const w = state.w;
    print($('#prompt').textContent + ' ' + line, 'cmdline');
    if (line.trim() === 'clear') {
      $('#term-out').textContent = '';
      return;
    }
    const r = G.run(w, line);
    printResult(r);
    const before = w.step;
    afterChange();
    renderFiles();
    const lv = state.level;
    if (w.step > before || w.step >= lv.steps.length) state.miss = 0;
    else {
      state.miss++;
      const lvl = state.shown[w.step] || 0;
      if (lvl < 1 && ((!r.ok && state.miss >= 2) || state.miss >= 4)) {
        state.shown[w.step] = 1;
        print('💡 教練：這一步好像卡住了，左邊已經幫你打開提示。', 'tip');
        renderMission();
      } else if (lvl === 1 && state.miss >= 7) {
        state.miss = 0;
        print('💡 教練：還是不順的話，按左邊的「看解答」，照著做一次再回頭看說明也可以。', 'tip');
      }
    }
  }
  $('#cmd').addEventListener('keydown', (e) => {
    const inp = e.target;
    if (e.key === 'Enter') {
      const line = inp.value;
      inp.value = '';
      if (!line.trim()) return;
      state.hist.push(line);
      state.hpos = state.hist.length;
      exec(line);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.hpos > 0) inp.value = state.hist[--state.hpos];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.hpos = Math.min(state.hist.length, state.hpos + 1);
      inp.value = state.hist[state.hpos] || '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const r = G.complete(state.w, inp.value);
      inp.value = r.line;
      if (r.options.length) print(r.options.slice(0, 30).join('   '), 'opts');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      $('#term-out').textContent = '';
    }
  });
  $('#term').addEventListener('click', (e) => {
    if (!window.getSelection().toString() && !e.target.closest('input')) $('#cmd').focus();
  });

  // ---------- 叢集視覺化 ----------
  function podChip(p) {
    const cls = p.st.ready ? 'ok' : p.st.crash || /ImagePull|Config/.test(p.st.status) ? 'bad' : 'warn';
    return '<button type="button" class="pod ' + cls + '" data-pod="' + esc(p.name) + '" title="' + esc(p.name + '（點一下把名稱貼到終端機）') + '"><span class="dot ' + cls + '"></span>…' + esc(p.name.slice(-5)) + ' ' + p.st.readyCount + '/' + p.st.total + (p.st.status !== 'Running' ? ' ' + esc(p.st.status) : '') + '</button>';
  }
  function renderViz() {
    const w = state.w;
    const c = S.cur(w);
    let h = '<h2>叢集現況</h2><div class="sub">' + (c.kind === 'orb' ? '本機 OrbStack（模擬，單節點）' : '模擬 GKE Autopilot（不會產生費用）') + '</div>';
    if (!c.started) {
      $('#viz').innerHTML = h + '<div class="empty">Kubernetes 還沒啟動。</div>';
      return;
    }
    S.reconcile(w, c);
    if (c.kind === 'gke' && c.pods.length) {
      const cost = S.costOf(c);
      h += '<div class="cost">預估費用：<strong>' + cost.total + '</strong> 點／月<span class="muted">（模擬點數）</span><div class="bar"><i class="' + (cost.total <= 60 ? 'ok' : '') + '" style="width:' + Math.min(100, (cost.total / 120) * 100) + '%"></i></div></div>';
    }
    const nss = S.list(c, 'Namespace').map((n) => n.metadata.name).filter((n) => n !== 'kube-system');
    let any = false;
    for (const ns of nss) {
      const deps = S.list(c, 'Deployment', ns);
      const svcs = S.list(c, 'Service', ns);
      const gws = S.list(c, 'Gateway', ns);
      const routes = S.list(c, 'HTTPRoute', ns);
      const misc = ['ConfigMap', 'Secret', 'ServiceAccount', 'HealthCheckPolicy'].map((k) => S.list(c, k, ns).map((o) => k + '/' + o.metadata.name)).flat();
      if (!deps.length && !svcs.length && !gws.length && !routes.length && !misc.length) continue;
      any = true;
      h += '<div class="ns"><div class="ns-name">namespace: ' + esc(ns) + '</div>';
      for (const gw of gws) {
        const g = S.gatewayInfo(c, gw);
        h += '<div class="card gw' + (g.programmed ? '' : ' bad') + '"><div class="kind">GATEWAY（對外入口）</div><div class="name">' + esc(gw.metadata.name) + '</div><div class="muted">' + (g.programmed ? esc(c.kind === 'orb' ? 'http://app.k8s.orb.local' : 'http://' + g.address) : '找不到 GatewayClass「' + esc(g.cls) + '」') + '</div>';
        const mine = routes.filter((r) => ((r.spec || {}).parentRefs || []).some((p) => p.name === gw.metadata.name));
        for (const rt of mine) {
          for (const rule of (rt.spec || {}).rules || []) {
            const ref = (rule.backendRefs || [])[0] || {};
            const bh = S.backendHealth(w, c, ns, ref);
            const paths = (rule.matches || [{}]).map((m) => (m.path || {}).value || '/').join(', ');
            h += '<div class="route"><span class="dot ' + (bh.ok ? 'ok' : 'bad') + '"></span><span>' + esc(paths) + ' → ' + esc(ref.name || '?') + ':' + esc(ref.port || '?') + '</span>' + (bh.ok ? '' : '<span class="muted">' + esc(bh.why) + '</span>') + '</div>';
          }
        }
        if (!mine.length) h += '<div class="route muted">還沒有 HTTPRoute 掛到這個 Gateway</div>';
        h += '</div>';
      }
      for (const rt of routes.filter((r) => !gws.some((g) => ((r.spec || {}).parentRefs || []).some((p) => p.name === g.metadata.name)))) {
        h += '<div class="card bad"><div class="kind">HTTPROUTE</div><div class="name">' + esc(rt.metadata.name) + '</div><div class="muted">parentRefs 指向的 Gateway 不存在</div></div>';
      }
      const used = new Set();
      for (const d of deps) {
        const st = S.depStatus(c, d);
        const labels = (d.spec.template.metadata || {}).labels || {};
        for (const s of svcs) {
          const sel = (s.spec || {}).selector || {};
          if (Object.keys(sel).length && S.matchLabels(labels, sel)) {
            used.add(s.metadata.name);
            const n = S.endpoints(c, s).length;
            h += '<div class="svc-tab"><span>Service ' + esc(s.metadata.name) + ':' + esc(s.spec.ports[0].port) + '</span><span><span class="dot ' + (n ? 'ok' : 'bad') + '"></span> ' + n + ' 個 endpoint</span></div>';
          }
        }
        h += '<div class="card' + (d._failed ? ' bad' : '') + '"><div class="kind">DEPLOYMENT</div><div class="name">' + esc(d.metadata.name) + ' <span class="muted">' + st.ready + '/' + st.replicas + ' 就緒</span></div>';
        if (d._failed) h += '<div class="muted">建立 Pod 失敗（describe deploy 看原因）</div>';
        h += '<div class="pods">' + st.pods.map(podChip).join('') + '</div></div>';
      }
      for (const s of svcs.filter((x) => !used.has(x.metadata.name))) {
        h += '<div class="card bad"><div class="kind">SERVICE</div><div class="name">' + esc(s.metadata.name) + '</div><div class="muted"><span class="dot bad"></span> selector（' + esc(Object.entries((s.spec || {}).selector || {}).map((e) => e.join('=')).join(',')) + '）沒有對到任何 Pod</div></div>';
      }
      if (misc.length) h += '<div class="chips">' + misc.map((m) => '<span>' + esc(m) + '</span>').join('') + '</div>';
      h += '</div>';
    }
    if (!any) h += '<div class="empty">叢集是空的。apply 一些東西進來吧。</div>';
    $('#viz').innerHTML = h;
  }
  $('#viz').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pod]');
    if (!b) return;
    const inp = $('#cmd');
    inp.value = inp.value + (inp.value && !/\s$/.test(inp.value) ? ' ' : '') + b.dataset.pod;
    inp.focus();
  });

  // ---------- 測驗與結業 ----------
  function renderQuiz() {
    const lv = state.level;
    const firstOpen = lv.questions.findIndex((q, i) => state.answers[i] !== q.answer);
    let h = '<div class="stage-inner">';
    if (lv.intro) h += '<div class="lesson-intro">' + md(lv.intro) + '</div>';
    lv.questions.forEach((q, i) => {
      if (lv.progressive && firstOpen >= 0 && i > firstOpen) return;
      const a = state.answers[i];
      const tried = state.tried[lv.id + i] || [];
      h += '<div class="q" id="q' + i + '">';
      if (q.teach) h += '<div class="eyebrow">觀念 ' + (i + 1) + '／' + lv.questions.length + (q.topic ? '　' + esc(q.topic) : '') + '</div><div class="teach">' + md(q.teach) + '</div><div class="ask">確認一下</div>';
      h += '<h3>' + (q.teach ? '' : i + 1 + '. ') + md(q.q) + '</h3>';
      q.options.forEach((o, j) => {
        const cls = a === q.answer && j === q.answer ? 'right' : tried.includes(j) && j !== q.answer ? 'wrong' : '';
        h += '<button type="button" class="opt ' + cls + '" data-q="' + i + '" data-o="' + j + '"' + (a === q.answer ? ' disabled' : '') + '>' + md(o) + '</button>';
      });
      if (a === q.answer) h += '<div class="explain"><strong>答對了。</strong>' + md(q.explain) + '</div>';
      else if (tried.length) h += '<div class="explain" style="border-color:var(--bad)">不是這個。回頭看一下上面的說明，再選一次。</div>';
      h += '</div>';
    });
    if (lv.progressive && firstOpen >= 0 && firstOpen < lv.questions.length - 1) h += '<p class="muted more">答對這一題，下一張卡片就會出現（還有 ' + (lv.questions.length - 1 - firstOpen) + ' 張）。</p>';
    if (firstOpen < 0) h += '<div class="done-box"><h3>這一關完成了</h3>' + md(lv.outro || '') + '</div><button type="button" class="next" data-next="1">下一關 →</button>';
    $('#stage').innerHTML = h + '</div>';
  }
  function renderFinal() {
    let h = '<div class="stage-inner"><h2>MVP 自我檢核</h2><p class="muted">「模擬」欄是你在這個遊戲裡練過的關卡；「實機」請在真的做過之後自己打勾。</p>';
    G.checklist.forEach((item, i) => {
      const lvls = G.levels.filter((l) => (l.covers || []).includes(i));
      const done = lvls.filter(isDone).length;
      h += '<div class="check-item"><span class="badge ' + (lvls.length && done === lvls.length ? 'ok' : '') + '">模擬 ' + done + '／' + lvls.length + '</span><div><div>' + md(item.text) + '</div><label><input type="checkbox" data-real="' + i + '"' + (state.save.real[i] ? ' checked' : '') + '> 實機做過了：' + esc(item.real) + '</label><div class="muted" style="font-size:12.5px">相關關卡：' + lvls.map((l) => l.id).join('、') + '</div></div></div>';
    });
    h += '<p style="margin-top:16px">完整的能力地圖、GKE 細節與參考連結在研究報告：<code>docs/research/k8s-frontend-to-jr-devops-mvp.md</code>。下一步建議：拿自己的前端專案，在真的 OrbStack 上從 1-1 做到 2-5。</p></div>';
    $('#stage').innerHTML = h;
  }
  $('#stage').addEventListener('click', (e) => {
    if (e.target.closest('button[data-next]')) return load(state.idx + 1);
    const b = e.target.closest('button.opt');
    if (!b) return;
    const lv = state.level;
    const i = Number(b.dataset.q);
    const j = Number(b.dataset.o);
    const k = lv.id + i;
    state.tried[k] = (state.tried[k] || []).concat(j);
    if (j === lv.questions[i].answer) state.answers[i] = j;
    if (lv.questions.every((q, n) => state.answers[n] === q.answer)) {
      state.save.done[lv.id] = true;
      persist();
    }
    renderQuiz();
    renderMission();
    renderTop();
    if (j === lv.questions[i].answer) {
      const nxt = document.getElementById('q' + (i + 1)) || $('#stage .done-box');
      if (nxt && lv.progressive) nxt.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
  $('#stage').addEventListener('change', (e) => {
    if (e.target.dataset.real == null) return;
    state.save.real[e.target.dataset.real] = e.target.checked;
    persist();
  });

  // ---------- 關卡地圖 ----------
  function openMap() {
    let h = '';
    for (const ch of G.chapters) {
      h += '<div class="chapter"><h3>第 ' + ch.id + ' 章　' + esc(ch.title) + ' <span class="muted" style="font-weight:400;font-size:13px">' + esc(ch.env) + '</span></h3><p>' + esc(ch.desc) + '</p>';
      G.levels.forEach((lv, i) => {
        if (lv.ch !== ch.id) return;
        h += '<button type="button" class="lv' + (isDone(lv) ? ' done' : '') + (i === state.idx ? ' on' : '') + '" data-lv="' + i + '"><span class="id">' + (isDone(lv) ? '✓ ' : '') + esc(lv.id === 'final' ? '★' : lv.id) + '</span><span>' + esc(lv.title) + '</span></button>';
      });
      h += '</div>';
    }
    $('#map-body').innerHTML = h;
    $('#map').hidden = false;
  }
  $('#btn-map').addEventListener('click', openMap);
  $('#btn-map-close').addEventListener('click', () => ($('#map').hidden = true));
  $('#map').addEventListener('click', (e) => {
    if (e.target === $('#map')) $('#map').hidden = true;
    const b = e.target.closest('button[data-lv]');
    if (b) {
      $('#map').hidden = true;
      load(Number(b.dataset.lv));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#map').hidden = true;
  });
  $('#btn-reset').addEventListener('click', () => load(state.idx));

  function modal(title, html) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').hidden = false;
    $('#modal-close').focus();
  }
  const closeModal = () => ($('#modal').hidden = true);
  // stage 1：第一次進來；stage 2：第一次進到有終端機的關卡。
  function showTour(stage) {
    if (stage && state.save.tour < stage) {
      state.save.tour = stage;
      persist();
    }
    const ops = !!state.w;
    let h = '';
    if (!ops) {
      h += '<p><strong>這是什麼？</strong>一個在瀏覽器裡<strong>模擬</strong> Kubernetes 的練習場。裡面的終端機、叢集、雲端都是假的，不會動到你的電腦，也不會產生任何費用，可以放心亂試。</p>';
      h += '<p><strong>怎麼進行？</strong></p><ul><li><strong>第 0 章（現在這裡）</strong>：不用打指令。右邊一張一張讀觀念卡片，每張後面有一題小問題，答對就出現下一張。</li><li><strong>第 1 章起</strong>：動手操作。左邊會一步一步告訴你要打什麼指令、為什麼，並把每個新指令拆開解釋。</li></ul>';
    }
    h += '<p><strong>' + (ops ? '這一關開始要動手了。畫面分成四塊：' : '第 1 章起的畫面長這樣：') + '</strong></p>';
    h += '<div class="tour-grid"><div class="a"><b>① 任務</b>照著步驟做。目前的步驟會標示要在哪裡操作，有「提示」和「看解答」。</div><div class="b"><b>② 檔案與編輯器</b>專案裡的 YAML。點檔名開啟，直接改，會自動儲存。</div><div class="c"><b>③ 終端機</b>在最下面那一行打指令，按 Enter。步驟裡灰底的指令可以直接點，會幫你填好。</div><div class="d"><b>④ 叢集現況</b>你的指令造成的結果會即時畫在這裡。綠點是健康的 Pod，紅點是壞掉的。</div></div>';
    h += '<p><strong>卡住的時候：</strong></p><ul><li>按步驟下方的<strong>「卡住了？給我提示」</strong>，再不行按<strong>「看解答」</strong>，解答可以一鍵填入。連續幾次沒進展，提示會自動打開。</li><li>看不懂名詞：右上角<strong>「名詞小抄」</strong>。</li><li>把環境弄壞了：右上角<strong>「重設本關」</strong>。</li><li>想跳關或回頭：右上角<strong>「關卡地圖」</strong>。</li></ul>';
    h += '<p><button type="button" id="tour-ok">開始</button></p>';
    modal('怎麼玩', h);
    $('#tour-ok').addEventListener('click', closeModal);
  }
  function showGlossary() {
    let h = '<h3 class="gl-h">最常用的指令</h3><dl class="gl">' + G.cheats.map((x) => '<dt>' + esc(x[0]) + '</dt><dd>' + md(x[1]) + '</dd>').join('') + '</dl>';
    h += '<h3 class="gl-h">名詞</h3><dl class="gl">' + G.glossary.map((x) => '<dt>' + esc(x[0]) + '</dt><dd>' + md(x[1]) + '</dd>').join('') + '</dl>';
    modal('名詞小抄', h);
  }
  $('#btn-help').addEventListener('click', () => showTour(0));
  $('#btn-gloss').addEventListener('click', showGlossary);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => {
    if (e.target === $('#modal')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  const start = G.levels.findIndex((l) => l.id === state.save.last);
  load(start >= 0 ? start : 0);
  if (state.save.tour < 1) showTour(1);
})();
