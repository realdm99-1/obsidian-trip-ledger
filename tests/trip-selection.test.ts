import assert from 'node:assert/strict';
import test from 'node:test';
import { TripSelection } from '../src/model/trip-selection';
import type { Trip } from '../src/model/types';
import type { TripCandidate } from '../src/storage/trip-store';
import { TripStore } from '../src/storage/trip-store';
import { MemoryLedgerFiles } from './support/memory-ledger-files';
import { tripFilePath } from '../src/storage/paths';

function trip(id: string, root = 'Trip Ledger'): Trip {
	return { id, name: id, currency: 'JPY', currencyLocked: false, folderPath: `${root}/${id}` };
}

function valid(value: Trip): TripCandidate {
	return { folderPath: value.folderPath, idHint: value.id, trip: value, error: null };
}

function makeSelection(
	settings: { lastSelectedTripId: string | null },
	save: (id: string) => Promise<void>,
	files = new MemoryLedgerFiles(),
): TripSelection {
	return new TripSelection(settings, save, files);
}

test('a saved trip opens after restart and follows a ledger root rename', async () => {
	const settings = { lastSelectedTripId: null as string | null };
	let persisted = { ...settings };
	const selection = makeSelection(settings, async (id) => { persisted = { lastSelectedTripId: id }; });
	await selection.choose('second');
	assert.deepEqual(selection.resolve([valid(trip('first')), valid(trip('second'))]),
		{ kind: 'ready', trip: trip('second') });
	const reopened = makeSelection(persisted, async () => {});
	assert.deepEqual(reopened.resolve([valid(trip('second', '내 여행'))]),
		{ kind: 'ready', trip: trip('second', '내 여행') });
});

test('a settings change immediately changes the trip resolved by another view', async () => {
	const settings = { lastSelectedTripId: 'first' as string | null };
	const viewSelection = makeSelection(settings, async () => {});
	await makeSelection(settings, async () => {}).choose('second');
	assert.deepEqual(viewSelection.resolve([valid(trip('first')), valid(trip('second'))]),
		{ kind: 'ready', trip: trip('second') });
});

test('a pending settings write does not expose an uncommitted trip to the view', async () => {
	const settings = { lastSelectedTripId: 'first' as string | null };
	let release!: () => void;
	const selection = makeSelection(settings, async () => {
		await new Promise<void>((resolve) => { release = resolve; });
	});
	const pending = selection.choose('second');
	await Promise.resolve();
	assert.deepEqual(selection.resolve([valid(trip('first')), valid(trip('second'))]),
		{ kind: 'ready', trip: trip('first') });
	release();
	await pending;
	assert.deepEqual(selection.resolve([valid(trip('first')), valid(trip('second'))]),
		{ kind: 'ready', trip: trip('second') });
});

test('a missing saved trip asks for selection when other trips exist', () => {
	const selection = makeSelection({ lastSelectedTripId: 'removed' }, async () => {});
	assert.deepEqual(selection.resolve([valid(trip('remaining'))]), { kind: 'select' });
});

test('no valid trips asks the user to create one', () => {
	const selection = makeSelection({ lastSelectedTripId: null }, async () => {});
	assert.deepEqual(selection.resolve([]), { kind: 'create' });
	assert.deepEqual(selection.resolve([{ folderPath: 'Trip Ledger/unrelated', idHint: null,
		trip: null, error: 'Missing trip.md' }]), { kind: 'create' });
});

test('an invalid selected trip reports its folder', () => {
	const selection = makeSelection({ lastSelectedTripId: 'broken' }, async () => {});
	assert.deepEqual(selection.resolve([{ folderPath: 'Trip Ledger/broken', idHint: 'broken',
		trip: null, error: 'Invalid schema' }]),
	{ kind: 'invalid', folderPath: 'Trip Ledger/broken', error: 'Invalid schema' });
});

test('a duplicate selected ID never opens either folder', () => {
	const selection = makeSelection({ lastSelectedTripId: 'same' }, async () => {});
	const first = valid(trip('same'));
	const second = { ...valid(trip('same', '내 여행')), folderPath: 'Trip Ledger/other' };
	assert.equal(selection.resolve([first, second]).kind, 'invalid');
});

test('a failed settings write restores the previous visible trip', async () => {
	const settings = { lastSelectedTripId: 'first' as string | null };
	const selection = makeSelection(settings, async () => { throw new Error('save failed'); });
	await assert.rejects(selection.choose('second'), /save failed/);
	assert.deepEqual(selection.resolve([valid(trip('first')), valid(trip('second'))]),
		{ kind: 'ready', trip: trip('first') });
	assert.equal(settings.lastSelectedTripId, 'first');
});

test('an older failed selection cannot overwrite a newer choice', async () => {
	const settings = { lastSelectedTripId: 'first' as string | null };
	let rejectFirst!: (error: Error) => void;
	let saves = 0;
	const selection = makeSelection(settings, async () => {
		if (++saves === 1) await new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
	});
	const first = selection.choose('second');
	const second = selection.choose('third');
	await Promise.resolve();
	rejectFirst(new Error('save failed'));
	await assert.rejects(first, /save failed/);
	await second;
	assert.equal(settings.lastSelectedTripId, 'third');
	assert.deepEqual(selection.resolve([valid(trip('first')), valid(trip('second')), valid(trip('third'))]),
		{ kind: 'ready', trip: trip('third') });
});

test('two failed overlapping choices restore the last saved trip', async () => {
	const settings = { lastSelectedTripId: 'first' as string | null };
	let rejectFirst!: (error: Error) => void;
	let saves = 0;
	const selection = makeSelection(settings, async () => {
		if (++saves === 1) await new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
		else throw new Error('second save failed');
	});
	const first = selection.choose('second');
	const second = selection.choose('third');
	await Promise.resolve();
	rejectFirst(new Error('first save failed'));
	await assert.rejects(first, /first save failed/);
	await assert.rejects(second, /second save failed/);
	assert.equal(settings.lastSelectedTripId, 'first');
});

test('a folder that became invalid cannot replace the saved selection', async () => {
	const files = new MemoryLedgerFiles();
	const store = new TripStore(files);
	const first = await store.createTrip('첫 여행', 'KRW');
	const second = await store.createTrip('둘째 여행', 'KRW');
	const settings = { lastSelectedTripId: first.id };
	let saved = 0;
	const selection = makeSelection(settings, async () => { saved++; }, files);
	files.seed(tripFilePath(second.folderPath), { 'trip-ledger': 'trip', schemaVersion: 2, id: second.id });
	assert.equal(await selection.chooseFolder(second.folderPath, await store.listTripCandidates()), false);
	assert.equal(settings.lastSelectedTripId, first.id);
	assert.equal(saved, 0);
});

test('choosing a valid folder saves its ID and a save failure restores the previous ID', async () => {
	const files = new MemoryLedgerFiles();
	const store = new TripStore(files);
	const first = await store.createTrip('첫 여행', 'KRW');
	const second = await store.createTrip('둘째 여행', 'KRW');
	const candidates = await store.listTripCandidates();
	const settings = { lastSelectedTripId: first.id };
	const selection = makeSelection(settings, async () => {}, files);
	assert.equal(await selection.chooseFolder(second.folderPath, candidates), true);
	assert.equal(settings.lastSelectedTripId, second.id);
	const failing = makeSelection(settings, async () => { throw new Error('save failed'); }, files);
	await assert.rejects(failing.chooseFolder(first.folderPath, candidates), /save failed/);
	assert.equal(settings.lastSelectedTripId, second.id);
});

test('a duplicate ID is rejected even if one supplied candidate still looks valid', async () => {
	const settings = { lastSelectedTripId: 'previous' };
	const selection = makeSelection(settings, async () => {});
	const candidates = [valid(trip('same')), { ...valid(trip('same')), folderPath: 'Trip Ledger/copy' }];
	assert.equal(await selection.chooseFolder('Trip Ledger/same', candidates), false);
	assert.equal(settings.lastSelectedTripId, 'previous');
});
