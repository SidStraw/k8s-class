// 關卡內容：依 docs/research/k8s-frontend-to-jr-devops-mvp.md 的階段 0～4 編排。
// 文字裡的 `...` 會顯示成程式碼、**...** 會顯示成粗體。
(function (root) {
  'use strict';
  const G = (root.K8sGame = root.K8sGame || {});
  const S = G.sim;
  const AR = S.AR_REPO;
  const IP = S.GKE_LB_IP;
  const L = (...a) => a.flat(9).filter((x) => x != null && x !== false).join('\n') + '\n';

  // ---------- 檔案範本 ----------
  const DOCKERFILE_FE = L('FROM node:22-alpine AS build', 'WORKDIR /app', 'COPY . .', 'RUN npm ci && npm run build', '', 'FROM nginx:1.29-alpine', 'COPY --from=build /app/dist /usr/share/nginx/html');
  const DOCKERFILE_BE = L('FROM node:22-alpine', 'WORKDIR /app', 'COPY . .', 'RUN npm ci --omit=dev', 'USER node', 'CMD ["node", "server.js"]');
  const RES_BLOCK = ['          resources:', '            requests:', '              cpu: 250m', '              memory: 512Mi', '            limits:', '              memory: 512Mi'];

  function feDeploy(o) {
    o = o || {};
    return L(
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: frontend',
      'spec:',
      '  replicas: ' + (o.replicas || 2),
      '  selector:',
      '    matchLabels:',
      '      app: frontend',
      '  template:',
      '    metadata:',
      '      labels:',
      '        app: frontend',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: ' + (o.image || 'frontend:dev'),
      o.command && '          command: ' + o.command,
      '          ports:',
      '            - name: http',
      '              containerPort: 80',
      o.probes && ['          readinessProbe:', '            httpGet:', '              path: /', '              port: http'],
      o.resources === 'todo' && '          # TODO：補上 resources.requests（cpu: 250m、memory: 512Mi）',
      o.resources === true && RES_BLOCK
    );
  }
  const ENVFROM = ['          envFrom:', '            - configMapRef:', '                name: backend-config', '            - secretRef:', '                name: backend-secret'];
  const LIVENESS = ['          livenessProbe:', '            httpGet:', '              path: /healthz', '              port: http', '            initialDelaySeconds: 10', '            periodSeconds: 10'];
  const REQUESTS = ['            requests:', '              cpu: 250m', '              memory: 512Mi'];
  function beDeploy(o) {
    o = Object.assign({ image: 'backend:dev', envFrom: true, readiness: '/healthz', liveness: true, mem: '512Mi', requests: true }, o || {});
    return L(
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: backend',
      'spec:',
      '  replicas: 2',
      '  selector:',
      '    matchLabels:',
      '      app: backend',
      '  strategy:',
      '    type: RollingUpdate',
      '    rollingUpdate:',
      '      maxSurge: 1        # 更新時最多多開幾個 Pod',
      '      maxUnavailable: 0  # 更新時最多允許幾個 Pod 不可用',
      '  template:',
      '    metadata:',
      '      labels:',
      '        app: backend',
      '    spec:',
      '      containers:',
      '        - name: api',
      '          image: ' + o.image,
      '          ports:',
      '            - name: http',
      '              containerPort: 8080',
      o.envFrom === 'todo' && '          # TODO：在這裡加上 envFrom，引用 ConfigMap backend-config 與 Secret backend-secret',
      o.envFrom === true && ENVFROM,
      o.readiness && ['          readinessProbe:', '            httpGet:', '              path: ' + o.readiness, '              port: http', '            periodSeconds: 5'],
      o.liveness === 'todo' && '          # TODO：加上 livenessProbe（一樣打 /healthz，initialDelaySeconds: 10）',
      o.liveness === true && LIVENESS,
      o.mem && ['          resources:', o.requests === 'todo' && '            # TODO：補上 requests（cpu: 250m、memory: 512Mi）', o.requests === true && REQUESTS, '            limits:', '              memory: ' + o.mem]
    );
  }
  const svc = (name, selector) => L('apiVersion: v1', 'kind: Service', 'metadata:', '  name: ' + name, 'spec:', '  selector:', '    app: ' + (selector || name), '  ports:', '    - name: http', '      port: 80', '      targetPort: http');
  const POSTGRES = L(
    '# 只限本機練習用。正式環境的資料庫放叢集外（Cloud SQL），密碼也不會這樣寫死。',
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: postgres',
    'spec:',
    '  replicas: 1',
    '  selector:',
    '    matchLabels:',
    '      app: postgres',
    '  template:',
    '    metadata:',
    '      labels:',
    '        app: postgres',
    '    spec:',
    '      containers:',
    '        - name: postgres',
    '          image: postgres:17',
    '          ports:',
    '            - name: pg',
    '              containerPort: 5432',
    '          env:',
    '            - name: POSTGRES_PASSWORD',
    '              value: devpass',
    '---',
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: postgres',
    'spec:',
    '  selector:',
    '    app: postgres',
    '  ports:',
    '    - port: 5432',
    '      targetPort: pg'
  );
  const cm = (env) => L('apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: backend-config', 'data:', '  APP_ENV: ' + env);
  const gateway = (cls) => L('apiVersion: gateway.networking.k8s.io/v1', 'kind: Gateway', 'metadata:', '  name: web', 'spec:', '  gatewayClassName: ' + cls, '  listeners:', '    - name: http', '      protocol: HTTP', '      port: 80');
  const API_RULE = ['    - matches:', '        - path:', '            type: PathPrefix', '            value: /api', '      backendRefs:', '        - name: backend', '          port: 80'];
  const httproute = (api) =>
    L(
      'apiVersion: gateway.networking.k8s.io/v1',
      'kind: HTTPRoute',
      'metadata:',
      '  name: app',
      'spec:',
      '  parentRefs:',
      '    - name: web          # 掛到名為 web 的 Gateway',
      '  rules:',
      api ? API_RULE : '    # TODO：在這裡加一條規則，把 /api 開頭的請求送到 backend 的 80 埠',
      '    - matches:',
      '        - path:',
      '            type: PathPrefix',
      '            value: /',
      '      backendRefs:',
      '        - name: frontend',
      '          port: 80'
    );
  const ns = (name) => L('apiVersion: v1', 'kind: Namespace', 'metadata:', '  name: ' + name);
  const KHEAD = ['apiVersion: kustomize.config.k8s.io/v1beta1', 'kind: Kustomization'];

  // Kustomize 專案的完整檔案（第 2-5 關之後共用），用選項控制「哪裡還沒做完」。
  function kfiles(o) {
    o = Object.assign({ localTodo: false, gkeImages: true, patch: true, restart: true, sa: true, hcListed: true, hcPath: '/healthz', frontReq: true, proxyReq: true, backendTag: 'a1b2c3d' }, o || {});
    const f = {
      'frontend/Dockerfile': DOCKERFILE_FE,
      'backend/Dockerfile': DOCKERFILE_BE,
      'k8s/base/kustomization.yaml': L(KHEAD, 'resources:', '  - frontend/deployment.yaml', '  - frontend/service.yaml', '  - backend/deployment.yaml', '  - backend/service.yaml', '  - backend/configmap.yaml', '  - httproute.yaml'),
      'k8s/base/frontend/deployment.yaml': feDeploy({ image: 'frontend   # 不寫 tag，由各 overlay 的 images 欄位改寫', probes: true, resources: o.frontReq ? true : 'todo' }),
      'k8s/base/frontend/service.yaml': svc('frontend'),
      'k8s/base/backend/deployment.yaml': beDeploy({ image: 'backend    # 不寫 tag，由各 overlay 的 images 欄位改寫' }),
      'k8s/base/backend/service.yaml': svc('backend'),
      'k8s/base/backend/configmap.yaml': cm('production'),
      'k8s/base/httproute.yaml': httproute(true),
      'k8s/overlays/local/kustomization.yaml': L(
        KHEAD,
        'namespace: app-local',
        'resources:',
        '  - ../../base',
        '  - namespace.yaml',
        '  - gateway.yaml',
        '  - postgres.yaml',
        o.localTodo
          ? ['# TODO 1：加上 patches，套用 patch-config.yaml（把 APP_ENV 改成 local）', '# TODO 2：加上 images，把 frontend 和 backend 都改寫成 tag dev']
          : ['patches:', '  - path: patch-config.yaml', 'images:', '  - name: frontend', '    newTag: dev', '  - name: backend', '    newTag: dev']
      ),
      'k8s/overlays/local/namespace.yaml': ns('app-local'),
      'k8s/overlays/local/gateway.yaml': gateway('traefik'),
      'k8s/overlays/local/postgres.yaml': POSTGRES,
      'k8s/overlays/local/patch-config.yaml': cm('local'),
      'k8s/overlays/gke-staging/kustomization.yaml': L(
        KHEAD,
        'namespace: app-staging',
        'resources:',
        '  - ../../base',
        '  - namespace.yaml',
        '  - serviceaccount.yaml',
        '  - gateway.yaml',
        o.hcListed && '  - healthcheckpolicy.yaml',
        'patches:',
        '  - path: patch-config.yaml',
        o.patch && '  - path: patch-backend-sqlproxy.yaml',
        'images:',
        '  - name: frontend',
        o.gkeImages ? ['    newName: ' + AR + '/frontend', '    newTag: a1b2c3d'] : ['    newName: frontend   # TODO：改成 Artifact Registry 的完整路徑', '    newTag: dev          # TODO：改成 git SHA'],
        '  - name: backend',
        o.gkeImages ? ['    newName: ' + AR + '/backend', '    newTag: ' + o.backendTag] : ['    newName: backend    # TODO', '    newTag: dev          # TODO']
      ),
      'k8s/overlays/gke-staging/namespace.yaml': ns('app-staging'),
      'k8s/overlays/gke-staging/serviceaccount.yaml': L('# Kubernetes ServiceAccount（KSA）。IAM 那邊已經把 roles/cloudsql.client 授予這個 KSA。', 'apiVersion: v1', 'kind: ServiceAccount', 'metadata:', '  name: backend'),
      'k8s/overlays/gke-staging/gateway.yaml': gateway('gke-l7-global-external-managed'),
      'k8s/overlays/gke-staging/patch-config.yaml': cm('staging'),
      'k8s/overlays/gke-staging/patch-backend-sqlproxy.yaml': L(
        '# 幫 backend 加上 Cloud SQL Auth Proxy。應用程式連 127.0.0.1:5432，由 proxy 轉到叢集外的 Cloud SQL。',
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: backend',
        'spec:',
        '  template:',
        '    spec:',
        o.sa ? '      serviceAccountName: backend' : '      # TODO（之後）：指定 serviceAccountName',
        '      initContainers:',
        '        - name: cloud-sql-proxy',
        '          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2',
        o.restart ? '          restartPolicy: Always' : '          # TODO（之後）：這裡少了一個讓它變成 sidecar 的欄位',
        '          args:',
        '            - "--port=5432"',
        '            - "demo-project:asia-east1:shop-db"',
        o.proxyReq ? ['          resources:', '            requests:', '              cpu: 250m', '              memory: 512Mi'] : '          # TODO：補上 resources.requests'
      ),
      'k8s/overlays/gke-staging/healthcheckpolicy.yaml': L(
        '# GKE Gateway 不會讀 readinessProbe，要用這個資源告訴負載平衡器去哪裡做健康檢查。',
        'apiVersion: networking.gke.io/v1',
        'kind: HealthCheckPolicy',
        'metadata:',
        '  name: backend-hc',
        'spec:',
        '  default:',
        '    config:',
        '      type: HTTP',
        '      httpHealthCheck:',
        '        requestPath: ' + o.hcPath,
        '  targetRef:',
        '    group: ""',
        '    kind: Service',
        '    name: backend'
      ),
    };
    return f;
  }

  // ---------- 關卡用的小幫手 ----------
  const DB_LOCAL = 'postgres://shop:devpass@postgres:5432/shop';
  const DB_GKE = 'postgres://shop:s3cret@127.0.0.1:5432/shop';
  function boot(w, files) {
    w.clusters.orbstack.started = true;
    w.images['frontend:dev'] = { app: 'frontend', label: 'dev' };
    w.images['backend:dev'] = { app: 'backend', label: 'dev' };
    Object.assign(w.files, { 'frontend/Dockerfile': DOCKERFILE_FE, 'backend/Dockerfile': DOCKERFILE_BE }, files || {});
  }
  // 第 2 章的起點：前端、Postgres、後端都健康。
  function bootFull(w, sh, beOpt) {
    boot(w, {
      'k8s/frontend.yaml': feDeploy() + '---\n' + svc('frontend'),
      'k8s/postgres.yaml': POSTGRES,
      'k8s/backend-config.yaml': cm('local'),
      'k8s/backend-service.yaml': svc('backend'),
      'k8s/backend-deployment.yaml': beDeploy(beOpt),
    });
    sh('kubectl apply -f k8s/frontend.yaml');
    sh('kubectl apply -f k8s/postgres.yaml');
    sh('kubectl apply -f k8s/backend-config.yaml');
    sh('kubectl apply -f k8s/backend-service.yaml');
    sh('kubectl create secret generic backend-secret --from-literal=DATABASE_URL=' + DB_LOCAL);
    sh('kubectl apply -f k8s/backend-deployment.yaml');
  }
  // 第 3 章的起點：映像檔已在 registry，context 指向模擬 GKE。
  function bootGke(w, sh, opt) {
    boot(w);
    w.files = kfiles(opt);
    w.dockerAuth = true;
    w.iam['app-staging/backend'] = true;
    for (const app of ['frontend', 'backend']) w.registry[AR + '/' + app + ':a1b2c3d'] = { app, label: 'a1b2c3d' };
    w.ctx = 'gke-staging';
    sh('kubectl apply -f k8s/overlays/gke-staging/namespace.yaml');
    sh('kubectl create secret generic backend-secret -n app-staging --from-literal=DATABASE_URL=' + DB_GKE);
    sh('kubectl apply -k k8s/overlays/gke-staging');
  }
  const GET_PODS = /\bget\s+(po|pods?)\b/;
  const DESC_POD = /\bdescribe\s+(po|pods?)\b/;
  const container = (cl, nsName, dep, cname) => {
    const d = S.getRes(cl, 'Deployment', nsName, dep);
    return d && (d.spec.template.spec.containers.concat(d.spec.template.spec.initContainers || []).find((x) => x.name === cname) || null);
  };
  const GKE_K = 'k8s/overlays/gke-staging/kustomization.yaml';
  const GKE_PATCH = 'k8s/overlays/gke-staging/patch-backend-sqlproxy.yaml';
  const APPLY_GKE = 'kubectl apply -k k8s/overlays/gke-staging';

  // ---------- 章節 ----------
  const chapters = [
    { id: 0, title: '出航前：觀念', env: '不需要叢集', desc: '先把地圖看懂：誰管誰、流量怎麼走。' },
    { id: 1, title: '單一服務', env: 'OrbStack（模擬）', desc: '把前端跑起來、對外服務、更新與回滾，並學會看懂壞掉的 Pod。' },
    { id: 2, title: '前後端與設定', env: 'OrbStack（模擬）', desc: '設定與機密、健康檢查、資源、Gateway 分流，最後收成 Kustomize。' },
    { id: 3, title: '上雲演習', env: '模擬 GKE Autopilot', desc: '同一份 base 換到雲端會踩到的坑，全部在模擬器裡踩一遍。' },
    { id: 4, title: 'CI/CD 與結業', env: '模擬 GKE', desc: '親手扮演一次 CI，再想清楚什麼時候根本不該用 k8s。' },
  ];

  const levels = [
    // ================= 第 0 章 =================
    {
      id: '0-1', ch: 0, type: 'quiz', title: '地圖：誰管誰、流量怎麼走',
      intro: '你已經會用 Docker 跑一個容器，也用過 Cloud Run。Kubernetes 做的事情其實很像：你**宣告**想要的狀態，它負責讓現況**一直符合**。差別在 Cloud Run 幫你藏起來的零件，在這裡都要自己組。\n\n先確認你腦中有這張圖：\n`Gateway → HTTPRoute → Service → Pod`（Pod 由 `Deployment` 管理）',
      questions: [
        { q: '半夜有一個 Pod 掛了。誰負責補一個新的？', options: ['Service', 'Deployment（背後的 ReplicaSet）', 'Gateway', '你，手動 kubectl run'], answer: 1, explain: 'Deployment 宣告「我要 N 個這種 Pod」，控制器會一直把數量補到 N。你不直接管 Pod。' },
        { q: 'Service 怎麼知道流量要送給哪些 Pod？', options: ['靠 Pod 的名稱', '靠 Deployment 的名稱', '靠 label selector 比對 Pod 的 labels', '靠 Pod 的 IP 清單（手動維護）'], answer: 2, explain: 'Service 的 `selector` 會去比對 Pod 的 `labels`。打錯一個字，Service 就會「存在但沒有任何後端」，這是最常見的新手錯誤之一。' },
        { q: '使用者的請求進到叢集，正確的順序是？', options: ['Pod → Service → Gateway', 'Gateway → HTTPRoute → Service → Pod', 'Deployment → Service → Pod', 'Service → Gateway → Pod'], answer: 1, explain: 'Gateway 是對外的入口，HTTPRoute 決定哪個路徑送到哪個 Service，Service 再把流量分給健康的 Pod。' },
        { q: '同一個映像檔要部署到本機、staging、prod，資料庫位址都不同。位址該放哪？', options: ['寫死在映像檔裡，每個環境 build 一份', 'ConfigMap／Secret，啟動時以環境變數帶入', '寫在 Dockerfile 的 ENV', '放在 Service 的 annotation'], answer: 1, explain: '一份映像檔跑遍所有環境，差異都放在設定。一般設定用 ConfigMap，密碼這類機密用 Secret。' },
        { q: '`readinessProbe` 失敗時會發生什麼事？', options: ['容器被重啟', 'Pod 被刪除', 'Pod 繼續跑，但從 Service 的後端清單被拿掉', '整個 Deployment 回滾'], answer: 2, explain: 'readiness 回答「現在能不能接流量」，失敗只是暫時不分流量給它。會重啟容器的是 `livenessProbe`（回答「是不是卡死了」）。' },
        { q: '2026 年開始一個新專案，對外流量的設定應該主力學哪一個？', options: ['Ingress（搭配 Ingress NGINX）', 'Gateway API（Gateway + HTTPRoute）', '每個服務各開一個 LoadBalancer', 'NodePort'], answer: 1, explain: 'Kubernetes 官方已凍結 Ingress API 並建議改用 Gateway；最常見的控制器 Ingress NGINX 也已在 2026-03-24 退役。Ingress 看得懂就好。' },
      ],
      outro: '觀念有了。接下來每一關都是動手做，做錯沒關係，模擬器裡的叢集壞了按「重設本關」就好。',
    },

    // ================= 第 1 章 =================
    {
      id: '1-1', ch: 1, title: '起錨：第一個 Deployment', covers: [0, 1],
      intro: '你手上有一個前端專案 `frontend/`，以前是 build 成映像檔丟到 Cloud Run。現在改成在本機的 Kubernetes 上跑起來。\n\n下方是**模擬的終端機**，上方是專案檔案，右邊會即時畫出叢集的樣子。',
      setup(w) {
        Object.assign(w.files, { 'frontend/Dockerfile': DOCKERFILE_FE, 'k8s/frontend-deployment.yaml': feDeploy() });
      },
      steps: [
        { text: '啟動 OrbStack 內建的 Kubernetes：`orb start k8s`', why: 'OrbStack 內建一個單節點叢集，專門給本機開發用，啟動後 `kubectl` 就直接連得上。', sol: ['orb start k8s'], check: (h) => h.orb.started },
        { text: '看看叢集有哪些節點：`kubectl get nodes`', why: '只有一個節點，這是它和雲端叢集最大的差別：練不到「跨節點」的情境，但其他幾乎都練得到。', sol: ['kubectl get nodes'], check: (h) => h.ran(/\bget\s+(no|nodes?)\b/) },
        { text: '把前端 build 成映像檔，tag 用 `dev`：`docker build -t frontend:dev frontend`', why: 'OrbStack 的 Kubernetes 和 Docker 共用同一個容器引擎，本機 build 完就能直接用，**不需要推到 registry**。tag 刻意不用 `latest`，原因在 1-6 關揭曉。', sol: ['docker build -t frontend:dev frontend'], check: (h) => !!h.w.images['frontend:dev'] },
        { text: '在上方檔案區點開 `k8s/frontend-deployment.yaml` 讀一遍（或 `cat k8s/frontend-deployment.yaml`）。', why: '重點看三個地方：`replicas`（要幾個）、`selector.matchLabels`（我管哪些 Pod）、`template`（Pod 長什麼樣）。selector 和 template 的 labels 必須對得上。', hint: '點一下檔案名稱就算完成。', sol: ['cat k8s/frontend-deployment.yaml'], check: (h) => h.ran(/\bcat\s+k8s\/frontend-deployment/) || !!h.w.opened['k8s/frontend-deployment.yaml'] },
        { text: '把它套用到叢集：`kubectl apply -f k8s/frontend-deployment.yaml`', why: '`apply` 是**宣告式**的：你交出「想要的樣子」，同一個指令可以重複執行，叢集只會補上差異。', sol: ['kubectl apply -f k8s/frontend-deployment.yaml'], check: (h) => !!h.res(h.orb, 'Deployment', 'default', 'frontend') },
        { text: '確認兩個 Pod 都是 `Running`、`1/1`：`kubectl get pods`', why: 'Pod 名稱是 `Deployment 名稱-範本雜湊-亂數`。中間那段雜湊在範本改變時會換，之後做滾動更新時你會再看到它。', sol: ['kubectl get pods'], check: (h) => h.ran(GET_PODS) && h.ready(h.orb, 'default', 'frontend', 2) },
      ],
      outro: '你剛做的事等同 Cloud Run 的「部署一個修訂版本」，只是這次每個零件都看得到。右邊面板的兩個綠點就是你的 Pod。',
      real: ['orb start k8s', 'kubectl get nodes', 'docker build -t frontend:dev ./你的前端專案', 'kubectl apply -f deployment.yaml && kubectl get pods'],
    },
    {
      id: '1-2', ch: 1, title: 'Service：給 Pod 一個穩定的門牌', covers: [0, 6],
      intro: 'Pod 隨時會被換掉，IP 也會跟著變。**Service** 提供一個固定的名稱和 IP，把流量分給後面符合條件的 Pod。\n\n同事幫你寫好了 `k8s/frontend-service.yaml`，但他趕著下班……',
      setup(w, sh) {
        boot(w, { 'k8s/frontend-deployment.yaml': feDeploy(), 'k8s/frontend-service.yaml': svc('frontend', 'fronted') });
        sh('kubectl apply -f k8s/frontend-deployment.yaml');
      },
      steps: [
        { text: '套用 Service：`kubectl apply -f k8s/frontend-service.yaml`', sol: ['kubectl apply -f k8s/frontend-service.yaml'], check: (h) => !!h.res(h.orb, 'Service', 'default', 'frontend') },
        { text: '從你的 Mac 直接連連看：`curl http://frontend.default.svc.cluster.local`', why: 'Service 在叢集內的 DNS 名稱是 `<名稱>.<namespace>.svc.cluster.local`。OrbStack 讓 Mac 可以直接連這個名稱，真的雲端叢集做不到。', sol: ['curl http://frontend.default.svc.cluster.local'], check: (h) => h.http((r) => /frontend\.default/.test(r.url)) },
        { text: '連不上。先問：Service 後面到底有沒有 Pod？`kubectl get endpointslices`', why: '**EndpointSlice** 是 Service 目前實際的後端清單。`<unset>` 代表一個都沒有，流量無處可去。', sol: ['kubectl get endpointslices'], check: (h) => h.ran(/\bget\s+(endpointslices?|ep|endpoints)\b/) },
        { text: '比對 Service 的 selector 和 Pod 的 labels：`kubectl describe svc frontend`、`kubectl get pods --show-labels`（擇一即可）', why: 'Pod 明明都是 Running，Service 卻沒有後端，九成是 selector 和 labels 對不上。', sol: ['kubectl describe svc frontend', 'kubectl get pods --show-labels'], check: (h) => h.ran(/--show-labels|\bdescribe\s+(svc|services?)\b/) },
        { text: '在編輯器裡修好 `k8s/frontend-service.yaml` 的 selector，再 `kubectl apply` 一次。', hint: 'Pod 的 label 是 `app=frontend`，Service 寫的是什麼？', sol: [{ edit: 'k8s/frontend-service.yaml', find: 'app: fronted', to: 'app: frontend' }, 'kubectl apply -f k8s/frontend-service.yaml'], check: (h) => { const s = h.res(h.orb, 'Service', 'default', 'frontend'); return !!s && S.endpoints(h.orb, s).length === 2; } },
        { text: '再 `curl http://frontend.default.svc.cluster.local` 一次，應該會拿到首頁。', sol: ['curl http://frontend.default.svc.cluster.local'], check: (h) => h.http((r) => r.code === 200 && /frontend\.default/.test(r.url)) },
      ],
      outro: '「Service 打不到」的排查順序請記下來：**先看 EndpointSlice 有沒有後端，沒有就比對 selector 和 labels，再來才懷疑 Pod 本身。**',
      real: ['kubectl get endpointslices -l kubernetes.io/service-name=frontend', 'kubectl get pods --show-labels', 'curl http://frontend.default.svc.cluster.local   # OrbStack 可以直接連'],
    },
    {
      id: '1-3', ch: 1, title: '擴展與自我修復', covers: [0, 1],
      intro: '這一關感受 Kubernetes 最核心的行為：**你說要幾個，它就維持幾個**。同時也會看到「手動改」和「檔案宣告」打架時誰會贏。',
      setup(w, sh) {
        boot(w, { 'k8s/frontend.yaml': feDeploy() + '---\n' + svc('frontend') });
        sh('kubectl apply -f k8s/frontend.yaml');
      },
      steps: [
        { text: '流量變大了，把前端擴到 3 個：`kubectl scale deploy/frontend --replicas=3`', sol: ['kubectl scale deploy/frontend --replicas=3'], check: (h) => h.ready(h.orb, 'default', 'frontend', 3) },
        { text: '動手破壞：用 `kubectl get pods` 找一個 Pod，然後 `kubectl delete pod <名稱>` 刪掉它。', hint: '打 `kubectl delete pod fr` 再按 Tab 可以補完名稱；也可以點右邊面板的 Pod，名稱會貼進終端機。', sol: [(w) => 'kubectl delete pod ' + w.clusters.orbstack.pods[0].name], check: (h) => h.w.stats.podDeletes > 0 },
        { text: '再看一次：`kubectl get pods`。數量還是 3，但有一個名字是新的。', why: '你刪的是 Pod，「要 3 個」的宣告還在，所以控制器立刻補了一個。這就是不必半夜起來重啟服務的原因。', sol: ['kubectl get pods'], check: (h) => h.ran(GET_PODS) && h.ready(h.orb, 'default', 'frontend', 3) },
        { text: '現在重新套用檔案：`kubectl apply -f k8s/frontend.yaml`，再看 Pod 數量。', why: '檔案裡寫的是 `replicas: 2`，所以叢集被拉回 2 個。**手動改的東西會被下一次 apply 蓋掉**。真正要擴展就改檔案，檔案才是事實來源。', sol: ['kubectl apply -f k8s/frontend.yaml'], check: (h) => h.ran(/\bapply\b/) && h.ready(h.orb, 'default', 'frontend', 2) },
      ],
      outro: '`kubectl scale`、`kubectl set image` 這類「命令式」指令適合救火和實驗；要長期保留的變更一律寫進 YAML。',
      real: ['kubectl scale deploy/frontend --replicas=3', 'kubectl delete pod <某個 Pod>  &&  kubectl get pods', 'kubectl apply -f frontend.yaml   # 觀察被拉回 replicas: 2'],
    },
    {
      id: '1-4', ch: 1, title: '滾動更新與回滾', covers: [5],
      intro: '設計師改了首頁，要上 v2。Kubernetes 預設用**滾動更新**：先開新的、確認健康、再關舊的，過程中服務不中斷。\n\n更重要的是：出事時要能在一分鐘內退回去。',
      setup(w, sh) {
        boot(w, { 'k8s/frontend.yaml': feDeploy() + '---\n' + svc('frontend') });
        sh('kubectl apply -f k8s/frontend.yaml');
      },
      steps: [
        { text: 'build 新版映像檔：`docker build -t frontend:v2 frontend`', sol: ['docker build -t frontend:v2 frontend'], check: (h) => !!h.w.images['frontend:v2'] },
        { text: '把 Deployment 的映像檔換成 v2：`kubectl set image deploy/frontend web=frontend:v2`', why: '`web` 是容器名稱。範本一變，Deployment 就會建立新的 ReplicaSet，開始滾動更新。', sol: ['kubectl set image deploy/frontend web=frontend:v2'], check: (h) => (container(h.orb, 'default', 'frontend', 'web') || {}).image === 'frontend:v2' },
        { text: '等更新完成：`kubectl rollout status deploy/frontend`', why: 'CI 裡一定會放這一步。它會等到新 Pod 全部就緒才回傳成功；新版起不來的話，這一步會失敗，流程就停在這裡。', sol: ['kubectl rollout status deploy/frontend'], check: (h) => h.ran(/\brollout\s+status\b/) },
        { text: '確認線上已經是 v2：`curl http://frontend.default.svc.cluster.local`', sol: ['curl http://frontend.default.svc.cluster.local'], check: (h) => h.http((r) => r.code === 200 && /v2/.test(r.body)) },
        { text: 'PM 衝過來說 v2 的結帳按鈕不見了。先看有哪些版本可以退：`kubectl rollout history deploy/frontend`', sol: ['kubectl rollout history deploy/frontend'], check: (h) => h.ran(/\brollout\s+history\b/) },
        { text: '退回上一版：`kubectl rollout undo deploy/frontend`，再 curl 確認。', why: '回滾其實也是一次滾動更新，只是範本換回舊的那一份。注意：這是救火用的命令式操作，事後記得讓檔案（或 Git）和叢集一致。', sol: ['kubectl rollout undo deploy/frontend'], check: (h) => h.ran(/\brollout\s+undo\b/) && (container(h.orb, 'default', 'frontend', 'web') || {}).image === 'frontend:dev' && h.ready(h.orb, 'default', 'frontend') },
      ],
      outro: '更新節奏由兩個參數控制：`maxSurge`（最多可以多開幾個）和 `maxUnavailable`（最多允許幾個不可用）。設成 `maxSurge: 1`、`maxUnavailable: 0` 就是「先確定新的活著，才動舊的」。',
      real: ['kubectl set image deploy/frontend web=frontend:v2', 'kubectl rollout status deploy/frontend', 'kubectl rollout history deploy/frontend', 'kubectl rollout undo deploy/frontend'],
    },
    {
      id: '1-5', ch: 1, title: '除錯：CrashLoopBackOff', covers: [6],
      intro: '早上進公司，前端全掛。有人昨晚改了 `k8s/frontend-deployment.yaml` 後直接 apply。\n\n這一關不給答案，給你**排查的順序**：`get` 看症狀 → `describe` 看事件與結束代碼 → `logs --previous` 看它死前說了什麼。',
      setup(w, sh) {
        boot(w, { 'k8s/frontend-deployment.yaml': feDeploy({ command: '["nginx", "-g", "daemon of;"]' }) });
        sh('kubectl apply -f k8s/frontend-deployment.yaml');
      },
      steps: [
        { text: '先看症狀：`kubectl get pods`', why: '`CrashLoopBackOff` 的意思是「容器啟動後馬上結束，Kubernetes 重啟它，又結束……重啟間隔越拉越長」。它是結果，不是原因。', sol: ['kubectl get pods'], check: (h) => h.ran(GET_PODS) },
        { text: '看細節：`kubectl describe pod <名稱>`。找 `Last State`、`Exit Code` 和最下面的 `Events`。', hint: '用 Tab 補完 Pod 名稱，或點右邊面板的紅色 Pod。', sol: [(w) => 'kubectl describe pod ' + w.clusters.orbstack.pods[0].name], check: (h) => h.ran(DESC_POD) },
        { text: '看它死前印了什麼：`kubectl logs <名稱> --previous`', why: '容器已經重啟過，目前這個可能還沒印出東西。`--previous` 會拿**上一次**（剛死掉那次）的輸出。', sol: [(w) => 'kubectl logs ' + w.clusters.orbstack.pods[0].name + ' --previous'], check: (h) => h.ran(/\blogs\b.*(--previous|\s-p\b)/) },
        { text: '依照 log 的線索修好 `k8s/frontend-deployment.yaml`，重新 apply，直到兩個 Pod 都 `1/1`。', hint: 'log 說 `daemon` 這個指令的值不對，只能是 on 或 off。', sol: [{ edit: 'k8s/frontend-deployment.yaml', find: 'daemon of;', to: 'daemon off;' }, 'kubectl apply -f k8s/frontend-deployment.yaml'], check: (h) => h.ready(h.orb, 'default', 'frontend', 2) },
      ],
      outro: 'Exit Code 也是線索：`1` 通常是程式自己報錯結束；`137` 是被強制終止（常見原因是記憶體超過上限，之後會遇到）；`StartError` 則是連執行檔都找不到，這種情況 logs 會是空的，要看 describe。',
      real: ['# 刻意把 command 寫錯再 apply，然後：', 'kubectl get pods', 'kubectl describe pod <名稱>', 'kubectl logs <名稱> --previous'],
    },
    {
      id: '1-6', ch: 1, title: '除錯：ImagePullBackOff', covers: [6],
      intro: '新同事照著網路教學，把映像檔 build 成 `frontend:latest`，manifest 也寫 `frontend:latest`。本機明明有這個映像檔，Pod 卻說拉不到。',
      setup(w, sh) {
        boot(w, { 'k8s/frontend-deployment.yaml': feDeploy({ image: 'frontend:latest' }) });
        w.images['frontend:latest'] = { app: 'frontend', label: 'latest' };
        sh('kubectl apply -f k8s/frontend-deployment.yaml');
      },
      steps: [
        { text: '看症狀：`kubectl get pods`', sol: ['kubectl get pods'], check: (h) => h.ran(GET_PODS) },
        { text: '映像檔相關的問題容器根本還沒啟動，所以 logs 沒東西，要看事件：`kubectl describe pod <名稱>`，讀最下面的 `Events`。', why: '事件顯示它跑去 `docker.io/library/frontend:latest` 拉。原因：tag 是 `latest` 時，`imagePullPolicy` 預設是 `Always`，**每次都去遠端 registry 拉**，就算本機有也一樣。', sol: [(w) => 'kubectl describe pod ' + w.clusters.orbstack.pods[0].name], check: (h) => h.ran(DESC_POD) },
        { text: '確認本機有哪些映像檔：`docker images`，然後把 manifest 改成用 `frontend:dev` 並重新 apply。', hint: '另一個解法是保留 latest，但加上 `imagePullPolicy: IfNotPresent`。兩種都能過關，不過明確的 tag 才知道現在跑的是哪一版。', sol: ['docker images', { edit: 'k8s/frontend-deployment.yaml', find: 'image: frontend:latest', to: 'image: frontend:dev' }, 'kubectl apply -f k8s/frontend-deployment.yaml'], check: (h) => h.ready(h.orb, 'default', 'frontend', 2) },
      ],
      outro: '`ImagePullBackOff` 的常見原因就三種：**名稱或 tag 打錯、沒有權限拉、本機映像檔用了 `latest`**。第三章上雲之後你會再遇到前兩種。\n\n第一章完成。你已經能部署、對外、擴展、更新、回滾一個服務，並排除兩種最常見的故障。',
      real: ['docker build -t frontend:latest .   # 然後 manifest 也寫 :latest', 'kubectl describe pod <名稱>         # 看 Events', '# 改用 :dev 之類的明確 tag 再 apply'],
    },

    // ================= 第 2 章 =================
    {
      id: '2-1', ch: 2, title: '設定與機密：ConfigMap、Secret', covers: [3, 6],
      intro: '後端 API 加入了。它需要兩個環境變數：`APP_ENV`（一般設定）和 `DATABASE_URL`（含密碼，是機密）。本機的 Postgres 已經在叢集裡跑著。\n\n後端的 Deployment 已經 apply 了，但起不來。',
      setup(w, sh) {
        bootFull(w, sh, { envFrom: 'todo', readiness: null, liveness: false, mem: null });
        sh('kubectl delete cm backend-config');
        sh('kubectl delete secret backend-secret');
      },
      steps: [
        { text: '看後端為什麼起不來：`kubectl logs deploy/backend`', why: '`deploy/backend` 讓 kubectl 自己挑一個 Pod，不用查名稱。log 會告訴你它缺哪個環境變數。', sol: ['kubectl logs deploy/backend'], check: (h) => h.ran(/\blogs\b.*backend/) },
        { text: '一般設定放 ConfigMap。檔案已經寫好，套用它：`kubectl apply -f k8s/backend-config.yaml`', sol: ['kubectl apply -f k8s/backend-config.yaml'], check: (h) => !!h.res(h.orb, 'ConfigMap', 'default', 'backend-config') },
        { text: '機密放 Secret，而且**不寫成檔案進版控**，直接用指令建立：\n`kubectl create secret generic backend-secret --from-literal=DATABASE_URL=' + DB_LOCAL + '`', why: '主機名稱 `postgres` 就是資料庫那個 Service 的名稱，同一個 namespace 裡可以直接用短名稱。', sol: ['kubectl create secret generic backend-secret --from-literal=DATABASE_URL=' + DB_LOCAL], check: (h) => { const s = h.res(h.orb, 'Secret', 'default', 'backend-secret'); return !!s && !!S.secretData(s).DATABASE_URL; } },
        { text: '光建立還不夠，Pod 要「引用」它們。編輯 `k8s/backend-deployment.yaml`，把 TODO 那行換成 `envFrom`，再 apply。', hint: '格式：\n`envFrom:`\n`  - configMapRef:`\n`      name: backend-config`\n`  - secretRef:`\n`      name: backend-secret`\n縮排要和上面的 `ports:` 對齊。', sol: [{ write: 'k8s/backend-deployment.yaml', content: beDeploy({ readiness: null, liveness: false, mem: null }) }, 'kubectl apply -f k8s/backend-deployment.yaml'], check: (h) => h.ready(h.orb, 'default', 'backend', 2) },
        { text: '進容器確認環境變數真的進去了：`kubectl exec deploy/backend -- env`', sol: ['kubectl exec deploy/backend -- env'], check: (h) => h.ran(/\bexec\b.*--\s*(env|printenv)/) },
        { text: '打 API 驗收：`curl http://backend.default.svc.cluster.local/api/hello`', sol: ['curl http://backend.default.svc.cluster.local/api/hello'], check: (h) => h.http((r) => r.code === 200 && r.path === '/api/hello') },
      ],
      outro: '兩件事要知道：\n1. Secret 只是 base64 編碼，**不是加密**。`kubectl get secret backend-secret -o yaml` 看得到內容，所以才不該進版控。\n2. 之後改了 ConfigMap，已經在跑的 Pod **不會自動拿到新值**（環境變數是啟動時帶入的），要 `kubectl rollout restart deploy/backend`。',
      real: ['kubectl create secret generic backend-secret --from-literal=DATABASE_URL=...', 'kubectl get secret backend-secret -o yaml   # 看到 base64', 'kubectl exec deploy/backend -- env'],
    },
    {
      id: '2-2', ch: 2, title: '健康檢查：readiness 與 liveness', covers: [2, 6],
      intro: '上次後端更新時，有幾秒鐘使用者拿到錯誤：新 Pod 還在連資料庫，就已經被分到流量。解法是加 **readinessProbe**。\n\n同事加好並 apply 了，結果更新卡住。',
      setup(w, sh) {
        bootFull(w, sh, { readiness: null, liveness: false, mem: null });
        w.files['k8s/backend-deployment.yaml'] = beDeploy({ readiness: '/health', liveness: 'todo', mem: null });
        sh('kubectl apply -f k8s/backend-deployment.yaml');
      },
      steps: [
        { text: '看現況：`kubectl get pods`', why: '注意後端有 3 個 Pod：2 個舊的 `1/1`，1 個新的 `Running` 但 `0/1`。`0/1` 的意思是「容器在跑，但還沒通過 readiness」。', sol: ['kubectl get pods'], check: (h) => h.ran(GET_PODS) },
        { text: '看更新進度：`kubectl rollout status deploy/backend`', why: '因為設了 `maxUnavailable: 0`，新 Pod 沒就緒之前舊 Pod 不會被關掉，所以**使用者完全沒感覺**。這個設定剛剛救了你。', sol: ['kubectl rollout status deploy/backend'], check: (h) => h.ran(/\brollout\s+status\b/) },
        { text: '找出新 Pod 為什麼不就緒：`kubectl describe pod <0/1 的那個>`，看 Events。', hint: '新 Pod 的名稱中間那段雜湊和另外兩個不一樣。', sol: [(w) => 'kubectl describe pod ' + w.clusters.orbstack.pods.find((p) => p.owner === 'backend' && !p.st.ready).name], check: (h) => h.ran(DESC_POD) },
        { text: '後端的健康檢查端點其實是 `/healthz`。修好 readinessProbe 的路徑，順便把 TODO 換成 livenessProbe，再 apply。', hint: 'livenessProbe 的寫法和 readinessProbe 一樣，多加一行 `initialDelaySeconds: 10`，讓程式有時間啟動。', sol: [{ write: 'k8s/backend-deployment.yaml', content: beDeploy({ mem: null }) }, 'kubectl apply -f k8s/backend-deployment.yaml'], check: (h) => { const x = container(h.orb, 'default', 'backend', 'api'); return !!x && !!x.livenessProbe && ((x.readinessProbe || {}).httpGet || {}).path === '/healthz' && h.ready(h.orb, 'default', 'backend', 2); } },
        { text: '確認 Service 的後端清單：`kubectl get endpointslices`', why: '只有通過 readiness 的 Pod 才會出現在這裡。', sol: ['kubectl get endpointslices'], check: (h) => h.ran(/\bget\s+(endpointslices?|ep|endpoints)\b/) },
      ],
      outro: '兩種 probe 回答不同的問題：\n• **readiness**：現在能接流量嗎？失敗 → 從 Service 拿掉，不重啟。\n• **liveness**：是不是卡死了？失敗 → 重啟容器。\n\nliveness 設太嚴格（例如程式啟動要 20 秒，卻 5 秒就開始檢查）會讓健康的服務被一直重啟，這也是 CrashLoopBackOff 的常見原因。',
      real: ['# 故意把 readinessProbe 的 path 寫錯再 apply', 'kubectl get pods            # 觀察 0/1', 'kubectl get endpointslices  # 觀察它不在清單裡'],
    },
    {
      id: '2-3', ch: 2, title: '資源：requests、limits 與 OOMKilled', covers: [2, 6],
      intro: '為了「省資源」，有人把後端的記憶體上限設成 `64Mi` 然後 apply。新的 Pod 起不來。',
      setup(w, sh) {
        bootFull(w, sh, { mem: null });
        w.files['k8s/backend-deployment.yaml'] = beDeploy({ mem: '64Mi', requests: 'todo' });
        sh('kubectl apply -f k8s/backend-deployment.yaml');
      },
      steps: [
        { text: '看症狀：`kubectl get pods`', sol: ['kubectl get pods'], check: (h) => h.ran(GET_PODS) },
        { text: '`kubectl describe pod <CrashLoopBackOff 的那個>`，找 `Last State` 的 `Reason` 和 `Exit Code`。', why: '`OOMKilled`、`Exit Code 137`：容器用的記憶體超過 `limits.memory`，被核心直接終止。程式沒機會印錯誤訊息，所以 **logs 裡看不出原因**，只能從 describe 看。', sol: [(w) => 'kubectl describe pod ' + w.clusters.orbstack.pods.find((p) => p.owner === 'backend' && !p.st.ready).name], check: (h) => h.ran(DESC_POD) },
        { text: '編輯 `k8s/backend-deployment.yaml`：把記憶體上限改成 `512Mi`，並把 TODO 換成 `requests`（`cpu: 250m`、`memory: 512Mi`），再 apply。', hint: '`requests:` 和 `limits:` 同一層，底下各有 `cpu`／`memory`。', sol: [{ write: 'k8s/backend-deployment.yaml', content: beDeploy() }, 'kubectl apply -f k8s/backend-deployment.yaml'], check: (h) => { const r = ((container(h.orb, 'default', 'backend', 'api') || {}).resources || {}).requests || {}; return !!r.cpu && !!r.memory && h.ready(h.orb, 'default', 'backend', 2); } },
      ],
      outro: '• **requests**：排程用的「保證量」。節點剩餘資源不夠 requests，Pod 會卡在 `Pending`。\n• **limits**：上限。記憶體超過會被 OOMKilled；CPU 超過只會被限速。\n\n常見做法：記憶體的 requests 和 limits 設一樣，CPU 只設 requests。到了 GKE Autopilot，**費用就是照 requests 算的**，第三章會親眼看到。',
      real: ['# 把 limits.memory 設成很小（例如 16Mi）再 apply', 'kubectl describe pod <名稱>   # Last State: OOMKilled, Exit Code 137'],
    },
    {
      id: '2-4', ch: 2, title: '入口：Gateway 與 HTTPRoute', covers: [0, 4],
      intro: '前端和後端都好了，但使用者不會打 `xxx.svc.cluster.local`。我們要**一個**對外入口，依路徑分流：`/api` 給後端，其他給前端。這樣前後端同網域，也不用處理 CORS。\n\n• **Gateway**：入口本身（聽哪個埠、用哪一種實作）\n• **HTTPRoute**：路由規則（哪個路徑送到哪個 Service）',
      setup(w, sh) {
        bootFull(w, sh);
        Object.assign(w.files, { 'k8s/gateway.yaml': gateway('traefik'), 'k8s/httproute.yaml': httproute(false) });
      },
      steps: [
        { text: '先看叢集裝了哪些 Gateway 實作：`kubectl get gatewayclass`', why: 'Gateway API 只是規格，要有人實作。OrbStack 預設**沒有**裝任何實作，這個模擬叢集已經幫你裝好 Traefik；真的環境要自己用 Helm 裝。', sol: ['kubectl get gatewayclass'], check: (h) => h.ran(/\bget\s+(gc|gatewayclass(es)?)\b/) },
        { text: '建立入口：`kubectl apply -f k8s/gateway.yaml`', sol: ['kubectl apply -f k8s/gateway.yaml'], check: (h) => { const g = h.res(h.orb, 'Gateway', 'default', 'web'); return !!g && S.gatewayInfo(h.orb, g).programmed; } },
        { text: '套用路由 `kubectl apply -f k8s/httproute.yaml`，然後 `curl http://app.k8s.orb.local/`', why: 'OrbStack 會把 `*.k8s.orb.local` 這個萬用網域指到叢集的入口，不用改 hosts 檔。', sol: ['kubectl apply -f k8s/httproute.yaml', 'curl http://app.k8s.orb.local/'], check: (h) => !!h.res(h.orb, 'HTTPRoute', 'default', 'app') && h.http((r) => /orb\.local/.test(r.url) && r.path === '/' && r.code === 200) },
        { text: '再打 API：`curl http://app.k8s.orb.local/api/hello`。咦，回來的是什麼？', why: '目前只有一條 `/` 的規則，所有請求（包含 `/api/...`）都送到前端，前端就回了首頁的 HTML。', sol: ['curl http://app.k8s.orb.local/api/hello'], check: (h) => h.http((r) => /orb\.local/.test(r.url) && /^\/api/.test(r.path)) },
        { text: '編輯 `k8s/httproute.yaml`，把 TODO 換成一條 `/api` → `backend:80` 的規則，apply 後再 curl，應該拿到 JSON。', hint: '照抄下面 `/` 那條規則的結構，把 `value` 改成 `/api`、`name` 改成 `backend`。多條規則同時符合時，**比較長的路徑優先**。', sol: [{ write: 'k8s/httproute.yaml', content: httproute(true) }, 'kubectl apply -f k8s/httproute.yaml', 'curl http://app.k8s.orb.local/api/hello'], check: (h) => S.httpGet(h.w, 'http://app.k8s.orb.local/api/hello').app === 'backend' && h.http((r) => r.app === 'backend') },
      ],
      outro: '右邊面板現在應該能看到完整的路徑：`Gateway → /api → backend`、`/ → frontend`。這就是第 0 章那張圖。\n\n舊教材會用 Ingress 做同一件事。看到 `kind: Ingress` 時，把它想成「Gateway 加 HTTPRoute 合在一個資源裡的舊版」就看得懂了。',
      real: ['# 先依 Traefik 官方文件用 Helm 安裝並啟用 Gateway API', 'kubectl get gatewayclass', 'kubectl apply -f gateway.yaml -f httproute.yaml', 'curl http://app.k8s.orb.local/api/hello'],
    },
    {
      id: '2-5', ch: 2, title: 'Kustomize：一份 base，多個環境', covers: [1, 3],
      intro: '檔案越來越多，而且本機和雲端只差一點點（映像檔位置、環境變數、資料庫）。複製兩份 YAML 遲早會改漏。\n\n**Kustomize**（kubectl 內建）的做法：共用的放 `base/`，每個環境一個 `overlays/<環境>/`，只寫差異。專案已經整理成這個結構，請看檔案區。\n\n叢集已清空，這次要用一行指令建好整套環境。',
      setup(w) {
        boot(w);
        w.files = kfiles({ localTodo: true });
      },
      steps: [
        { text: '先預覽 Kustomize 會產生什麼，不真的套用：`kubectl kustomize k8s/overlays/local`', why: '養成習慣：apply 之前先看一眼產出的 YAML。真實環境還可以用 `kubectl apply -k ... --dry-run=server` 讓叢集幫你驗證。', sol: ['kubectl kustomize k8s/overlays/local'], check: (h) => h.ran(/kubectl\s+kustomize|kustomize\s+build/) },
        { text: '套用整個 overlay：`kubectl apply -k k8s/overlays/local`', sol: ['kubectl apply -k k8s/overlays/local'], check: (h) => h.ran(/\bapply\s+(-k|--kustomize)\b/) && !!h.res(h.orb, 'Namespace', '', 'app-local') },
        { text: '資源都建在 `app-local` 這個 namespace，要加 `-n` 才看得到：`kubectl get pods -n app-local`', why: '前端和後端是 `ImagePullBackOff`。base 裡的映像檔寫的是沒有 tag 的 `frontend`／`backend`（等於 `latest`），overlay 還沒告訴它要用哪個 tag。', sol: ['kubectl get pods -n app-local'], check: (h) => h.ran(/\bget\s+(po|pods?)\b.*(-n|--namespace)[ =]app-local|\bget\s+(po|pods?)\b.*\s-A\b/) },
        { text: '編輯 `k8s/overlays/local/kustomization.yaml`，完成兩個 TODO：用 `patches` 套用 `patch-config.yaml`，用 `images` 把兩個映像檔的 tag 改成 `dev`。然後再 apply -k 一次。', hint: '`patches:`\n`  - path: patch-config.yaml`\n`images:`\n`  - name: frontend`\n`    newTag: dev`\n`  - name: backend`\n`    newTag: dev`', sol: [{ write: 'k8s/overlays/local/kustomization.yaml', content: kfiles()['k8s/overlays/local/kustomization.yaml'] }, 'kubectl apply -k k8s/overlays/local'], check: (h) => h.ready(h.orb, 'app-local', 'frontend', 2) && ((h.res(h.orb, 'ConfigMap', 'app-local', 'backend-config') || {}).data || {}).APP_ENV === 'local' },
        { text: '後端還缺 Secret（它不在版控裡，所以 Kustomize 不會建）。在 `app-local` 建立它：\n`kubectl create secret generic backend-secret -n app-local --from-literal=DATABASE_URL=' + DB_LOCAL + '`', why: 'Secret 屬於某個 namespace。之前建在 `default` 的那個，`app-local` 裡的 Pod 用不到。', sol: ['kubectl create secret generic backend-secret -n app-local --from-literal=DATABASE_URL=' + DB_LOCAL], check: (h) => h.ready(h.orb, 'app-local', 'backend', 2) },
        { text: '驗收：`curl http://app.k8s.orb.local/api/hello`，回應裡的 `env` 應該是 `local`。', sol: ['curl http://app.k8s.orb.local/api/hello'], check: (h) => h.http((r) => r.code === 200 && r.path === '/api/hello' && /"env":"local"/.test(r.body)) },
      ],
      outro: '第二章完成。你現在有一套可以一行指令重建的本機環境：前端、後端、資料庫、設定、健康檢查、資源、入口都齊了。\n\n模擬器簡化的地方：真的 Kustomize 還有 `configMapGenerator`（會在名稱後面加雜湊，設定一改就自動觸發滾動更新），這裡沒有模擬，實機練習時值得試。',
      real: ['kubectl kustomize k8s/overlays/local', 'kubectl apply -k k8s/overlays/local --dry-run=server', 'kubectl apply -k k8s/overlays/local', 'kubectl get all -n app-local'],
    },

    // ================= 第 3 章 =================
    {
      id: '3-1', ch: 3, title: '映像檔上雲：Artifact Registry', covers: [6, 7],
      intro: '這一章換到**模擬的 GKE Autopilot 叢集**。這裡沒有真的雲端，不會產生任何費用；但錯誤訊息和踩坑的順序，和真的 GKE 是一樣的。\n\n同一份 `base`，新增了 `overlays/gke-staging/`。同事已經建好 namespace `app-staging` 和裡面的 Secret。你的任務是讓 Pod 拉得到映像檔。',
      setup(w, sh) {
        boot(w);
        w.files = kfiles({ gkeImages: false, patch: false, hcListed: false });
        w.ctx = 'gke-staging';
        sh('kubectl apply -f k8s/overlays/gke-staging/namespace.yaml');
        sh('kubectl create secret generic backend-secret -n app-staging --from-literal=DATABASE_URL=' + DB_GKE);
        w.ctx = 'orbstack';
      },
      steps: [
        { text: 'kubectl 用 **context** 決定現在對哪個叢集下指令。列出來看看：`kubectl config get-contexts`', sol: ['kubectl config get-contexts'], check: (h) => h.ran(/\bconfig\s+get-contexts\b/) },
        { text: '切到雲端叢集：`kubectl config use-context gke-staging`', why: '畫面右上角會顯示目前的 context。**下指令前先確認 context**，對錯叢集 apply 或 delete 是真實世界很常見的事故。', sol: ['kubectl config use-context gke-staging'], check: (h) => h.w.ctx === 'gke-staging' },
        { text: '直接套用雲端的 overlay：`kubectl apply -k k8s/overlays/gke-staging`，再 `kubectl get pods -n app-staging`', sol: ['kubectl apply -k k8s/overlays/gke-staging', 'kubectl get pods -n app-staging'], check: (h) => h.ran(/\bapply\s+-k\s+k8s\/overlays\/gke-staging/) && h.gke.pods.length > 0 },
        { text: '`ImagePullBackOff`。看事件：`kubectl describe pod <名稱> -n app-staging`', why: '雲端的節點上沒有你筆電 build 的映像檔。它跑去 Docker Hub 找 `frontend:dev`，當然找不到。映像檔必須放在叢集拉得到的 registry，在 GCP 就是 **Artifact Registry**。', sol: [(w) => 'kubectl describe pod ' + w.clusters['gke-staging'].pods[0].name + ' -n app-staging'], check: (h) => h.ran(DESC_POD) },
        { text: '讓本機的 docker 能登入 Artifact Registry：`gcloud auth configure-docker ' + S.AR_HOST + '`', sol: ['gcloud auth configure-docker ' + S.AR_HOST], check: (h) => h.w.dockerAuth },
        { text: '用 git commit 的 SHA 當 tag（`git rev-parse --short HEAD` 會得到 `a1b2c3d`），把兩個映像檔 tag 成完整路徑並推上去：\n`docker tag frontend:dev ' + AR + '/frontend:a1b2c3d`\n`docker push ' + AR + '/frontend:a1b2c3d`\nbackend 也做一次。', why: '路徑格式是 `地區-docker.pkg.dev/專案/儲存庫/映像檔:tag`。用 SHA 當 tag，就能從叢集裡跑的版本一路追回是哪個 commit。', hint: '打到 `asia` 按 Tab 可以補完很長的那段路徑。', sol: ['git rev-parse --short HEAD', 'docker tag frontend:dev ' + AR + '/frontend:a1b2c3d', 'docker push ' + AR + '/frontend:a1b2c3d', 'docker tag backend:dev ' + AR + '/backend:a1b2c3d', 'docker push ' + AR + '/backend:a1b2c3d'], check: (h) => !!h.w.registry[AR + '/frontend:a1b2c3d'] && !!h.w.registry[AR + '/backend:a1b2c3d'] },
        { text: '編輯 `k8s/overlays/gke-staging/kustomization.yaml` 的 `images`：`newName` 改成完整路徑（不含 tag），`newTag` 改成 `a1b2c3d`。再 apply -k。', hint: '`newName: ' + AR + '/frontend`\n`newTag: a1b2c3d`', sol: [{ write: GKE_K, content: kfiles({ patch: false, hcListed: false })[GKE_K] }, APPLY_GKE], check: (h) => h.ready(h.gke, 'app-staging', 'frontend', 2) && h.gke.pods.some((p) => p.owner === 'backend') && h.gke.pods.every((p) => p.st.status !== 'ImagePullBackOff') },
      ],
      outro: '前端綠了。後端從 `ImagePullBackOff` 變成 `CrashLoopBackOff`，這是**進步**：映像檔拉到了，換成下一個問題。除錯就是這樣一層一層往下剝。\n\n真的 GKE 上，節點預設就有權限讀同專案的 Artifact Registry，所以叢集這一側通常不用另外設定。',
      real: ['# 以下需要真的 GCP 專案（會產生費用），這裡只列出對應的真實指令：', 'gcloud auth configure-docker asia-east1-docker.pkg.dev', 'docker tag frontend:dev asia-east1-docker.pkg.dev/<專案>/<儲存庫>/frontend:$(git rev-parse --short HEAD)', 'docker push ...'],
    },
    {
      id: '3-2', ch: 3, title: '資料庫在叢集外：Cloud SQL 與 Workload Identity', covers: [6, 7],
      intro: '正式環境的資料庫不放叢集裡，用託管的 **Cloud SQL**（備份、高可用、升級都有人顧）。Google 建議的連線方式是在 Pod 裡多放一個 **Cloud SQL Auth Proxy** 容器：應用程式連 `127.0.0.1:5432`，proxy 負責加密並轉到 Cloud SQL。\n\nSecret 裡的 `DATABASE_URL` 已經指向 `127.0.0.1`。patch 檔 `patch-backend-sqlproxy.yaml` 寫了一半。',
      setup(w, sh) {
        bootGke(w, sh, { patch: false, restart: false, sa: false, hcListed: false });
      },
      steps: [
        { text: '確認後端現在的錯誤：`kubectl logs deploy/backend -n app-staging`', why: '`ECONNREFUSED 127.0.0.1:5432`：Pod 裡的 5432 埠沒有程式在聽，因為 proxy 還沒放進去。', sol: ['kubectl logs deploy/backend -n app-staging'], check: (h) => h.ran(/\blogs\b.*backend/) },
        { text: '把 patch 掛上去：在 `k8s/overlays/gke-staging/kustomization.yaml` 的 `patches` 加一項 `- path: patch-backend-sqlproxy.yaml`，然後 apply -k。', sol: [{ write: GKE_K, content: kfiles({ hcListed: false })[GKE_K] }, APPLY_GKE], check: (h) => !!container(h.gke, 'app-staging', 'backend', 'cloud-sql-proxy') },
        { text: '看結果：`kubectl get pods -n app-staging`', why: '狀態是 `Init:0/1`。一般的 init container 必須**跑完結束**，主容器才會啟動；但 proxy 是常駐程式，永遠不會結束，所以整個 Pod 卡在初始化。', sol: ['kubectl get pods -n app-staging'], check: (h) => h.ran(GET_PODS) },
        { text: '在 `patch-backend-sqlproxy.yaml` 的 proxy 容器加上 `restartPolicy: Always`（取代那行 TODO），再 apply -k。', why: '加了這個欄位的 init container 就是**原生 sidecar**：先啟動、然後陪主容器一起跑。READY 會變成 `x/2`。', sol: [{ write: GKE_PATCH, content: kfiles({ sa: false })[GKE_PATCH] }, APPLY_GKE], check: (h) => (container(h.gke, 'app-staging', 'backend', 'cloud-sql-proxy') || {}).restartPolicy === 'Always' },
        { text: '後端還是掛。這次問 proxy：`kubectl logs deploy/backend -n app-staging -c cloud-sql-proxy`', why: '一個 Pod 有多個容器時，用 `-c` 指定要看哪一個。proxy 說 `403 NOT_AUTHORIZED`，而且身分是 `app-staging/default`。', sol: ['kubectl logs deploy/backend -n app-staging -c cloud-sql-proxy'], check: (h) => h.ran(/\blogs\b.*-c[ =]?cloud-sql-proxy/) },
        { text: 'IAM 那邊授權的是 KSA `backend`，但 Pod 用的是預設的 `default`。在 patch 檔把另一行 TODO 換成 `serviceAccountName: backend`，再 apply -k。', why: '這就是 **Workload Identity Federation**：Pod 以 Kubernetes ServiceAccount 的身分直接向 GCP 驗證。整個過程**沒有任何 JSON 金鑰檔**，沒有東西可以外洩。', sol: [{ write: GKE_PATCH, content: kfiles()[GKE_PATCH] }, APPLY_GKE], check: (h) => h.ready(h.gke, 'app-staging', 'backend', 2) },
      ],
      outro: '後端現在是 `2/2`：API 容器加上 proxy sidecar。\n\n回想一下這三關的除錯路徑：`ImagePullBackOff` → `CrashLoopBackOff（連不到）` → `Init:0/1` → `CrashLoopBackOff（403）` → 正常。每一步都是靠 `get`、`describe`、`logs` 這三個指令找到線索的。',
      real: ['# 真實環境還需要（不在模擬範圍）：建立 Cloud SQL 執行個體、', '# 把 roles/cloudsql.client 授予 KSA 的 principal（見研究報告 3.2 節）', 'kubectl logs deploy/backend -n app-staging -c cloud-sql-proxy'],
    },
    {
      id: '3-3', ch: 3, title: '雲端入口：GKE Gateway 的健康檢查陷阱', covers: [4, 6],
      intro: 'Pod 全部健康，Gateway 也建好了（`gatewayClassName: gke-l7-global-external-managed`，背後是 Google 的全域負載平衡器）。但 QA 說 API 全部打不通。\n\n這是 GKE 上最經典的一個坑。',
      setup(w, sh) {
        bootGke(w, sh, { hcListed: false, hcPath: '/   # TODO：後端的健康檢查端點不是這個' });
      },
      steps: [
        { text: '拿到入口的對外 IP：`kubectl get gateway -n app-staging`', sol: ['kubectl get gateway -n app-staging'], check: (h) => h.ran(/\bget\s+(gateways?|gtw)\b/) },
        { text: '打前端：`curl http://' + IP + '/`', sol: ['curl http://' + IP + '/'], check: (h) => h.http((r) => r.url.includes(IP) && r.path === '/' && r.code === 200) },
        { text: '打 API：`curl http://' + IP + '/api/hello`', why: '`no healthy upstream`：負載平衡器認為後端**沒有任何健康的 Pod**，所以連送都不送。可是 `kubectl get pods` 明明全綠……', sol: ['curl http://' + IP + '/api/hello'], check: (h) => h.http((r) => r.url.includes(IP) && /^\/api/.test(r.path)) },
        { text: '繞過負載平衡器，直接打 Service 來縮小範圍：\n`kubectl port-forward svc/backend 8080:80 -n app-staging`\n`curl http://localhost:8080/healthz`', why: '`port-forward` 在你的電腦和叢集裡的 Service 之間開一條隧道。直接打是通的，表示 Pod 和 Service 沒問題，**問題出在負載平衡器怎麼判斷健康**。', sol: ['kubectl port-forward svc/backend 8080:80 -n app-staging', 'curl http://localhost:8080/healthz'], check: (h) => h.ran(/\bport-forward\b/) && h.http((r) => /localhost|127\.0\.0\.1/.test(r.url) && r.code === 200) },
        { text: '原因：GKE Gateway **不會**讀 Pod 的 readinessProbe，它自己的健康檢查預設打 `/` 而且只接受 200。後端的 `/` 回 404。\n\n修法：把 `healthcheckpolicy.yaml` 裡的 `requestPath` 改成 `/healthz`，並把這個檔案加進 `kustomization.yaml` 的 `resources`，然後 apply -k，再 curl API。', hint: '`kubectl describe httproute app -n app-staging` 可以看到每條規則的後端健康狀態與原因。', sol: [{ write: 'k8s/overlays/gke-staging/healthcheckpolicy.yaml', content: kfiles()['k8s/overlays/gke-staging/healthcheckpolicy.yaml'] }, { write: GKE_K, content: kfiles()[GKE_K] }, APPLY_GKE, 'curl http://' + IP + '/api/hello'], check: (h) => S.httpGet(h.w, 'http://' + IP + '/api/hello').code === 200 && h.http((r) => r.url.includes(IP) && r.path === '/api/hello' && r.code === 200) },
      ],
      outro: '前端沒事是因為它的 `/` 本來就回 200，剛好符合預設值。這種「一半好一半壞」的狀況很容易讓人往錯的方向查。\n\n`HealthCheckPolicy` 是 GKE 專屬的資源，所以只放在 `overlays/gke-staging/`，本機的 overlay 不需要（放了反而會報「no matches for kind」）。這正是 overlay 存在的意義。',
      real: ['kubectl port-forward svc/backend 8080:80 -n <namespace>   # 另開視窗 curl localhost:8080/healthz', 'kubectl describe httproute <名稱> -n <namespace>'],
    },
    {
      id: '3-4', ch: 3, title: 'Autopilot 帳單：requests 就是錢', covers: [2, 7],
      intro: 'GKE Autopilot 不用管節點，費用是**照每個 Pod 的 `requests` 算**。財務問這個 staging 環境為什麼這麼貴。\n\n模擬器用「點數」代表費用（不是真實價格，只看相對大小）。目標：壓到 **60 點以下**，而且服務都要健康。',
      setup(w, sh) {
        bootGke(w, sh, { frontReq: false, proxyReq: false });
      },
      steps: [
        { text: '看費用明細：`sim cost`（這是模擬器專用的指令，右邊面板也有顯示）', why: '有容器沒設 requests 時，Autopilot 會套用預設值 **0.5 vCPU／2 GiB**。一個只送靜態檔的 nginx 根本用不到這麼多。', sol: ['sim cost'], check: (h) => h.ran(/\bsim\s+cost\b/) },
        { text: '幫前端設 requests：編輯 `k8s/base/frontend/deployment.yaml`，把 TODO 換成 `resources`（`requests` 的 `cpu: 250m`、`memory: 512Mi`），再 apply -k。', hint: '可以參考 `k8s/base/backend/deployment.yaml` 裡的寫法。Autopilot 不使用 bursting 時的下限就是 250m／512Mi，設更小也會被調上來。', sol: [{ write: 'k8s/base/frontend/deployment.yaml', content: kfiles()['k8s/base/frontend/deployment.yaml'] }, APPLY_GKE], check: (h) => { const r = ((container(h.gke, 'app-staging', 'frontend', 'web') || {}).resources || {}).requests || {}; return !!r.cpu && !!r.memory && h.ready(h.gke, 'app-staging', 'frontend', 2); } },
        { text: '再跑一次 `sim cost`，找出還有誰在用預設值，一樣補上 requests，直到合計 ≤ 60 點。', hint: '後端 Pod 裡有兩個容器。sidecar 定義在 `patch-backend-sqlproxy.yaml`。', sol: ['sim cost', { write: GKE_PATCH, content: kfiles()[GKE_PATCH] }, APPLY_GKE, 'sim cost'], check: (h) => h.gke.pods.length >= 4 && S.costOf(h.gke).total <= 60 && h.ready(h.gke, 'app-staging', 'frontend') && h.ready(h.gke, 'app-staging', 'backend') },
      ],
      outro: '費用少了將近一半，而且沒有動到任何程式碼。\n\n第三章完成。真實環境還有幾項固定成本要記得：叢集管理費（有免費額度可抵一個叢集）、負載平衡器、Cloud SQL。**練習完把叢集刪掉**，是在真的 GKE 上最重要的一個習慣。',
      real: ['# 真實的費用請用 GCP 的 Pricing Calculator 與帳單報表', 'kubectl get pods -n <ns> -o yaml | grep -A4 requests'],
    },

    // ================= 第 4 章 =================
    {
      id: '4-1', ch: 4, title: '扮演 CI：發布、失敗、回滾', covers: [5, 6, 8],
      intro: 'CI/CD 流程其實就是把你前面手動做的事寫成腳本：\n`build（tag = git SHA）→ push → 更新 overlay 的 tag → apply -k → rollout status`\n\n這一關由你親手當一次 CI。有一個新的 commit 剛 merge 進 main。',
      setup(w, sh) {
        bootGke(w, sh);
        w.git = 'f4e5d6c';
        w.buildBug.backend = { bug: 'crash', msg: "TypeError: Cannot read properties of undefined (reading 'port')\n    at createServer (/app/server.js:21:34)" };
      },
      steps: [
        { text: '取得這次 commit 的 SHA：`git rev-parse --short HEAD`', sol: ['git rev-parse --short HEAD'], check: (h) => h.ran(/\bgit\s+rev-parse\b/) },
        { text: 'build 後端並推上去，tag 用剛剛的 SHA：\n`docker build -t ' + AR + '/backend:f4e5d6c backend`\n`docker push ' + AR + '/backend:f4e5d6c`', sol: ['docker build -t ' + AR + '/backend:f4e5d6c backend', 'docker push ' + AR + '/backend:f4e5d6c'], check: (h) => !!h.w.registry[AR + '/backend:f4e5d6c'] },
        { text: '把 `k8s/overlays/gke-staging/kustomization.yaml` 裡 backend 的 `newTag` 改成 `f4e5d6c`，然後 apply -k。', why: '真的 CI 會用 `kustomize edit set image` 自動改這一行。重點是**版本寫在檔案裡**，Git 記錄就是部署記錄。', sol: [{ write: GKE_K, content: kfiles({ backendTag: 'f4e5d6c' })[GKE_K] }, APPLY_GKE], check: (h) => /f4e5d6c$/.test((container(h.gke, 'app-staging', 'backend', 'api') || {}).image || '') },
        { text: 'CI 的最後一步：`kubectl rollout status deploy/backend -n app-staging`', why: '它卡住了，在 CI 裡這一步會逾時失敗，整條 pipeline 亮紅燈。**這就是它存在的目的**：新版本有問題時要有人知道。', sol: ['kubectl rollout status deploy/backend -n app-staging'], check: (h) => h.ran(/\brollout\s+status\b/) },
        { text: '線上壞了嗎？`curl http://' + IP + '/api/hello`', why: '還是好的，而且 `version` 是舊的 `a1b2c3d`。因為 `maxUnavailable: 0` 加上 readinessProbe，壞掉的新 Pod 從頭到尾沒接到流量。', sol: ['curl http://' + IP + '/api/hello'], check: (h) => h.http((r) => r.url.includes(IP) && r.path === '/api/hello' && r.code === 200) },
        { text: '找出新版為什麼起不來：`kubectl logs deploy/backend -n app-staging`', sol: ['kubectl logs deploy/backend -n app-staging'], check: (h) => h.ran(/\blogs\b.*backend/) },
        { text: '是程式的 bug，要請後端修。先把叢集退回去：`kubectl rollout undo deploy/backend -n app-staging`', sol: ['kubectl rollout undo deploy/backend -n app-staging'], check: (h) => h.ran(/\brollout\s+undo\b/) && h.ready(h.gke, 'app-staging', 'backend', 2) },
        { text: '最後一步常被忘記：檔案裡還寫著壞掉的 `f4e5d6c`，下次有人 apply 又會壞一次。把 `newTag` 改回 `a1b2c3d` 再 apply -k，讓 Git 和叢集一致。', why: '在真實流程裡這一步是 `git revert` 那個 commit，讓 CI 重新部署舊版。', sol: [{ write: GKE_K, content: kfiles()[GKE_K] }, APPLY_GKE], check: (h) => h.ran(/\bapply\s+-k\b/) && /a1b2c3d$/.test((container(h.gke, 'app-staging', 'backend', 'api') || {}).image || '') && /newTag: a1b2c3d[\s\S]*newTag: a1b2c3d/.test(h.w.files[GKE_K]) && h.ready(h.gke, 'app-staging', 'backend', 2) },
      ],
      outro: '你剛走完一次完整的「發布失敗 → 使用者無感 → 找原因 → 回滾 → 收尾」。能獨立做完這件事，就是 Jr DevOps 最核心的能力。\n\n真實的 CI（GitHub Actions 或 Cloud Build）還有一個重點這裡沒模擬：CI 向 GCP 驗證也要用 Workload Identity Federation（OIDC），不要把服務帳戶的 JSON 金鑰放進 CI 的 secrets。',
      real: ['# 在 OrbStack 上可以完整重現「壞版本不影響線上」：', '# 1. 部署一個健康的版本（有 readinessProbe、maxUnavailable: 0）', '# 2. kubectl set image 換成一個會 crash 的映像檔', '# 3. 一邊 curl 一邊 kubectl rollout status，再 rollout undo'],
    },
    {
      id: '4-2', ch: 4, type: 'quiz', title: '最後一課：什麼時候不該用 Kubernetes', covers: [9],
      intro: '學會一個工具之後，最難的是判斷**什麼時候不要用它**。你原本的系統是單一容器跑在 Cloud Run 上。以下每個情境，選你會給的建議。\n\n（依據：Google 官方的定位是 Cloud Run 適合無狀態、請求驅動的服務，重視簡單與速度；GKE 適合複雜的微服務、有狀態應用，或對資源和網路有特殊需求的工作負載。）',
      questions: [
        { q: '一個前端加一個 API，無狀態，資料庫用 Cloud SQL，流量不大而且半夜幾乎是零。', options: ['搬到 GKE，比較專業', '留在 Cloud Run', '自己開 VM 裝 k8s'], answer: 1, explain: 'Cloud Run 可以縮到零、沒有叢集的固定成本、維運負擔最小。這個情境搬到 GKE 只會多出工作和費用。' },
        { q: '你想學 k8s，也想把它寫進履歷。公司的正式環境該跟著搬嗎？', options: ['該，這樣才有實戰經驗', '不必。用 OrbStack 和短期的練習叢集學，正式環境照需求決定', '該，但只搬一半'], answer: 1, explain: '學習需求和系統需求是兩件事。因為兩邊用的是同一份容器映像檔，哪天真的需要搬，成本主要在部署設定，不在程式碼。' },
        { q: '系統長到 8 個服務，彼此頻繁呼叫，還需要常駐的背景 worker 和自訂的 sidecar。', options: ['繼續全部放 Cloud Run', '開始值得認真評估 GKE', '全部合併回一個容器'], answer: 1, explain: '服務多、需要統一的流量與政策管理、需要常駐程式或 sidecar，這些都是該考慮 GKE 的訊號。' },
        { q: '流量很穩定、全天都有負載，算下來叢集的固定成本攤掉後比按用量計費便宜。', options: ['GKE 可能比較划算', '一定是 Cloud Run 便宜', '成本不該是考量'], answer: 0, explain: 'Cloud Run 的優勢在流量起伏大、能縮到零的情境。負載穩定且可預測時，GKE 可能更省。' },
        { q: '你把系統搬上 GKE 了。純靜態的 SPA 前端，正式環境最划算的放法通常是？', options: ['nginx 容器跑在叢集裡，至少 2 個 Pod', 'Cloud Storage 加 CDN，不佔叢集資源', '和後端塞在同一個容器'], answer: 1, explain: '純靜態檔交給物件儲存和 CDN 通常最便宜也最快。放在叢集裡的好處是同網域、同一條部署流程，學習階段這樣做很合理，但正式環境要算一下。' },
        { q: '正式環境的資料庫要放哪？', options: ['叢集裡，用 StatefulSet 自己跑 Postgres', '叢集外的託管服務（Cloud SQL）', '放在後端 Pod 裡當 sidecar'], answer: 1, explain: '備份、高可用、升級這些事託管服務都處理好了。自己在叢集裡跑有狀態的服務，是等你真的有理由時才需要學的進階主題。' },
      ],
      outro: '「為什麼用／為什麼不用 k8s」說得清楚，是 MVP 清單的最後一項，也是面試時最能看出程度的一題。',
    },
    { id: 'final', ch: 4, type: 'final', title: '結業：MVP 自我檢核' },
  ];

  // 研究報告 TL;DR 的 10 項 MVP 檢核，對應到關卡。
  const checklist = [
    { text: '能說明 Pod、Deployment、Service、ConfigMap、Secret、Gateway 各自負責什麼，以及怎麼用 label／selector 串起來', real: '在紙上畫出自己專案的流量圖' },
    { text: '能用宣告式 YAML 加 `kubectl apply -k` 部署前端和後端，多個環境共用一份 base', real: '把自己的專案整理成 base 加 overlays，在 OrbStack 上 apply' },
    { text: '每個 Deployment 都有 probes 和 requests／limits，並說得出原因', real: '故意讓 readiness 失敗、故意 OOM，各觀察一次' },
    { text: '設定走 ConfigMap、機密走 Secret，映像檔裡不寫死環境設定', real: '同一個映像檔在兩個 namespace 用不同設定跑起來' },
    { text: '用一個 Gateway（HTTPRoute）依路徑分流 `/` 和 `/api`', real: '在 OrbStack 裝一個 Gateway API 實作（例如 Traefik），實際分流' },
    { text: '能做滾動更新，並用 `rollout status／history／undo` 回滾', real: '在 OrbStack 上完整做一次發布與回滾' },
    { text: '遇到 CrashLoopBackOff、ImagePullBackOff、Service 沒有 endpoint、LB 不健康，能靠 get／describe／logs／endpointslices／port-forward 找出原因', real: '請朋友幫你把環境弄壞，計時排除' },
    { text: 'GKE：映像檔進 Artifact Registry、Pod 用 Workload Identity（沒有 JSON 金鑰）、透過 Cloud SQL Auth Proxy 連資料庫', real: '模擬器只能讓你認得錯誤長相；這一項一定要在真的 GKE Autopilot 上做過一次（做完刪叢集）' },
    { text: '有一條 CI/CD：push 後 build（tag 用 git SHA）、推送、部署', real: '用 GitHub Actions 或 Cloud Build 實際接一條，CI 用 OIDC 驗證' },
    { text: '能說清楚自己的系統為什麼用、或為什麼不用 k8s', real: '用三句話對同事解釋你現在的 Cloud Run 專案該不該搬' },
  ];

  // ---------- 執行期 ----------
  function helpers(w) {
    const since = () => w.history.slice(w.stepStart || 0);
    return {
      w,
      orb: w.clusters.orbstack,
      gke: w.clusters['gke-staging'],
      ran: (re) => since().some((e) => re.test(e.cmd)),
      http: (pred) => since().some((e) => e.http && pred(e.http)),
      res: (cl, kind, nsName, name) => S.getRes(cl, kind, nsName, name),
      ready: (cl, nsName, name, n) => {
        const d = S.getRes(cl, 'Deployment', nsName, name);
        if (!d) return false;
        S.reconcile(w, cl);
        const s = S.depStatus(cl, d);
        return s.done && (n == null || s.replicas === n);
      },
    };
  }
  function startLevel(level) {
    const w = S.newWorld();
    if (level.setup) {
      level.setup(w, (cmd) => {
        const r = G.run(w, cmd);
        if (!r.ok) throw new Error('關卡 ' + level.id + ' 的初始化指令失敗：' + cmd + '\n' + r.out);
        return r;
      });
    }
    for (const c of Object.values(w.clusters)) S.reconcile(w, c);
    w.history = [];
    w.opened = {};
    w.stats.podDeletes = 0;
    w.stepStart = 0;
    w.step = 0;
    return w;
  }
  // 依序檢查目前的步驟，通過就往下一步。回傳這次新完成了幾步。
  function advance(level, w) {
    let n = 0;
    while (w.step < level.steps.length) {
      let ok = false;
      try {
        ok = !!level.steps[w.step].check(helpers(w));
      } catch (e) {
        ok = false;
      }
      if (!ok) break;
      w.step++;
      w.stepStart = w.history.length;
      n++;
    }
    return n;
  }

  G.chapters = chapters;
  G.levels = levels;
  G.checklist = checklist;
  G.startLevel = startLevel;
  G.advance = advance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
