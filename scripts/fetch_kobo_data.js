#!/usr/bin/env node
/**
 * fetch_kobo_data.js
 * ------------------------------------------------------------
 * data/extracted_titles.json のタイトル一覧を元に、楽天ブックス
 * 総合検索API（Kobo電子書籍ジャンル）を叩いて表紙画像・アフィリ
 * エイトリンク等を取得し、src/content/books/*.json を生成する。
 *
 * 事前準備:
 *   1. 楽天ウェブサービス (https://webservice.rakuten.co.jp/) で
 *      アプリID(applicationId)を取得
 *   2. 楽天アフィリエイト (https://affiliate.rakuten.co.jp/) で
 *      アフィリエイトID(affiliateId)を取得
 *   3. 環境変数に設定:
 *        export RAKUTEN_APP_ID="xxxxx"
 *        export RAKUTEN_AFFILIATE_ID="xxxxx"
 *   4. Node.js 18以降（組み込みfetchを使用）
 *
 * 使い方:
 *   node scripts/fetch_kobo_data.js
 *
 * 注意:
 *   - Main Color / 人数・構図 / 属性タグ は楽天APIからは取得できない
 *     ため、暫定値で生成した後に手動で正しい値へ編集することを
 *     前提にしている（コメント欄に "要確認" と入る）。
 *   - APIのレート制限（目安: 1リクエスト/秒）を考慮し、間隔を空けて
 *     リクエストする。
 * ------------------------------------------------------------
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TITLES_PATH = path.join(__dirname, '..', 'data', 'extracted_titles.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'content', 'books');

const APP_ID = process.env.RAKUTEN_APP_ID;
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;

const API_ENDPOINT = 'https://app.rakuten.co.jp/services/api/BooksTotal/Search/20170404';
const REQUEST_INTERVAL_MS = 1100; // 楽天APIのレート制限に配慮

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(title, index) {
  const base = title
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return base ? `${base}-${index}` : `book-${index}`;
}

async function searchTitle(title) {
  const params = new URLSearchParams({
    format: 'json',
    applicationId: APP_ID,
    affiliateId: AFFILIATE_ID ?? '',
    keyword: title,
    booksGenreId: '002004', // コミック・電子書籍(Kobo)ジャンル。必要に応じて変更
    hits: '1',
  });

  const url = `${API_ENDPOINT}?${params.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`APIリクエスト失敗 (${res.status}): ${title}`);
  }

  const data = await res.json();
  return data?.Items?.[0]?.Item ?? null;
}

function buildBookJson(item, fallbackTitle) {
  return {
    title: item?.title ?? fallbackTitle,
    author: item?.author ?? '不明',
    coverUrl: item?.largeImageUrl || item?.mediumImageUrl || item?.smallImageUrl || '',
    affiliateUrl: item?.affiliateUrl || item?.itemUrl || '',
    // 以下4項目はAPIから自動判定できないため暫定値。要確認の上、手動で修正すること。
    mainColor: 'pink', // 要確認: 表紙を見てpink/black/blue/yellow/green/white/redから選択
    peopleCount: 'duo', // 要確認: solo/duo/group から選択
    tags: [], // 要確認: スパダリ・執着・オフィスラブ等のタグを追記
    description: item?.itemCaption ?? '',
    price: item?.itemPrice ?? undefined,
    publishedDate: item?.salesDate ?? undefined,
    memo: '楽天APIから自動生成。mainColor/peopleCount/tagsは要確認。',
  };
}

async function main() {
  if (!APP_ID) {
    console.error('環境変数 RAKUTEN_APP_ID が設定されていません。');
    process.exitCode = 1;
    return;
  }

  let titles;
  try {
    const raw = await readFile(TITLES_PATH, 'utf-8');
    titles = JSON.parse(raw);
  } catch (err) {
    console.error(`タイトル一覧が読み込めません: ${TITLES_PATH}`);
    console.error('先に scripts/extract_titles.js を実行してください。');
    process.exitCode = 1;
    return;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    process.stdout.write(`[${i + 1}/${titles.length}] ${title} ... `);

    try {
      const item = await searchTitle(title);
      if (!item) {
        console.log('見つかりませんでした（スキップ）');
        failCount += 1;
        await sleep(REQUEST_INTERVAL_MS);
        continue;
      }

      const bookJson = buildBookJson(item, title);
      const filename = `${slugify(bookJson.title, i + 1)}.json`;
      const outPath = path.join(OUTPUT_DIR, filename);
      await writeFile(outPath, JSON.stringify(bookJson, null, 2), 'utf-8');

      console.log(`OK -> ${filename}`);
      successCount += 1;
    } catch (err) {
      console.log(`エラー: ${err.message}`);
      failCount += 1;
    }

    await sleep(REQUEST_INTERVAL_MS);
  }

  console.log('----------------------------------------');
  console.log(`成功: ${successCount} 件 / 失敗・未検出: ${failCount} 件`);
  console.log(`生成先: ${OUTPUT_DIR}`);
  console.log('mainColor / peopleCount / tags は自動判定できないため、必ず内容を確認・編集してください。');
}

main();
