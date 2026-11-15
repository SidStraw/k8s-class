# 舵手訓練：Kubernetes 互動學習遊戲

依 `docs/research/k8s-frontend-to-jr-devops-mvp.md` 的學習路徑設計的模擬演練。全部在瀏覽器裡執行，不會連到任何真實叢集或雲端。

## 開始

直接用瀏覽器開 `index.html`（不需要安裝或啟動伺服器）：

```bash
open game/index.html
```

進度存在瀏覽器的 localStorage。

## 內容

| 章 | 主題 | 環境 |
|---|---|---|
| 0 | 觀念測驗 | — |
| 1 | Deployment、Service、擴展、滾動更新與回滾、CrashLoopBackOff、ImagePullBackOff | 模擬 OrbStack |
| 2 | ConfigMap／Secret、probes、requests／limits、Gateway＋HTTPRoute、Kustomize | 模擬 OrbStack |
| 3 | Artifact Registry、Cloud SQL Auth Proxy＋Workload Identity、GKE Gateway 健康檢查、Autopilot 計費 | 模擬 GKE |
| 4 | 扮演 CI（發布失敗與回滾）、Cloud Run vs GKE 判斷、MVP 自我檢核 | 模擬 GKE |

每一關都有逐步引導、提示、解答，過關後附「在真的 OrbStack 上重做」的指令。

## 模擬範圍

模擬器只實作學習路徑需要的行為，輸出格式盡量貼近真實工具，但不是真的 Kubernetes：

- 狀態是立刻算出來的，沒有時間流逝（沒有 `-w`，`rollout status` 不會真的等待）。
- 只支援 Deployment 管理的 Pod；沒有 StatefulSet、Job、HPA、RBAC、NetworkPolicy。
- Kustomize 只支援 `resources`、`patches`、`images`、`namespace`。
- GKE 的費用是「模擬點數」，不是真實價格。
- 終端機裡 💡 開頭的行是模擬器的旁白，真實工具不會印出來。

## 檔案

- `js/sim.js`：叢集模擬器（Pod 狀態、滾動更新、Service／Gateway 路由、Kustomize）
- `js/shell.js`：模擬的 `kubectl`、`docker`、`orb`、`curl` 等指令
- `js/levels.js`：關卡內容與過關條件
- `js/app.js`、`styles.css`、`index.html`：介面
- `vendor/js-yaml.min.js`：YAML 解析（MIT 授權）

## 測試

```bash
node game/test/play.cjs      # 逐關套用解答，確認每一關都能破關
node game/test/play.cjs -v   # 同時印出每個指令的輸出
```
