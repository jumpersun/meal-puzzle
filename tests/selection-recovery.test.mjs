import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeDetail, prepareItem } from '../server/api.mjs';
import { selectionsFor, reconcileSelections, selectionError } from '../public/live-state.js';

const sample = JSON.parse(await readFile(new URL('./fixtures/mcd-sample.json', import.meta.url)));
const original = normalizeDetail(sample.detail);
const selected = () => selectionsFor(original);
const validate = (raw, selections) => prepareItem({ id: 'l1', code: raw.code, quantity: 1, selections }, raw);

test('unchanged details preserve a custom drink choice without a recovery notice', () => {
  const previous = selected();
  previous.find(r => r.roundId === '6').choices = [{ code: '3050', quantity: 1 }, { code: '507411', quantity: 1 }];
  const recovered = reconcileSelections(original, previous);
  assert.deepEqual(recovered, { selections: previous, changed: false });
  assert.equal(selectionError(original, recovered.selections), '');
  assert.equal(validate(sample.detail, recovered.selections).units.length, 8);
});

test('a new round gets current defaults and a removed round is not submitted', () => {
  const raw = structuredClone(sample.detail);
  raw.rounds[0].id = 'new-main';
  const detail = normalizeDetail(raw), previous = selected();
  const recovered = reconcileSelections(detail, previous);
  assert.equal(recovered.changed, true);
  assert.ok(!recovered.selections.some(r => r.roundId === original.rounds[0].id));
  assert.deepEqual(recovered.selections.find(r => r.roundId === 'new-main'), selectionsFor(detail)[0]);
  assert.deepEqual(recovered.selections.slice(1), previous.slice(1));
  assert.equal(selectionError(detail, recovered.selections), '');
  assert.equal(validate(raw, recovered.selections).units.length, 8);
  assert.deepEqual(previous, selected());
});

test('a removed selected option is cleared and can be replaced in the same round', () => {
  const raw = structuredClone(sample.detail);
  const drinks = raw.rounds.find(r => String(r.id) === '6');
  drinks.choices = drinks.choices.filter(c => c.code !== '3050');
  const detail = normalizeDetail(raw), recovered = reconcileSelections(detail, selected());
  const group = recovered.selections.find(r => r.roundId === '6');
  assert.equal(recovered.changed, true);
  assert.deepEqual(group.choices, []);
  assert.notEqual(selectionError(detail, recovered.selections), '');
  group.choices.push({ code: '507411', quantity: 2 });
  assert.equal(selectionError(detail, recovered.selections), '');
  assert.equal(validate(raw, recovered.selections).units.filter(u => u.code === '507411').length, 2);
});

test('reduced group and option maxima keep only legal quantities', () => {
  const raw = structuredClone(sample.detail);
  const drinks = raw.rounds.find(r => String(r.id) === '6');
  drinks.minQuantity = 1; drinks.maxQuantity = 1;
  drinks.choices.find(c => c.code === '3050').maxQuantity = 1;
  const detail = normalizeDetail(raw), recovered = reconcileSelections(detail, selected());
  assert.equal(recovered.changed, true);
  assert.deepEqual(recovered.selections.find(r => r.roundId === '6').choices, [{ code: '3050', quantity: 1 }]);
  assert.equal(selectionError(detail, recovered.selections), '');
  assert.equal(validate(raw, recovered.selections).units.length, 7);
});

test('client validation rejects stale options and per-option excess even if group total is valid', () => {
  const stale = selected();
  stale[0].choices[0].code = '999999';
  assert.notEqual(selectionError(original, stale), '');
  const detail = structuredClone(original);
  detail.rounds.find(r => r.id === '6').choices.find(c => c.code === '3050').max = 1;
  assert.notEqual(selectionError(detail, selected()), '');
});
