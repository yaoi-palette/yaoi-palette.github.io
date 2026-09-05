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
]);

// 人数・構図: 表紙に写る人数で絞り込む
const peopleCountEnum = z.enum(['solo', 'duo', 'group']);

const booksCollection = defineCollection({
  type: 'data', // src/content/books/*.json を読み込む
  schema: z.object({
    title: z.string(),
    author: z.string(),
    coverUrl: z.string().url(),
    // 楽天Koboアフィリエイトリンク（本文中では実キーを含めず、id を .env 側で付与する運用を推奨）
    affiliateUrl: z.string().url(),
    mainColor: mainColorEnum,
    peopleCount: peopleCountEnum,
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
