// 叢集模擬器：純資料 + 純函式，瀏覽器與 Node 都能載入。
// 這不是真的 Kubernetes，只模擬學習路徑需要的行為（見 README 的「模擬範圍」）。
(function (root) {
  'use strict';
  const G = (root.K8sGame = root.K8sGame || {});
  const yaml = root.jsyaml || require('../vendor/js-yaml.min.js');

  const AR_HOST = 'asia-east1-docker.pkg.dev';
  const AR_REPO = AR_HOST + '/demo-project/app';
  const GKE_LB_IP = '34.120.0.10';
  const ALPHA = 'bcdfghjklmnpqrstvwxz2456789';

  const KINDS = {
    Namespace: { api: 'v1', names: ['ns', 'namespace', 'namespaces'], out: 'namespace', cluster: true },
    Deployment: { api: 'apps/v1', names: ['deploy', 'deployment', 'deployments', 'deployment.apps', 'deployments.apps'], out: 'deployment.apps' },
    Service: { api: 'v1', names: ['svc', 'service', 'services'], out: 'service' },
    ConfigMap: { api: 'v1', names: ['cm', 'configmap', 'configmaps'], out: 'configmap' },
    Secret: { api: 'v1', names: ['secret', 'secrets'], out: 'secret' },
    ServiceAccount: { api: 'v1', names: ['sa', 'serviceaccount', 'serviceaccounts'], out: 'serviceaccount' },
    Gateway: { api: 'gateway.networking.k8s.io/v1', names: ['gateway', 'gateways', 'gtw'], out: 'gateway.gateway.networking.k8s.io' },
    HTTPRoute: { api: 'gateway.networking.k8s.io/v1', names: ['httproute', 'httproutes'], out: 'httproute.gateway.networking.k8s.io' },
    HealthCheckPolicy: { api: 'networking.gke.io/v1', names: ['healthcheckpolicy', 'healthcheckpolicies'], out: 'healthcheckpolicy.networking.gke.io', gkeOnly: true },
  };
  const GATEWAY_CLASSES = {
    orb: ['traefik'],
    gke: ['gke-l7-global-external-managed', 'gke-l7-regional-external-managed'],
  };

  // ---------- 小工具 ----------
  const key = (kind, ns, name) => kind + '|' + ns + '|' + name;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function clean(o) {
    if (Array.isArray(o)) return o.map(clean);
    if (o && typeof o === 'object') {
      const r = {};
      for (const k of Object.keys(o)) if (k[0] !== '_') r[k] = clean(o[k]);
      return r;
    }
    return o;
  }
  const b64e = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(String(s), 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(String(s)))));
  const b64d = (s) => {
    try {
      return typeof Buffer !== 'undefined' ? Buffer.from(String(s), 'base64').toString('utf8') : decodeURIComponent(escape(atob(String(s))));
    } catch (e) {
      return '';
    }
  };
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function hashName(s) {
    let h = hashStr(s);
    let out = '';
    while (out.length < 9) {
      out += ALPHA[h % ALPHA.length];
      h = Math.floor(h / ALPHA.length);
      if (h === 0) h = hashStr(s + out);
    }
    return out;
  }
  function rnd(w) {
    w.rng = (Math.imul(w.rng, 1103515245) + 12345) >>> 0;
    return w.rng >>> 8;
  }
  function suffix5(w) {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHA[rnd(w) % ALPHA.length];
    return s;
  }
  function parseCpu(v) {
    if (v == null || v === '') return 0;
    const s = String(v);
    return s.endsWith('m') ? parseFloat(s) / 1000 : parseFloat(s) || 0;
  }
  function parseMem(v) {
    // 回傳 Mi
    if (v == null || v === '') return 0;
    const m = String(v).match(/^([\d.]+)\s*([A-Za-z]*)$/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = { Ki: 1 / 1024, Mi: 1, Gi: 1024, K: 1 / 1024, M: 1, G: 1024, '': 1 / 1048576 }[m[2]];
    return u == null ? 0 : n * u;
  }
  function parseImage(ref) {
    let name = ref;
    let tag = 'latest';
    const i = ref.lastIndexOf(':');
    if (i > ref.lastIndexOf('/')) {
      name = ref.slice(0, i);
      tag = ref.slice(i + 1);
    }
    const parts = name.split('/');
    const registry = parts.length > 1 && /[.:]/.test(parts[0]) ? parts[0] : null;
    return { ref: name + ':' + tag, name, tag, base: parts[parts.length - 1], registry };
  }
  const matchLabels = (labels, sel) => Object.keys(sel).every((k) => (labels || {})[k] === sel[k]);
  function normPath(p) {
    const out = [];
    for (const seg of String(p).split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return out.join('/');
  }

  // ---------- 世界 ----------
  function newCluster(name, kind) {
    const c = { name, kind, started: kind === 'gke', res: {}, pods: [], ipSeq: 10 };
    for (const ns of ['default', 'kube-system']) {
      c.res[key('Namespace', '', ns)] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns }, _created: 0 };
    }
    return c;
  }
  function newWorld() {
    return {
      files: {},
      opened: {},
      ctx: 'orbstack',
      clusters: { orbstack: newCluster('orbstack', 'orb'), 'gke-staging': newCluster('gke-staging', 'gke') },
      images: {}, // 本機映像檔 ref -> meta
      registry: {}, // 模擬 Artifact Registry ref -> meta
      dockerAuth: false,
      iam: {}, // 'ns/ksa' -> true，代表這個 KSA 已被授予 roles/cloudsql.client
      buildBug: {}, // app -> {bug, msg}，讓某次 build 產生壞版本
      git: 'a1b2c3d',
      tick: 1,
      rng: 20261115,
      history: [],
      forwards: {},
      stats: { podDeletes: 0 },
    };
  }
  const cur = (w) => w.clusters[w.ctx];
  const list = (c, kind, ns) => Object.values(c.res).filter((o) => o.kind === kind && (ns == null || (o.metadata.namespace || '') === ns));
  const getRes = (c, kind, ns, name) => c.res[key(kind, KINDS[kind].cluster ? '' : ns, name)];
  const nodeName = (c) => (c.kind === 'orb' ? 'orbstack' : 'gk3-shop-pool-1-7d4f');

  // ---------- 映像檔與應用程式行為 ----------
  const PUBLIC = {
    nginx: { app: 'frontend', label: 'nginx 預設頁' },
    postgres: { app: 'postgres' },
    'gcr.io/cloud-sql-connectors/cloud-sql-proxy': { app: 'sqlproxy' },
  };
  const APPS = {
    frontend: {
      port: 80,
      mem: 24,
      bins: ['nginx', 'sh'],
      okCmd: 'nginx -g daemon off;',
      cmdError: (cmd) => {
        const m = /^daemon\s+(\S+?);?$/.exec(cmd[2] || '');
        return m ? 'nginx: [emerg] invalid value "' + m[1] + '" in "daemon" directive, it must be "on" or "off" in command line' : 'nginx: [emerg] unknown directive "' + (cmd[2] || cmd[1] || '') + '" in command line';
      },
      logs: () => ['/docker-entrypoint.sh: Configuration complete; ready for start up', 'nginx: start worker processes'],
      http: (path, env, meta) => ({ code: 200, body: '<!doctype html><title>Shop</title><h1>Shop 前端（版本 ' + meta.label + '）</h1>' }),
    },
    backend: {
      port: 8080,
      mem: 180,
      bins: ['node', 'sh'],
      okCmd: 'node server.js',
      cmdError: (cmd) => "Error: Cannot find module '/app/" + (cmd[1] || '') + "'\n    code: 'MODULE_NOT_FOUND'",
      requiredEnv: ['APP_ENV', 'DATABASE_URL'],
      needsDb: true,
      logs: (env) => ['[shop-api] env=' + env.APP_ENV, '[shop-api] database connected', '[shop-api] listening on :8080'],
      http: (path, env, meta) => {
        if (path === '/healthz') return { code: 200, body: 'ok' };
        if (path === '/api/hello') return { code: 200, body: JSON.stringify({ message: 'hello from backend', env: env.APP_ENV, version: meta.label, db: 'connected' }) };
        return { code: 404, body: JSON.stringify({ error: 'not found', path }) };
      },
    },
    postgres: {
      port: 5432,
      mem: 96,
      bins: ['postgres', 'docker-entrypoint.sh', 'sh'],
      requiredEnv: ['POSTGRES_PASSWORD'],
      logs: () => ['PostgreSQL init process complete; ready for start up.', 'LOG:  database system is ready to accept connections'],
    },
    sqlproxy: { port: 5432, mem: 32, bins: ['/cloud-sql-proxy'], longRunning: true, logs: () => [] },
  };

  function pullImage(w, c, x) {
    const im = parseImage(x.image || '');
    if (PUBLIC[im.name]) return { ok: true, meta: Object.assign({ label: im.tag }, PUBLIC[im.name]) };
    const remoteErr = () => {
      if (im.registry) return 'rpc error: code = NotFound desc = failed to pull and unpack image "' + im.ref + '": failed to resolve reference "' + im.ref + '": ' + im.ref + ': not found';
      const full = 'docker.io/library/' + im.ref;
      return 'rpc error: code = Unknown desc = failed to pull and unpack image "' + full + '": failed to resolve reference "' + full + '": pull access denied, repository does not exist or may require authorization';
    };
    if (c.kind === 'orb') {
      const policy = x.imagePullPolicy || (im.tag === 'latest' ? 'Always' : 'IfNotPresent');
      const local = w.images[im.ref];
      if (policy === 'Never') return local ? { ok: true, meta: local } : { ok: false, err: 'Container image "' + im.ref + '" is not present with pull policy of Never' };
      if (policy === 'IfNotPresent' && local) return { ok: true, meta: local };
      return { ok: false, err: remoteErr() };
    }
    const r = w.registry[im.ref];
    return r ? { ok: true, meta: r } : { ok: false, err: remoteErr() };
  }

  function secretData(s) {
    const out = {};
    for (const k of Object.keys(s.data || {})) out[k] = b64d(s.data[k]);
    Object.assign(out, s.stringData || {});
    return out;
  }
  function resolveEnv(c, ns, x) {
    const env = {};
    for (const ef of x.envFrom || []) {
      if (ef.configMapRef) {
        const cm = getRes(c, 'ConfigMap', ns, ef.configMapRef.name);
        if (!cm) return { err: 'configmap "' + ef.configMapRef.name + '" not found' };
        Object.assign(env, cm.data || {});
      } else if (ef.secretRef) {
        const s = getRes(c, 'Secret', ns, ef.secretRef.name);
        if (!s) return { err: 'secret "' + ef.secretRef.name + '" not found' };
        Object.assign(env, secretData(s));
      }
    }
    for (const e of x.env || []) {
      if (e.value != null) env[e.name] = String(e.value);
      else if (e.valueFrom && e.valueFrom.configMapKeyRef) {
        const r = e.valueFrom.configMapKeyRef;
        const cm = getRes(c, 'ConfigMap', ns, r.name);
        if (!cm) return { err: 'configmap "' + r.name + '" not found' };
        if (!(r.key in (cm.data || {}))) return { err: "couldn't find key " + r.key + ' in ConfigMap ' + ns + '/' + r.name };
        env[e.name] = cm.data[r.key];
      } else if (e.valueFrom && e.valueFrom.secretKeyRef) {
        const r = e.valueFrom.secretKeyRef;
        const s = getRes(c, 'Secret', ns, r.name);
        if (!s) return { err: 'secret "' + r.name + '" not found' };
        const d = secretData(s);
        if (!(r.key in d)) return { err: "couldn't find key " + r.key + ' in Secret ' + ns + '/' + r.name };
        env[e.name] = d[r.key];
      }
    }
    return { env };
  }
  function namedPort(spec, name) {
    for (const x of (spec.containers || []).concat(spec.initContainers || [])) {
      for (const p of x.ports || []) if (p.name === name) return p.containerPort;
    }
    return null;
  }
  function probeResult(spec, x, app, probe, env, meta) {
    if (!probe) return null;
    const target = probe.httpGet || probe.tcpSocket;
    if (!target) return null;
    let port = target.port;
    if (typeof port === 'string' && !/^\d+$/.test(port)) port = namedPort(spec, port);
    port = Number(port);
    if (port !== app.port) return 'dial tcp :' + (port || target.port) + ': connect: connection refused';
    if (probe.httpGet) {
      if (!app.http) return 'HTTP probe failed: 這個容器不是 HTTP 服務';
      const r = app.http(probe.httpGet.path || '/', env, meta);
      if (r.code >= 400) return 'HTTP probe failed with statuscode: ' + r.code;
    }
    return null;
  }

  // 依 Pod 範本算出「這個 Pod 現在會是什麼狀態」。
  function evalPod(w, c, ns, spec, pod) {
    const mains = spec.containers || [];
    const inits = spec.initContainers || [];
    const sidecars = inits.filter((x) => x.restartPolicy === 'Always');
    const blocking = inits.filter((x) => x.restartPolicy !== 'Always');
    const all = sidecars.concat(mains);
    const podName = pod ? pod.name : 'pod';
    const st = {
      status: 'Running',
      phase: 'Running',
      ready: false,
      readyCount: 0,
      total: all.length,
      crash: false,
      cs: {},
      events: [{ type: 'Normal', reason: 'Scheduled', message: 'Successfully assigned ' + ns + '/' + podName + ' to ' + nodeName(c) }],
    };
    const ev = (type, reason, message) => st.events.push({ type, reason, message });
    const waitAll = (reason) => {
      for (const x of blocking.concat(all)) st.cs[x.name] = { ready: false, state: 'Waiting', reason, logs: [], prev: null, waiting: true };
    };

    // 1. 排程
    let cpu = 0;
    let mem = 0;
    for (const x of all) {
      const r = (x.resources || {}).requests || (x.resources || {}).limits || {};
      cpu += parseCpu(r.cpu);
      mem += parseMem(r.memory);
    }
    const cap = c.kind === 'orb' ? { cpu: 4, mem: 8192 } : { cpu: 30, mem: 110 * 1024 };
    if (cpu > cap.cpu || mem > cap.mem) {
      st.status = 'Pending';
      st.phase = 'Pending';
      waitAll('');
      st.events = [{ type: 'Warning', reason: 'FailedScheduling', message: '0/1 nodes are available: 1 Insufficient ' + (cpu > cap.cpu ? 'cpu' : 'memory') + '. preemption: 0/1 nodes are available: 1 No preemption victims found for incoming pod.' }];
      return st;
    }

    // 2. 拉映像檔
    const metas = {};
    for (const x of blocking.concat(all)) {
      const im = pullImage(w, c, x);
      if (!im.ok) {
        st.status = 'ImagePullBackOff';
        st.phase = 'Pending';
        waitAll('ContainerCreating');
        st.cs[x.name].reason = 'ImagePullBackOff';
        ev('Normal', 'Pulling', 'Pulling image "' + x.image + '"');
        ev('Warning', 'Failed', 'Failed to pull image "' + x.image + '": ' + im.err);
        ev('Warning', 'Failed', 'Error: ErrImagePull');
        ev('Normal', 'BackOff', 'Back-off pulling image "' + x.image + '"');
        ev('Warning', 'Failed', 'Error: ImagePullBackOff');
        return st;
      }
      metas[x.name] = im.meta;
    }

    // 3. 設定來源（ConfigMap／Secret）。健康的 Pod 沿用啟動當下的環境變數快照。
    const snapshot = pod && pod.st && pod.st.ready && pod.env;
    const envs = snapshot ? pod.env : {};
    if (!snapshot) {
      for (const x of all) {
        const r = resolveEnv(c, ns, x);
        if (r.err) {
          st.status = 'CreateContainerConfigError';
          st.phase = 'Pending';
          waitAll('ContainerCreating');
          st.cs[x.name].reason = 'CreateContainerConfigError';
          ev('Normal', 'Pulled', 'Container image "' + x.image + '" already present on machine');
          ev('Warning', 'Failed', 'Error: ' + r.err);
          return st;
        }
        envs[x.name] = r.env;
      }
      if (pod) pod.env = envs;
    }

    // 4. 一般 init container 必須「跑完」才輪到主容器；常駐程式放這裡會永遠卡住。
    const stuck = blocking.find((x) => APPS[metas[x.name].app].longRunning);
    if (stuck) {
      st.status = 'Init:0/' + blocking.length;
      st.phase = 'Pending';
      waitAll('PodInitializing');
      st.cs[stuck.name] = { ready: false, state: 'Running', logs: ['Listening on 127.0.0.1:5432', 'The proxy has started successfully and is ready for new connections!'], prev: null, init: true };
      ev('Normal', 'Started', 'Started container ' + stuck.name);
      return st;
    }

    // 5. sidecar（restartPolicy: Always 的 init container）
    let proxy = null;
    for (const x of sidecars) {
      const meta = metas[x.name];
      const cs = { ready: true, state: 'Running', logs: [], prev: null, sidecar: true };
      if (meta.app === 'sqlproxy') {
        const sa = spec.serviceAccountName || 'default';
        const ok = c.kind === 'gke' && !!w.iam[ns + '/' + sa];
        proxy = { ok };
        cs.logs = ['Authorizing with Application Default Credentials', 'Listening on 127.0.0.1:5432', 'The proxy has started successfully and is ready for new connections!'];
        if (!ok) {
          cs.logs.push(
            c.kind === 'gke'
              ? 'failed to connect to instance: googleapi: Error 403: boss::NOT_AUTHORIZED: Not authorized to access resource. Possibly missing permission cloudsql.instances.connect（目前身分：KSA ' + ns + '/' + sa + '）'
              : 'failed to connect to instance: could not find default credentials'
          );
        }
      }
      st.cs[x.name] = cs;
      ev('Normal', 'Started', 'Started container ' + x.name);
    }

    // 6. 主容器
    for (const x of mains) {
      const meta = metas[x.name];
      const app = APPS[meta.app];
      const env = envs[x.name] || {};
      const crash = (reason, exitCode, logs, message) => {
        st.cs[x.name] = { ready: false, state: 'Waiting', reason: 'CrashLoopBackOff', lastState: { reason, exitCode, message }, logs, prev: logs };
        st.crash = true;
        ev('Normal', 'Pulled', 'Container image "' + x.image + '" already present on machine');
        ev('Warning', 'BackOff', 'Back-off restarting failed container ' + x.name + ' in pod ' + podName);
      };
      const base = app.logs ? app.logs(env) : [];
      const cmd = x.command ? x.command.concat(x.args || []) : null;
      if (cmd && !app.bins.includes(cmd[0])) {
        const msg = 'failed to create containerd task: failed to create shim task: OCI runtime create failed: exec: "' + cmd[0] + '": executable file not found in $PATH';
        crash('StartError', 128, [], msg);
        ev('Warning', 'Failed', 'Error: ' + msg);
        continue;
      }
      if (cmd && app.okCmd && cmd.join(' ') !== app.okCmd && cmd[0] !== 'sh') {
        crash('Error', 1, app.cmdError(cmd).split('\n'));
        continue;
      }
      if (meta.bug === 'crash') {
        crash('Error', 1, [base[0], meta.msg || 'Error: 啟動失敗'].filter(Boolean));
        continue;
      }
      const missing = (app.requiredEnv || []).find((k) => !env[k]);
      if (missing) {
        crash('Error', 1, ['Error: missing required env ' + missing, '    at loadConfig (/app/config.js:12:11)']);
        continue;
      }
      const lim = parseMem(((x.resources || {}).limits || {}).memory);
      if (lim && lim < app.mem) {
        crash('OOMKilled', 137, base.slice(0, 1));
        continue;
      }
      if (app.needsDb) {
        const m = String(env.DATABASE_URL).match(/^postgres(?:ql)?:\/\/(?:[^@/]*@)?([^:/]+)(?::(\d+))?/);
        let dbErr = null;
        if (!m) dbErr = 'Error: invalid DATABASE_URL';
        else if (m[1] === '127.0.0.1' || m[1] === 'localhost') {
          if (!proxy) dbErr = 'Error: connect ECONNREFUSED 127.0.0.1:5432';
          else if (!proxy.ok) dbErr = 'Error: Connection terminated unexpectedly（127.0.0.1:5432 有程式在聽，但連線被中斷）';
        } else {
          const host = m[1].split('.')[0];
          const svc = getRes(c, 'Service', ns, host);
          if (!svc) dbErr = 'Error: getaddrinfo ENOTFOUND ' + m[1];
          else if (!endpoints(c, svc).length) dbErr = 'Error: connect ECONNREFUSED ' + m[1] + ':5432';
        }
        if (dbErr) {
          crash('Error', 1, [base[0], dbErr, '    at connectDb (/app/db.js:8:9)']);
          continue;
        }
      }
      const live = probeResult(spec, x, app, x.livenessProbe, env, meta);
      if (live) {
        crash('Error', 137, base);
        ev('Warning', 'Unhealthy', 'Liveness probe failed: ' + live);
        ev('Normal', 'Killing', 'Container ' + x.name + ' failed liveness probe, will be restarted');
        continue;
      }
      ev('Normal', 'Pulled', 'Container image "' + x.image + '" already present on machine');
      ev('Normal', 'Created', 'Created container ' + x.name);
      ev('Normal', 'Started', 'Started container ' + x.name);
      const ready = probeResult(spec, x, app, x.readinessProbe, env, meta);
      st.cs[x.name] = { ready: !ready, state: 'Running', logs: base, prev: null };
      if (ready) ev('Warning', 'Unhealthy', 'Readiness probe failed: ' + ready);
    }
    st.readyCount = all.filter((x) => st.cs[x.name] && st.cs[x.name].ready).length;
    st.ready = st.readyCount === st.total;
    if (st.crash) st.status = 'CrashLoopBackOff';
    return st;
  }

  // ---------- Deployment 控制器 ----------
  function noteRevision(dep) {
    dep._revs = dep._revs || [];
    dep._revCounter = dep._revCounter || 0;
    const tpl = clean(dep.spec.template);
    const h = hashName(dep.metadata.name + JSON.stringify(tpl));
    const last = dep._revs[dep._revs.length - 1];
    if (last && last.hash === h) return;
    const i = dep._revs.findIndex((r) => r.hash === h);
    if (i >= 0) dep._revs.splice(i, 1);
    dep._revs.push({ rev: ++dep._revCounter, hash: h, template: tpl });
  }
  function pct(v, n, up) {
    if (v == null) return null;
    if (typeof v === 'string' && v.endsWith('%')) {
      const x = (parseFloat(v) / 100) * n;
      return up ? Math.ceil(x) : Math.floor(x);
    }
    return Number(v) || 0;
  }
  function reconcile(w, c) {
    if (!c.started) return;
    for (let pass = 0; pass < 3; pass++) {
      for (const dep of list(c, 'Deployment')) {
        noteRevision(dep);
        const ns = dep.metadata.namespace;
        const name = dep.metadata.name;
        const replicas = dep.spec.replicas == null ? 1 : Number(dep.spec.replicas);
        const cr = dep._revs[dep._revs.length - 1];
        const sa = cr.template.spec.serviceAccountName;
        let desired;
        dep._failed = null;
        if (sa && sa !== 'default' && !getRes(c, 'ServiceAccount', ns, sa)) {
          desired = [];
          dep._failed = 'Error creating: pods "' + name + '-' + cr.hash + '-" is forbidden: error looking up service account ' + ns + '/' + sa + ': serviceaccount "' + sa + '" not found';
        } else if (evalPod(w, c, ns, cr.template.spec, null).ready) {
          dep._stable = cr.hash;
          desired = [{ rev: cr, n: replicas }];
        } else {
          const stable = dep._stable && dep._stable !== cr.hash && dep._revs.find((r) => r.hash === dep._stable);
          if (stable && evalPod(w, c, ns, stable.template.spec, null).ready) {
            const ru = (dep.spec.strategy || {}).rollingUpdate || {};
            const mu = pct(ru.maxUnavailable == null ? '25%' : ru.maxUnavailable, replicas, false);
            const surge = pct(ru.maxSurge == null ? '25%' : ru.maxSurge, replicas, true);
            desired = [
              { rev: stable, n: Math.max(0, replicas - mu) },
              { rev: cr, n: Math.min(replicas, surge + mu) },
            ];
          } else desired = [{ rev: cr, n: replicas }];
        }
        const mine = c.pods.filter((p) => p.ns === ns && p.owner === name);
        const keep = [];
        for (const d of desired) {
          const have = mine.filter((p) => p.hash === d.rev.hash).slice(0, d.n);
          keep.push(...have);
          for (let i = have.length; i < d.n; i++) {
            const pod = {
              name: name + '-' + d.rev.hash + '-' + suffix5(w),
              ns,
              owner: name,
              hash: d.rev.hash,
              spec: d.rev.template.spec,
              labels: (d.rev.template.metadata || {}).labels || {},
              ip: (c.kind === 'orb' ? '192.168.194.' : '10.8.0.') + c.ipSeq++,
              created: w.tick,
              restarts: 0,
              st: null,
              env: null,
            };
            keep.push(pod);
          }
        }
        c.pods = c.pods.filter((p) => !(p.ns === ns && p.owner === name)).concat(keep);
      }
      const owners = {};
      for (const d of list(c, 'Deployment')) owners[d.metadata.namespace + '/' + d.metadata.name] = true;
      c.pods = c.pods.filter((p) => owners[p.ns + '/' + p.owner]);
      for (const pod of c.pods) {
        pod.st = evalPod(w, c, pod.ns, pod.spec, pod);
        if (pass === 2 && pod.st.crash) pod.restarts = Math.min(pod.restarts < 3 ? 3 : pod.restarts + 1, 99);
      }
    }
  }
  function depStatus(c, dep) {
    const ns = dep.metadata.namespace;
    const pods = c.pods.filter((p) => p.ns === ns && p.owner === dep.metadata.name);
    const cr = (dep._revs || [])[dep._revs ? dep._revs.length - 1 : 0];
    const replicas = dep.spec.replicas == null ? 1 : Number(dep.spec.replicas);
    const updated = pods.filter((p) => cr && p.hash === cr.hash);
    const ready = pods.filter((p) => p.st && p.st.ready);
    return {
      replicas,
      pods,
      updated: updated.length,
      ready: ready.length,
      current: cr,
      done: updated.length === replicas && pods.length === replicas && updated.every((p) => p.st && p.st.ready),
    };
  }

  // ---------- 網路 ----------
  function endpoints(c, svc) {
    const ns = svc.metadata.namespace;
    const sel = (svc.spec || {}).selector;
    if (!sel || !Object.keys(sel).length) return [];
    const p = ((svc.spec || {}).ports || [])[0] || {};
    const tp = p.targetPort == null ? p.port : p.targetPort;
    const out = [];
    for (const pod of c.pods) {
      if (pod.ns !== ns || !matchLabels(pod.labels, sel) || !pod.st || !pod.st.ready) continue;
      const port = typeof tp === 'string' && !/^\d+$/.test(tp) ? namedPort(pod.spec, tp) : Number(tp);
      if (port) out.push({ pod, ip: pod.ip, port });
    }
    return out;
  }
  function podHttp(w, c, ep, path) {
    for (const x of ep.pod.spec.containers || []) {
      const im = pullImage(w, c, x);
      if (!im.ok) continue;
      const app = APPS[im.meta.app];
      if (app.port === ep.port) {
        if (!app.http) return { code: 0, err: 'Empty reply from server（對方不是 HTTP 服務）' };
        const r = app.http(path, (ep.pod.env || {})[x.name] || {}, im.meta);
        return Object.assign({ app: im.meta.app, pod: ep.pod.name }, r);
      }
    }
    return { code: 0, err: 'Connection refused（Pod 的 ' + ep.port + ' 埠沒有程式在聽，檢查 targetPort）' };
  }
  function svcRequest(w, c, ns, name, port, path) {
    const svc = getRes(c, 'Service', ns, name);
    if (!svc) return { code: 0, err: 'Could not resolve host: ' + name };
    const sp = ((svc.spec || {}).ports || [])[0] || {};
    if (port != null && Number(port) !== Number(sp.port)) return { code: 0, err: 'Connection refused（Service ' + name + ' 開的是 ' + sp.port + ' 埠）' };
    const eps = endpoints(c, svc);
    if (!eps.length) return { code: 0, err: 'Connection refused（Service ' + name + ' 目前沒有任何 endpoint）' };
    return podHttp(w, c, eps[0], path);
  }
  function gatewayInfo(c, gw) {
    const cls = (gw.spec || {}).gatewayClassName;
    const programmed = GATEWAY_CLASSES[c.kind].includes(cls);
    return { cls, programmed, address: programmed ? (c.kind === 'orb' ? '198.19.249.2' : GKE_LB_IP) : '' };
  }
  function routeMatch(rule, path) {
    let best = -1;
    const ms = rule.matches && rule.matches.length ? rule.matches : [{ path: { type: 'PathPrefix', value: '/' } }];
    for (const m of ms) {
      const p = m.path || { type: 'PathPrefix', value: '/' };
      const v = p.value || '/';
      if (p.type === 'Exact') {
        if (path === v) best = Math.max(best, 10000 + v.length);
      } else {
        const b = v.replace(/\/+$/, '');
        if (b === '' || path === b || path.startsWith(b + '/')) best = Math.max(best, b.length);
      }
    }
    return best;
  }
  function hcPath(c, ns, svcName) {
    const pol = list(c, 'HealthCheckPolicy', ns).find((p) => {
      const t = (p.spec || {}).targetRef || {};
      return t.kind === 'Service' && t.name === svcName;
    });
    const cfg = pol && ((pol.spec.default || {}).config || {});
    const h = cfg && (cfg.httpHealthCheck || cfg.httpsHealthCheck || {});
    return (h && h.requestPath) || '/';
  }
  // 每條路由規則的後端狀態，視覺化面板與 curl 共用。
  function backendHealth(w, c, ns, ref) {
    const svc = getRes(c, 'Service', ns, ref.name);
    if (!svc) return { ok: false, why: '找不到 Service ' + ref.name };
    const eps = endpoints(c, svc);
    if (!eps.length) return { ok: false, why: 'Service 沒有 endpoint' };
    if (c.kind === 'gke') {
      const path = hcPath(c, ns, ref.name);
      if (!eps.some((ep) => podHttp(w, c, ep, path).code === 200)) return { ok: false, why: 'LB 健康檢查 ' + path + ' 沒回 200', hc: path };
      return { ok: true, hc: path };
    }
    return { ok: true };
  }
  function gatewayRequest(w, c, path) {
    const gws = list(c, 'Gateway').filter((g) => gatewayInfo(c, g).programmed);
    if (!gws.length) return { code: 0, err: c.kind === 'orb' ? 'Could not resolve host（叢集裡沒有可用的 Gateway）' : 'Connection refused' };
    let best = null;
    for (const gw of gws) {
      const ns = gw.metadata.namespace;
      for (const rt of list(c, 'HTTPRoute', ns)) {
        if (!((rt.spec || {}).parentRefs || []).some((p) => p.name === gw.metadata.name)) continue;
        for (const rule of rt.spec.rules || []) {
          const score = routeMatch(rule, path);
          if (score >= 0 && (!best || score > best.score)) best = { score, rule, ns };
        }
      }
    }
    if (!best) return { code: 404, body: c.kind === 'orb' ? '404 page not found' : 'fault filter abort', via: 'gateway' };
    const ref = (best.rule.backendRefs || [])[0];
    if (!ref) return { code: 500, body: 'no backendRefs', via: 'gateway' };
    const h = backendHealth(w, c, best.ns, ref);
    if (!h.ok) return { code: 503, body: c.kind === 'orb' ? 'no available server' : 'no healthy upstream', via: 'gateway', why: h.why };
    return svcRequest(w, c, best.ns, ref.name, ref.port, path);
  }
  function httpGet(w, url, from) {
    const m = String(url).match(/^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/);
    if (!m) return { code: 0, err: 'URL 格式不對' };
    if (m[1] === 'https') return { code: 0, err: '模擬器只支援 http://' };
    const host = m[2];
    const port = m[3] ? Number(m[3]) : null;
    const path = (m[4] || '/').split('?')[0];
    if (from) {
      const parts = host.split('.');
      return svcRequest(w, from.c, parts[1] || from.ns, parts[0], port == null ? 80 : port, path);
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      const f = w.forwards[port];
      if (!f) return { code: 0, err: 'Failed to connect to localhost port ' + port + ': Connection refused' };
      const c = w.clusters[f.ctx];
      if (f.kind === 'svc') return svcRequest(w, c, f.ns, f.name, f.port, path);
      const pod = c.pods.find((p) => p.ns === f.ns && p.name === f.name);
      if (!pod || !pod.st || pod.st.phase !== 'Running') return { code: 0, err: 'Connection refused' };
      return podHttp(w, c, { pod, port: Number(f.port) }, path);
    }
    const orb = w.clusters.orbstack;
    if (/\.k8s\.orb\.local$/.test(host)) {
      if (!orb.started) return { code: 0, err: 'Could not resolve host: ' + host };
      return gatewayRequest(w, orb, path);
    }
    if (host === GKE_LB_IP) return gatewayRequest(w, w.clusters['gke-staging'], path);
    const sm = host.match(/^([^.]+)\.([^.]+)\.svc(?:\.cluster\.local)?$/);
    if (sm) {
      if (w.ctx !== 'orbstack')
        return { code: 0, err: 'Could not resolve host: ' + host + '\n💡 GKE 的叢集內部 DNS 從你的 Mac 連不到（OrbStack 才有這個便利）。改用 kubectl port-forward 或 kubectl exec。' };
      if (!orb.started) return { code: 0, err: 'Could not resolve host: ' + host };
      return svcRequest(w, orb, sm[2], sm[1], port == null ? 80 : port, path);
    }
    return { code: 0, err: 'Could not resolve host: ' + host };
  }

  // ---------- GKE Autopilot 計費（模擬點數，不是真實價格） ----------
  function costOf(c) {
    const rows = [];
    let total = 0;
    for (const pod of c.pods) {
      let cpu = 0;
      let mem = 0;
      let defaulted = false;
      const xs = (pod.spec.containers || []).concat((pod.spec.initContainers || []).filter((x) => x.restartPolicy === 'Always'));
      for (const x of xs) {
        const r = (x.resources || {}).requests || (x.resources || {}).limits;
        if (!r || (r.cpu == null && r.memory == null)) {
          cpu += 0.5;
          mem += 2048;
          defaulted = true;
        } else {
          cpu += Math.max(parseCpu(r.cpu), 0.25);
          mem += Math.max(parseMem(r.memory), 512);
        }
      }
      const points = cpu * 30 + (mem / 1024) * 4;
      total += points;
      rows.push({ pod: pod.name, ns: pod.ns, cpu, mem, points, defaulted });
    }
    return { total: Math.round(total * 10) / 10, rows };
  }

  // ---------- YAML／Kustomize ----------
  function loadDocs(text, src) {
    try {
      return yaml.loadAll(text).filter((d) => d && typeof d === 'object');
    } catch (e) {
      const line = e.mark ? e.mark.line + 1 : '?';
      throw new Error('error: error parsing ' + src + ': error converting YAML to JSON: yaml: line ' + line + ': ' + (e.reason || e.message));
    }
  }
  function mergePatch(target, patch) {
    for (const k of Object.keys(patch)) {
      const pv = patch[k];
      const tv = target[k];
      if (Array.isArray(pv) && Array.isArray(tv) && pv.every((x) => x && typeof x === 'object' && 'name' in x)) {
        for (const item of pv) {
          const t = tv.find((x) => x && x.name === item.name);
          if (t) mergePatch(t, item);
          else tv.push(clone(item));
        }
      } else if (pv && typeof pv === 'object' && !Array.isArray(pv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
        mergePatch(tv, pv);
      } else target[k] = clone(pv);
    }
    return target;
  }
  const K_FIELDS = ['apiVersion', 'kind', 'metadata', 'namespace', 'resources', 'patches', 'images'];
  function kbuild(w, dir) {
    dir = normPath(dir);
    const kf = w.files[dir + '/kustomization.yaml'];
    if (kf == null) throw new Error("error: unable to find one of 'kustomization.yaml', 'kustomization.yml' or 'Kustomization' in directory '" + dir + "'");
    const k = loadDocs(kf, dir + '/kustomization.yaml')[0] || {};
    for (const f of Object.keys(k)) {
      if (!K_FIELDS.includes(f)) {
        const known = ['configMapGenerator', 'secretGenerator', 'labels', 'namePrefix', 'nameSuffix', 'replicas', 'components'];
        throw new Error(known.includes(f) ? 'error: 模擬器尚未支援 kustomization 的 ' + f + ' 欄位（真的 kustomize 有支援）' : 'error: invalid Kustomization: json: unknown field "' + f + '"');
      }
    }
    let objs = [];
    for (const r of k.resources || []) {
      const p = normPath(dir + '/' + r);
      if (w.files[p] != null) objs.push(...loadDocs(w.files[p], p));
      else if (w.files[p + '/kustomization.yaml'] != null) objs.push(...kbuild(w, p));
      else throw new Error("error: accumulating resources: accumulation err='accumulating resources from '" + r + "': evalsymlink failure on '" + p + "' : lstat " + p + ': no such file or directory');
    }
    objs = clone(objs);
    for (const pt of k.patches || []) {
      let docs;
      if (pt.path) {
        const p = normPath(dir + '/' + pt.path);
        if (w.files[p] == null) throw new Error('error: patch file not found: ' + p);
        docs = loadDocs(w.files[p], p);
      } else if (pt.patch) docs = loadDocs(pt.patch, 'inline patch');
      else throw new Error('error: patches 的每一項都需要 path 或 patch');
      for (const d of docs) {
        const t = objs.find((o) => o.kind === d.kind && o.metadata && d.metadata && o.metadata.name === d.metadata.name);
        if (!t) throw new Error('error: no matches for Id ' + d.kind + '/' + ((d.metadata || {}).name || '') + '; failed to find unique target for patch');
        mergePatch(t, d);
      }
    }
    for (const im of k.images || []) {
      for (const o of objs) {
        if (o.kind !== 'Deployment') continue;
        const spec = ((o.spec || {}).template || {}).spec || {};
        for (const x of (spec.containers || []).concat(spec.initContainers || [])) {
          const pi = parseImage(x.image || '');
          if (pi.name !== im.name) continue;
          const hasTag = /:[^/]+$/.test(x.image);
          x.image = (im.newName || pi.name) + (im.newTag != null ? ':' + im.newTag : hasTag ? ':' + pi.tag : '');
        }
      }
    }
    if (k.namespace) {
      for (const o of objs) if (KINDS[o.kind] && !KINDS[o.kind].cluster) (o.metadata = o.metadata || {}).namespace = k.namespace;
    }
    return objs;
  }

  // ---------- apply／delete ----------
  function noMatch(o, src) {
    return 'error: resource mapping not found for name: "' + ((o.metadata || {}).name || '') + '" namespace: "" from "' + src + '": no matches for kind "' + o.kind + '" in version "' + o.apiVersion + '"\nensure CRDs are installed first';
  }
  function validate(c, o) {
    const name = o.metadata.name;
    if (o.kind === 'Deployment') {
      const spec = o.spec || {};
      const sel = (spec.selector || {}).matchLabels;
      const tpl = spec.template || {};
      const labels = (tpl.metadata || {}).labels || {};
      if (!sel || !Object.keys(sel).length) return 'The Deployment "' + name + '" is invalid: spec.selector: Required value';
      if (!matchLabels(labels, sel)) return 'The Deployment "' + name + '" is invalid: spec.template.metadata.labels: Invalid value: ' + JSON.stringify(labels) + ': `selector` does not match template `labels`';
      const xs = (tpl.spec || {}).containers;
      if (!Array.isArray(xs) || !xs.length) return 'The Deployment "' + name + '" is invalid: spec.template.spec.containers: Required value';
      for (const x of xs.concat((tpl.spec || {}).initContainers || [])) {
        if (!x || !x.name) return 'The Deployment "' + name + '" is invalid: spec.template.spec.containers[].name: Required value';
        if (!x.image) return 'The Deployment "' + name + '" is invalid: spec.template.spec.containers[' + x.name + '].image: Required value';
      }
    }
    if (o.kind === 'Service' && !(((o.spec || {}).ports || []).length)) return 'The Service "' + name + '" is invalid: spec.ports: Required value';
    return null;
  }
  function applyObjs(w, c, objs, opt) {
    opt = opt || {};
    const lines = [];
    let ok = true;
    const sorted = objs.filter((o) => o.kind === 'Namespace').concat(objs.filter((o) => o.kind !== 'Namespace'));
    for (const raw of sorted) {
      const o = clone(raw);
      const K = KINDS[o.kind];
      if (!K || K.api !== o.apiVersion || (K.gkeOnly && c.kind !== 'gke')) {
        lines.push(noMatch(o, opt.src || 'STDIN'));
        ok = false;
        continue;
      }
      o.metadata = o.metadata || {};
      if (!o.metadata.name) {
        lines.push('error: error validating "' + (opt.src || 'STDIN') + '": error validating data: [metadata.name: Required value]');
        ok = false;
        continue;
      }
      const ns = K.cluster ? '' : o.metadata.namespace || opt.ns || 'default';
      if (!K.cluster) {
        o.metadata.namespace = ns;
        if (!c.res[key('Namespace', '', ns)]) {
          lines.push('Error from server (NotFound): error when creating "' + (opt.src || 'STDIN') + '": namespaces "' + ns + '" not found');
          ok = false;
          continue;
        }
      }
      const bad = validate(c, o);
      if (bad) {
        lines.push(bad);
        ok = false;
        continue;
      }
      if (o.kind === 'Deployment' && o.spec.replicas == null) o.spec.replicas = 1;
      const k = key(o.kind, ns, o.metadata.name);
      const old = c.res[k];
      let verb = 'created';
      if (old) {
        if (o.kind === 'Deployment' && JSON.stringify(old.spec.selector) !== JSON.stringify(o.spec.selector)) {
          lines.push('The Deployment "' + o.metadata.name + '" is invalid: spec.selector: Invalid value: field is immutable');
          ok = false;
          continue;
        }
        verb = JSON.stringify(clean(old)) === JSON.stringify(o) ? 'unchanged' : 'configured';
        for (const f of Object.keys(old)) if (f[0] === '_') o[f] = old[f];
      } else {
        o._created = w.tick;
        if (o.kind === 'Service') o._ip = (c.kind === 'orb' ? '192.168.194.' : '10.12.0.') + (100 + c.ipSeq++);
      }
      c.res[k] = o;
      lines.push(K.out + '/' + o.metadata.name + ' ' + verb + (opt.dry ? ' (server dry run)' : ''));
    }
    reconcile(w, c);
    return { ok, lines };
  }
  function deleteRes(w, c, kind, ns, name) {
    const K = KINDS[kind];
    const k = key(kind, K.cluster ? '' : ns, name);
    if (!c.res[k]) return false;
    delete c.res[k];
    if (kind === 'Namespace') {
      for (const rk of Object.keys(c.res)) if (c.res[rk].metadata.namespace === name) delete c.res[rk];
      c.pods = c.pods.filter((p) => p.ns !== name);
    }
    reconcile(w, c);
    return true;
  }

  G.sim = {
    AR_HOST, AR_REPO, GKE_LB_IP, KINDS, GATEWAY_CLASSES, APPS,
    key, clone, clean, b64e, b64d, parseCpu, parseMem, parseImage, matchLabels, normPath,
    newWorld, cur, list, getRes, nodeName, secretData,
    reconcile, depStatus, noteRevision, evalPod,
    endpoints, gatewayInfo, backendHealth, hcPath, httpGet, costOf,
    loadDocs, kbuild, applyObjs, deleteRes, yaml,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
