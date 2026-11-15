// 教學補充：每關的「本關新觀念」、指令拆解、名詞小抄、操作導覽。
// 在 levels.js 之後載入，把內容併進 G.levels。
(function (root) {
  'use strict';
  const G = (root.K8sGame = root.K8sGame || {});
  const byId = (id) => G.levels.find((l) => l.id === id);

  // ---------- 第 0 章：先教再問 ----------
  const l0 = byId('0-1');
  l0.title = '從你會的開始：Docker、Cloud Run 到 Kubernetes';
  l0.progressive = true;
  l0.intro =
    '這一關不用背東西。每張卡片先講一個觀念，再用一題確認你有跟上，**答錯可以重選**。\n\n你已經會的事：用 `docker run` 跑一個容器，以及把映像檔丟到 Cloud Run。Cloud Run 其實偷偷幫你做了很多事，Kubernetes（簡稱 k8s）只是把這些事**拆成一個一個零件**讓你自己組：\n\n| Cloud Run 幫你做的 | k8s 裡對應的零件 |\n| 跑起一個容器 | **Pod** |\n| 維持幾個執行個體、發新版本 | **Deployment** |\n| 給一個固定網址、把流量分給執行個體 | **Service** 加 **Gateway** |\n| 設定環境變數、密碼 | **ConfigMap**、**Secret** |\n| 確認容器活著才送流量 | **probe**（健康檢查） |';
  const teach = [
    '**k8s 的核心想法：你只說「要什麼」，不說「怎麼做」。**\n\n用 Docker 時你是下命令：`docker run`、`docker stop`，一步一步做。k8s 反過來：你寫一份 YAML 說「我要 2 個前端容器」，交給叢集。叢集裡有一群叫**控制器**的程式，不停比對「你要的」和「現在有的」，有落差就自己補上。\n\n這叫**宣告式**。好處是：機器壞了、容器掛了，你什麼都不用做，它會自己修回你要的樣子。',
    '**Pod 是什麼？Deployment 又是什麼？**\n\n• **Pod**：k8s 裡跑容器的最小單位。先把它想成「一個 `docker run` 起來的容器」就好。Pod 是消耗品，隨時可能被換掉。\n• **Deployment**：你交給叢集的「訂單」，上面寫：用哪個映像檔、要幾個。它會幫你產生並維持那幾個 Pod。\n\n所以你幾乎不會直接建立 Pod，都是寫 Deployment，讓它去管 Pod。\n\n```\nDeployment（訂單：frontend 要 2 個）\n   ├── Pod frontend-xxxx   ← 掛了會自動補\n   └── Pod frontend-yyyy\n```',
    '**Pod 一直換，別人要怎麼找到它？**\n\n每個 Pod 有自己的 IP，但 Pod 被換掉後 IP 就變了。所以需要 **Service**：一個固定的名稱和 IP，站在一群 Pod 前面幫忙分流。\n\nService 怎麼知道哪些 Pod 歸它管？靠**標籤**。每個 Pod 身上貼著 `labels`（例如 `app: frontend`），Service 寫一個 `selector`（例如 `app: frontend`），**貼著相同標籤的 Pod 就是它的後端**。\n\n```\nService frontend（selector: app=frontend）\n   ├──► Pod（labels: app=frontend）  ✓ 對得上\n   ├──► Pod（labels: app=frontend）  ✓ 對得上\n   └─✗  Pod（labels: app=backend）   對不上，不送\n```',
    '**外面的使用者怎麼進來？**\n\nService 只在叢集**內部**有效。要讓網際網路的請求進來，需要一個對外的入口：\n\n• **Gateway**：入口本身，像大樓的大門（對外的 IP、聽 80 埠）。\n• **HTTPRoute**：門口的指示牌，寫著「`/api` 開頭的去後端，其他去前端」。\n\n整條路是這樣走的，之後每一關右邊的面板都會畫出這張圖：\n\n```\n使用者 → Gateway → HTTPRoute → Service → Pod\n          大門       指示牌      總機     實際做事的容器\n```',
    '**設定不要寫死在映像檔裡。**\n\n你在 Cloud Run 上設定過環境變數，k8s 也一樣，只是分成兩種資源：\n\n• **ConfigMap**：一般設定，例如 `APP_ENV=staging`。\n• **Secret**：機密，例如資料庫密碼。\n\nPod 啟動時把它們當環境變數帶進去。這樣**同一個映像檔**可以原封不動跑在本機、測試、正式環境，只換設定。',
    '**容器「有在跑」不等於「可以服務」。**\n\n程式啟動後可能還在連資料庫，也可能跑到一半卡死。k8s 用 **probe**（定期打一個網址）來判斷，分兩種：\n\n• **readinessProbe**：問「你現在能接客了嗎？」不行就**暫時不分流量給它**，但不動它。\n• **livenessProbe**：問「你還活著嗎？」沒回應就**重啟容器**。\n\n記法：readiness 管流量，liveness 管重啟。',
    '**最後一個背景知識：Gateway API 和 Ingress。**\n\n你在網路上找教學，會看到很多用 `Ingress` 做對外入口的文章。那是舊的做法：\n\n• Kubernetes 官方已經**凍結** Ingress API（不再加新功能），建議改用 **Gateway API**（就是上面的 Gateway 加 HTTPRoute）。\n• 最多人用的 Ingress 實作「Ingress NGINX」已在 2026-03-24 **退役**，不再修補安全漏洞。\n\n所以這個遊戲只教 Gateway API。看到 Ingress 時，知道它是「同一件事的舊寫法」就夠了。',
  ];
  l0.questions.unshift({
    q: '你把 YAML 裡的數量從 2 改成 3，重新交給叢集。接下來會發生什麼事？',
    options: ['什麼都不會發生，要再手動啟動第 3 個容器', '叢集發現「要 3 個、現在 2 個」，自己補上 1 個', '叢集把原本 2 個全部刪掉，重新建立 3 個'],
    answer: 1,
    explain: '這就是宣告式：你只改「想要的狀態」，落差由控制器去補。它只會補上缺的那 1 個，不會動原本健康的 2 個。',
  });
  const topics = ['宣告式：只說要什麼', 'Pod 與 Deployment', 'Service 與標籤', 'Gateway 與流量路徑', 'ConfigMap 與 Secret', '健康檢查 probe', 'Gateway API 與 Ingress'];
  l0.questions.forEach((q, i) => Object.assign(q, { teach: teach[i], topic: topics[i] }));
  l0.outro = '你現在有整張地圖了：**Deployment 管 Pod、Service 用標籤找 Pod、Gateway 和 HTTPRoute 把外面的流量帶進來、ConfigMap 和 Secret 放設定、probe 判斷健康。**\n\n忘了沒關係，畫面右上角的「名詞小抄」隨時可以查。接下來每一關都是動手做，而且每個新指令都會拆開來解釋。';

  byId('4-2').questions[0].teach =
    '先看兩者的定位。這是 Google 官方文件的說法，加上報告整理的判斷訊號：\n\n| | Cloud Run | GKE（Kubernetes） |\n| 適合 | 無狀態、收到請求才工作的 web 服務 | 很多個服務、有狀態、需要特殊網路或資源 |\n| 你要管的 | 幾乎只有映像檔和設定 | Deployment、Service、Gateway、資源、升級…… |\n| 費用 | 按用量，沒流量可以縮到零 | 叢集和 Pod 有固定成本 |\n| 一句話 | 簡單、快 | 控制權完整，但要自己顧 |\n\n判斷原則：**先問「Cloud Run 哪裡不夠用」，答不出來就不用搬。**';

  // ---------- 各關的新觀念與指令拆解 ----------
  // learn：本關新觀念（[名詞, 白話解釋]）；parts：某一步的指令拆解（步驟索引 → [[片段, 意思], ...]）；read：怎麼讀輸出。
  const EXTRA = {
    '1-1': {
      learn: [
        ['叢集（cluster）', '一組用來跑容器的機器，加上管理它們的控制程式。每一台機器叫**節點（node）**。OrbStack 給你的是只有一台的迷你版。'],
        ['kubectl', '對叢集下指令的工具，地位就像 `docker` 指令之於 Docker。句型幾乎都是 `kubectl 動詞 資源種類 名稱`，例如 `kubectl get pods`。'],
        ['manifest', '描述「我要什麼」的 YAML 檔。你不會一行一行下命令建立東西，而是寫好 manifest 交給叢集。'],
        ['Pod／Deployment', 'Pod ≈ 一個跑起來的容器；Deployment 是「用這個映像檔、維持 N 個 Pod」的訂單。'],
      ],
      parts: {
        0: [['orb', 'OrbStack 的指令列工具'], ['start k8s', '啟動它內建的 Kubernetes 叢集']],
        1: [['kubectl', '對叢集下指令'], ['get', '動詞：列出'], ['nodes', '資源種類：節點（叢集裡的機器）']],
        2: [['docker build', '這個你會：把專案建置成映像檔'], ['-t frontend:dev', '命名為 `frontend`，標籤（tag）是 `dev`'], ['frontend', '建置目錄，裡面有 Dockerfile']],
        4: [['apply', '動詞：把檔案描述的狀態套用到叢集（沒有就建立，有就更新）'], ['-f k8s/frontend-deployment.yaml', '`-f` 指定要套用的檔案']],
        5: [['get pods', '列出 Pod。輸出每一欄的意思見下方']],
      },
      read: {
        1: '輸出裡 `STATUS` 是 `Ready` 就代表節點可以用。',
        3: '這份 YAML 由上到下是：\n```\nkind: Deployment        ← 資源種類\nmetadata.name: frontend ← 這張訂單的名字\nspec.replicas: 2        ← 要 2 個 Pod\nspec.selector           ← 我負責管「貼著這個標籤」的 Pod\nspec.template           ← Pod 的樣板：\n  labels: app=frontend  ←   每個 Pod 貼的標籤（要和上面 selector 一致）\n  containers.image      ←   用哪個映像檔\n  containerPort: 80     ←   容器聽哪個埠\n```',
        5: '`get pods` 的欄位：\n• `READY 1/1`：Pod 裡 1 個容器、1 個就緒\n• `STATUS Running`：正在執行\n• `RESTARTS 0`：重啟過幾次（數字一直增加代表有問題）',
      },
    },
    '1-2': {
      learn: [
        ['Service', '站在一群 Pod 前面的固定門牌。Pod 換了、IP 變了，Service 的名稱和 IP 都不變。'],
        ['labels／selector', 'Pod 身上貼的標籤叫 `labels`；Service 用 `selector` 指定「我要找貼著哪些標籤的 Pod」。兩邊必須一字不差。'],
        ['EndpointSlice', 'Service 目前**實際對到的 Pod 清單**。Service 不通時，第一個要看的就是它。'],
      ],
      parts: {
        1: [['curl', '這個你會：發一個 HTTP 請求'], ['frontend.default.svc.cluster.local', 'Service 的完整名稱：`Service 名稱.namespace.svc.cluster.local`。這裡的 namespace 是預設的 `default`']],
        2: [['get endpointslices', '列出每個 Service 實際的後端。`ENDPOINTS` 欄是 `<unset>` 代表沒有任何 Pod']],
        3: [['describe svc frontend', '`describe` 是「看某個資源的完整細節」，這裡看名為 frontend 的 Service'], ['get pods --show-labels', '列出 Pod 時多顯示一欄標籤']],
      },
    },
    '1-3': {
      learn: [
        ['replicas', 'Deployment 要維持的 Pod 數量。'],
        ['自我修復', 'Pod 不見了（當機、被刪、節點壞掉），Deployment 會自動補到指定數量。'],
        ['命令式 vs 宣告式', '`kubectl scale` 這種「直接改叢集」的指令是命令式；改 YAML 再 `apply` 是宣告式。兩者衝突時，下一次 apply 會以檔案為準。'],
      ],
      parts: {
        0: [['scale', '動詞：調整數量'], ['deploy/frontend', '`種類/名稱` 的寫法，`deploy` 是 deployment 的縮寫'], ['--replicas=3', '改成 3 個']],
        1: [['delete pod <名稱>', '刪除指定的 Pod。名稱很長，打前幾個字按 Tab 補完，或點右邊面板的 Pod']],
      },
    },
    '1-4': {
      learn: [
        ['滾動更新（rolling update）', '換新版本時不是全部關掉再開，而是「開一個新的 → 確認健康 → 關一個舊的」輪流換，服務不中斷。'],
        ['revision', 'Deployment 每次換範本（例如換映像檔）都會留下一個版本紀錄，所以能退回去。'],
        ['rollout', '`kubectl rollout` 這組指令專門看更新進度、歷史和回滾。'],
      ],
      parts: {
        1: [['set image', '動詞：換映像檔'], ['deploy/frontend', '對象：frontend 這個 Deployment'], ['web=frontend:v2', '把名為 `web` 的容器換成 `frontend:v2`（容器名稱寫在 YAML 的 `containers.name`）']],
        2: [['rollout status', '等這次更新跑完，並回報成功或卡住']],
        4: [['rollout history', '列出這個 Deployment 有過哪些版本']],
        5: [['rollout undo', '退回上一個版本']],
      },
    },
    '1-5': {
      learn: [
        ['CrashLoopBackOff', 'Pod 的一種狀態：容器一啟動就結束，k8s 重啟它、又結束，一直循環。它只告訴你「在崩潰」，沒告訴你原因。'],
        ['除錯三步驟', '`get`（看症狀）→ `describe`（看事件和結束代碼）→ `logs`（看程式自己印了什麼）。之後所有除錯關卡都是這個順序。'],
        ['Exit Code', '容器結束時的代碼。`0` 是正常結束，其他都是出錯。'],
      ],
      parts: {
        1: [['describe pod <名稱>', '看這個 Pod 的完整細節。重點看 `Last State`（上次怎麼死的）和最下面的 `Events`（發生過的事）']],
        2: [['logs <名稱>', '看容器印出的訊息，等同 `docker logs`'], ['--previous', '看「上一次」那個已經死掉的容器的輸出']],
      },
    },
    '1-6': {
      learn: [
        ['ImagePullBackOff', 'Pod 的一種狀態：拉不到映像檔。容器根本還沒啟動，所以 `logs` 沒東西，要看 `describe` 的 Events。'],
        ['imagePullPolicy', '決定「要不要去遠端拉映像檔」。tag 是 `latest` 時預設**每次都去遠端拉**；其他 tag 則是本機有就直接用。'],
      ],
      parts: { 2: [['docker images', '這個你會：列出本機有哪些映像檔']] },
    },
    '2-1': {
      learn: [
        ['ConfigMap', '放一般設定的資源，內容是一組 `名稱: 值`。'],
        ['Secret', '放機密的資源，用法和 ConfigMap 幾乎一樣，但內容會編碼，且通常不進版控。'],
        ['envFrom', '寫在容器設定裡，意思是「把某個 ConfigMap 或 Secret 的所有內容，當成環境變數帶進這個容器」。'],
      ],
      parts: {
        0: [['logs deploy/backend', '不指定 Pod 名稱，讓 kubectl 從這個 Deployment 挑一個 Pod 看 log']],
        2: [['create secret generic backend-secret', '建立一個名為 backend-secret 的 Secret（`generic` 是最一般的類型）'], ['--from-literal=DATABASE_URL=...', '直接在指令裡給一組 `名稱=值`']],
        4: [['exec deploy/backend', '在容器裡執行指令，等同 `docker exec`'], ['-- env', '`--` 後面是要在容器裡跑的指令，這裡是印出所有環境變數']],
      },
    },
    '2-2': {
      learn: [
        ['readinessProbe', '定期打一個網址確認「能不能接流量」。沒通過時 Pod 顯示 `0/1`，Service 不會把流量分給它。'],
        ['livenessProbe', '定期確認「還活著嗎」。連續失敗就重啟容器。'],
        ['READY 欄位', '`0/1` 的意思是「1 個容器裡有 0 個就緒」。`Running` 但 `0/1`，就是容器在跑卻沒通過 readiness。'],
      ],
    },
    '2-3': {
      learn: [
        ['requests', '這個容器「至少需要」多少 CPU 和記憶體。叢集用它決定 Pod 放得下放不下。'],
        ['limits', '這個容器「最多能用」多少。記憶體超過會被強制終止。'],
        ['單位', 'CPU：`250m` 是 0.25 顆核心（m 是千分之一）。記憶體：`512Mi` 約 512 MB。'],
        ['OOMKilled', 'Out Of Memory Killed：記憶體用超過 limits，被系統強制終止。結束代碼固定是 137。'],
      ],
    },
    '2-4': {
      learn: [
        ['Gateway', '對外入口本身：聽哪個埠、由哪一套實作來處理。'],
        ['GatewayClass', '叢集裡「有哪些入口實作可以用」。Gateway 要指定其中一個（`gatewayClassName`）。'],
        ['HTTPRoute', '路由規則：哪個路徑的請求送到哪個 Service。用 `parentRefs` 掛到某個 Gateway 上。'],
      ],
    },
    '2-5': {
      learn: [
        ['Kustomize', 'kubectl 內建的功能，用來管理「大部分相同、只有一點不同」的多套 YAML。'],
        ['base／overlay', '`base/` 放所有環境共用的 YAML；`overlays/環境名/` 只寫那個環境的差異。'],
        ['kustomization.yaml', '每個目錄的「清單」，列出要包含哪些檔案（`resources`）、要改哪些地方（`patches`、`images`）。'],
        ['namespace', '叢集裡的資料夾，用來隔開不同環境或專案。沒指定時是 `default`；指定後查詢要加 `-n 名稱`。'],
      ],
      parts: {
        0: [['kustomize k8s/overlays/local', '只把 base 和 overlay 合併後的結果印出來，不動叢集']],
        1: [['apply -k k8s/overlays/local', '`-k` 是「套用這個目錄的 kustomization」；之前的 `-f` 是套用單一檔案']],
        2: [['-n app-local', '指定 namespace。不加的話只會看 `default`']],
      },
    },
    '3-1': {
      learn: [
        ['context', 'kubectl 的設定檔裡可以存很多個叢集的連線資訊，每一組叫一個 context。切換 context 就是切換「現在對哪個叢集下指令」。'],
        ['registry', '存放映像檔的遠端倉庫。雲端的節點拿不到你筆電裡的映像檔，必須先推到 registry。GCP 的叫 **Artifact Registry**。'],
        ['映像檔完整路徑', '`主機/專案/儲存庫/名稱:tag`。docker 靠開頭的主機名稱知道要推去哪。'],
      ],
      parts: {
        4: [['gcloud auth configure-docker', '讓 docker 用你的 GCP 身分登入'], [G.sim.AR_HOST, 'Artifact Registry 在這個地區的主機名稱']],
        5: [['docker tag 來源 目標', '幫同一個映像檔多取一個名字（這裡取成 registry 的完整路徑）'], ['docker push', '把它上傳到 registry']],
      },
    },
    '3-2': {
      learn: [
        ['sidecar', '和主容器放在同一個 Pod 裡、幫忙做輔助工作的容器。同一個 Pod 裡的容器共用 `127.0.0.1`，所以主程式連本機就等於連到 sidecar。'],
        ['init container', '在主容器啟動**之前**先跑的容器，預設要「跑完結束」才輪到主容器。加上 `restartPolicy: Always` 就變成會一直陪跑的 sidecar。'],
        ['ServiceAccount（KSA）', 'Pod 在叢集裡的「身分」。沒指定時用 `default`。'],
        ['Workload Identity', '讓 Pod 用它的 ServiceAccount 身分直接存取 GCP 資源，不需要金鑰檔。'],
      ],
      parts: { 4: [['-c cloud-sql-proxy', 'Pod 裡有多個容器時，用 `-c` 指定要看哪一個的 log']] },
    },
    '3-3': {
      learn: [
        ['負載平衡器的健康檢查', '雲端的負載平衡器會**自己**定期打後端確認健康，不健康就不送流量。這和 Pod 的 readinessProbe 是兩套獨立的機制。'],
        ['HealthCheckPolicy', 'GKE 專屬的資源，用來告訴負載平衡器「健康檢查要打哪個路徑」。'],
        ['port-forward', '在你的電腦和叢集裡的某個 Service 或 Pod 之間開一條臨時通道，用來繞過入口直接測試。'],
      ],
      parts: { 3: [['port-forward svc/backend', '對象是 backend 這個 Service'], ['8080:80', '把你電腦的 8080 埠接到 Service 的 80 埠']] },
    },
    '3-4': {
      learn: [
        ['GKE Autopilot', 'GKE 的一種模式：你不用管節點，Google 依每個 Pod **申請（requests）** 的資源收費。'],
        ['預設值的代價', '容器沒寫 requests 時，Autopilot 會套用預設的 0.5 vCPU／2 GiB，再照這個數字收費。'],
      ],
    },
    '4-1': {
      learn: [
        ['CI/CD', '把「建置 → 推送 → 部署 → 確認」寫成自動執行的流程。push 程式碼後由機器代勞。'],
        ['用 git SHA 當 tag', '每個 commit 有唯一的代碼。拿它當映像檔的 tag，就能確定叢集裡跑的是哪一版程式碼。'],
      ],
    },
  };
  byId('1-1').steps[3].where = '檔案區';
  byId('4-2').questions.forEach((q, i) => (q.topic = '情境 ' + (i + 1)));
  for (const id of Object.keys(EXTRA)) {
    const lv = byId(id);
    const x = EXTRA[id];
    lv.learn = x.learn;
    for (const k of Object.keys(x.parts || {})) lv.steps[k].parts = x.parts[k];
    for (const k of Object.keys(x.read || {})) lv.steps[k].read = x.read[k];
  }

  // ---------- 名詞小抄 ----------
  G.glossary = [
    ['叢集 cluster／節點 node', '跑容器的一組機器，每台機器是一個節點。'],
    ['kubectl', '對叢集下指令的工具。句型：`kubectl 動詞 資源種類 名稱`。'],
    ['manifest', '描述資源的 YAML 檔。'],
    ['Pod', '跑容器的最小單位，≈ 一個 `docker run` 起來的容器。消耗品，會被換掉。'],
    ['Deployment', '「用這個映像檔、維持 N 個 Pod」的訂單，負責補 Pod 和滾動更新。'],
    ['ReplicaSet', 'Deployment 底下實際負責維持數量的東西。每換一次範本就有一個新的。通常不用直接碰。'],
    ['labels／selector', 'Pod 身上的標籤／用來挑選標籤的條件。Service 和 Deployment 都靠它找 Pod。'],
    ['Service', 'Pod 前面的固定門牌（名稱和 IP），把流量分給符合 selector 且就緒的 Pod。'],
    ['EndpointSlice', 'Service 目前實際對到的 Pod 清單。'],
    ['namespace', '叢集裡的資料夾。查詢其他 namespace 要加 `-n 名稱`。'],
    ['ConfigMap／Secret', '放一般設定／機密的資源，啟動時以環境變數帶進容器。'],
    ['readinessProbe', '「能接流量了嗎？」失敗 → 不分流量給它。'],
    ['livenessProbe', '「還活著嗎？」失敗 → 重啟容器。'],
    ['requests／limits', '至少需要／最多能用的 CPU 和記憶體。'],
    ['Gateway／HTTPRoute', '對外入口／路由規則（哪個路徑去哪個 Service）。'],
    ['Ingress', 'Gateway API 之前的舊做法，API 已凍結，看得懂即可。'],
    ['滾動更新／回滾', '新舊 Pod 輪流替換的更新方式／退回上一個版本。'],
    ['Kustomize', '用 base 加 overlays 管理多環境 YAML，`kubectl apply -k 目錄`。'],
    ['context', 'kubectl 目前對哪個叢集下指令。'],
    ['CrashLoopBackOff', '容器一啟動就掛、不斷重啟。看 `describe` 和 `logs --previous`。'],
    ['ImagePullBackOff', '拉不到映像檔。看 `describe` 的 Events。'],
    ['OOMKilled', '記憶體超過 limits 被強制終止，結束代碼 137。'],
    ['sidecar', '和主容器同一個 Pod 的輔助容器，共用 `127.0.0.1`。'],
    ['ServiceAccount', 'Pod 在叢集裡的身分。'],
  ];
  G.cheats = [
    ['看有什麼', '`kubectl get pods`（也可以是 `deploy`、`svc`、`all`…）'],
    ['看細節和事件', '`kubectl describe pod <名稱>`'],
    ['看程式輸出', '`kubectl logs <名稱>`，剛死掉的加 `--previous`'],
    ['套用檔案', '`kubectl apply -f <檔案>` 或 `-k <目錄>`'],
    ['其他 namespace', '任何指令後面加 `-n <namespace>`'],
    ['忘了能打什麼', '在終端機輸入 `help`'],
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
