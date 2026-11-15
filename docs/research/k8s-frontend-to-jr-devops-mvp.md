# 從前端工程師到 Jr DevOps：Kubernetes 最低可行能力（MVP）與學習路徑

> 研究日期：2026-11-15
> 對象：會基本 Docker、目前把單一容器部署到 GCP Cloud Run 的前端工程師
> 環境：本機 OrbStack（macOS）＋ 雲端 GKE
> 標記說明：**〔事實〕** 附官方連結；**〔建議〕** 是本文作者的判斷或意見；**〔未驗證〕** 是查不到官方原文佐證的內容。

---

## TL;DR

**〔建議〕** 下面全部做得到，就算達到「Jr DevOps（k8s）」的最低可行程度：

- [ ] 能說明 Pod、Deployment、ReplicaSet、Service、Namespace、ConfigMap、Secret、Gateway／Ingress 各自負責什麼，也知道它們之間怎麼用 label／selector 串起來。
- [ ] 能用宣告式 YAML 加上 `kubectl apply -k`（Kustomize），把**前端＋後端**部署到 OrbStack 和 GKE，而且兩邊共用同一份 base。
- [ ] 每個 Deployment 都設好 `readinessProbe`、`livenessProbe`，以及 `resources.requests`／`limits`，並說得出原因（尤其在 GKE Autopilot，費用是照 requests 算的）。
- [ ] 設定走 ConfigMap，機密走 Secret（GKE 上能說明 Secret Manager 的整合選項），映像檔裡不寫死任何環境設定。
- [ ] 用**一個** Gateway（HTTPRoute）或 Ingress 依路徑分流：`/` 給前端、`/api` 給後端。
- [ ] 能做 rolling update，用 `kubectl rollout status`／`history`／`undo` 回滾，也知道 `maxSurge`／`maxUnavailable` 的作用。
- [ ] 遇到 `CrashLoopBackOff`、`ImagePullBackOff`、`Pending`、Service 沒有 endpoint、LB 健康檢查失敗時，能用 `kubectl get/describe/logs --previous/events`、`kubectl get endpointslices`、`kubectl exec`、`kubectl port-forward` 找出原因。
- [ ] 在 GKE 上：映像檔推到 Artifact Registry、Pod 用 Workload Identity Federation 存取 GCP 資源（不用 JSON key）、透過 Cloud SQL Auth Proxy 連到叢集外的 Cloud SQL。
- [ ] 有一條 CI/CD：push 之後建置映像檔（tag 用 git SHA），推到 Artifact Registry，再部署到 GKE。
- [ ] 能說清楚自己的系統「為什麼不用／為什麼要用」k8s。很多小型前後端系統留在 Cloud Run 才是對的選擇（見第 4 節）。

**外部參考尺標**：CKAD 的考試範圍很接近上面這份清單（見第 2 節）。KCNA 是選擇題，考的是觀念，適合當第 0 階段的觀念自我檢查。

---

## 1. 能力地圖：MVP 必備 vs 之後再學

### 1.1 MVP 必備

| 領域 | 具體能力 | 官方參考 |
|---|---|---|
| 容器基礎（補強） | 多階段建置、非 root 執行、用 env 帶設定、image tag 不用 `latest` | [Kubernetes：Images](https://kubernetes.io/docs/concepts/containers/images/) |
| 核心物件 | Pod／Deployment／ReplicaSet／Service（ClusterIP、LoadBalancer）／Namespace、labels 與 selectors | [Concepts: Workloads](https://kubernetes.io/docs/concepts/workloads/)、[Service](https://kubernetes.io/docs/concepts/services-networking/service/) |
| 設定與機密 | ConfigMap、Secret，以 `envFrom` 或 volume 掛載 | [ConfigMap](https://kubernetes.io/docs/concepts/configuration/configmap/)、[Secret](https://kubernetes.io/docs/concepts/configuration/secret/) |
| 健康檢查 | readiness、liveness、startup probe 的差別 | [Configure Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) |
| 資源管理 | requests 和 limits、QoS、OOMKilled | [Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) |
| 發布 | rolling update、rollback | [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) |
| 對外流量 | Gateway API（HTTPRoute），並看得懂 Ingress | [Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/)、[Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
| 除錯 | describe、logs、events、exec、port-forward、EndpointSlice | [Debug Applications](https://kubernetes.io/docs/tasks/debug/debug-application/)、[Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/) |
| 多環境 | Kustomize base／overlays、`kubectl apply -k` | [Kustomize（kubernetes.io）](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) |
| GKE 基本功 | Autopilot、Artifact Registry、Workload Identity Federation、Gateway、Cloud SQL Auth Proxy | 見第 3.2 節 |
| CI/CD | 建置、推送、部署，用 SHA 當 tag | 見第 5.6 節 |

**〔事實〕為什麼 MVP 要學 Gateway API，不能只學 Ingress**
- Kubernetes 官方文件寫明：「The Kubernetes project recommends using Gateway instead of Ingress. The Ingress API has been frozen.」Ingress 不會被移除，但不會再有新功能（[Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)）。
- 最常見的 Ingress 控制器 **Ingress NGINX 已在 2026-03-24 退役**：之後不再有新版本、bug 修正，也不會修補安全漏洞（[Ingress NGINX Retirement 公告](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)、[Steering／SRC 聲明](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/)）。官方另外推出 [Ingress2Gateway 1.0](https://kubernetes.io/blog/2026/03/20/ingress2gateway-1-0-release/) 協助遷移。
- GKE 也建議：「Over time, we recommend transitioning to using Gateway and Route resources」（[GKE Gateway API 概念](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gateway-api)）。

**〔建議〕** 主力學 Gateway API，Ingress 只要看得懂就好，畢竟很多既有專案和教材還在用。

### 1.2 之後再學（Nice to have）

| 主題 | 什麼時候該學 | 〔建議〕優先序 |
|---|---|---|
| HPA（自動水平擴展） | 流量會明顯起伏時 | 高。MVP 完成後第一個學 |
| 可觀測性（Cloud Logging／Monitoring、Managed Prometheus、OpenTelemetry） | 上正式環境前 | 高 |
| GitOps（Argo CD／Flux） | 環境和服務變多、需要稽核和自動同步時 | 中高 |
| Helm | 要安裝第三方套件（例如 Gateway 控制器、Argo CD），或要發布 chart 時 | 中。先學會「用 Helm 裝東西」，再學「寫 chart」 |
| RBAC | 多人或多團隊共用叢集、CI 的部署權限要收斂時 | 中 |
| NetworkPolicy | 要限制 Pod 之間能不能互連時 | 中 |
| Terraform／IaC | 要把 GKE、Cloud SQL、IAM 本身版本控管時 | 中 |
| StatefulSet、PV／PVC | 真的要在叢集裡跑有狀態服務時。〔建議〕初學者的資料庫優先放在叢集外的託管服務 | 低 |
| Service Mesh、多叢集 | 大型微服務架構 | 低 |

---

## 2. 用 CNCF 認證當「Jr」的尺標

**〔事實〕**
- 官方課綱放在 [github.com/cncf/curriculum](https://github.com/cncf/curriculum)。目前 CKAD 課綱檔名是 `CKAD_Curriculum_v1.37.pdf`，KCNA 是 `KCNA_Curriculum.pdf`。
- **CKAD**：線上監考的實作題，在命令列作答，時間 2 小時，對應 Kubernetes v1.37。考試範圍與比重如下：Application Design and Build 20%、Application Deployment 20%、Application Observability and Maintenance 15%、Application Environment, Configuration and Security 25%、Services and Networking 20%。報名費 US$445（[Linux Foundation CKAD](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/)）。
- **KCNA**：線上監考的選擇題，時間 90 分鐘。範圍是 Kubernetes Fundamentals 44%、Container Orchestration 28%、Cloud Native Application Delivery 16%、Cloud Native Architecture 12%（[Linux Foundation KCNA](https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate/)）。
- 目前仍在維護的 Kubernetes 版本是 1.37、1.36、1.35（1.34 的 EOL 是 2026-10-27），下一版是 1.38（[Kubernetes Releases](https://kubernetes.io/releases/)）。

**〔建議〕**
- KCNA 適合在第 0～1 階段當觀念檢查，不一定要真的去考。
- CKAD 和本文的 MVP 重疊度最高。完成第 3 階段之後，可以拿 CKAD 課綱逐條自評。
- CKA（叢集管理）偏向維運叢集本身。對「用 GKE 託管叢集」的 Jr DevOps 來說不是 MVP 範圍。

---

## 3. 分階段學習路徑

**〔建議〕** 整體節奏：第 0～2 階段全部在 OrbStack 上做（免費、回饋快），第 3～4 階段才上 GKE。每個階段都有「完成條件」，做到了才往下走。

### 3.1 本機：OrbStack Kubernetes 的特性（〔事實〕，來源都是 [docs.orbstack.dev/kubernetes](https://docs.orbstack.dev/kubernetes/)）

- **單節點**：OrbStack 內建「a lightweight single-node Kubernetes cluster optimized for development」。
- **啟動與停止**：`orb start k8s`、`orb stop k8s`、`orb restart k8s`、`orb delete k8s`，而且已經內建 `kubectl`。要在 OrbStack 和遠端叢集（例如 GKE）之間切換 context，可以用選單列 App 的 Context 選單。
  - 〔未驗證〕GUI 裡「Settings → Kubernetes → Enable」的確切操作路徑，我在該頁沒有看到逐步說明。用 `orb start k8s` 是官方文件明確寫出的方法。
- **本機映像檔不用推 registry**：Kubernetes 和 OrbStack 共用同一個容器引擎，「There's no need to push images to a local registry」。注意：tag 是 `:latest` 時，Kubernetes 預設會去遠端拉，所以要改用 `:dev`、`:1` 這類 tag，或者設 `imagePullPolicy: IfNotPresent`。
- **LoadBalancer／Ingress**：「LoadBalancer services, such as Ingress controllers, work out of the box」，可以用萬用網域 `*.k8s.orb.local` 存取，也能用 `example.k8s.orb.local` 這種虛擬主機名稱。
- **預設沒有 Ingress 控制器**：「No Ingress controller is installed by default」。文件裡附了 Ingress-NGINX 和 Traefik（Helm）的安裝方式。
  - 〔建議〕Ingress NGINX 已退役（見 1.1），新的練習不要再用它。可以改用 Traefik（文件有附安裝方式，它也支援 Gateway API），或其他 Gateway API 實作，例如 Envoy Gateway、NGINX Gateway Fabric。〔未驗證〕本文沒有逐一驗證各實作在 OrbStack 上的安裝步驟，請以各專案官方文件為準。
- **從 Mac 直接存取**：「All Kubernetes service types are accessible directly from Mac」。NodePort 走 `localhost:PORT`，ClusterIP、Pod IP、`cluster.local` 網域也都能從 Mac 直接連，多數情況不需要 port-forward。
- **區網曝露**：NodePort 和 LoadBalancer 預設只綁 localhost。要讓區網其他裝置連進來，到 Settings → Kubernetes 開啟「Expose services to local network devices」。
- **CNI**：預設是 Flannel。〔建議〕所以 NetworkPolicy 的練習在 OrbStack 上可能不會生效（Flannel 本身不實作 NetworkPolicy）。〔未驗證〕OrbStack 文件沒有直接說明這一點。

> 〔建議〕OrbStack 和 GKE 的關鍵差異：單節點（練不到跨節點排程或 Pod 反親和性）、沒有雲端 LB／IAM／Cloud SQL。這些都要留到第 3 階段在 GKE 上練。

### 3.2 雲端：GKE 重點（〔事實〕）

- **Autopilot vs Standard**：Google 的建議是「Use Autopilot for most workloads」，除非需要特殊權限或直接控制節點（[Choose a GKE mode](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/choose-cluster-mode)）。
- **費用**（[GKE pricing](https://cloud.google.com/kubernetes-engine/pricing)，經搜尋摘要取得，請以官網即時價格為準）：
  - 每個叢集收管理費 **US$0.10／小時**，Autopilot 和 Standard 都一樣。
  - 免費額度：每個帳單帳戶每月 **US$74.40** 的抵免額，大約等於一個 Autopilot 或 zonal Standard 叢集的管理費。這份額度**不抵運算費用**，regional Standard 叢集也不適用。
  - Autopilot 以 Pod 為單位計費，按 Pod 佈建（request）的 CPU、記憶體等資源收費。
- **Autopilot 的資源預設值與下限**（[Autopilot resource requests](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests)）：
  - 沒有指定 requests 時，通用型 Pod 預設是 **0.5 vCPU／2 GiB 記憶體／1 GiB 暫存儲存空間**。
  - 下限：不使用 bursting 時是 250m CPU／512 MiB，使用 bursting 時是 50m／52 MiB。
  - CPU 和記憶體的比例必須介於 1:1 到 1:6.5（vCPU:GiB）之間。
  - Google 建議明確設定 requests。
  - 〔建議〕**這就是為什麼「設 resource requests」在 Autopilot 上同時是省錢技能**：不設的話，一個小小的 nginx Pod 也會用 0.5 vCPU／2 GiB 計費。
- **〔建議〕初學者選 Autopilot**，理由如下：
  1. 不用管節點、升級和節點池。
  2. Gateway API 和 Workload Identity Federation 都已預設啟用（見下面兩項）。
  3. 學習重點正好落在 CKAD 範圍的「應用程式層」。
  - 代價是有些權限受限，對 DaemonSet、privileged Pod 也有限制。
  - 練習完記得刪掉叢集或把工作負載縮到 0。〔建議〕叢集管理費有免費額度可以抵，但運算費用和 LB 的費用（〔未驗證〕實際金額依區域和用量而定）都要自己付。
- **Artifact Registry**：
  - 本機推映像檔前先執行 `gcloud auth configure-docker LOCATION-docker.pkg.dev`（例如 `asia-east1-docker.pkg.dev`）。
  - 文件寫明 GKE 這類 Google Cloud 執行環境「don't need to configure authentication」，但要確認節點使用的帳號有讀取權限（[Artifact Registry 驗證](https://docs.cloud.google.com/artifact-registry/docs/docker/authentication)）。
  - 映像檔路徑格式是 `LOCATION-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE:TAG`。〔未驗證〕這個完整格式是依慣例寫的，上面那頁只列出 hostname 的格式。
- **Workload Identity Federation for GKE**（[文件](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)）：
  - Autopilot 上「always enabled」；Standard 叢集要在叢集和節點池層級分別啟用。
  - 推薦做法是直接把 IAM 角色授予 Kubernetes ServiceAccount 的 principal：
    `principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/PROJECT_ID.svc.id.goog/subject/ns/NAMESPACE/sa/KSA_NAME`
  - 替代做法（某些 API 不支援 federated identity 時才用）：
    1. 建立 IAM service account。
    2. 授予 `roles/iam.workloadIdentityUser` 給 `serviceAccount:PROJECT_ID.svc.id.goog[NAMESPACE/KSA_NAME]`。
    3. 在 KSA 上加 annotation `iam.gke.io/gcp-service-account`。
    - 文件特別說明，allow policy 和 annotation 兩者**都要設**。
- **Gateway API on GKE**（[概念](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gateway-api)、[部署 Gateway](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/deploying-gateways)）：
  - 「GKE Gateway is always enabled on Autopilot clusters」。Standard 叢集要用 `gcloud container clusters update CLUSTER --location=LOC --gateway-api=standard` 啟用，可能要花到 45 分鐘。
  - 對外的全域 L7 建議使用 `gke-l7-global-external-managed`，也可以選 `gke-l7-regional-external-managed`。單叢集 Gateway 控制器不另外收費（但 LB 本身照常計費）。
  - **常見陷阱**：GKE Gateway **不會**從 readinessProbe 推斷健康檢查設定，預設會檢查 `/`，而且只接受 HTTP 200。後端如果把健康檢查放在 `/healthz`，要另外建立 `HealthCheckPolicy`（[Configure Gateway resources using Policies](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/configure-gateway-resources)）。GKE Ingress 則會在 containerPort 和 targetPort 都有設定時，從 readinessProbe 推斷健康檢查設定（[Ingress health checks 疑難排解](https://cloud.google.com/kubernetes-engine/docs/troubleshooting/ingress-health-checks)）。
- **Cloud SQL**（[Connect from GKE](https://docs.cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)）：
  - 官方明說：「The Cloud SQL Auth Proxy is the recommended way to connect to Cloud SQL, even when using private IP.」
  - Proxy 以 sidecar 方式部署，放在 `initContainers` 並設 `restartPolicy: Always`（也就是原生 sidecar）。應用程式連 `127.0.0.1`。
  - 身分建議使用 Workload Identity。
  - 另一個選項是語言連接器（Cloud SQL Language Connectors），但〔未驗證〕本文引用的那頁沒有涵蓋。
- **Secret Manager 的選項**：
  1. **Secret Manager add-on**（託管的 Secrets Store CSI Driver）：以 volume 掛載，使用 `apiVersion: secrets-store.csi.x-k8s.io/v1` 的 `SecretProviderClass` 並設 `provider: gke`。需要 GKE 1.27.14-gke.1042001 以上；自動輪替需要 1.32.2-gke.1059000 以上。支援 Autopilot。**不支援**同步成 Kubernetes Secret（[文件](https://docs.cloud.google.com/secret-manager/docs/secret-manager-managed-csi-component)）。
  2. 文件指出，需要同步成 Kubernetes Secret 時，要改用 Secret Manager 的「integrated secret synchronization」功能。〔未驗證〕本文沒有展開這個功能的細節。
  3. 應用程式在程式碼裡用 Secret Manager client library，搭配 Workload Identity 直接讀取。
  4. 〔建議〕MVP 階段先手動建立 Kubernetes Secret（不要進版控）就好，熟悉之後再改成 add-on。

### 3.3 階段與里程碑

| 階段 | 環境 | 內容 | 完成條件（可檢查） | 建議時間〔建議〕 |
|---|---|---|---|---|
| **0. 觀念** | 無 | 讀 [Kubernetes Basics 教學](https://kubernetes.io/docs/tutorials/kubernetes-basics/) 和 [Concepts 概覽](https://kubernetes.io/docs/concepts/overview/)，用 KCNA 範圍自我檢查 | 能畫出「Gateway → Service → Pod（Deployment 管理）」的流量圖，並說明 label selector 的作用 | 3～5 天 |
| **1. 單一服務** | OrbStack | 啟用 k8s；把現有的前端映像檔（tag 用 `:dev`）用 Deployment 和 Service 跑起來；練 `kubectl get/describe/logs/exec`；`kubectl scale`；改 image 觸發 rolling update，再 `rollout undo` | ① 用 `http://<svc>.<ns>.svc.cluster.local` 或 `*.k8s.orb.local` 打得開 ② 能完整回滾一次 ③ **刻意**把 command 寫錯造成 CrashLoopBackOff，再靠 `describe` 和 `logs --previous` 找出原因 | 1 週 |
| **2. 前後端＋設定** | OrbStack | 後端 Deployment 和 Service；ConfigMap、Secret；probes；requests／limits；安裝一個 Gateway API 實作，用 HTTPRoute 分流 `/` 和 `/api`；本機 DB 先用一個簡單的 Postgres Deployment（只限本機練習）；全部改成 Kustomize base＋`overlays/local` | ① `kubectl apply -k overlays/local` 一行就能建好整套環境 ② 刪掉一個 Pod 後服務不中斷 ③ 故意讓 readiness 失敗，觀察 EndpointSlice 把它移除 ④ 故意設很小的 memory limit，觀察 OOMKilled | 2 週 |
| **3. 上 GKE** | GKE Autopilot | 建立 Artifact Registry 並推映像檔；建立 Autopilot 叢集；`overlays/gke`；Gateway（`gke-l7-global-external-managed`）＋ HealthCheckPolicy；Cloud SQL ＋ Auth Proxy sidecar ＋ Workload Identity；namespace 區分 staging 和 prod | ① 透過 LB IP 或自有網域打得開前端，`/api` 能連到 DB ② Pod 裡沒有任何 JSON key ③ 遇到 `ImagePullBackOff` 或 LB unhealthy 都能自己排除 ④ 能估算這套環境一個月要多少錢 | 2 週 |
| **4. CI/CD 與收尾** | GitHub Actions 或 Cloud Build | push 之後建置映像檔（tag 用 git SHA），推到 AR，執行 `kustomize edit set image`，再 `kubectl apply -k`；CI 改用 Workload Identity Federation（GitHub OIDC），不用 SA key | ① merge 到 main 會自動部署到 staging ② 能用 rollout undo 或回退 commit 完成回滾 ③ 拿 CKAD 課綱逐條自評，大部分都有實作經驗 | 1～2 週 |
| **5. 進階** | — | HPA、可觀測性、Argo CD、Helm、RBAC、NetworkPolicy、Terraform | 依需求挑著學 | 持續 |

---

## 4. Cloud Run vs GKE：什麼時候真的值得搬？

**〔事實〕Google 官方的說法**（[GKE and Cloud Run](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run)）：
- Cloud Run「Best suited for stateless, request or event-driven services, web services, and functions」，「Ideal for simplicity and speed」，而且按用量計費。
- GKE 提供「Full control over the Kubernetes cluster」，適合「complex microservices architectures, stateful applications」，以及對資源或網路有特殊需求的工作負載，但節點、網路、擴展、升級這些都要自己負責（Autopilot 會幫你分擔一部分）。
- 兩者可以混用：「Run stateless microservices on Cloud Run for cost efficiency and scalability」，並把複雜的有狀態應用放在 GKE。兩者都使用標準容器映像檔，所以服務在兩邊之間搬移相對容易。
- 結論：「The best approach ultimately depends on your specific needs and priorities.」

**〔建議〕判斷表**

| 情境 | 建議 |
|---|---|
| 一個前端加一個 API、無狀態、DB 用 Cloud SQL、流量不大或起伏大 | **留在 Cloud Run**。不用付叢集的固定成本，可以 scale to zero，維運負擔最小 |
| 想學 k8s、為了職涯需要 | 用 OrbStack 加一個短期的 GKE Autopilot 練習叢集來學，**正式環境不一定要跟著搬** |
| 服務數量多（例如 5 個以上）、彼此呼叫頻繁、需要統一的流量和政策管理 | 開始值得考慮 GKE |
| 需要常駐的背景 worker、長連線、自訂 sidecar、DaemonSet、GPU 排程、需要控制節點 | GKE |
| 流量穩定，叢集的固定成本攤下來比較便宜 | GKE（Google 也提到可預測的工作負載用 GKE 可能更划算） |
| 公司已經在用 k8s 生態（Argo CD、Helm chart、多雲） | GKE |

**〔建議〕結論**：以使用者目前「單一容器上 Cloud Run」的情況來說，**k8s 是值得學的技能，但不一定是現在系統該換的平台**。比較務實的路線是：正式環境維持 Cloud Run；學習和作品集用 OrbStack 加 GKE Autopilot；等出現上表中「該換 GKE」的訊號再搬。因為兩邊都用同一份容器映像檔，搬移成本主要在部署設定，不在程式碼。

---

## 5. 前後端上 k8s 的建議架構

### 5.1 架構總覽〔建議〕

```
              Internet
                 │
      ┌──────────▼───────────┐
      │ Gateway (GKE: gke-l7-global-external-managed / 本機: Traefik 等) │
      │  HTTPRoute:  /api → backend:80   /  → frontend:80               │
      └──────┬──────────────────────┬───────┘
             │                      │
     Service frontend        Service backend
             │                      │
   Deployment frontend     Deployment backend ──(sidecar) cloud-sql-proxy ──► Cloud SQL（叢集外）
   (nginx 提供 SPA 靜態檔)   (API，KSA + Workload Identity)
             ConfigMap / Secret（每個 namespace：app-staging、app-prod）
```

### 5.2 前端要怎麼放？〔建議〕

| 方案 | 適合 | 優點 | 缺點 |
|---|---|---|---|
| **A. nginx 容器提供 SPA**（放在叢集內） | 學習 k8s、要跟後端同網域、同一條部署流程 | 同源，不用處理 CORS；一個 Gateway 就搞定；本機和 GKE 一致 | 純靜態檔也要付 Pod 的費用（Autopilot 有資源下限） |
| **B. Cloud Storage ＋ Cloud CDN** | 正式環境的純 SPA | 便宜、快、不佔叢集資源 | 要另外設定 LB 和 CDN，和 k8s 部署流程分開（[靜態網站代管](https://docs.cloud.google.com/storage/docs/hosting-static-website)） |
| **C. SSR Node 容器**（Next.js／Nuxt） | 需要 SSR 或 SEO | 和後端一樣都是 Deployment | 要調資源和健康檢查，冷啟動和記憶體也要注意 |

**〔建議〕** 學習階段選 **A**（純 SPA）或 **C**（SSR）。正式環境如果是純 SPA，**B** 通常比較划算，但也會讓 k8s 練習少掉一塊。

### 5.3 資料庫：放叢集外〔建議〕

正式環境用 **Cloud SQL**，不要在叢集裡用 StatefulSet 自己跑 DB。託管服務已經處理備份、HA、升級，而 Google 也把 GKE 連 Cloud SQL 的建議做法寫得很清楚（見 3.2）。本機練習時可以在 OrbStack 跑一個 Postgres Deployment，只放在 `overlays/local`。

### 5.4 目錄結構〔建議〕

```
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── backend/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── serviceaccount.yaml
│   │   └── configmap.yaml
│   └── httproute.yaml
└── overlays/
    ├── local/                  # OrbStack
    │   ├── kustomization.yaml
    │   ├── gateway.yaml        # 本機 Gateway API 實作的 GatewayClass
    │   ├── postgres.yaml       # 只用於本機
    │   └── patch-backend-db.yaml
    ├── gke-staging/
    │   ├── kustomization.yaml
    │   ├── gateway.yaml        # gke-l7-global-external-managed
    │   ├── healthcheckpolicy.yaml
    │   └── patch-backend-sqlproxy.yaml
    └── gke-prod/
        └── kustomization.yaml  # 可以從 gke-staging 繼承後再改 replicas、資源
```

### 5.5 YAML 範例

> 這些範例使用目前的穩定 API 版本：`apps/v1`、`v1`、`gateway.networking.k8s.io/v1`、`kustomize.config.k8s.io/v1beta1`。〔建議〕實際套用前，先用 `kubectl apply -k ... --dry-run=server` 驗證。

**base/backend/deployment.yaml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: backend
    spec:
      serviceAccountName: backend
      containers:
        - name: api
          image: backend            # 由 kustomization 的 images 欄位改寫
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: backend-config
            - secretRef:
                name: backend-secret   # 不進版控，用 kubectl create secret 或 Secret Manager 建立
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              memory: 512Mi
```

**base/backend/service.yaml**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  selector:
    app: backend
  ports:
    - name: http
      port: 80
      targetPort: http
```
（frontend 的 Deployment 和 Service 結構相同：containerPort 80，image 用 nginx 打包的 SPA，probe 打 `/`。）

**base/httproute.yaml**
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app
spec:
  parentRefs:
    - name: web            # 由各個 overlay 提供同名的 Gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: backend
          port: 80
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: frontend
          port: 80
```

**overlays/gke-staging/gateway.yaml**
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: web
spec:
  gatewayClassName: gke-l7-global-external-managed
  listeners:
    - name: http
      protocol: HTTP
      port: 80
```

**overlays/gke-staging/healthcheckpolicy.yaml**（GKE Gateway 不會讀 readinessProbe，見 3.2）
```yaml
apiVersion: networking.gke.io/v1
kind: HealthCheckPolicy
metadata:
  name: backend-hc
spec:
  default:
    config:
      type: HTTP
      httpHealthCheck:
        requestPath: /healthz
  targetRef:
    group: ""
    kind: Service
    name: backend
```
> 〔未驗證〕欄位結構是依 [Configure Gateway resources using Policies](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/configure-gateway-resources) 的寫法整理的，本文沒有逐欄核對最新版本，請以該頁範例為準。

**overlays/gke-staging/patch-backend-sqlproxy.yaml**（原生 sidecar，寫法依 [Cloud SQL 文件](https://docs.cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)）
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  template:
    spec:
      initContainers:
        - name: cloud-sql-proxy
          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2   # 〔建議〕正式環境改成固定的版本號
          restartPolicy: Always
          args:
            - "--port=5432"
            - "PROJECT_ID:REGION:INSTANCE"
          securityContext:
            runAsNonRoot: true
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
```
> 〔未驗證〕Proxy 映像檔的確切路徑和 tag 請以官方文件當下的範例為準。backend 的 KSA 要用 Workload Identity 取得 `roles/cloudsql.client`。

**overlays/gke-staging/kustomization.yaml**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-staging
resources:
  - ../../base
  - gateway.yaml
  - healthcheckpolicy.yaml
patches:
  - path: patch-backend-sqlproxy.yaml
configMapGenerator:
  - name: backend-config
    behavior: merge
    literals:
      - DB_HOST=127.0.0.1
      - APP_ENV=staging
images:
  - name: backend
    newName: asia-east1-docker.pkg.dev/PROJECT_ID/app/backend
    newTag: "GIT_SHA"
  - name: frontend
    newName: asia-east1-docker.pkg.dev/PROJECT_ID/app/frontend
    newTag: "GIT_SHA"
```

**overlays/local/kustomization.yaml**（OrbStack：映像檔直接用本機 build 的 `:dev`，不用推）
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: app-local
resources:
  - ../../base
  - gateway.yaml        # gatewayClassName 填本機安裝的實作，例如 traefik
  - postgres.yaml
patches:
  - path: patch-backend-db.yaml
images:
  - name: backend
    newName: backend
    newTag: dev
  - name: frontend
    newName: frontend
    newTag: dev
```
- base 裡的 `configMapGenerator`（`name: backend-config`）放共用設定。
- `namespace` 資源要另外建立，或者用 `kubectl create ns`。
- Kustomize 的 `patches`、`images`、`configMapGenerator` 欄位見 [kubernetes.io Kustomize 任務頁](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) 和 [kubectl.docs.kubernetes.io](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/)。
- 〔建議〕不要再用舊的 `patchesStrategicMerge`、`commonLabels`，改用 `patches`、`labels`。〔未驗證〕本文沒有逐條核對這兩個欄位的棄用時程。

### 5.6 CI/CD〔建議〕

```
git push ──► GitHub Actions（或 Cloud Build）
              1. docker build（tag = git SHA）
              2. push 到 asia-east1-docker.pkg.dev/PROJECT/app/*
              3. cd k8s/overlays/gke-staging && kustomize edit set image backend=...:SHA
              4. kubectl apply -k k8s/overlays/gke-staging
              5. kubectl rollout status deploy/backend -n app-staging
```
- GitHub Actions 用 Workload Identity Federation（OIDC）向 GCP 驗證，不要把 SA JSON key 放進 GitHub Secrets。〔未驗證〕本文沒有展開 WIF for GitHub 的設定步驟，請參考 Google Cloud IAM 的 Workload Identity Federation 文件。
- 進階做法：改成 GitOps（Argo CD 監看 `overlays/*`），CI 只負責「建置映像檔並更新 tag 的 commit」。

---

## 6. 除錯速查（MVP 必會）〔建議〕，依據 [Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)

| 症狀 | 先看 | 常見原因 |
|---|---|---|
| `CrashLoopBackOff` | `kubectl logs POD --previous`、`kubectl describe pod`（Last State、Exit Code） | 程式啟動失敗、缺環境變數、liveness 太嚴格、OOMKilled（exit 137） |
| `ImagePullBackOff` | `describe` 的 Events | tag 打錯、沒有 AR 讀取權限、OrbStack 上用了 `:latest` |
| `Pending` | `describe` 的 Events | requests 太大，或 Autopilot 正在佈建節點（等一下就好） |
| Service 打不到 | `kubectl get endpointslices -l kubernetes.io/service-name=SVC` | selector 和 label 對不上、readiness 失敗、targetPort 寫錯 |
| GKE LB 回傳 502 或 no healthy upstream | Gateway／HTTPRoute 的 `status`、HealthCheckPolicy | 健康檢查路徑沒回 200（Gateway 預設檢查 `/`） |
| 整體狀況 | `kubectl get events -n NS --sort-by=.lastTimestamp` | — |

---

## 7. 參考資料

**Kubernetes 官方**
- [Kubernetes Basics 教學](https://kubernetes.io/docs/tutorials/kubernetes-basics/)、[Concepts](https://kubernetes.io/docs/concepts/)
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[Service](https://kubernetes.io/docs/concepts/services-networking/service/)、[Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/)、[Ingress（已凍結）](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)、[Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)、[ConfigMap](https://kubernetes.io/docs/concepts/configuration/configmap/)、[Secret](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Debug Applications](https://kubernetes.io/docs/tasks/debug/debug-application/)、[Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/)
- [Releases](https://kubernetes.io/releases/)
- [Ingress NGINX Retirement（2025-11-11）](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)、[Steering／SRC 聲明（2026-01-29）](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/)、[Ingress2Gateway 1.0（2026-03-20）](https://kubernetes.io/blog/2026/03/20/ingress2gateway-1-0-release/)

**OrbStack**
- [Kubernetes | OrbStack Docs](https://docs.orbstack.dev/kubernetes/)

**Google Cloud**
- [Choose a GKE mode of operation](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/choose-cluster-mode)、[GKE pricing](https://cloud.google.com/kubernetes-engine/pricing)、[Autopilot resource requests](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests)
- [GKE and Cloud Run](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run)
- [Gateway API on GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gateway-api)、[Deploying Gateways](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/deploying-gateways)、[Gateway Policies](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/configure-gateway-resources)
- [Workload Identity Federation for GKE](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Artifact Registry Docker 驗證](https://docs.cloud.google.com/artifact-registry/docs/docker/authentication)
- [Connect to Cloud SQL from GKE](https://docs.cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Secret Manager add-on for GKE](https://docs.cloud.google.com/secret-manager/docs/secret-manager-managed-csi-component)

**認證**
- [github.com/cncf/curriculum](https://github.com/cncf/curriculum)
- [CKAD（Linux Foundation）](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/)、[KCNA（Linux Foundation）](https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate/)
