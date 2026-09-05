#!/usr/bin/env node
/**
 * fetch_kobo_data.js
 * ------------------------------------------------------------
 * data/extracted_titles.json のタイトル一覧を元に、楽天ブックス
 * 総合検索API（Kobo電子書籍ジャンル）を叩いて表紙画像・アフィリ
 * エイトリンク等を取得し、src/content/books/*.json を生成する。
 *
 * 事前準備（2026年の楽天API改定後の仕様）:
 *   1. 楽天ウェブサービス (https://webservice.rakuten.co.jp/app/list) で
 *      アプリを登録し、applicationId(UUID形式)とaccessKey("pk_"から始まる文字列)
 *      を取得。アプリケーションURLには本サイトのURLを登録しておくこと
 *      （Originヘッダー検証でこのURLと一致している必要がある）。
 *   2. 楽天アフィリエイト (https://affiliate.rakuten.co.jp/) で
 *      アフィリエイトID(affiliateId)を取得
 *   3. .env ファイル（プロジェクト直下）に設定:
 *        RAKUTEN_APP_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 *        RAKUTEN_ACCESS_KEY="pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 *        RAKUTEN_AFFILIATE_ID="xxxxx"
 *   4. Node.js 20.6以降（--env-file-if-exists と組み込みfetchを使用）
 *
 * 使い方:
 *   npm run fetch-kobo
 *   （内部で node --env-file-if-exists=.env scripts/fetch_kobo_data.js を実行）
 *
 * 750冊規模のバッチ処理を想定した挙動:
 *   - data/fetch_progress.json に処理済みタイトルを記録し、途中で
 *     中断しても再実行時に成功済み分をスキップして再開できる。
 *   - APIエラー・画像取得エラーは指数バックオフで最大3回リトライ。
 *   - 見つからなかった／最終的に失敗したタイトルは
 *     data/fetch_failures.json に一覧化し、手動確認に回せるようにする。
 *   - 出力ファイル名はタイトルのハッシュを含むため、実行順序が変わっても
 *     同じタイトルは常に同じファイルを指す（重複生成防止）。
 *
 * 自動分類について（要確認前提の一次判定）:
 *   - mainColor: 表紙画像をダウンロードし sharp で支配色を抽出、
 *     色相/明度から pink/black/blue/yellow/green/white/red に丸める。
 *   - peopleCount: タイトル・あらすじのキーワードから group/solo を推測し、
 *     判定できなければ BL表紙で最多構図の duo を既定値にする。
 *   どちらも完全な精度は保証できないため、生成後に目視確認すること
 *   （memo 欄に "要確認" と入る）。
 * ------------------------------------------------------------
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const TITLES_PATH = path.join(DATA_DIR, 'extracted_titles.json');
const PROGRESS_PATH = path.join(DATA_DIR, 'fetch_progress.json');
const FAILURES_PATH = path.join(DATA_DIR, 'fetch_failures.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'content', 'books');

const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
// 2026年のAPI改定でジャンルID体系が変更されたため、未設定の場合はジャンル絞り込みをしない
// （キーワード検索のみで十分実用的なため）。指定したい場合は環境変数で新ジャンルIDを渡す。
const GENRE_ID = process.env.RAKUTEN_GENRE_ID;
// 2026年のAPI改定でOriginヘッダーによるリクエスト元検証が必須になった。
// アプリ登録時の「アプリケーションURL」と一致させる必要がある。
const APP_ORIGIN = process.env.RAKUTEN_APP_ORIGIN || 'https://yaoi-palette.github.io';

const API_ENDPOINT = 'https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404';
const REQUEST_INTERVAL_MS = 1100; // 楽天APIのレート制限に配慮
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(title) {
  const base = title
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  const hash = crypto.createHash('sha1').update(title).digest('hex').slice(0, 8);
  return `${base || 'book'}-${hash}`;
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = REQUEST_INTERVAL_MS * attempt * 2;
        console.log(`  ${label} 失敗 (試行${attempt}/${MAX_RETRIES}): ${err.message} -> ${backoff}ms後にリトライ`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

async function searchTitle(title) {
  const params = new URLSearchParams({
    format: 'json',
    applicationId: APP_ID,
    accessKey: ACCESS_KEY,
    affiliateId: AFFILIATE_ID ?? '',
    keyword: title,
    hits: '1',
  });
  if (GENRE_ID) params.set('booksGenreId', GENRE_ID);

  const url = `${API_ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Origin: APP_ORIGIN },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`APIリクエスト失敗 (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.Items?.[0]?.Item ?? null;
}

// --- mainColor: 表紙画像から支配色を抽出し、7色パレットに丸める ---

const COLOR_KEYWORDS = ['pink', 'black', 'blue', 'yellow', 'green', 'white', 'red'];

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }

  return { h, s, l };
}

function classifyMainColorFromRgb({ r, g, b }) {
  const { h, s, l } = rgbToHsl(r, g, b);

  if (l > 0.92) return 'white';
  if (l < 0.12) return 'black';
  if (s < 0.15) return l > 0.5 ? 'white' : 'black';

  if (h >= 345 || h < 15) return l > 0.62 ? 'pink' : 'red';
  if (h < 45) return 'yellow';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  if (h < 320) return 'pink';
  return 'pink';
}

async function classifyMainColor(coverUrl) {
  if (!coverUrl) return { mainColor: 'pink', colorConfident: false };

  try {
    const res = await fetch(coverUrl);
    if (!res.ok) throw new Error(`表紙画像取得失敗 (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const stats = await sharp(buffer).stats();
    const { r, g, b } = stats.dominant;
    return { mainColor: classifyMainColorFromRgb({ r, g, b }), colorConfident: true };
  } catch (err) {
    console.log(`  表紙色の自動判定に失敗: ${err.message}`);
    return { mainColor: 'pink', colorConfident: false };
  }
}

// --- peopleCount: タイトル・あらすじのキーワードから簡易推測 ---

const GROUP_KEYWORDS = /群像劇|オムニバス|アンソロジー|三角関係|3P|三人|四人|複数カップル|総受け|総攻め/;
const SOLO_KEYWORDS = /一人称|ひとり暮らし|ソロ活動|自伝|エッセイ/;

function classifyPeopleCount(text) {
  if (!text) return { peopleCount: 'duo', peopleConfident: false };
  if (GROUP_KEYWORDS.test(text)) return { peopleCount: 'group', peopleConfident: true };
  if (SOLO_KEYWORDS.test(text)) return { peopleCount: 'solo', peopleConfident: true };
  return { peopleCount: 'duo', peopleConfident: false };
}

function buildBookJson(item, fallbackTitle, mainColorResult, peopleCountResult) {
  const needsReview = !mainColorResult.colorConfident || !peopleCountResult.peopleConfident;
  return {
    title: item?.title ?? fallbackTitle,
    author: item?.author ?? '不明',
    coverUrl: item?.largeImageUrl || item?.mediumImageUrl || item?.smallImageUrl || '',
    affiliateUrl: item?.affiliateUrl || item?.itemUrl || '',
    mainColor: mainColorResult.mainColor,
    peopleCount: peopleCountResult.peopleCount,
    tags: [], // 要確認: スパダリ・執着・オフィスラブ等のタグを追記
    description: item?.itemCaption ?? '',
    price: item?.itemPrice ?? undefined,
    publishedDate: item?.salesDate ?? undefined,
    memo: needsReview
      ? '楽天APIから自動生成。mainColor/peopleCountは自動推定のため要確認。tagsは未設定。'
      : '楽天APIから自動生成。tagsは未設定のため要確認。',
  };
}

async function loadJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function main() {
  if (!APP_ID) {
    console.error('環境変数 RAKUTEN_APP_ID が設定されていません。');
    process.exitCode = 1;
    return;
  }
  if (!ACCESS_KEY) {
    console.error('環境変数 RAKUTEN_ACCESS_KEY が設定されていません（2026年API改定によりapplicationIdと併用が必須）。');
    process.exitCode = 1;
    return;
  }

  let titles;
  try {
    titles = JSON.parse(await readFile(TITLES_PATH, 'utf-8'));
  } catch {
    console.error(`タイトル一覧が読み込めません: ${TITLES_PATH}`);
    console.error('先に scripts/extract_titles.js を実行してください。');
    process.exitCode = 1;
    return;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const progress = await loadJsonSafe(PROGRESS_PATH, {});
  const failures = [];

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    process.stdout.write(`[${i + 1}/${titles.length}] ${title} ... `);

    if (progress[title]?.status === 'success') {
      console.log('スキップ（処理済み）');
      skipCount += 1;
      continue;
    }

    try {
      const item = await withRetry(() => searchTitle(title), 'API検索');

      if (!item) {
        console.log('見つかりませんでした（スキップ）');
        progress[title] = { status: 'not_found' };
        failures.push({ title, reason: 'not_found' });
        failCount += 1;
        await sleep(REQUEST_INTERVAL_MS);
        continue;
      }

      const coverUrl = item.largeImageUrl || item.mediumImageUrl || item.smallImageUrl || '';
      const mainColorResult = await classifyMainColor(coverUrl);
      const peopleCountResult = classifyPeopleCount(`${item.title ?? ''} ${item.itemCaption ?? ''}`);

      const bookJson = buildBookJson(item, title, mainColorResult, peopleCountResult);
      const filename = `${slugify(bookJson.title)}.json`;
      const outPath = path.join(OUTPUT_DIR, filename);
      await writeFile(outPath, JSON.stringify(bookJson, null, 2), 'utf-8');

      progress[title] = { status: 'success', file: filename };
      console.log(`OK -> ${filename}`);
      successCount += 1;
    } catch (err) {
      console.log(`エラー: ${err.message}`);
      progress[title] = { status: 'error', error: err.message };
      failures.push({ title, reason: err.message });
      failCount += 1;
    }

    // 途中で中断されても再開できるよう、1件処理するごとに進捗を保存
    await writeFile(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf-8');
    await sleep(REQUEST_INTERVAL_MS);
  }

  if (failures.length > 0) {
    await writeFile(FAILURES_PATH, JSON.stringify(failures, null, 2), 'utf-8');
  }

  console.log('----------------------------------------');
  console.log(`成功: ${successCount} 件 / スキップ(処理済み): ${skipCount} 件 / 失敗・未検出: ${failCount} 件`);
  console.log(`生成先: ${OUTPUT_DIR}`);
  if (failures.length > 0) {
    console.log(`失敗・未検出の一覧: ${FAILURES_PATH}`);
  }
  console.log('mainColor / peopleCount は自動推定です。tags と合わせて必ず内容を確認してください。');
}

main();
