// Run with: node --test src/components/pdf-pages/page-range.test.ts
// (Node 23.6+ runs TypeScript directly; page-range.ts has no imports.)
import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  chunkPages,
  formatPageRanges,
  pagesLabel,
  parsePageRanges,
  parsePageSelection,
  rangesToIndices,
} = (await import(new URL('./page-range.ts', import.meta.url).href)) as typeof import('./page-range');

const pages = (text: string, total: number) => rangesToIndices(parsePageRanges(text, total).ranges);

test('single pages and ranges, 1-based in, 0-based out', () => {
  assert.deepEqual(pages('1', 10), [0]);
  assert.deepEqual(pages('1-3, 8', 10), [0, 1, 2, 7]);
  assert.deepEqual(pages('2 - 4; 6', 10), [1, 2, 3, 5]);
  assert.deepEqual(pages('1 3 5', 10), [0, 2, 4]);
});

test('open ends, last, all, odd, even', () => {
  assert.deepEqual(pages('8-', 10), [7, 8, 9]);
  assert.deepEqual(pages('-3', 10), [0, 1, 2]);
  assert.deepEqual(pages('last', 10), [9]);
  assert.deepEqual(pages('9-last', 10), [8, 9]);
  assert.deepEqual(pages('all', 3), [0, 1, 2]);
  assert.deepEqual(pages('odd', 5), [0, 2, 4]);
  assert.deepEqual(pages('EVEN', 5), [1, 3]);
});

test('backwards ranges and typographic dashes', () => {
  assert.deepEqual(pages('5-3', 10), [4, 3, 2]);
  assert.deepEqual(pages('2–4', 10), [1, 2, 3]);
  assert.deepEqual(parsePageRanges('5-3', 10).ranges, [{ start: 4, end: 2 }]);
});

test('each comma-separated piece is its own range (for splitting)', () => {
  assert.deepEqual(parsePageRanges('1-3, 4-6, 7-', 9).ranges, [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 8 },
  ]);
});

test('errors are readable and return no ranges', () => {
  assert.match(parsePageRanges('12', 10).error ?? '', /Page 12 does not exist; the PDF has 10 pages/);
  assert.match(parsePageRanges('0', 10).error ?? '', /start at 1/);
  assert.match(parsePageRanges('a-3', 10).error ?? '', /not a page number/);
  assert.match(parsePageRanges('1-2-3', 10).error ?? '', /not a valid range/);
  assert.match(parsePageRanges('-', 10).error ?? '', /not a valid range/);
  assert.deepEqual(parsePageRanges('1, 99', 10).ranges, []);
  assert.equal(parsePageRanges('   ', 10).error, null);
  assert.deepEqual(parsePageRanges('', 10).ranges, []);
});

test('selection de-duplicates', () => {
  assert.deepEqual([...parsePageSelection('1-3, 2, 3', 5).pages].sort(), [0, 1, 2]);
});

test('formatting compresses runs and round-trips', () => {
  assert.equal(formatPageRanges([0, 1, 2, 7, 11, 12, 13]), '1-3, 8, 12-14');
  assert.equal(formatPageRanges([5, 3, 4, 4]), '4-6');
  assert.equal(formatPageRanges([]), '');
  const text = formatPageRanges([0, 2, 3, 4, 9]);
  assert.deepEqual([...parsePageSelection(text, 10).pages].sort((a, b) => a - b), [0, 2, 3, 4, 9]);
});

test('file-name labels', () => {
  assert.equal(pagesLabel([4]), 'page-5');
  assert.equal(pagesLabel([0, 1, 2]), 'pages-1-3');
  assert.equal(pagesLabel([0, 1, 2, 7]), 'pages-1-3_8');
  assert.equal(pagesLabel(Array.from({ length: 40 }, (_, i) => i * 2)), '40-pages');
  assert.equal(pagesLabel([]), 'no-pages');
});

test('chunking', () => {
  assert.deepEqual(chunkPages(7, 3), [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 6 },
  ]);
  assert.deepEqual(chunkPages(2, 5), [{ start: 0, end: 1 }]);
  assert.deepEqual(chunkPages(0, 2), []);
});
