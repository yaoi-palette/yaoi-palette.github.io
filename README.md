# 積み本、開く。— BL本棚ギャラリー

BLコミック専用のWeb本棚ギャラリーサイト。表紙画像中心のグリッド表示と、
色・人数・属性タグでのリアルタイム絞り込みができます。Astro + Tailwind CSS
で構築した完全静的サイトで、GitHub Pagesで無料・永続的に公開できます。

## 構成

- **Astro** — 静的サイトジェネレーター
- **Tailwind CSS** — スタイリング
- **Content Collections** (`src/content/books/*.json`) — 書籍データ
- 依存パッケージなしの素のJavaScript（`<script>`タグ）でフィルタリングを実装

## セットアップ

```bash
npm install
npm run dev       # http://localhost:4321 で確認
```

現在 `src/content/books/` には架空のサンプルデータが8件入っています。
本番運用時はこれらを削除し、自分の蔵書データに差し替えてください。

## 蔵書データの作り方（半自動）

1. **購入履歴のテキスト化**
   楽天Koboの購入履歴ページを開き、対象範囲をコピーして
   `data/purchase_history.txt` に保存する。

2. **タイトル抽出**
   ```bash
   node scripts/extract_titles.js
   ```
   `data/extracted_titles.json` にタイトル一覧が出力される。誤抽出があれば
   このJSONを直接編集して整える。

3. **楽天APIから表紙・アフィリンク等を取得**
   ```bash
   export RAKUTEN_APP_ID="あなたのアプリID"
   export RAKUTEN_AFFILIATE_ID="あなたのアフィリエイトID"
   node scripts/fetch_kobo_data.js
   ```
   `src/content/books/*.json` が自動生成される。ただし `mainColor`（表紙の色）・
   `peopleCount`（人数）・`tags`（属性タグ）はAPIから自動判定できないため、
   生成後に必ず目視で確認・修正すること（各ファイルの `memo` に注記が入る）。

## データスキーマ

`src/content/config.ts` で定義。主なフィールド:

| フィールド | 説明 |
| --- | --- |
| `title` / `author` | 作品名・作者名 |
| `coverUrl` | 表紙画像URL |
| `affiliateUrl` | 楽天Koboアフィリエイトリンク |
| `mainColor` | `pink / black / blue / yellow / green / white / red` |
| `peopleCount` | `solo / duo / group`（1人・2人・3人以上） |
| `tags` | 属性タグの配列（例: `["スパダリ", "執着", "オフィスラブ"]`） |
| `description` | 紹介文（任意） |
| `price` | 参考価格（任意） |
| `publishedDate` | 発行日（任意） |

## デプロイ（GitHub Pages）

1. `astro.config.mjs` の `site` を自分のGitHub Pages URLに変更する。
   `username.github.io` リポジトリ直下で公開する場合は `base` 不要。
   `username.github.io/repo-name` 形式の場合は `base: '/repo-name'` を追加する。
2. リポジトリの Settings → Pages → Source を **GitHub Actions** に設定する。
3. `main` ブランチにpushすると `.github/workflows/deploy.yml` が自動でビルド・公開する。

サーバー費用は発生せず、GitHubアカウントが存在する限り無期限に公開され続ける
構成になっています（＝「死後放置」運用に対応）。

## ディレクトリ構成

```text
src/
├── components/
│   ├── Header.astro
│   ├── Footer.astro
│   ├── BookCard.astro        # 1作品のカードUI
│   ├── FilterBar.astro       # 色/人数/タグの絞り込みUI
│   └── AffiliateButton.astro
├── content/
│   ├── config.ts             # スキーマ定義
│   └── books/                # 書籍データ(JSON)
├── layouts/
│   └── BaseLayout.astro
└── pages/
    ├── index.astro           # メインギャラリー
    └── books/[id].astro      # 個別ページ

scripts/
├── extract_titles.js         # 購入履歴からタイトル抽出
└── fetch_kobo_data.js        # 楽天APIから書誌情報を取得
```

## 注意事項

- 表紙画像は各出版社・楽天Koboの著作物です。本サイトは自分の蔵書を記録・
  紹介する目的の個人サイトとして運用し、作品本文の複製・再配布は行わないこと。
- サンプルデータ（`src/content/books/sample-*.json`）はすべて架空の作品です。
  実在のタイトル・著者名ではありません。本番投入前に削除してください。
