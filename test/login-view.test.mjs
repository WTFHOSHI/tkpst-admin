import test from 'node:test';
import assert from 'node:assert/strict';
import { loginMarkup } from '../public/login-view.js';
test('common password form is shared by all roles, explains automatic role persistence, escapes errors', () => {
  const html = loginMarkup('<script>error</script>');
  assert.match(html, /Один вход для расписания, посещаемости и пользователей/);
  assert.ok(!html.includes('name="remember"'));
  assert.match(html, /Администратор и староста/);
  assert.match(html, /до выхода/);
  assert.match(html, /Куратор/);
  assert.match(html, /до закрытия вкладки/);
  assert.match(html, /autocomplete="current-password"/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-show-password/);
});
