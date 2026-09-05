/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        stage: '#16141A',      // ギャラリーの背景（暗いステージ）
        surface: '#211D27',    // カード面
        surface2: '#2A2531',   // ホバー時など一段明るい面
        ink: '#F1EDE7',        // 主テキスト
        inkdim: '#B9B2C2',     // 副テキスト
        wine: '#B4485F',       // メインアクセント（表紙が映える深いローズ）
        gold: '#C9A227',       // サブアクセント（タグ・価格など）
        line: '#39323F',       // 罫線
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
