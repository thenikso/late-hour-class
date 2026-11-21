// Unit tests for part marks and HTML escaping in public/js/shared/marks.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarks, stripMarks, marksToHtml } from '../public/js/shared/marks.js';

test('parseMarks and stripMarks extract and remove ==①...== spans', () => {
  const text = 'Given ==①one seat left==, when ==②two students book==, then ==③only one succeeds==.';
  assert.deepEqual(parseMarks(text), {
    1: 'one seat left',
    2: 'two students book',
    3: 'only one succeeds',
  });
  assert.equal(stripMarks(text), 'Given one seat left, when two students book, then only one succeeds.');
});

test('marksToHtml escapes HTML both outside and inside marked spans (never renders student HTML)', () => {
  const hostile = '<script>alert(1)</script> ==①<img src=x onerror=alert(2)>== "quoted" & \'single\'';
  const html = marksToHtml(hostile);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<span class="mark m1"><b>①</b>&lt;img src=x onerror=alert(2)&gt;</span>'));
  assert.ok(html.includes('&quot;quoted&quot; &amp; &#39;single&#39;'));
});
