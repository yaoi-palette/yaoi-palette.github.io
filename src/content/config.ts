import { defineCollection, z } from 'astro:content';

// Main Color: 表紙の印象で選ぶ主要カラー（読者の感覚的な検索軸）
const mainColorEnum = z.enum([
  'pink',
  'black',
  'blue',
  'yellow',
  'green',
  'white',
  'red',
  'brown',
  'other',
]);

// 人数・構図: 表紙に写る人数で絞り込む
const peopleCountEnum = z.enum(['solo', 'duo', 'group']);

// タイトルロゴのフォント系統: 明朝体/ゴシック体/手書き風
const fontStyleEnum = z.enum(['mincho', 'gothic', 'tegaki']);

const booksCollection = defineCollection({
  type: 'data', // src/content/books/*.json を読み込む
  schema: z.object({
    title: z.string(),
    author: z.string(),
    coverUrl: z.string().url(),
    // 楽天Koboアフィリエイトリンク（本文中では実キーを含めず、id を .env 側で付与する運用を推奨）
    affiliateUrl: z.string().url(),
    // 表紙の主要カラーは最大2色まで登録できる（絞り込みは1色ずつ選択する運用）
    mainColor: z.array(mainColorEnum).min(1).max(2),
    peopleCount: peopleCountEnum,
    // タイトルロゴの書体。未分類の本もあるため任意項目（要目視確認）
    fontStyle: fontStyleEnum.optional(),
    // 属性タグ: 「スパダリ」「執着」「オフィスラブ」などジャンルの慣用タグ
    tags: z.array(z.string()).default([]),
    description: z.string().optional(),
    price: z.number().optional(),
    publishedDate: z.coerce.date().optional(),
    // 死後放置運用のためのメモ欄。特に管理不要な情報を残せる
    memo: z.string().optional(),
  }),
});

export const collections = {
  books: booksCollection,
};
