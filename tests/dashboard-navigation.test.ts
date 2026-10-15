import assert from 'node:assert/strict';
import test from 'node:test';
import { screenAfterSave } from '../src/model/dashboard-navigation';

test('saving on the dashboard stays there only for today', () => {
	assert.deepEqual(screenAfterSave({ kind: 'dashboard' }, '2026-10-15', '2026-10-15'), { kind: 'dashboard' });
	assert.deepEqual(screenAfterSave({ kind: 'dashboard' }, '2026-10-14', '2026-10-15'),
		{ kind: 'day', date: '2026-10-14' });
});

test('saving in date detail opens the saved date', () => {
	assert.deepEqual(screenAfterSave({ kind: 'day', date: '2026-10-13' }, '2026-10-14', '2026-10-15'),
		{ kind: 'day', date: '2026-10-14' });
});
