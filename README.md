# Spin BP

一個極簡的 BEYBLADE X 比賽規則圖片產生器。

## 使用方式

1. 開啟網站。
2. 選擇「以下陀螺禁止使用」或「只有以下陀螺可使用」。
3. 用 BX / UX / CX 與搜尋快速篩選。
4. 點選要列入規則圖的陀螺。
5. 輸入比賽名稱與補充規則。
6. 下載 PNG，直接貼到 LINE / Discord / Facebook / 報名頁。

## 圖鑑同步

- GitHub Action 每天自動從 `https://beyblade.phstudy.org/data/main.json` 同步 BX / UX / CX 圖鑑資料。
- 不同配色 / 商品版本會分開保留。
- 只自動合併明確的來源鏡像資料，例如同 source ID 尾端的 `R` / `RR` alias。
- 自動同步圖片存放在 repo 的 `images/`，避免 Canvas 跨網域限制。

## 編輯者模式

網站支援永久人工修正，不會因為換電腦或重新同步圖鑑而消失：

- 隱藏 / 恢復圖鑑 item
- 修改顯示名稱
- 加管理備註
- 上傳 PNG / JPG / WEBP 自訂圖片
- 移除自訂圖片並退回同步圖
- 一鍵清除某個 item 的所有人工修改

人工修正以穩定 `sourceId` 為 key，存在 Cloudflare D1；自訂圖片存在 Cloudflare R2。GitHub Pages 每次載入圖鑑後，再套用後端 overrides。

後端程式與設定範本位於 [`worker/`](./worker/README.md)。第一次部署完成後，只需要把 Worker URL 填入根目錄 `config.js`；之後圖鑑更新不需要重新做人工修正。

## 手動更新資料

GitHub → Actions → **Sync Beyblade data** → **Run workflow**。

本機也可以：

```bash
npm run sync:data
```

## 部署

前端使用 GitHub Pages，`.github/workflows/deploy-pages.yml` 會在 `main` 更新後自動發布。

編輯者後端使用 Cloudflare Worker + D1 + R2。詳細的一次性建立步驟請看 `worker/README.md`。

## 資料與圖片

圖鑑資料來源為 `beyblade.phstudy.org`。商品名稱、圖片與相關權利屬其原權利人；本專案只做比賽規則整理與圖片產生。
