#!/usr/bin/env node
/**
 * extract_titles.js
 * ------------------------------------------------------------
 * 楽天Koboの購入履歴ページ（テキストとして保存したもの）から
 * 作品タイトルの一覧を抽出し、JSON配列として出力する。
 *
 * 使い方:
 *   1. 楽天Koboの「購入履歴」画面を開き、対象部分を全選択してコピー
 *   2. data/purchase_history.txt として保存（UTF-8）
 *   3. node scripts/extract_titles.js
 *      -> data/extracted_titles.json が生成される
 *
 * 購入履歴のレイアウトは楽天側の仕様変更で変わることがあるため、
 * 抽出できなかった場合は下部の PATTERNS を調整すること。
 * ------------------------------------------------------------
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = path.join(__dirname, '..', 'data', 'purchase_history.txt');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'extracted_titles.json');

// 除外したい行（購入日・価格・注文番号などのノイズ）を検出する正規表現
const NOISE_PATTERNS = [
  /^\d{4}[年/-]\d{1,2}[月/-]\d{1,2}/, // 日付行
  /^¥?[\d,]+\s*円?$/, // 価格のみの行
  /^注文番号[:：]/,
  /^ポイント/,
  /^数量[:：]/,
  /^小計/,
  /^合計/,
  /^配送/,
];

// 「第N巻」「(N)」などの巻数表記は残しつつ、末尾の余計な記号を除去する
function cleanTitle(line) {
  return line
    .replace(/^[\s\u3000・\-–—]+/, '')
    .replace(/[\s\u3000]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isNoise(line) {
  if (!line || line.length < 2) return true;
  return NOISE_PATTERNS.some((re) => re.test(line));
}

async function main() {
  let raw;
  try {
    raw = await readFile(INPUT_PATH, 'utf-8');
  } catch (err) {
    console.error(`入力ファイルが見つかりません: ${INPUT_PATH}`);
    console.error('先に data/purchase_history.txt を用意してください。');
    process.exitCode = 1;
    return;
  }

  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const titles = [];
  const seen = new Set();

  for (const line of lines) {
    if (isNoise(line)) continue;
    const cleaned = cleanTitle(line);
    if (!cleaned || seen.has(cleaned)) continue;
    // 日本語コミックタイトルは概ね2文字以上、極端に長い行（説明文の誤検出）は除外
    if (cleaned.length > 60) continue;
    seen.add(cleaned);
    titles.push(cleaned);
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(titles, null, 2), 'utf-8');

  console.log(`抽出したタイトル数: ${titles.length}`);
  console.log(`出力先: ${OUTPUT_PATH}`);
  console.log('内容を確認し、誤抽出があれば手動で編集してから fetch_kobo_data.js に渡してください。');
}

main();
