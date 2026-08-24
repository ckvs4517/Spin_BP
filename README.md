# Spin BP

一個極簡的 BEYBLADE X 比賽規則圖片產生器。

## 使用方式

1. 開啟網站。
2. 選擇「以下陀螺禁止使用」或「只有以下陀螺可使用」。
3. 用 BX / UX / CX 與搜尋快速篩選。
4. 點選要列入規則圖的陀螺。
5. 輸入比賽名稱與補充規則。
6. 下載 PNG，直接貼到 LINE / Discord / Facebook / 報名頁。

## 架構

- 純 HTML / CSS / JavaScript，沒有後端、帳號、資料庫。
- 前端只讀取 repo 內的 `data/beyblades.json` 與 `images/`。
- GitHub Action 每天自動從 `https://beyblade.phstudy.org/data/main.json` 同步 BX / UX / CX 圖鑑資料。
- 同步時把圖片下載到 repo，確保 Canvas 輸出 PNG 時不會被跨網域限制卡住。
- 瀏覽器用 localStorage 記住上次選擇。

## 手動更新資料

GitHub → Actions → **Sync Beyblade data** → **Run workflow**。

本機也可以：

```bash
npm run sync:data
```

## 部署

這是完全靜態網站，可直接使用 GitHub Pages。將 Pages 的 Source 設為 `Deploy from a branch`，Branch 選 `main` / `/ (root)` 即可。

## 資料與圖片

圖鑑資料來源為 `beyblade.phstudy.org`。商品名稱、圖片與相關權利屬其原權利人；本專案只做比賽規則整理與圖片產生。
