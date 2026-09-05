#!/usr/bin/env node
/**
 * auto_tag.js
 * ------------------------------------------------------------
 * src/content/books/*.json の title/description をキーワード辞書と
 * 照合し、tags（スパダリ・執着・オフィスラブ等）を一次推定して書き込む。
 *
 * - tags が既に1件以上設定されている本はスキップする（手動編集を上書きしない）
 * - 完全な精度は保証できないため、あくまで一次判定。生成後は目視確認すること
 *   （memo欄に「要確認」が入る）
 * - キーワードに当てはまらなかった本は tags が空のまま残るので、手動で追加する
 *
 * 使い方:
 *   npm run auto-tag
 * ------------------------------------------------------------
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', 'src', 'content', 'books');

// キーワードから機械的に推測できるジャンル・属性タグの辞書。
// 必要に応じて自由に追加・調整してよい（要相談で作成したベースセット）。
const TAG_RULES = [
  ['溺愛', /溺愛/],
  ['執着', /執着/],
  ['スパダリ', /スパダリ/],
  ['オフィスラブ', /社内恋愛|オフィスラブ|上司|部下|同僚|社内/],
  ['年の差', /年の差|歳の差/],
  ['幼馴染', /幼馴染|幼なじみ/],
  ['同棲', /同棲/],
  ['異世界・転生', /異世界|転生/],
  ['オメガバース', /オメガバース|アルファ.{0,10}オメガ|オメガ.{0,10}アルファ/],
  ['獣人', /獣人|オオカミ|狼|狐|ケモノ|ケモ耳/],
  ['ヤクザ', /ヤクザ|極道|任侠/],
  ['学園', /学園|高校生|部活|生徒会|同級生/],
  ['王道ファンタジー', /王子|貴族|伯爵|公爵|騎士/],
  ['医療系', /医者|外科医|内科医|ドクター/],
  ['刑事・警察', /刑事|警察官|捜査/],
  ['芸能・アイドル', /アイドル|芸能人|俳優|声優/],
  ['契約・偽装関係', /契約結婚|契約カップル|偽装(結婚|恋人|カップル)/],
  ['婚約・政略結婚', /婚約|政略結婚|見合い/],
];

const MAX_TAGS = 3; // トップページに常時表示する運用のため上限を設ける

function inferTags(text) {
  const tags = [];
  for (const [tag, pattern] of TAG_RULES) {
    if (pattern.test(text)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function markTagsAsReviewNeeded(memo) {
  const base = memo ?? '';
  if (/tagsは未設定/.test(base)) {
    return base.replace(/tagsは未設定(のため要確認)?。?/, 'tagsはキーワードからの自動推定のため要確認。');
  }
  return base ? `${base} tagsはキーワードからの自動推定のため要確認。` : 'tagsはキーワードからの自動推定のため要確認。';
}

async function main() {
  const files = (await readdir(BOOKS_DIR)).filter(
    (f) => f.endsWith('.json') && !f.startsWith('sample')
  );

  let tagged = 0;
  let skippedExisting = 0;
  let noMatch = 0;

  for (const f of files) {
    const filePath = path.join(BOOKS_DIR, f);
    const data = JSON.parse(await readFile(filePath, 'utf-8'));

    if (Array.isArray(data.tags) && data.tags.length > 0) {
      skippedExisting += 1;
      continue;
    }

    const text = `${data.title ?? ''} ${data.description ?? ''}`;
    const tags = inferTags(text);

    if (tags.length === 0) {
      noMatch += 1;
      continue;
    }

    data.tags = tags;
    data.memo = markTagsAsReviewNeeded(data.memo);
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    tagged += 1;
  }

  console.log(`タグを自動付与: ${tagged} 件`);
  console.log(`既にtags設定済みでスキップ: ${skippedExisting} 件`);
  console.log(`キーワードに一致せずtags未設定のまま: ${noMatch} 件`);
  console.log('自動付与されたタグは推定のため、必ず目視で確認・修正してください。');
}

main();
