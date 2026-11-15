// 介面：任務面板、編輯器、終端機、叢集視覺化。遊戲邏輯都在 sim.js／shell.js／levels.js。
(function () {
  'use strict';
  const G = window.K8sGame;
  const S = G.sim;
  const $ = (s) => document.querySelector(s);
  const STORE = 'k8s-helm-training-v1';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

  const state = { idx: 0, level: null, w: null, file: null, hist: [], hpos: 0, shown: {}, save: { done: {}, real: {}, last: null } };
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
    }
    renderAll();
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
  function renderMission() {
    const lv = state.level;
    const ch = G.chapters[lv.ch];
    let h = '<div class="eyebrow">第 ' + ch.id + ' 章　' + esc(ch.title) + '　·　' + esc(ch.env) + '</div><h1>' + esc(lv.id === 'final' ? lv.title : lv.id + '　' + lv.title) + '</h1>';
    if (lv.intro) h += '<div class="intro">' + md(lv.intro) + '</div>';
    const next = '<button type="button" class="next" data-next="1">' + (state.idx + 1 < G.levels.length ? '下一關 →' : '回到關卡地圖') + '</button>';
    if (lv.type === 'quiz') {
      const n = lv.questions.filter((q, i) => state.answers[i] === q.answer).length;
      h += '<p class="muted">答對 ' + n + '／' + lv.questions.length + ' 題。答錯可以重選，重點是看懂解說。</p>';
      if (n === lv.questions.length) h += '<div class="done-box"><h3>完成</h3>' + md(lv.outro || '') + '</div>' + next;
    } else if (lv.type === 'final') {
      h += '<div class="intro">右邊是研究報告整理的 10 項「最小可行程度」。模擬器能讓你把流程和錯誤的長相練熟，但每一項都要在真的環境親手做過才算數。</div>';
    } else {
      const w = state.w;
      h += '<ol class="steps">';
      lv.steps.forEach((st, i) => {
        const cls = i < w.step ? 'done' : i === w.step ? 'cur' : 'todo';
        h += '<li class="' + cls + '">' + md(st.text);
        if (cls !== 'todo' && st.why) h += '<div class="why">' + md(st.why) + '</div>';
        if (cls === 'cur') {
          const lvl = state.shown[i] || 0;
          h += '<div class="step-actions">';
          if (st.hint && lvl < 1) h += '<button type="button" class="ghost" data-hint="' + i + '">給我提示</button>';
          if (lvl < 2) h += '<button type="button" class="ghost" data-solbtn="' + i + '">看解答</button>';
          h += '</div>';
          if (st.hint && lvl >= 1) h += '<div class="hint">' + md(st.hint) + '</div>';
          if (lvl >= 2) h += '<div class="sol">點一下就會填進終端機（按 Enter 執行）：' + solutionHtml(st, i) + '</div>';
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
  $('#mission').addEventListener('click', (e) => {
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
    afterChange();
    renderFiles();
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
    let h = '<div class="stage-inner">';
    lv.questions.forEach((q, i) => {
      const a = state.answers[i];
      const tried = (state.tried = state.tried || {})[lv.id + i] || [];
      h += '<div class="q"><h3>' + (i + 1) + '. ' + md(q.q) + '</h3>';
      q.options.forEach((o, j) => {
        const cls = a === q.answer && j === q.answer ? 'right' : tried.includes(j) && j !== q.answer ? 'wrong' : '';
        h += '<button type="button" class="opt ' + cls + '" data-q="' + i + '" data-o="' + j + '"' + (a === q.answer ? ' disabled' : '') + '>' + md(o) + '</button>';
      });
      if (a === q.answer) h += '<div class="explain">' + md(q.explain) + '</div>';
      else if (tried.length) h += '<div class="explain" style="border-color:var(--bad)">再想想，換一個選項試試。</div>';
      h += '</div>';
    });
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

  const start = G.levels.findIndex((l) => l.id === state.save.last);
  load(start >= 0 ? start : 0);
})();
