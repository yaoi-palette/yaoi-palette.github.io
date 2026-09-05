#!/usr/bin/env node
/**
 * extract_titles.js
 * ------------------------------------------------------------
 * 楽天Koboの購入履歴から作品タイトルの一覧を抽出し、JSON配列として出力する。
 *
 * 入力は次のどちらかに対応（両方あればCSVを優先）:
 *   - data/purchase_history.csv : 購入履歴ページから「CSVエクスポート」した場合
 *     （ヘッダー行に "商品名"/"タイトル"/"title" のいずれかを含む列を自動検出）
 *   - data/purchase_history.txt : 購入履歴ページを全選択してコピペした場合
 *     （日付・価格・注文番号などのノイズ行を正規表現で除去）
 *
 * 使い方:
 *   1. 上記のいずれかを data/ 以下に保存（UTF-8）
 *   2. node scripts/extract_titles.js
 *      -> data/extracted_titles.json が生成される
 *   3. 内容を確認し、誤抽出があれば手動で編集してから fetch_kobo_data.js に渡す
 *
 * 購入履歴のレイアウトは楽天側の仕様変更で変わることがあるため、
 * 抽出できなかった場合は下部の NOISE_PATTERNS / CSV_TITLE_HEADERS を調整すること。
 * ------------------------------------------------------------
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const CSV_INPUT_PATH = path.join(DATA_DIR, 'purchase_history.csv');
const TXT_INPUT_PATH = path.join(DATA_DIR, 'purchase_history.txt');
const OUTPUT_PATH = path.join(DATA_DIR, 'extracted_titles.json');

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

// CSVのヘッダーからタイトル列を推定するためのキーワード
const CSV_TITLE_HEADERS = ['商品名', 'タイトル', 'title', '作品名'];

// 「【電子限定〇〇】」「【電子書籍】」など、購入履歴特有の販促・フォーマット表記を
// 検出するためのキーワード。これらを含む【】/＜＞括弧は検索ノイズになるため除去する。
const PROMO_BRACKET_KEYWORDS =
  /電子|限定|特典|描き下ろし|かきおろし|イラスト入り|単行本版|単話版|単話売|合冊版|無料|セット|全巻|特装|書き下ろし|ボーナス|試し読み|同時収録|購入特典|コミックス|小冊子|ペーパー|全サ|缶バッジ|ドラマCD|ブロマイド|リーフレット|複製原画/;

// 【...】＜...＞（...）(...）[...] の括弧のうち、販促キーワードを含むものだけを取り除く。
// 括弧の種類ごとに個別マッチさせることで、【…(…)…】のような入れ子でも
// 誤って別の種類の閉じ括弧で終端しないようにする。
const BRACKET_GROUP_PATTERN =
  /【[^】]*】|＜[^＞]*＞|（[^）]*）|\([^)]*\)|［[^］]*］|\[[^\]]*\]/g;

function stripPromoBrackets(text) {
  return text.replace(BRACKET_GROUP_PATTERN, (match) => {
    const inner = match.slice(1, -1);
    return PROMO_BRACKET_KEYWORDS.test(inner) ? ' ' : match;
  });
}

// 商品名の末尾は「... 【電子書籍】[ 著者名 ]」のように著者名が半角角括弧で
// 付与されることが多いため、内容を問わず末尾の角括弧のみ無条件で除去する
function stripTrailingAuthorBracket(text) {
  return text.replace(/\s*\[[^\]]*\]\s*$/, '');
}

// 「第N巻」「(N)」などの巻数表記は残しつつ、末尾の余計な記号を除去する
function cleanTitle(line) {
  return stripTrailingAuthorBracket(stripPromoBrackets(line))
    .replace(/^[\s　・\-–—]+/, '')
    .replace(/[\s　\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isNoise(line) {
  if (!line || line.length < 2) return true;
  return NOISE_PATTERNS.some((re) => re.test(line));
}

// 簡易CSVパーサー（ダブルクォート囲み・カンマ区切りに対応）
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function extractFromCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]);
  const titleColIndex = header.findIndex((h) =>
    CSV_TITLE_HEADERS.some((key) => h.includes(key))
  );

  if (titleColIndex === -1) {
    console.error(`CSVヘッダーにタイトル列が見つかりません: ${header.join(', ')}`);
    console.error(`次のいずれかを含む列名が必要です: ${CSV_TITLE_HEADERS.join(', ')}`);
    process.exitCode = 1;
    return [];
  }

  const titles = [];
  const seen = new Set();

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const raw = cells[titleColIndex];
    if (!raw) continue;
    const cleaned = cleanTitle(raw);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    titles.push(cleaned);
  }

  return titles;
}

function extractFromText(raw) {
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

  return titles;
}

async function main() {
  let titles;

  try {
    const raw = await readFile(CSV_INPUT_PATH, 'utf-8');
    console.log(`CSV入力を使用: ${CSV_INPUT_PATH}`);
    titles = extractFromCsv(raw);
  } catch {
    try {
      const raw = await readFile(TXT_INPUT_PATH, 'utf-8');
      console.log(`テキスト入力を使用: ${TXT_INPUT_PATH}`);
      titles = extractFromText(raw);
    } catch {
      console.error('入力ファイルが見つかりません。');
      console.error(`次のいずれかを用意してください: ${CSV_INPUT_PATH} または ${TXT_INPUT_PATH}`);
      process.exitCode = 1;
      return;
    }
  }

  if (!titles || titles.length === 0) {
    console.error('タイトルを1件も抽出できませんでした。入力ファイルの内容を確認してください。');
    process.exitCode = 1;
    return;
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(titles, null, 2), 'utf-8');

  console.log(`抽出したタイトル数: ${titles.length}`);
  console.log(`出力先: ${OUTPUT_PATH}`);
  console.log('内容を確認し、誤抽出があれば手動で編集してから fetch_kobo_data.js に渡してください。');
}

main();
