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
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', '..', 'src', 'content', 'books');
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');
const PORT = process.env.REVIEW_TAGS_PORT || 5050;

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
