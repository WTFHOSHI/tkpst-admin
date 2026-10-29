import test from 'node:test';
import assert from 'node:assert/strict';
import { loginMarkup } from '../public/login-view.js';
test('minimal common password form preserves accessible controls and escaped errors', () => {
  const html = loginMarkup('<script>error</script>');
  assert.ok(!html.includes('name="remember"'));
  assert.match(html, /autocomplete="current-password"/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-show-password/);
});
