'use strict';
// ID моделей в API (slug): перенос со старого apiId, уникальность, стабильность при переименовании, поиск.
// Заменяет старые test/model-ids.test.js и test/admin-model-ids.test.js (они проверяли удалённый model-ids.js).
const test = require('node:test'), assert = require('node:assert/strict');
const { ensureSlugs, resolve, slugify } = require('../api/models');

test('slugify: латиница, кириллица, мусор', () => {
  assert.equal(slugify('Claude Sonnet 4.5'), 'claude-sonnet-4.5');
  assert.equal(slugify('Быстрая модель'), 'bystraya-model');
  assert.equal(slugify('  --GPT / 5 (mini)--  '), 'gpt-5-mini');
  assert.equal(slugify('***'), 'model');
  assert.ok(slugify('x'.repeat(200)).length <= 64);
});

test('ensureSlugs: старый apiId сохраняется, дубли получают -2, apiId/apiAliases удаляются', () => {
  const models = [
    { id: 'a', name: 'Kimi K3', apiId: 'kimi-k3', apiAliases: ['kimi-old'] },
    { id: 'b', name: 'Kimi K3' },
    { id: 'c', name: 'Другая', apiId: 'kimi-k3' }, // занятый apiId — берём из названия
    { id: 'd', name: 'Плохой', slug: 'НЕ ID' },     // невалидный slug — назначаем заново
  ];
  assert.equal(ensureSlugs(models), true);
  assert.deepEqual(models.map((m) => m.slug), ['kimi-k3', 'kimi-k3-2', 'drugaya', 'plohoy']);
  assert.ok(models.every((m) => !('apiId' in m) && !('apiAliases' in m)));
  assert.equal(ensureSlugs(models), false, 'повторный запуск ничего не меняет');
});

test('ensureSlugs: переименование и перестановка не меняют ID', () => {
  const models = [{ id: 'a', name: 'Первая' }, { id: 'b', name: 'Вторая' }];
  ensureSlugs(models);
  const before = Object.fromEntries(models.map((m) => [m.id, m.slug]));
  models[0].name = 'Совсем новое имя'; models.reverse();
  assert.equal(ensureSlugs(models), false);
  assert.deepEqual(Object.fromEntries(models.map((m) => [m.id, m.slug])), before);
});

test('resolve: по slug (без учёта регистра), внутреннему id и modelId', () => {
  const models = [{ id: '111111111111', name: 'A', slug: 'model-a', modelId: 'provider/a' }, { id: '222222222222', name: 'B', slug: 'model-b', modelId: 'provider/b' }];
  assert.equal(resolve(models, 'model-b').id, '222222222222');
  assert.equal(resolve(models, ' MODEL-A ').id, '111111111111');
  assert.equal(resolve(models, '222222222222').slug, 'model-b');
  assert.equal(resolve(models, 'provider/a').slug, 'model-a');
  assert.equal(resolve(models, 'nope'), null);
  assert.equal(resolve(models, ''), null);
  assert.equal(resolve(models, null), null);
});
