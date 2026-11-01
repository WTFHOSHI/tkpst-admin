import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteConfirmationMarkup } from '../public/delete-confirm.js';
import { studentOp, defaultConfig } from '../public/att-logic.js';
import { activeStudents, studentTotals, attendanceWorkbook } from '../public/att-core.js';

test('deletion confirmation escapes identity, requires typed confirmation and starts disabled', () => {
  const html = deleteConfirmationMarkup({ title: '<script>', description: 'Необратимо', label: 'Логин', expected: '<b>Имя</b>' });
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<b>Имя</b>'));
  assert.match(html, /type="submit" class="btn delete-action" disabled/);
  assert.match(html, /data-delete-cancel/);
});
test('student deletion preserves anonymous attendance and previous withdrawal boundary', () => {
  const config = defaultConfig();
  config.courses[2].students = [{ id: 'student', name: 'Исходное ФИО', from: '2026-01-01', to: '2026-09-01', privateNote: 'личные данные' }];
  const week = { m: { student: { '2026-08-31': { 1: 'P', 2: 'N' } } } };
  const result = studentOp(config, { course: '2', action: 'delete', id: 'student', confirmName: 'Исходное ФИО', to: '2026-10-26' });
  assert.equal(result.ok, true);
  const record = config.courses[2].students[0];
  assert.equal(record.name, 'Удалённый студент'); assert.equal(record.to, '2026-09-01'); assert.equal(record.privateNote, undefined);
  assert.deepEqual(activeStudents(config.courses[2].students, '2026-08-31', '2026-09-05'), []);
  assert.equal(activeStudents(config.courses[2].students, '2026-10-26', '2026-10-31').length, 0);
  assert.equal(studentTotals('student', { week }).total, 2);
  assert.equal(studentOp(config, { course: '2', action: 'rename', id: 'student', name: 'Новое имя' }).ok, false);
});
test('deleted students stay out of the day and week lists while same-day marks remain stored', () => {
  const config = defaultConfig(); config.courses[2].students = [{ id: 'today', name: 'Студент', from: '2026-10-26' }];
  studentOp(config, { course: '2', action: 'delete', id: 'today', confirmName: 'Студент', to: '2026-10-26' });
  assert.deepEqual(activeStudents(config.courses[2].students, '2026-10-26', '2026-10-26'), []);
  assert.deepEqual(activeStudents(config.courses[2].students, '2026-10-26', '2026-10-31'), []);
  assert.equal(config.courses[2].students[0].id, 'today');
  assert.equal(studentTotals('today', { week: { m: { today: { '2026-10-26': { 1: 'P' } } } } }).total, 1);
});

test('deleted rows are excluded from attendance exports, including an empty course, without removing records', () => {
  const students = [{ id: 'kept', name: 'Оставшийся' }, { id: 'deleted', name: 'Удалённый студент', deleted: true, to: '2026-10-27' }];
  const weeks = { '2026-10-26': { m: { deleted: { '2026-10-26': { 1: 'N' } } }, pairs: {}, hide: {} } };
  const before = JSON.stringify({ students, weeks });
  for (const [kind, key, records] of [['week', '2026-10-26', weeks], ['month', '2026-10', weeks], ['course', '', weeks], ['course', '', {}]]) {
    const book = attendanceWorkbook({ kind, key, students, weeks: records, courseTitle: 'Тест', exportedAt: '2026-10-27' });
    assert.ok(!JSON.stringify(book).includes('Удалённый студент'));
    assert.ok(JSON.stringify(book).includes('Оставшийся'));
  }
  assert.equal(JSON.stringify({ students, weeks }), before);
});
