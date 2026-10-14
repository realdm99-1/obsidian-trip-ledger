import assert from 'node:assert/strict';
import test from 'node:test';
import { SettingsWriteQueue } from '../src/model/settings-write-queue';
import { TripSelection } from '../src/model/trip-selection';
import { MemoryLedgerFiles } from './support/memory-ledger-files';

test('overlapping trip and language saves persist one combined setting', async () => {
	const settings = { language: 'ko', lastSelectedTripId: 'first' as string | null };
	let disk = { ...settings };
	let releaseFirst!: () => void;
	let writes = 0;
	const writer = new SettingsWriteQueue(settings, async (snapshot) => {
		if (++writes === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
		disk = { ...snapshot };
	});
	const selection = new TripSelection(settings, (id) => writer.update({ lastSelectedTripId: id }), new MemoryLedgerFiles());
	const tripSave = selection.choose('second');
	await Promise.resolve();
	await Promise.resolve();
	const languageSave = writer.update({ language: 'en' });
	releaseFirst();
	await Promise.all([tripSave, languageSave]);
	assert.deepEqual(settings, { language: 'en', lastSelectedTripId: 'second' });
	assert.deepEqual(disk, settings);
});

test('a failed trip save leaves both memory and disk at the previous selection', async () => {
	const settings = { language: 'ko', lastSelectedTripId: 'first' as string | null };
	let disk = { ...settings };
	let writes = 0;
	const writer = new SettingsWriteQueue(settings, async (snapshot) => {
		if (++writes === 1) throw new Error('write failed');
		disk = { ...snapshot };
	});
	const selection = new TripSelection(settings, (id) => writer.update({ lastSelectedTripId: id }), new MemoryLedgerFiles());
	await assert.rejects(selection.choose('second'), /write failed/);
	assert.equal(settings.lastSelectedTripId, 'first');
	assert.equal(disk.lastSelectedTripId, 'first');
	await writer.update({ language: 'en' });
	assert.deepEqual(disk, { language: 'en', lastSelectedTripId: 'first' });
});
