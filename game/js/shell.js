// 模擬終端機：把一行指令轉成對模擬叢集的操作，輸出盡量貼近真實工具。
(function (root) {
  'use strict';
  const G = (root.K8sGame = root.K8sGame || {});
  const S = G.sim;
  const yaml = S.yaml;

  const VIRTUAL = {
    pod: ['po', 'pod', 'pods'],
    rs: ['rs', 'replicaset', 'replicasets'],
    endpointslice: ['endpointslice', 'endpointslices', 'ep', 'endpoints'],
    event: ['ev', 'event', 'events'],
    node: ['no', 'node', 'nodes'],
    gatewayclass: ['gc', 'gatewayclass', 'gatewayclasses'],
    all: ['all'],
  };
  const VALUE_FLAGS = ['n', 'namespace', 'o', 'output', 'l', 'selector', 'f', 'filename', 'k', 'kustomize', 'c', 'container', 'replicas', 'from-literal', 'to-revision', 'revision', 'tail', 't', 'tag', 'image', 'type'];

  class Fail extends Error {}
  const fail = (msg) => {
    throw new Fail(msg);
  };

  function tokenize(line) {
    const out = [];
    let cur = '';
    let q = null;
    let has = false;
    for (const ch of line) {
      if (q) {
        if (ch === q) q = null;
        else cur += ch;
      } else if (ch === '"' || ch === "'") {
        q = ch;
        has = true;
      } else if (/\s/.test(ch)) {
        if (cur || has) out.push(cur);
        cur = '';
        has = false;
      } else cur += ch;
    }
    if (cur || has) out.push(cur);
    return out;
  }
  function parseArgs(tokens) {
    const pos = [];
    const flags = {};
    const multi = {};
    let rest = null;
    const set = (k, v) => {
      flags[k] = v;
      (multi[k] = multi[k] || []).push(v);
    };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '--') {
        rest = tokens.slice(i + 1);
        break;
      }
      if (t.startsWith('--')) {
        const eq = t.indexOf('=');
        if (eq > 0) set(t.slice(2, eq), t.slice(eq + 1));
        else if (VALUE_FLAGS.includes(t.slice(2)) && i + 1 < tokens.length) set(t.slice(2), tokens[++i]);
        else set(t.slice(2), true);
      } else if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) {
        const name = t.slice(1);
        if (VALUE_FLAGS.includes(name) && i + 1 < tokens.length) set(name, tokens[++i]);
        else for (const ch of name) set(ch, true);
      } else pos.push(t);
    }
    return { pos, flags, multi, rest };
  }
  function rtype(t) {
    const s = String(t).toLowerCase();
    for (const v of Object.keys(VIRTUAL)) if (VIRTUAL[v].includes(s)) return v;
    for (const k of Object.keys(S.KINDS)) if (S.KINDS[k].names.includes(s)) return k;
    fail('error: the server doesn\'t have a resource type "' + t + '"');
  }
  const plural = (t) => ({ pod: 'pods', rs: 'replicasets.apps', endpointslice: 'endpointslices.discovery.k8s.io', event: 'events', node: 'nodes', gatewayclass: 'gatewayclasses.gateway.networking.k8s.io' }[t] || S.KINDS[t].names[S.KINDS[t].names.length - 1]);
  function table(rows) {
    const w = [];
    for (const r of rows) r.forEach((cell, i) => (w[i] = Math.max(w[i] || 0, String(cell).length)));
    return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? String(cell) : String(cell).padEnd(w[i] + 3))).join('').trimEnd()).join('\n');
  }
  function age(w, created) {
    const s = Math.max(1, (w.tick - (created || 0)) * 11 + 3);
    return s < 120 ? s + 's' : Math.floor(s / 60) + 'm';
  }
  const labelStr = (l) => Object.keys(l || {}).map((k) => k + '=' + l[k]).join(',') || '<none>';
  function parseSel(s) {
    const o = {};
    for (const p of String(s).split(',')) {
      const i = p.indexOf('=');
      if (i > 0) o[p.slice(0, i)] = p.slice(i + 1).replace(/^=/, '');
    }
    return o;
  }
  function podObj(p) {
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: p.name, namespace: p.ns, labels: p.labels, ownerReferences: [{ kind: 'ReplicaSet', name: p.owner + '-' + p.hash }] },
      spec: p.spec,
      status: {
        phase: p.st.phase,
        podIP: p.ip,
        containerStatuses: Object.keys(p.st.cs).map((name) => {
          const s = p.st.cs[name];
          const o = { name, ready: s.ready, restartCount: s.lastState ? p.restarts : 0, state: s.state === 'Running' ? { running: {} } : { waiting: { reason: s.reason } } };
          if (s.lastState) o.lastState = { terminated: s.lastState };
          return o;
        }),
      },
    };
  }

  // ---------- kubectl get ----------
  function collect(x, type, ns) {
    const { w, c } = x;
    const wide = x.flags.o === 'wide';
    const inNs = (o) => ns == null || o.metadata.namespace === ns;
    switch (type) {
      case 'pod':
        return {
          head: ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'].concat(wide ? ['IP', 'NODE'] : []),
          rows: c.pods
            .filter((p) => ns == null || p.ns === ns)
            .map((p) => ({ ns: p.ns, name: p.name, labels: p.labels, obj: podObj(p), cols: [p.name, p.st.readyCount + '/' + p.st.total, p.st.status, p.st.crash ? p.restarts : 0, age(w, p.created)].concat(wide ? [p.ip, S.nodeName(c)] : []) })),
        };
      case 'Deployment':
        return {
          head: ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'],
          rows: S.list(c, 'Deployment').filter(inNs).map((d) => {
            const s = S.depStatus(c, d);
            return { ns: d.metadata.namespace, name: d.metadata.name, labels: d.metadata.labels, obj: S.clean(d), cols: [d.metadata.name, s.ready + '/' + s.replicas, s.updated, s.ready, age(w, d._created)] };
          }),
        };
      case 'rs': {
        const rows = [];
        for (const d of S.list(c, 'Deployment').filter(inNs)) {
          const s = S.depStatus(c, d);
          for (const r of d._revs || []) {
            const pods = s.pods.filter((p) => p.hash === r.hash);
            const name = d.metadata.name + '-' + r.hash;
            rows.push({ ns: d.metadata.namespace, name, obj: { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name, namespace: d.metadata.namespace } }, cols: [name, pods.length, pods.length, pods.filter((p) => p.st.ready).length, age(w, d._created)] });
          }
        }
        return { head: ['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE'], rows };
      }
      case 'Service':
        return {
          head: ['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE'].concat(wide ? ['SELECTOR'] : []),
          rows: S.list(c, 'Service').filter(inNs).map((s) => ({
            ns: s.metadata.namespace, name: s.metadata.name, labels: s.metadata.labels, obj: S.clean(s),
            cols: [s.metadata.name, s.spec.type || 'ClusterIP', s._ip, '<none>', s.spec.ports.map((p) => p.port + '/' + (p.protocol || 'TCP')).join(','), age(w, s._created)].concat(wide ? [labelStr(s.spec.selector)] : []),
          })),
        };
      case 'endpointslice':
        return {
          head: ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'],
          rows: S.list(c, 'Service').filter(inNs).map((s) => {
            const eps = S.endpoints(c, s);
            const name = s.metadata.name + '-' + (S.key('x', '', s.metadata.name).length % 9) + 'x7kq';
            return {
              ns: s.metadata.namespace, name, labels: { 'kubernetes.io/service-name': s.metadata.name },
              obj: { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', metadata: { name, namespace: s.metadata.namespace, labels: { 'kubernetes.io/service-name': s.metadata.name } }, endpoints: eps.map((e) => ({ addresses: [e.ip], conditions: { ready: true }, targetRef: { kind: 'Pod', name: e.pod.name } })) },
              cols: [name, 'IPv4', eps.length ? eps[0].port : '<unset>', eps.length ? eps.map((e) => e.ip).join(',') : '<unset>', age(w, s._created)],
            };
          }),
        };
      case 'ConfigMap':
        return { head: ['NAME', 'DATA', 'AGE'], rows: S.list(c, 'ConfigMap').filter(inNs).map((o) => ({ ns: o.metadata.namespace, name: o.metadata.name, obj: S.clean(o), cols: [o.metadata.name, Object.keys(o.data || {}).length, age(w, o._created)] })) };
      case 'Secret':
        return {
          head: ['NAME', 'TYPE', 'DATA', 'AGE'],
          rows: S.list(c, 'Secret').filter(inNs).map((o) => {
            const v = S.clean(o);
            if (v.stringData) {
              v.data = Object.assign({}, v.data);
              for (const k of Object.keys(v.stringData)) v.data[k] = S.b64e(v.stringData[k]);
              delete v.stringData;
            }
            return { ns: o.metadata.namespace, name: o.metadata.name, obj: v, cols: [o.metadata.name, o.type || 'Opaque', Object.keys(S.secretData(o)).length, age(w, o._created)] };
          }),
        };
      case 'ServiceAccount': {
        const rows = S.list(c, 'ServiceAccount').filter(inNs).map((o) => ({ ns: o.metadata.namespace, name: o.metadata.name, obj: S.clean(o), cols: [o.metadata.name, 0, age(w, o._created)] }));
        for (const n of S.list(c, 'Namespace')) if (ns == null || n.metadata.name === ns) rows.unshift({ ns: n.metadata.name, name: 'default', obj: { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default', namespace: n.metadata.name } }, cols: ['default', 0, age(w, n._created)] });
        return { head: ['NAME', 'SECRETS', 'AGE'], rows };
      }
      case 'Namespace':
        return { cluster: true, head: ['NAME', 'STATUS', 'AGE'], rows: S.list(c, 'Namespace').map((o) => ({ name: o.metadata.name, obj: S.clean(o), cols: [o.metadata.name, 'Active', age(w, o._created)] })) };
      case 'Gateway':
        return {
          head: ['NAME', 'CLASS', 'ADDRESS', 'PROGRAMMED', 'AGE'],
          rows: S.list(c, 'Gateway').filter(inNs).map((o) => {
            const g = S.gatewayInfo(c, o);
            return { ns: o.metadata.namespace, name: o.metadata.name, obj: S.clean(o), cols: [o.metadata.name, g.cls || '', g.address, g.programmed ? 'True' : 'Unknown', age(w, o._created)] };
          }),
        };
      case 'HTTPRoute':
        return { head: ['NAME', 'HOSTNAMES', 'AGE'], rows: S.list(c, 'HTTPRoute').filter(inNs).map((o) => ({ ns: o.metadata.namespace, name: o.metadata.name, obj: S.clean(o), cols: [o.metadata.name, JSON.stringify((o.spec || {}).hostnames || []).replace(/"/g, ''), age(w, o._created)] })) };
      case 'HealthCheckPolicy':
        if (c.kind !== 'gke') fail('error: the server doesn\'t have a resource type "healthcheckpolicy"');
        return { head: ['NAME', 'AGE'], rows: S.list(c, 'HealthCheckPolicy').filter(inNs).map((o) => ({ ns: o.metadata.namespace, name: o.metadata.name, obj: S.clean(o), cols: [o.metadata.name, age(w, o._created)] })) };
      case 'node':
        return { cluster: true, head: ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION'], rows: [{ name: S.nodeName(c), obj: { kind: 'Node', metadata: { name: S.nodeName(c) } }, cols: [S.nodeName(c), 'Ready', c.kind === 'orb' ? 'control-plane,master' : '<none>', age(w, 0), c.kind === 'orb' ? 'v1.37.0+orb1' : 'v1.37.0-gke.100'] }] };
      case 'gatewayclass':
        return { cluster: true, head: ['NAME', 'CONTROLLER', 'ACCEPTED', 'AGE'], rows: S.GATEWAY_CLASSES[c.kind].map((n) => ({ name: n, obj: { kind: 'GatewayClass', metadata: { name: n } }, cols: [n, c.kind === 'orb' ? 'traefik.io/gateway-controller' : 'networking.gke.io/gateway', 'True', age(w, 0)] })) };
      case 'event': {
        const rows = [];
        for (const p of c.pods.filter((p) => ns == null || p.ns === ns)) for (const e of p.st.events) rows.push({ ns: p.ns, name: p.name, cols: [age(w, p.created), e.type, e.reason, 'pod/' + p.name, e.message] });
        for (const d of S.list(c, 'Deployment').filter(inNs)) if (d._failed) rows.push({ ns: d.metadata.namespace, name: d.metadata.name, cols: [age(w, d._created), 'Warning', 'FailedCreate', 'replicaset/' + d.metadata.name, d._failed] });
        return { head: ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'], rows };
      }
    }
    fail('error: 模擬器不支援 get ' + type);
  }
  function kGet(x) {
    const { pos, flags } = x;
    if (!pos.length) fail('You must specify the type of resource to get. 例如：kubectl get pods');
    let targets = [];
    if (pos[0].includes('/')) targets = pos.map((p) => ({ type: rtype(p.split('/')[0]), names: [p.split('/')[1]] }));
    else targets = pos[0].split(',').map((t) => ({ type: rtype(t), names: pos.slice(1) }));
    if (targets.length === 1 && targets[0].type === 'all') targets = ['pod', 'Service', 'Deployment', 'rs'].map((type) => ({ type, names: [], prefix: true, quiet: true }));
    const sel = flags.l || flags.selector;
    const out = [];
    const objs = [];
    for (const t of targets) {
      const data = collect(x, t.type, x.allNs ? null : x.ns);
      let rows = data.rows;
      for (const n of t.names) if (!rows.some((r) => r.name === n)) fail('Error from server (NotFound): ' + plural(t.type) + ' "' + n + '" not found');
      if (t.names.length) rows = rows.filter((r) => t.names.includes(r.name));
      if (sel) rows = rows.filter((r) => S.matchLabels(r.labels, parseSel(sel)));
      if (!rows.length) {
        if (!t.quiet) out.push(data.cluster || x.allNs ? 'No resources found' : 'No resources found in ' + x.ns + ' namespace.');
        continue;
      }
      if (flags.o === 'yaml' || flags.o === 'json') {
        objs.push(...rows.map((r) => r.obj).filter(Boolean));
        continue;
      }
      if (flags.o === 'name') {
        out.push(rows.map((r) => plural(t.type).replace(/s$/, '') + '/' + r.name).join('\n'));
        continue;
      }
      const pre = t.prefix ? (t.type === 'pod' ? 'pod/' : t.type === 'rs' ? 'replicaset.apps/' : S.KINDS[t.type].out + '/') : '';
      const head = (x.allNs && !data.cluster ? ['NAMESPACE'] : []).concat(data.head, flags['show-labels'] ? ['LABELS'] : []);
      const body = rows.map((r) => (x.allNs && !data.cluster ? [r.ns] : []).concat([pre + r.cols[0]], r.cols.slice(1), flags['show-labels'] ? [labelStr(r.labels)] : []));
      out.push(table([head].concat(body)));
    }
    if (flags.o === 'yaml' || flags.o === 'json') {
      const single = objs.length === 1 && targets.length === 1 && targets[0].names.length === 1;
      const v = single ? objs[0] : { apiVersion: 'v1', kind: 'List', items: objs };
      return flags.o === 'json' ? JSON.stringify(v, null, 2) : yaml.dump(v, { lineWidth: 200, noRefs: true }).trimEnd();
    }
    if (flags.w || flags.watch) out.push('💡 模擬器沒有即時 watch，狀態是立刻算出來的；再下一次 get 就是最新狀態。');
    return out.join('\n\n');
  }

  // ---------- kubectl describe ----------
  function findPod(x, arg) {
    const { c, ns } = x;
    if (!arg) fail('error: 需要指定 Pod 名稱（可以用 Tab 鍵補完，或用 deploy/名稱）');
    const parts = arg.split('/');
    if (parts.length === 2 && rtype(parts[0]) === 'Deployment') {
      const d = S.getRes(c, 'Deployment', ns, parts[1]) || fail('Error from server (NotFound): deployments.apps "' + parts[1] + '" not found');
      const s = S.depStatus(c, d);
      const pods = s.pods.slice().sort((a, b) => (b.hash === s.current.hash) - (a.hash === s.current.hash));
      if (!pods.length) fail('error: deployment "' + parts[1] + '" 目前沒有任何 Pod');
      return { pod: pods[0], note: pods.length > 1 ? 'Found ' + pods.length + ' pods, using pod/' + pods[0].name + '\n' : '' };
    }
    const name = parts.length === 2 ? parts[1] : arg;
    const pod = c.pods.find((p) => p.ns === ns && p.name === name);
    if (!pod) fail('Error from server (NotFound): pods "' + name + '" not found' + (c.pods.some((p) => p.name === name) ? '\n💡 這個 Pod 在別的 namespace，記得加 -n' : ''));
    return { pod, note: '' };
  }
  function probeStr(p) {
    if (!p) return null;
    const h = p.httpGet;
    const t = h ? 'http-get http://:' + h.port + (h.path || '/') : p.tcpSocket ? 'tcp-socket :' + p.tcpSocket.port : 'exec';
    return t + ' delay=' + (p.initialDelaySeconds || 0) + 's timeout=1s period=' + (p.periodSeconds || 10) + 's #success=1 #failure=3';
  }
  function describePod(x, p) {
    const L = [];
    const kv = (k, v, ind) => L.push(' '.repeat(ind || 0) + (k + ':').padEnd(18 - 0) + v);
    kv('Name', p.name);
    kv('Namespace', p.ns);
    kv('Node', S.nodeName(x.c));
    kv('Labels', labelStr(p.labels));
    kv('Status', p.st.phase);
    kv('IP', p.ip);
    kv('Controlled By', 'ReplicaSet/' + p.owner + '-' + p.hash);
    kv('Service Account', p.spec.serviceAccountName || 'default');
    const section = (title, xs) => {
      if (!xs.length) return;
      L.push(title + ':');
      for (const ct of xs) {
        const cs = p.st.cs[ct.name] || { state: 'Waiting', reason: '' };
        L.push('  ' + ct.name + ':');
        const k2 = (k, v) => L.push('    ' + (k + ':').padEnd(16) + v);
        k2('Image', ct.image);
        if ((ct.ports || []).length) k2('Port', ct.ports.map((q) => q.containerPort + '/TCP' + (q.name ? ' (' + q.name + ')' : '')).join(', '));
        if (ct.command) k2('Command', ct.command.join(' '));
        k2('State', cs.state);
        if (cs.state !== 'Running' && cs.reason) L.push('      ' + 'Reason:'.padEnd(14) + cs.reason);
        if (cs.lastState) {
          k2('Last State', 'Terminated');
          L.push('      ' + 'Reason:'.padEnd(14) + cs.lastState.reason);
          if (cs.lastState.message) L.push('      ' + 'Message:'.padEnd(14) + cs.lastState.message);
          L.push('      ' + 'Exit Code:'.padEnd(14) + cs.lastState.exitCode);
        }
        k2('Ready', cs.ready ? 'True' : 'False');
        k2('Restart Count', cs.lastState ? p.restarts : 0);
        const res = ct.resources || {};
        for (const kind of ['limits', 'requests']) {
          if (!res[kind]) continue;
          L.push('    ' + kind[0].toUpperCase() + kind.slice(1) + ':');
          for (const k of Object.keys(res[kind])) L.push('      ' + (k + ':').padEnd(8) + res[kind][k]);
        }
        if (ct.livenessProbe) k2('Liveness', probeStr(ct.livenessProbe));
        if (ct.readinessProbe) k2('Readiness', probeStr(ct.readinessProbe));
        if ((ct.envFrom || []).length) {
          L.push('    Environment Variables from:');
          for (const ef of ct.envFrom) L.push('      ' + (ef.configMapRef ? ef.configMapRef.name + '  ConfigMap' : ef.secretRef.name + '  Secret') + '  Optional: false');
        }
      }
    };
    section('Init Containers', p.spec.initContainers || []);
    section('Containers', p.spec.containers || []);
    L.push('Events:');
    L.push(table([['  Type', 'Reason', 'Age', 'From', 'Message']].concat(p.st.events.map((e) => ['  ' + e.type, e.reason, age(x.w, p.created), e.reason === 'Scheduled' || e.reason === 'FailedScheduling' ? 'default-scheduler' : 'kubelet', e.message]))));
    return L.join('\n');
  }
  function kDescribe(x) {
    const { c, w, pos, ns } = x;
    if (!pos.length) fail('error: You must specify the type of resource to describe. 例如：kubectl describe pod <名稱>');
    let type;
    let name;
    if (pos[0].includes('/')) [type, name] = [rtype(pos[0].split('/')[0]), pos[0].split('/')[1]];
    else [type, name] = [rtype(pos[0]), pos[1]];
    if (type === 'pod') {
      const pods = name ? [findPod(x, name).pod] : c.pods.filter((p) => p.ns === ns);
      if (!pods.length) return 'No resources found in ' + ns + ' namespace.';
      return pods.map((p) => describePod(x, p)).join('\n\n\n');
    }
    if (!S.KINDS[type]) fail('error: 模擬器不支援 describe ' + pos[0]);
    const items = name ? [S.getRes(c, type, ns, name) || fail('Error from server (NotFound): ' + plural(type) + ' "' + name + '" not found')] : S.list(c, type, S.KINDS[type].cluster ? null : ns);
    if (!items.length) return 'No resources found in ' + ns + ' namespace.';
    return items
      .map((o) => {
        const L = [];
        const kv = (k, v) => L.push((k + ':').padEnd(20) + v);
        kv('Name', o.metadata.name);
        if (!S.KINDS[type].cluster) kv('Namespace', o.metadata.namespace);
        if (type === 'Deployment') {
          const s = S.depStatus(c, o);
          const ru = (o.spec.strategy || {}).rollingUpdate || {};
          kv('Selector', labelStr(o.spec.selector.matchLabels));
          kv('Replicas', s.replicas + ' desired | ' + s.updated + ' updated | ' + s.pods.length + ' total | ' + s.ready + ' available | ' + (s.pods.length - s.ready) + ' unavailable');
          kv('StrategyType', 'RollingUpdate');
          kv('RollingUpdateStrategy', (ru.maxUnavailable == null ? '25%' : ru.maxUnavailable) + ' max unavailable, ' + (ru.maxSurge == null ? '25%' : ru.maxSurge) + ' max surge');
          L.push('Pod Template:');
          L.push('  Labels:  ' + labelStr((o.spec.template.metadata || {}).labels));
          L.push('  Containers:');
          for (const ct of o.spec.template.spec.containers) L.push('   ' + ct.name + ':\n    Image:  ' + ct.image);
          kv('NewReplicaSet', o.metadata.name + '-' + s.current.hash + ' (' + s.updated + '/' + s.replicas + ' replicas created)');
          if (o._failed) L.push('Events:\n  Warning  FailedCreate  replicaset-controller  ' + o._failed);
        } else if (type === 'Service') {
          const eps = S.endpoints(c, o);
          const p = o.spec.ports[0];
          kv('Selector', labelStr(o.spec.selector));
          kv('Type', o.spec.type || 'ClusterIP');
          kv('IP', o._ip);
          kv('Port', (p.name || '<unset>') + '  ' + p.port + '/TCP');
          kv('TargetPort', (p.targetPort == null ? p.port : p.targetPort) + '/TCP');
          kv('Endpoints', eps.length ? eps.map((e) => e.ip + ':' + e.port).join(',') : '<none>');
        } else if (type === 'Gateway') {
          const g = S.gatewayInfo(c, o);
          kv('Class', g.cls || '');
          kv('Address', g.address || '<none>');
          L.push('Conditions:');
          L.push(g.programmed ? '  Accepted=True, Programmed=True' : '  Accepted=False  Reason: InvalidParameters  Message: GatewayClass "' + g.cls + '" not found（可用的 class 請看 kubectl get gatewayclass）');
        } else if (type === 'HTTPRoute') {
          kv('Parent Refs', ((o.spec || {}).parentRefs || []).map((p) => p.name).join(',') || '<none>');
          L.push('Rules:');
          for (const r of (o.spec || {}).rules || []) {
            const ref = (r.backendRefs || [])[0] || {};
            const h = S.backendHealth(w, c, o.metadata.namespace, ref);
            L.push('  ' + ((r.matches || [{}]).map((m) => ((m.path || {}).type || 'PathPrefix') + ' ' + ((m.path || {}).value || '/')).join(' | ')).padEnd(22) + '→ ' + ref.name + ':' + ref.port + '   ' + (h.ok ? 'Healthy' + (h.hc ? '（健康檢查 ' + h.hc + '）' : '') : 'Unhealthy：' + h.why));
          }
        } else if (type === 'ConfigMap') {
          L.push('Data\n====');
          for (const k of Object.keys(o.data || {})) L.push(k + ':\n----\n' + o.data[k]);
        } else if (type === 'Secret') {
          kv('Type', o.type || 'Opaque');
          L.push('Data\n====');
          const d = S.secretData(o);
          for (const k of Object.keys(d)) L.push(k + ':  ' + d[k].length + ' bytes');
        } else if (type === 'HealthCheckPolicy') {
          kv('Target', 'Service/' + ((o.spec.targetRef || {}).name || ''));
          kv('Request Path', S.hcPath(c, o.metadata.namespace, (o.spec.targetRef || {}).name));
        }
        return L.join('\n');
      })
      .join('\n\n\n');
  }

  // ---------- 其他 kubectl 子指令 ----------
  function kLogs(x) {
    const { pod, note } = findPod(x, x.pos[0]);
    const cname = x.flags.c || x.flags.container || pod.spec.containers[0].name;
    const cs = pod.st.cs[cname];
    if (!cs) fail('error: container ' + cname + ' is not valid for pod ' + pod.name);
    if (cs.waiting) fail(note + 'Error from server (BadRequest): container "' + cname + '" in pod "' + pod.name + '" is waiting to start: ' + (cs.reason || 'PodInitializing'));
    if (x.flags.previous || x.flags.p) {
      if (!cs.prev) fail(note + 'Error from server (BadRequest): previous terminated container "' + cname + '" in pod "' + pod.name + '" not found');
      return note + cs.prev.join('\n');
    }
    return note + cs.logs.join('\n');
  }
  function kExec(x) {
    const { pod } = findPod(x, x.pos[0]);
    const cname = x.flags.c || pod.spec.containers[0].name;
    const cs = pod.st.cs[cname];
    if (!cs || cs.state !== 'Running') fail('error: Internal error occurred: unable to upgrade connection: container not found ("' + cname + '")\n💡 容器沒在跑的時候進不去，先用 describe／logs 找原因。');
    const cmd = x.rest || [];
    if (!cmd.length) fail('error: you must specify at least one command for the container（格式：kubectl exec POD -- 指令）');
    if (cmd[0] === 'env' || cmd[0] === 'printenv') {
      const env = Object.assign({ HOSTNAME: pod.name, KUBERNETES_SERVICE_HOST: '192.168.194.129' }, (pod.env || {})[cname] || {});
      return Object.keys(env).map((k) => k + '=' + env[k]).join('\n');
    }
    if (cmd[0] === 'wget' || cmd[0] === 'curl') {
      const url = cmd.find((t, i) => i > 0 && !t.startsWith('-'));
      const r = S.httpGet(x.w, url, { c: x.c, ns: pod.ns });
      x.http = Object.assign({ url, path: '/' + (String(url).split('/').slice(3).join('/') || '') }, r);
      if (!r.code) fail(cmd[0] + ': ' + r.err);
      return r.body;
    }
    fail('💡 模擬器的 exec 只支援：env、printenv、wget -qO- <URL>、curl <URL>');
  }
  function depArg(x, verb) {
    let name;
    if (x.pos[0] && x.pos[0].includes('/')) {
      if (rtype(x.pos[0].split('/')[0]) !== 'Deployment') fail('error: 模擬器的 ' + verb + ' 只支援 deployment');
      name = x.pos[0].split('/')[1];
      x.pos = x.pos.slice(1);
    } else if (x.pos.length >= 2) {
      if (rtype(x.pos[0]) !== 'Deployment') fail('error: 模擬器的 ' + verb + ' 只支援 deployment');
      name = x.pos[1];
      x.pos = x.pos.slice(2);
    } else fail('error: 需要指定目標，例如 deploy/frontend');
    return S.getRes(x.c, 'Deployment', x.ns, name) || fail('Error from server (NotFound): deployments.apps "' + name + '" not found');
  }
  function fileObjs(x) {
    const { w, flags } = x;
    const k = flags.k || flags.kustomize;
    if (k) return { objs: S.kbuild(w, k), src: k };
    const f = flags.f || flags.filename;
    if (!f) fail('error: must specify one of -f and -k');
    const p = S.normPath(f);
    if (w.files[p] != null) return { objs: S.loadDocs(w.files[p], p), src: p };
    const inDir = Object.keys(w.files).filter((n) => n.startsWith(p + '/') && !n.slice(p.length + 1).includes('/') && /\.ya?ml$/.test(n) && !/kustomization\.yaml$/.test(n));
    if (!inDir.length) fail('error: the path "' + f + '" does not exist');
    return { objs: [].concat(...inDir.sort().map((n) => S.loadDocs(w.files[n], n))), src: p };
  }
  function kApply(x) {
    const { objs, src } = fileObjs(x);
    if (!objs.length) fail('error: no objects passed to apply');
    const dry = x.flags['dry-run'];
    const w = dry ? structuredClone(x.w) : x.w;
    const r = S.applyObjs(w, S.cur(w), objs, { ns: x.nsFlag, src, dry: !!dry });
    x.ok = r.ok;
    return r.lines.join('\n');
  }
  function kDelete(x) {
    const { w, c, pos, flags, ns } = x;
    const out = [];
    if (flags.f || flags.k || flags.filename || flags.kustomize) {
      for (const o of fileObjs(x).objs) {
        const K = S.KINDS[o.kind];
        if (!K) continue;
        const ons = (o.metadata || {}).namespace || x.nsFlag || 'default';
        out.push(S.deleteRes(w, c, o.kind, ons, o.metadata.name) ? K.out + ' "' + o.metadata.name + '" deleted' : 'Error from server (NotFound): ' + plural(o.kind) + ' "' + o.metadata.name + '" not found');
      }
      return out.join('\n');
    }
    if (!pos.length) fail('error: You must provide one or more resources');
    const targets = pos[0].includes('/') ? pos.map((p) => [rtype(p.split('/')[0]), p.split('/')[1]]) : pos.slice(1).map((n) => [rtype(pos[0]), n]);
    if (!targets.length) fail('error: resource(s) were provided, but no name was specified');
    for (const [type, name] of targets) {
      if (type === 'pod') {
        const i = c.pods.findIndex((p) => p.ns === ns && p.name === name);
        if (i < 0) fail('Error from server (NotFound): pods "' + name + '" not found');
        c.pods.splice(i, 1);
        w.stats.podDeletes++;
        S.reconcile(w, c);
        out.push('pod "' + name + '" deleted');
      } else if (S.KINDS[type]) {
        if (!S.deleteRes(w, c, type, ns, name)) fail('Error from server (NotFound): ' + plural(type) + ' "' + name + '" not found');
        out.push(S.KINDS[type].out + ' "' + name + '" deleted');
      } else fail('error: 模擬器不支援刪除 ' + type);
    }
    return out.join('\n');
  }
  function kRollout(x) {
    const { w, c } = x;
    const sub = x.pos.shift();
    if (!['status', 'history', 'undo', 'restart'].includes(sub)) fail('error: 用法：kubectl rollout status|history|undo|restart deploy/<名稱>');
    const d = depArg(x, 'rollout');
    const name = d.metadata.name;
    if (sub === 'status') {
      const s = S.depStatus(c, d);
      if (s.done) return 'deployment "' + name + '" successfully rolled out';
      x.ok = false;
      let msg;
      if (d._failed) msg = 'Waiting for deployment "' + name + '" rollout to finish: 0 of ' + s.replicas + ' updated replicas are available...\n' + d._failed;
      else if (s.updated < s.replicas) msg = 'Waiting for deployment "' + name + '" rollout to finish: ' + s.updated + ' out of ' + s.replicas + ' new replicas have been updated...';
      else msg = 'Waiting for deployment "' + name + '" rollout to finish: ' + s.pods.filter((p) => p.hash === s.current.hash && p.st.ready).length + ' of ' + s.replicas + ' updated replicas are available...';
      return msg + '\n💡 模擬器：真實環境會一直卡在這裡，直到你按 Ctrl+C 或超過 progressDeadlineSeconds。卡住就代表新版本的 Pod 起不來。';
    }
    if (sub === 'history') {
      const rv = x.flags.revision;
      if (rv) {
        const r = d._revs.find((q) => String(q.rev) === String(rv)) || fail('error: unable to find the specified revision');
        return 'deployment.apps/' + name + ' with revision #' + r.rev + '\nPod Template:\n  Containers:\n' + r.template.spec.containers.map((ct) => '   ' + ct.name + ':\n    Image:  ' + ct.image).join('\n');
      }
      return 'deployment.apps/' + name + '\n' + table([['REVISION', 'CHANGE-CAUSE']].concat(d._revs.map((r) => [r.rev, '<none>']))) + '\n💡 加上 --revision=<編號> 可以看那一版用的映像檔。';
    }
    if (sub === 'undo') {
      const to = x.flags['to-revision'];
      const target = to ? d._revs.find((r) => String(r.rev) === String(to)) : d._revs[d._revs.length - 2];
      if (!target) fail(to ? 'error: unable to find specified revision ' + to + ' in history' : 'error: no rollout history found for deployment "' + name + '"');
      d.spec.template = S.clone(target.template);
      S.reconcile(w, c);
      return 'deployment.apps/' + name + ' rolled back';
    }
    const md = (d.spec.template.metadata = d.spec.template.metadata || {});
    (md.annotations = md.annotations || {})['kubectl.kubernetes.io/restartedAt'] = '2026-11-15T10:00:' + String(w.tick % 60).padStart(2, '0') + 'Z#' + w.tick;
    for (const p of c.pods) if (p.ns === d.metadata.namespace && p.owner === name) p.env = null;
    S.reconcile(w, c);
    return 'deployment.apps/' + name + ' restarted';
  }
  function literals(x) {
    const data = {};
    for (const l of x.multi['from-literal'] || []) {
      const i = String(l).indexOf('=');
      if (i <= 0) fail('error: invalid literal source ' + l + ', expected key=value');
      data[l.slice(0, i)] = l.slice(i + 1);
    }
    return data;
  }
  function kCreate(x) {
    const { w, c, pos } = x;
    if (x.flags.f || x.flags.k) return kApply(x);
    if (!pos.length) fail('error: 用法：kubectl create namespace|secret generic|configmap <名稱> ...');
    const type = pos[0] === 'secret' ? 'Secret' : rtype(pos[0]);
    const name = type === 'Secret' ? pos[2] : pos[1];
    if (type === 'Secret' && pos[1] !== 'generic') fail('error: 模擬器只支援 kubectl create secret generic <名稱> --from-literal=KEY=VALUE');
    if (!name) fail('error: exactly one NAME is required, got 0');
    if (!['Namespace', 'Secret', 'ConfigMap', 'ServiceAccount'].includes(type)) fail('error: 模擬器的 create 只支援 namespace、secret generic、configmap、serviceaccount；其他資源請寫 YAML 再 apply。');
    if (S.getRes(c, type, x.ns, name)) fail('Error from server (AlreadyExists): ' + plural(type) + ' "' + name + '" already exists');
    const o = { apiVersion: 'v1', kind: type, metadata: { name } };
    if (type === 'Secret') {
      o.type = 'Opaque';
      o.data = {};
      const d = literals(x);
      for (const k of Object.keys(d)) o.data[k] = S.b64e(d[k]);
    }
    if (type === 'ConfigMap') o.data = literals(x);
    const r = S.applyObjs(w, c, [o], { ns: x.ns, src: 'create' });
    x.ok = r.ok;
    return r.lines.join('\n');
  }
  function kConfig(x) {
    const { w, pos } = x;
    if (pos[0] === 'current-context') return w.ctx;
    if (pos[0] === 'get-contexts') return table([['CURRENT', 'NAME', 'CLUSTER', 'AUTHINFO', 'NAMESPACE']].concat(Object.keys(w.clusters).map((n) => [n === w.ctx ? '*' : '', n, n === 'orbstack' ? 'orbstack' : 'gke_demo-project_asia-east1_shop', n === 'orbstack' ? 'orbstack' : 'gke_demo-project_asia-east1_shop', ''])));
    if (pos[0] === 'use-context') {
      if (!w.clusters[pos[1]]) fail('error: no context exists with the name: "' + (pos[1] || '') + '"');
      w.ctx = pos[1];
      return 'Switched to context "' + pos[1] + '".';
    }
    fail('error: 模擬器支援 kubectl config get-contexts｜current-context｜use-context <名稱>');
  }
  function kubectl(w, tokens) {
    const sub = tokens[0];
    if (!sub) return { out: 'kubectl controls the Kubernetes cluster manager.\n輸入 help 看模擬器支援的指令。', ok: true };
    const a = parseArgs(tokens.slice(1));
    const x = { w, c: S.cur(w), pos: a.pos, flags: a.flags, multi: a.multi, rest: a.rest, ok: true };
    x.nsFlag = a.flags.n || a.flags.namespace;
    x.ns = x.nsFlag === true || !x.nsFlag ? 'default' : x.nsFlag;
    x.nsFlag = x.nsFlag === true ? undefined : x.nsFlag;
    x.allNs = !!(a.flags.A || a.flags['all-namespaces']);
    if (a.flags.output) a.flags.o = a.flags.output;
    if (sub === 'config') return { out: kConfig(x), ok: true };
    if (sub === 'version') return { out: 'Client Version: v1.37.0\nServer Version: ' + (x.c.kind === 'orb' ? 'v1.37.0+orb1' : 'v1.37.0-gke.100'), ok: true };
    if (!x.c.started) fail('The connection to the server 127.0.0.1:26443 was refused - did you specify the right host or port?\n💡 OrbStack 的 Kubernetes 還沒啟動。');
    S.reconcile(w, x.c);
    let out;
    switch (sub) {
      case 'get': out = kGet(x); break;
      case 'describe': out = kDescribe(x); break;
      case 'logs': case 'log': out = kLogs(x); break;
      case 'exec': out = kExec(x); break;
      case 'apply': out = kApply(x); break;
      case 'create': out = kCreate(x); break;
      case 'delete': out = kDelete(x); break;
      case 'rollout': out = kRollout(x); break;
      case 'kustomize': out = S.kbuild(w, x.pos[0] || '.').map((o) => yaml.dump(o, { lineWidth: 200, noRefs: true }).trimEnd()).join('\n---\n'); break;
      case 'scale': {
        const d = depArg(x, 'scale');
        const n = Number(x.flags.replicas);
        if (x.flags.replicas == null || isNaN(n) || n < 0) fail('error: required flag(s) "replicas" not set（例如 --replicas=3）');
        d.spec.replicas = n;
        S.reconcile(w, x.c);
        out = 'deployment.apps/' + d.metadata.name + ' scaled';
        break;
      }
      case 'set': {
        if (x.pos.shift() !== 'image') fail('error: 模擬器只支援 kubectl set image deploy/<名稱> <容器>=<映像檔>');
        const d = depArg(x, 'set image');
        if (!x.pos.length) fail('error: at least one image update is required（格式：<容器名稱>=<映像檔>）');
        for (const pair of x.pos) {
          const [cn, img] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
          const ct = d.spec.template.spec.containers.find((q) => q.name === cn);
          if (!ct) fail('error: unable to find container named "' + cn + '"（這個 Deployment 的容器：' + d.spec.template.spec.containers.map((q) => q.name).join(', ') + '）');
          ct.image = img;
        }
        S.reconcile(w, x.c);
        out = 'deployment.apps/' + d.metadata.name + ' image updated';
        break;
      }
      case 'port-forward': {
        const [t, ports] = x.pos;
        const m = String(ports || '').match(/^(\d+)(?::(\d+))?$/);
        if (!t || !m) fail('error: 用法：kubectl port-forward svc/<名稱> <本機埠>:<目標埠>');
        const local = Number(m[1]);
        const remote = Number(m[2] || m[1]);
        const parts = t.split('/');
        if (parts.length === 2 && rtype(parts[0]) === 'Service') {
          S.getRes(x.c, 'Service', x.ns, parts[1]) || fail('Error from server (NotFound): services "' + parts[1] + '" not found');
          w.forwards[local] = { ctx: w.ctx, kind: 'svc', ns: x.ns, name: parts[1], port: remote };
        } else {
          const pod = findPod(x, t).pod;
          w.forwards[local] = { ctx: w.ctx, kind: 'pod', ns: x.ns, name: pod.name, port: remote };
        }
        out = 'Forwarding from 127.0.0.1:' + local + ' -> ' + remote + '\nForwarding from [::1]:' + local + ' -> ' + remote + '\n💡 模擬器：真實環境這個指令會佔住終端機（Ctrl+C 結束），要另開一個視窗下 curl。這裡讓它留在背景。';
        break;
      }
      case 'edit': fail('💡 模擬器不支援 kubectl edit。請在上方編輯器改檔案，再 kubectl apply（這也是比較好的習慣：檔案才是事實來源）。');
      default: fail('error: unknown command "' + sub + '" for "kubectl"\n輸入 help 看模擬器支援的指令。');
    }
    const r = { out, ok: x.ok };
    if (x.http) r.http = x.http;
    return r;
  }

  // ---------- 其他工具 ----------
  function docker(w, tokens) {
    const sub = tokens[0];
    const a = parseArgs(tokens.slice(1));
    if (sub === 'build') {
      const ref = a.flags.t || a.flags.tag;
      if (!ref || ref === true) fail('ERROR: 請用 -t 指定映像檔名稱與 tag，例如 docker build -t frontend:dev frontend');
      const dir = S.normPath(a.pos[0] || '');
      if (!a.pos.length) fail('ERROR: "docker build" requires exactly 1 argument（建置目錄，例如 frontend）');
      if (w.files[(dir ? dir + '/' : '') + 'Dockerfile'] == null) fail('ERROR: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory');
      const app = dir.split('/').pop();
      if (!['frontend', 'backend'].includes(app)) fail('ERROR: 模擬器只認得 frontend/ 與 backend/ 兩個建置目錄');
      const im = S.parseImage(ref);
      w.images[im.ref] = Object.assign({ app, label: im.tag }, w.buildBug[app] || {});
      return '[+] Building 2.3s (9/9) FINISHED\n => exporting to image\n => => naming to ' + (im.registry ? '' : 'docker.io/library/') + im.ref;
    }
    if (sub === 'images' || (sub === 'image' && tokens[1] === 'ls')) {
      const rows = Object.keys(w.images).map((r) => {
        const im = S.parseImage(r);
        return [im.name, im.tag, S.b64e(r).slice(0, 12).toLowerCase(), '2 minutes ago', w.images[r].app === 'frontend' ? '48.2MB' : '142MB'];
      });
      return table([['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE']].concat(rows));
    }
    if (sub === 'tag') {
      const [src, dst] = a.pos;
      if (!src || !dst) fail('"docker tag" requires exactly 2 arguments.\n用法：docker tag 來源:tag 目標:tag');
      const s = w.images[S.parseImage(src).ref] || fail('Error response from daemon: No such image: ' + src);
      w.images[S.parseImage(dst).ref] = Object.assign({}, s, { label: S.parseImage(dst).tag });
      return '';
    }
    if (sub === 'push') {
      const im = S.parseImage(a.pos[0] || '');
      const meta = w.images[im.ref] || fail('An image does not exist locally with the tag: ' + im.name);
      if (im.registry !== S.AR_HOST) fail('The push refers to repository [' + (im.registry ? '' : 'docker.io/library/') + im.name + ']\ndenied: requested access to the resource is denied\n💡 映像檔名稱開頭要是 registry 的位址（' + S.AR_REPO + '/...），docker 才知道要推去哪。');
      if (!w.dockerAuth) fail('The push refers to repository [' + im.name + ']\ndenied: Unauthenticated request. Unauthenticated requests do not have permission "artifactregistry.repositories.uploadArtifacts" on resource "projects/demo-project/locations/asia-east1/repositories/app"');
      if (!im.name.startsWith(S.AR_REPO + '/')) fail('name unknown: Repository "' + im.name.split('/').slice(1, 3).join('/') + '" not found（這個模擬專案的 repository 是 ' + S.AR_REPO + '）');
      w.registry[im.ref] = Object.assign({}, meta);
      return 'The push refers to repository [' + im.name + ']\n' + im.tag + ': digest: sha256:' + S.b64e(im.ref).toLowerCase().replace(/[^a-f0-9]/g, '').padEnd(12, '0').slice(0, 12) + '… size: 1785';
    }
    fail('💡 模擬器的 docker 支援：build -t、images、tag、push');
  }
  function curl(w, tokens) {
    let url = null;
    let head = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '-H' || t === '-o' || t === '-X') i++;
      else if (t.startsWith('-')) head = head || /[iIv]/.test(t);
      else url = url || t;
    }
    if (!url) fail("curl: try 'curl <URL>'");
    const r = S.httpGet(w, url);
    const m = String(url).match(/^(?:https?:\/\/)?[^/]+(\/[^?]*)?/);
    const http = Object.assign({ url, path: (m && m[1]) || '/' }, r);
    if (!r.code) return { out: 'curl: (' + (/resolve/.test(r.err) ? 6 : 7) + ') ' + r.err, ok: false, http };
    const text = { 200: 'OK', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' }[r.code] || '';
    return { out: (head ? 'HTTP/1.1 ' + r.code + ' ' + text + '\n\n' : '') + r.body + (r.code >= 400 && !head ? '\n💡 HTTP 狀態碼 ' + r.code + '（加 -i 可以看到狀態列）' : ''), ok: true, http };
  }
  function ls(w, path) {
    const p = S.normPath(path || '');
    if (w.files[p] != null) return p;
    const pre = p ? p + '/' : '';
    const names = new Set();
    for (const f of Object.keys(w.files)) if (f.startsWith(pre)) names.add(f.slice(pre.length).split('/')[0] + (f.slice(pre.length).includes('/') ? '/' : ''));
    if (!names.size) fail('ls: ' + path + ': No such file or directory');
    return Array.from(names).sort().join('\n');
  }
  const HELP = [
    '模擬器支援的指令（Tab 鍵可補完名稱，↑↓ 叫出歷史指令）：',
    '',
    '  kubectl get <資源> [名稱] [-n NS] [-A] [-o wide|yaml] [-l 標籤] [--show-labels]',
    '      資源：pods deploy rs svc endpointslices cm secret ns gateway httproute events nodes all …',
    '  kubectl describe <資源> <名稱>          kubectl logs <pod|deploy/名稱> [--previous] [-c 容器]',
    '  kubectl apply -f <檔案> | -k <目錄> [--dry-run=server]      kubectl kustomize <目錄>',
    '  kubectl delete <資源> <名稱> | -f | -k   kubectl scale deploy/<名稱> --replicas=N',
    '  kubectl set image deploy/<名稱> <容器>=<映像檔>',
    '  kubectl rollout status|history|undo|restart deploy/<名稱>',
    '  kubectl create namespace|configmap|secret generic <名稱> [--from-literal=K=V]',
    '  kubectl exec <pod|deploy/名稱> -- env | wget -qO- <URL>',
    '  kubectl port-forward svc/<名稱> 8080:80   kubectl config get-contexts|use-context',
    '  docker build -t <名稱:tag> <目錄> | images | tag | push        orb start k8s',
    '  gcloud auth configure-docker <主機>      git rev-parse --short HEAD',
    '  curl [-i] <URL>      ls [路徑]      cat <檔案>      sim cost（模擬 GKE 費用點數）',
    '',
    '  k 是 kubectl 的縮寫；可以用 && 串接指令。',
  ].join('\n');
  function dispatch(w, tokens) {
    const cmd = tokens[0];
    const rest = tokens.slice(1);
    switch (cmd) {
      case 'kubectl': case 'k': return kubectl(w, rest);
      case 'kustomize':
        if (rest[0] === 'build') return kubectl(w, ['kustomize'].concat(rest.slice(1)));
        fail('💡 模擬器只支援 kustomize build <目錄>（等同 kubectl kustomize）。真實 CI 常用的 kustomize edit set image，在這裡請直接改 kustomization.yaml。');
      case 'docker': return { out: docker(w, rest), ok: true };
      case 'curl': return curl(w, rest);
      case 'orb': {
        const c = w.clusters.orbstack;
        if (rest[1] !== 'k8s' || !['start', 'stop', 'restart'].includes(rest[0])) fail('用法：orb start k8s｜orb stop k8s｜orb restart k8s');
        c.started = rest[0] !== 'stop';
        S.reconcile(w, c);
        return { out: c.started ? 'Kubernetes started\n💡 kubectl 的 context 已指向 orbstack。' : 'Kubernetes stopped', ok: true };
      }
      case 'gcloud':
        if (rest[0] === 'auth' && rest[1] === 'configure-docker') {
          if (rest[2] !== S.AR_HOST) fail('ERROR: 請指定 registry 主機，例如 gcloud auth configure-docker ' + S.AR_HOST);
          w.dockerAuth = true;
          return { out: 'Adding credentials for: ' + S.AR_HOST + '\nDocker configuration file updated.', ok: true };
        }
        fail('💡 模擬器只支援 gcloud auth configure-docker ' + S.AR_HOST + '（這裡沒有真的雲端）。');
      case 'git':
        if (rest[0] === 'rev-parse') return { out: w.git, ok: true };
        fail('💡 模擬器只支援 git rev-parse --short HEAD');
      case 'ls': return { out: ls(w, rest.find((t) => !t.startsWith('-'))), ok: true };
      case 'cat': {
        if (!rest.length) fail('cat: 需要檔名');
        const p = S.normPath(rest[0]);
        if (w.files[p] == null) fail('cat: ' + rest[0] + ': No such file or directory');
        w.opened[p] = true;
        return { out: w.files[p].trimEnd(), ok: true };
      }
      case 'pwd': return { out: '/Users/you/shop', ok: true };
      case 'echo': return { out: rest.join(' '), ok: true };
      case 'help': case 'man': return { out: HELP, ok: true };
      case 'sim': {
        if (rest[0] !== 'cost') fail('用法：sim cost');
        const c = w.clusters['gke-staging'];
        const r = S.costOf(c);
        if (!r.rows.length) return { out: '模擬 GKE 叢集裡目前沒有 Pod。', ok: true };
        return { out: table([['POD', 'vCPU', '記憶體', '點數／月', '備註']].concat(r.rows.map((q) => [q.pod, q.cpu, q.mem + 'Mi', q.points.toFixed(1), q.defaulted ? '有容器沒設 requests → 套用預設 0.5 vCPU／2Gi' : '']))) + '\n合計：' + r.total + ' 點（模擬點數，不是真實價格；Autopilot 依 Pod 的 requests 計費）', ok: true };
      }
      case 'cd': fail('💡 模擬器沒有切換目錄，所有路徑都從專案根目錄算起（例如 k8s/overlays/local）。');
      case 'vim': case 'vi': case 'nano': case 'code': fail('💡 請用畫面上方的編輯器改檔案（會自動儲存）。');
      default: fail('zsh: command not found: ' + cmd + '\n輸入 help 看模擬器支援的指令。');
    }
  }
  function runOne(w, line) {
    w.tick++;
    let res;
    try {
      res = dispatch(w, tokenize(line));
    } catch (e) {
      if (!(e instanceof Fail) && !/^error:/.test(e.message)) console.error(e);
      res = { out: e instanceof Fail || /^error:/.test(e.message) ? e.message : '模擬器內部錯誤：' + e.message, ok: false };
    }
    const h = { cmd: line, out: res.out, ok: res.ok, ctx: w.ctx };
    if (res.http) h.http = res.http;
    w.history.push(h);
    return res;
  }
  function run(w, line) {
    line = String(line).trim().replace(/^\$\s+/, '');
    if (!line || line[0] === '#') return { out: '', ok: true };
    const parts = line.split(/\s+&&\s+/);
    const outs = [];
    let ok = true;
    for (const p of parts) {
      const r = runOne(w, p);
      if (r.out) outs.push(r.out);
      ok = r.ok;
      if (!ok) break;
    }
    return { out: outs.join('\n'), ok };
  }

  // ---------- Tab 補完 ----------
  function complete(w, line) {
    const i = line.lastIndexOf(' ');
    const head = line.slice(0, i + 1);
    const last = line.slice(i + 1);
    if (!last) return { line, options: [] };
    let cands = [];
    if (i < 0) cands = ['kubectl', 'docker', 'curl', 'orb', 'gcloud', 'git', 'ls', 'cat', 'help', 'sim', 'clear'];
    else {
      const c = S.cur(w);
      cands = ['get', 'describe', 'logs', 'apply', 'delete', 'scale', 'set', 'image', 'rollout', 'status', 'history', 'undo', 'restart', 'create', 'exec', 'port-forward', 'config', 'kustomize', 'use-context', 'get-contexts', 'current-context', 'namespace', 'generic',
        'pods', 'deployments', 'services', 'configmaps', 'secrets', 'namespaces', 'gateways', 'httproutes', 'endpointslices', 'events', 'nodes', 'gatewayclass', 'healthcheckpolicy', 'replicasets', 'serviceaccounts',
        '--previous', '--replicas=', '--from-literal=', '--dry-run=server', '--show-labels', '--short', '--revision=', '--to-revision=', 'build', 'images', 'tag', 'push', 'start', 'k8s', 'auth', 'configure-docker', 'rev-parse', 'HEAD', 'cost',
        S.AR_HOST, S.AR_REPO + '/', 'http://', 'http://app.k8s.orb.local/', 'http://' + S.GKE_LB_IP + '/', 'http://localhost:'];
      for (const p of c.pods) cands.push(p.name, 'pod/' + p.name);
      for (const k of Object.keys(c.res)) {
        const o = c.res[k];
        cands.push(o.metadata.name);
        if (o.kind === 'Deployment') cands.push('deploy/' + o.metadata.name);
        if (o.kind === 'Service') cands.push('svc/' + o.metadata.name, 'http://' + o.metadata.name + '.' + o.metadata.namespace + '.svc.cluster.local');
      }
      cands.push(...Object.keys(w.clusters), ...Object.keys(w.images), ...Object.keys(w.registry));
      for (const f of Object.keys(w.files)) {
        if (!f.startsWith(last)) continue;
        const j = f.indexOf('/', last.length);
        cands.push(j < 0 ? f : f.slice(0, j + 1));
      }
    }
    const opts = Array.from(new Set(cands.filter((s) => s.startsWith(last) && s !== last))).sort();
    if (!opts.length) return { line, options: [] };
    let pre = opts[0];
    for (const o of opts) while (!o.startsWith(pre)) pre = pre.slice(0, -1);
    const done = opts.length === 1 && !/[/=:]$/.test(pre);
    return { line: head + pre + (done ? ' ' : ''), options: opts.length > 1 ? opts : [] };
  }

  G.run = run;
  G.complete = complete;
})(typeof globalThis !== 'undefined' ? globalThis : this);
