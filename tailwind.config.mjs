/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        stage: '#FFFFFF',      // ギャラリーの背景（白）
        surface: '#FFFFFF',    // カード面
        surface2: '#F7F1F3',   // ホバー時など一段トーンを落とした面
        ink: '#231F29',        // 主テキスト
        inkdim: '#8A8090',     // 副テキスト
        wine: '#B4485F',       // メインアクセント（ロゴのハートと同系色）
        gold: '#C9A227',       // サブアクセント（タグ・価格など）
        line: '#E8E2E6',       // 罫線
      },
      fontFamily: {
        display: ['"Shippori Mincho"', 'serif'],
        body: ['"Zen Kaku Gothic New"', 'sans-serif'],
      },
      aspectRatio: {
        cover: '3 / 4',
      },
      maxWidth: {
        prose: '68ch',
      },
    },
  },
  plugins: [],
};
