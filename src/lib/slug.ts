// 著者名などをURLセグメントに変換する。日本語はそのままではURLに残せないことがあるため、
// 英数字以外の連続を "-" に、記号だけの名前は文字コード由来のフォールバックにする。
export function slugify(text: string): string {
  const base = text
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (base) return base;

  // 記号のみの名前など、英数字が1文字も残らない場合のフォールバック
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `author-${hash.toString(36)}`;
}
