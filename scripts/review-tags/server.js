#!/usr/bin/env node
/**
 * review-tags/server.js
 * ------------------------------------------------------------
 * src/content/books/*.json を1冊ずつ目視確認しながら
 * tags / mainColor / peopleCount を修正するためのローカル管理ツール。
 *
 * 使い方:
 *   npm run review-tags
 *   -> http://localhost:5050 をブラウザで開く
 *
 * 保存すると該当のJSONファイルを直接書き換える。サイトの公開データには
 * 含まれないローカル専用ツールで、Astroのビルド/デプロイには一切関与しない。
 * ------------------------------------------------------------
 */

import { createServer } from 'node:http';
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', '..', 'src', 'content', 'books');
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');
const PORT = process.env.REVIEW_TAGS_PORT || 5050;

// --- 新規登録（ISBN検索）用: fetch_kobo_data.js と同じロジックを流用 ---
const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const APP_ORIGIN = process.env.RAKUTEN_APP_ORIGIN || 'https://yaoi-palette.github.io';
const API_ENDPOINT = 'https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404';

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

function upscaleCoverUrl(url) {
  if (!url) return url;
  return url.replace(/_ex=\d+x\d+/, '_ex=800x800');
}

function normalizeSalesDate(salesDate) {
  if (!salesDate) return undefined;
  const match = salesDate.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

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
  if (!coverUrl) return 'pink';
  try {
    const res = await fetch(coverUrl);
    if (!res.ok) throw new Error(`表紙画像取得失敗 (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const stats = await sharp(buffer).stats();
    return classifyMainColorFromRgb(stats.dominant);
  } catch {
    return 'pink';
  }
}

const GROUP_KEYWORDS = /群像劇|オムニバス|アンソロジー|三角関係|3P|三人|四人|複数カップル|総受け|総攻め/;
const SOLO_KEYWORDS = /一人称|ひとり暮らし|ソロ活動|自伝|エッセイ/;

function classifyPeopleCount(text) {
  if (!text) return 'duo';
  if (GROUP_KEYWORDS.test(text)) return 'group';
  if (SOLO_KEYWORDS.test(text)) return 'solo';
  return 'duo';
}

async function searchByIsbn(isbn) {
  if (!APP_ID || !ACCESS_KEY) {
    throw new Error('RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が設定されていません（.envを確認してください）');
  }
  const params = new URLSearchParams({
    format: 'json',
    applicationId: APP_ID,
    accessKey: ACCESS_KEY,
    affiliateId: AFFILIATE_ID ?? '',
    isbnjan: isbn,
    hits: '1',
  });
  const url = `${API_ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, { headers: { Origin: APP_ORIGIN } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`楽天APIリクエスト失敗 (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.Items?.[0]?.Item ?? null;
}

async function lookupByIsbn(isbn) {
  const item = await searchByIsbn(isbn);
  if (!item) return null;

  const coverUrl = upscaleCoverUrl(item.largeImageUrl || item.mediumImageUrl || item.smallImageUrl || '');
  const mainColor = await classifyMainColor(coverUrl);
  const peopleCount = classifyPeopleCount(`${item.title ?? ''} ${item.itemCaption ?? ''}`);

  return {
    title: item.title ?? '',
    author: item.author ?? '不明',
    coverUrl,
    affiliateUrl: item.affiliateUrl || item.itemUrl || '',
    mainColor: [mainColor],
    peopleCount,
    fontStyle: '',
    tags: [],
    description: item.itemCaption ?? '',
    price: item.itemPrice ?? undefined,
    publishedDate: normalizeSalesDate(item.salesDate),
    memo: '楽天APIから自動生成。mainColor/peopleCountは自動推定のため要確認。tagsは未設定。',
  };
}

async function createBook(book) {
  const existing = new Set(await readdir(BOOKS_DIR));
  let filename = `${slugify(book.title || '無題')}.json`;
  let n = 2;
  while (existing.has(filename)) {
    filename = `${slugify(book.title || '無題')}-${n}.json`;
    n += 1;
  }
  const filePath = path.join(BOOKS_DIR, filename);
  await writeFile(filePath, `${JSON.stringify(book, null, 2)}\n`, 'utf-8');
  return filename;
}

function isBookFile(f) {
  return f.endsWith('.json') && !f.startsWith('sample');
}

async function listBooks() {
  const files = (await readdir(BOOKS_DIR)).filter(isBookFile).sort();
  const books = [];
  for (const filename of files) {
    const data = JSON.parse(await readFile(path.join(BOOKS_DIR, filename), 'utf-8'));
    books.push({
      filename,
      title: data.title ?? '',
      author: data.author ?? '',
      coverUrl: data.coverUrl ?? '',
      description: data.description ?? '',
      price: data.price,
      publishedDate: data.publishedDate,
      mainColor: Array.isArray(data.mainColor) ? data.mainColor : [data.mainColor ?? 'pink'],
      peopleCount: data.peopleCount ?? 'duo',
      fontStyle: data.fontStyle ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      memo: data.memo ?? '',
      needsReview: /要確認/.test(data.memo ?? ''),
    });
  }
  return books;
}

async function saveBook(filename, patch) {
  if (!isBookFile(filename)) throw new Error('invalid filename');
  const filePath = path.join(BOOKS_DIR, filename);
  const data = JSON.parse(await readFile(filePath, 'utf-8'));

  if (Array.isArray(patch.tags)) data.tags = patch.tags;
  if (Array.isArray(patch.mainColor) && patch.mainColor.length > 0) data.mainColor = patch.mainColor;
  if (typeof patch.peopleCount === 'string') data.peopleCount = patch.peopleCount;
  if (typeof patch.fontStyle === 'string') {
    if (patch.fontStyle) data.fontStyle = patch.fontStyle;
    else delete data.fontStyle;
  }

  if (patch.confirmed) {
    data.memo = (data.memo ?? '')
      .replace(/[^。]*要確認[^。]*。?/g, '')
      .trim();
    if (!data.memo) data.memo = '目視確認済み。';
    else if (!/確認済み/.test(data.memo)) data.memo = `${data.memo} 目視確認済み。`;
  }

  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  return data;
}

async function deleteBook(filename) {
  if (!isBookFile(filename)) throw new Error('invalid filename');
  const filePath = path.join(BOOKS_DIR, filename);
  await unlink(filePath);
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const html = await readFile(INDEX_HTML_PATH, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/books') {
      const books = await listBooks();
      sendJson(res, 200, books);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/lookup') {
      const isbn = url.searchParams.get('isbn')?.trim() ?? '';
      if (!isbn) {
        sendJson(res, 400, { error: 'isbnを指定してください' });
        return;
      }
      const found = await lookupByIsbn(isbn);
      if (!found) {
        sendJson(res, 404, { error: 'この ISBN の本が見つかりませんでした' });
        return;
      }
      sendJson(res, 200, found);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/books') {
      const book = await readRequestBody(req);
      if (!book.title || !Array.isArray(book.mainColor) || book.mainColor.length === 0) {
        sendJson(res, 400, { error: 'title と mainColor は必須です' });
        return;
      }
      const filename = await createBook(book);
      sendJson(res, 200, { filename, ...book });
      return;
    }

    const saveMatch = url.pathname.match(/^\/api\/books\/([^/]+)$/);
    if (req.method === 'POST' && saveMatch) {
      const filename = decodeURIComponent(saveMatch[1]);
      const patch = await readRequestBody(req);
      const updated = await saveBook(filename, patch);
      sendJson(res, 200, updated);
      return;
    }

    if (req.method === 'DELETE' && saveMatch) {
      const filename = decodeURIComponent(saveMatch[1]);
      await deleteBook(filename);
      sendJson(res, 200, { deleted: filename });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`タグ確認ツールを起動しました: ${url}`);
  console.log('Ctrl+C で終了します。');
  openBrowser(url);
});
