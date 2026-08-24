# Spin BP editor backend

This Worker stores only manual catalog overrides. The synchronized catalog remains in GitHub Pages.

## Stored data

- hidden / restored item state (D1)
- custom display name (D1)
- editor note (D1)
- uploaded replacement image key (D1)
- uploaded PNG/JPG/WEBP bytes (R2)

Overrides are keyed by the stable `sourceId`, so normal catalog refreshes do not erase manual edits.

## One-time Cloudflare setup

1. Create a D1 database named `spin-bp`.
2. Create an R2 bucket named `spin-bp-images`.
3. Copy `wrangler.toml.example` to `wrangler.toml` and replace `REPLACE_WITH_D1_DATABASE_ID`.
4. Run `npm install` in this directory.
5. Run `npm run db:migrate`.
6. Set the editor password as a Worker secret: `npx wrangler secret put EDITOR_PASSWORD`.
7. Run `npm run deploy`.
8. Put the deployed Worker URL into root `config.js` as `apiBase`, then commit it to `main`.

The public site only uses `GET /api/overrides`. All write, image upload, delete, and restore operations require `X-Editor-Password` and are checked by the Worker.
