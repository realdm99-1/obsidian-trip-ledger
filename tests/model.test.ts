import assert from 'node:assert/strict';
import test from 'node:test';
import { touchesLedgerRoot } from '../src/model/ledger-change';
import { parseAmountMinor, formatAmountMinor, amountInputValue } from '../src/model/money';
import { isDateKey, shiftDateKey } from '../src/model/dates';
import { summarize, categoryPercent } from '../src/model/aggregate';
import { validateCategoryName } from '../src/model/categories';
import { ko } from '../src/i18n/ko';
import { en } from '../src/i18n/en';
import { t } from '../src/i18n';
import { validateExpenseDraft } from '../src/model/expense-input';
import { tripListLabel } from '../src/model/trip-label';

test('moving a trip out of or into the ledger root refreshes the ledger view', () => {
	assert.equal(touchesLedgerRoot('Archive/japan', 'Trip Ledger/japan', 'Trip Ledger'), true);
	assert.equal(touchesLedgerRoot('Trip Ledger/japan', 'Archive/japan', 'Trip Ledger'), true);
	assert.equal(touchesLedgerRoot('Archive/japan', 'Other/japan', 'Trip Ledger'), false);
	assert.equal(touchesLedgerRoot('Trip Ledger 2/japan', undefined, 'Trip Ledger'), false);
});

test('amounts use currency minor units without floating point totals', () => {
	assert.equal(parseAmountMinor('1200', 'JPY'), 1200);
	assert.equal(parseAmountMinor('12.50', 'USD'), 1250);
	assert.equal(formatAmountMinor(1250, 'USD', 'en'), '$12.50');
	assert.equal(amountInputValue(1250, 'USD'), '12.50');
	assert.equal(formatAmountMinor(Number.MAX_SAFE_INTEGER, 'USD', 'en'), '$90,071,992,547,409.91');
	assert.throws(() => parseAmountMinor('12.5', 'JPY'));
	assert.throws(() => parseAmountMinor('0', 'KRW'));
	assert.throws(() => parseAmountMinor('1.234', 'USD'));
});

test('date keys reject impossible dates and move across month end', () => {
	assert.equal(isDateKey('2026-02-29'), false);
	assert.equal(isDateKey('2024-02-29'), true);
	assert.equal(shiftDateKey('2026-10-31', 1), '2026-11-01');
});

test('category and place totals each reconcile with trip total', () => {
	const rows = [
		{ id: '1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' },
		{ id: '2', date: '2026-10-14', item: '저녁', amountMinor: 3000, place: '식당', categoryId: 'food' },
		{ id: '3', date: '2026-10-15', item: '버스', amountMinor: 500, place: '역', categoryId: 'transport' },
	];
	const result = summarize(rows);
	assert.equal(result.totalMinor, 4700);
	assert.equal(result.byCategory.get('food'), 4200);
	assert.equal(result.byPlace.get('식당'), 4200);
	assert.equal([...result.byCategory.values()].reduce((a, b) => a + b, 0), 4700);
	assert.equal([...result.byPlace.values()].reduce((a, b) => a + b, 0), 4700);
});

test('category names avoid duplicates in either built-in language', () => {
	assert.equal(validateCategoryName('  기념품  ', []), '기념품');
	assert.throws(() => validateCategoryName('Food', []));
	assert.throws(() => validateCategoryName('식비', []));
	assert.throws(() => validateCategoryName('  기념품', [{ id: 'x', name: '기념품', archived: true }]));
});

test('zero total displays zero percent', () => {
	assert.equal(categoryPercent(0, 0), 0);
	assert.equal(categoryPercent(250, 1000), 25);
});

test('English covers the Korean UI keys and Korean is the default', () => {
	assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
	assert.equal(t('openLedger', 'ko'), ko.openLedger);
	assert.equal(t('openLedger', 'en'), en.openLedger);
});

test('existing ledger selection has clear Korean and English controls', () => {
	assert.equal(t('existingLedger', 'ko'), '기존 장부 선택');
	assert.equal(t('selectLedger', 'ko'), '선택');
	assert.equal(t('noExistingLedgers', 'ko'), '선택할 기존 장부가 없습니다.');
	for (const key of ['existingLedger', 'selectLedger', 'noExistingLedgers',
		'ledgerSelected', 'ledgerSelectFailed'] as const) {
		assert.ok(t(key, 'en'));
	}
});

test('expense draft rejects blank fields and a newly selected hidden category', () => {
	const categories = [{ id: 'custom', name: '기념품', archived: true }];
	const valid = { date: '2026-10-14', item: '  점심  ', amount: '1200', place: ' 식당 ', categoryId: 'food' };
	assert.deepEqual(validateExpenseDraft(valid, 'JPY', categories), {
		date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food',
	});
	assert.throws(() => validateExpenseDraft({ ...valid, item: ' ' }, 'JPY', categories));
	assert.throws(() => validateExpenseDraft({ ...valid, categoryId: 'custom' }, 'JPY', categories));
	assert.equal(validateExpenseDraft({ ...valid, categoryId: 'custom' }, 'JPY', categories, 'custom').categoryId, 'custom');
	assert.equal(validateExpenseDraft({ ...valid, categoryId: 'missing' }, 'JPY', categories, 'missing').categoryId, 'missing');
});

test('trips with the same name and currency have distinct list labels', () => {
	const first = { id: 'a1b2c3d4one', name: '일본', currency: 'JPY', currencyLocked: false, folderPath: 'Trip Ledger/first' };
	const second = { ...first, id: 'e5f6a7b8two', folderPath: 'Trip Ledger/second' };
	assert.equal(tripListLabel(first, [first]), '일본 · JPY');
	assert.equal(tripListLabel(first, [first, second]), '일본 · JPY · a1b2c3d4');
	assert.equal(tripListLabel(second, [first, second]), '일본 · JPY · e5f6a7b8');
});
