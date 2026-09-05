import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// GitHub Pages 用設定
// yaoi-palette.github.io リポジトリ = ユーザー/組織サイトなので
// ルート直下 (https://yaoi-palette.github.io/) で公開される。base は不要。
export default defineConfig({
  site: 'https://yaoi-palette.github.io',
  integrations: [tailwind()],
  output: 'static',
});
