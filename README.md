# Spin BP

BEYBLADE X 比賽規則圖片產生器，正式部署目標為 ChatGPT Sites。

## 功能

- BX / UX / CX 圖鑑搜尋與篩選
- 「禁止使用」或「只有以下可使用」規則模式
- 1080px PNG 規則圖輸出
- 保留不同配色版本，只合併明確的來源鏡像資料（如尾端 R / RR）
- 編輯者模式：隱藏 / 恢復 item、修改名稱、管理備註
- 編輯者可上傳 PNG / JPG / WEBP 替換圖片
- 人工修正以 `sourceId` 為 key 永久保存，不會被後續圖鑑同步覆蓋

## 架構

### GitHub

GitHub 是 source of truth，並持續由 `.github/workflows/sync-data.yml` 每日同步 `beyblade.phstudy.org` 的 BX / UX / CX 圖鑑快照與圖片。

### ChatGPT Sites

`npm run build` 產生 Sites 部署目錄：

- `dist/client/`：HTML / CSS / JS、`data/`、`images/`
- `dist/server/index.js`：Sites Worker 入口
- `dist/server/api.js`：圖鑑人工修正 API
- `dist/.openai/hosting.json`：Sites storage bindings
- `dist/.openai/drizzle/`：D1 migration

`.openai/hosting.json` 宣告：

- D1 binding：`DB`
- R2 binding：`IMAGES`

D1 只保存人工 override metadata；R2 只保存人工上傳的替換圖片。

## 編輯者後端

公開訪客可以讀取 `GET /api/overrides`，因此人工修正會套用到所有裝置。

寫入操作需要伺服器端環境變數 / secret：

- `EDITOR_PASSWORD`

編輯者密碼不應寫進 repo、`config.js` 或 `.openai/hosting.json`。

主要 API：

- `GET /api/overrides`
- `POST /api/auth/check`
- `PUT /api/overrides/:sourceId`
- `DELETE /api/overrides/:sourceId`
- `POST /api/overrides/:sourceId/image`
- `DELETE /api/overrides/:sourceId/image`
- `GET /media/:key`

## Build

```bash
npm run build
```

## 圖鑑同步

GitHub → Actions → **Sync Beyblade data** → **Run workflow**，或本機：

```bash
npm run sync:data
```

同步只更新基礎圖鑑。Sites D1 / R2 內的人工修改不會被同步流程刪除。

## 部署原則

- 正式 hosting：ChatGPT Sites
- GitHub Pages：不再作為 production hosting
- GitHub：保留原始碼與每日圖鑑同步

第一次由 ChatGPT Sites 建立 hosted project 時，Sites 會為 `.openai/hosting.json` 補上 `project_id` 並配置 D1 / R2。

## 資料與圖片

圖鑑資料來源為 `beyblade.phstudy.org`。商品名稱、圖片與相關權利屬原權利人；本專案僅用於比賽規則整理與圖片產生。
