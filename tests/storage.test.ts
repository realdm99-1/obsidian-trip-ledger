import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCategories, parseDay, parseTrip } from '../src/storage/schema';
import { dayPath, tripFolderPath } from '../src/storage/paths';
import { TripStore } from '../src/storage/trip-store';
import { CategoryStore } from '../src/storage/category-store';
import { ExpenseStore } from '../src/storage/expense-store';
import { tripFilePath } from '../src/storage/paths';
import { MemoryLedgerFiles } from './support/memory-ledger-files';
import { readValidTrips } from './support/trips';
import { RootManager } from '../src/storage/root-manager';
import { RootOperationGate } from '../src/storage/root-operation-gate';

class FailingMutationFiles extends MemoryLedgerFiles {
	failMutation = false;

	async mutateFrontmatter(path: string, mutation: (data: Record<string, unknown>) => void): Promise<void> {
		if (this.failMutation) throw new Error('Simulated write failure');
		await super.mutateFrontmatter(path, mutation);
	}
}

class FailingLockFiles extends MemoryLedgerFiles {
	failNextLock = false;

	async mutateFrontmatter(path: string, mutation: (data: Record<string, unknown>) => void): Promise<void> {
		if (this.failNextLock && path.endsWith('/trip.md')) {
			this.failNextLock = false;
			throw new Error('Simulated trip write failure');
		}
		await super.mutateFrontmatter(path, mutation);
	}
}

test('managed day parser rejects foreign and malformed files', () => {
	assert.throws(() => parseDay({
		'trip-ledger': 'other', schemaVersion: 1, tripId: 'trip-1',
		date: '2026-10-14', expenses: [],
	}, 'trip-1', '2026-10-14'));
	assert.throws(() => parseDay({
		'trip-ledger': 'day', schemaVersion: 2, tripId: 'trip-1',
		date: '2026-10-14', expenses: [],
	}, 'trip-1', '2026-10-14'));
	assert.throws(() => parseDay({
		'trip-ledger': 'day', schemaVersion: 1, tripId: 'trip-2',
		date: '2026-10-14', expenses: [],
	}, 'trip-1', '2026-10-14'));
	assert.throws(() => parseDay({
		'trip-ledger': 'day', schemaVersion: 1, tripId: 'trip-1',
		date: '2026-10-14', expenses: [{ id: 'e', item: 'meal', amountMinor: -1, place: 'cafe', categoryId: 'food' }],
	}, 'trip-1', '2026-10-14'));
});

test('managed parsers return typed trip, day, and user categories', () => {
	const folder = tripFolderPath('일본', 'a1b2c3');
	const trip = parseTrip({
		'trip-ledger': 'trip', schemaVersion: 1, id: 'a1b2c3',
		name: '일본', currency: 'JPY', currencyLocked: false,
	}, folder);
	assert.equal(trip.folderPath, folder);
	assert.equal(dayPath(folder, '2026-10-14'), `${folder}/dates/2026-10-14.md`);
	const day = parseDay({
		'trip-ledger': 'day', schemaVersion: 1, tripId: 'a1b2c3',
		date: '2026-10-14', expenses: [{ id: 'e1', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' }],
	}, 'a1b2c3', '2026-10-14');
	assert.equal(day.expenses[0]?.date, '2026-10-14');
	assert.deepEqual(parseCategories({
		'trip-ledger': 'categories', schemaVersion: 1,
		categories: [{ id: 'custom-1', name: '기념품', archived: false }],
	}), [{ id: 'custom-1', name: '기념품', archived: false }]);
});

test('ledger folder names are trimmed and cannot escape the vault root', () => {
	assert.equal(tripFolderPath('일본', 'a1b2c3', '  여행 장부  '), '여행 장부/일본--a1b2c3');
	for (const name of ['', ' ', '../밖', '안/밖', '안\\밖', '끝.', 'a'.repeat(81), 'CON']) {
		assert.throws(() => tripFolderPath('일본', 'a1b2c3', name), `Accepted ${name}`);
	}
});

test('a YAML timestamp date still identifies its day without a timezone shift', () => {
	const day = parseDay({
		'trip-ledger': 'day', schemaVersion: 1, tripId: 'trip-1',
		date: new Date('2026-10-14T00:00:00.000Z'), expenses: [],
	}, 'trip-1', '2026-10-14');
	assert.equal(day.date, '2026-10-14');
	assert.throws(() => parseDay({
		'trip-ledger': 'day', schemaVersion: 1, tripId: 'trip-1',
		date: new Date('2026-10-14T12:00:00.000Z'), expenses: [],
	}, 'trip-1', '2026-10-14'));
});

test('same trip name creates separate ledgers', async () => {
	const store = new TripStore(new MemoryLedgerFiles());
	const first = await store.createTrip('일본', 'JPY');
	const second = await store.createTrip('일본', 'JPY');
	assert.equal(first.folderPath, 'Trip Ledger/일본');
	assert.equal(second.folderPath, `Trip Ledger/일본--${second.id.slice(0, 8)}`);
	assert.notEqual(first.id, second.id);
	assert.notEqual(first.folderPath, second.folderPath);
	assert.equal((await readValidTrips(store)).length, 2);
});

test('a legacy suffixed trip does not reserve the plain folder name', async () => {
	const files = new MemoryLedgerFiles();
	await files.ensureFolder('Trip Ledger/일본--legacy12');
	files.seed('Trip Ledger/일본--legacy12/trip.md', {
		'trip-ledger': 'trip', schemaVersion: 1, id: 'legacy123456789',
		name: '일본', currency: 'JPY', currencyLocked: false,
	});
	const created = await new TripStore(files).createTrip('일본', 'JPY');
	assert.equal(created.folderPath, 'Trip Ledger/일본');
	assert.equal((await readValidTrips(new TripStore(files))).length, 2);
});

test('an occupied plain folder stays untouched when creating a trip', async () => {
	const files = new MemoryLedgerFiles();
	await files.ensureFolder('Trip Ledger/일본');
	files.seed('Trip Ledger/일본/notes.md', {}, 'personal note');
	const created = await new TripStore(files).createTrip('일본', 'JPY');
	assert.equal(created.folderPath, `Trip Ledger/일본--${created.id.slice(0, 8)}`);
	assert.equal(await files.readFrontmatter('Trip Ledger/일본/trip.md'), null);
	assert.equal(files.bodyAt('Trip Ledger/일본/notes.md'), 'personal note');
});

test('different names that sanitize to the same folder remain separate trips', async () => {
	const store = new TripStore(new MemoryLedgerFiles());
	const first = await store.createTrip('A/B', 'USD');
	const second = await store.createTrip('A-B', 'USD');
	assert.equal(first.folderPath, 'Trip Ledger/A-B');
	assert.equal(second.folderPath, `Trip Ledger/A-B--${second.id.slice(0, 8)}`);
});

test('an unrelated or broken child folder cannot hide valid trips', async () => {
	const files = new MemoryLedgerFiles();
	const store = new TripStore(files);
	const first = await store.createTrip('일본', 'JPY');
	const second = await store.createTrip('다시 일본', 'JPY');
	await files.ensureFolder('Trip Ledger/unrelated');
	await files.ensureFolder('Trip Ledger/broken');
	files.seed('Trip Ledger/broken/trip.md', { 'trip-ledger': 'trip', schemaVersion: 2 });
	const candidates = await store.listTripCandidates();
	assert.equal(candidates.length, 4);
	assert.equal(candidates.find((entry) => entry.folderPath === 'Trip Ledger/unrelated')?.trip, null);
	assert.match(candidates.find((entry) => entry.folderPath === 'Trip Ledger/broken')?.error ?? '', /broken\/trip\.md/);
	assert.deepEqual((await readValidTrips(store)).map((trip) => trip.id).sort(), [first.id, second.id].sort());
});

test('duplicate trip IDs cannot be resolved to either folder', async () => {
	const files = new MemoryLedgerFiles();
	const store = new TripStore(files);
	const first = await store.createTrip('첫 여행', 'KRW');
	const second = await store.createTrip('둘째 여행', 'KRW');
	files.seed(tripFilePath(second.folderPath), (await files.readFrontmatter(tripFilePath(first.folderPath)))!);
	const candidates = await store.listTripCandidates();
	assert.equal(candidates.filter((entry) => entry.idHint === first.id).length, 2);
	assert.equal(candidates.filter((entry) => entry.trip !== null).length, 0);
	assert.equal((await readValidTrips(store)).length, 0);
});

test('a custom ledger folder contains trips, categories, and dated expenses', async () => {
	const files = new MemoryLedgerFiles('여행 장부');
	const tripStore = new TripStore(files);
	const trip = await tripStore.createTrip('일본', 'JPY');
	assert.match(trip.folderPath, /^여행 장부\//);
	assert.equal((await readValidTrips(tripStore))[0]?.id, trip.id);
	const category = await new CategoryStore(files).add('기념품');
	assert.equal((await new CategoryStore(files).list())[0]?.id, category.id);
	await new ExpenseStore(files).upsert(trip, {
		id: 'e1', date: '2026-10-14', item: '키링', amountMinor: 500, place: '역', categoryId: category.id,
	});
	assert.equal((await new ExpenseStore(files).loadDay(trip, '2026-10-14'))[0]?.item, '키링');
	assert.ok(await files.readFrontmatter('여행 장부/categories.md'));
	assert.ok(await files.readFrontmatter(`${trip.folderPath}/dates/2026-10-14.md`));
});

test('day summaries include only nonempty dates in the selected trip, newest first', async () => {
	const files = new MemoryLedgerFiles();
	const trips = new TripStore(files);
	const first = await trips.createTrip('일본', 'JPY');
	const second = await trips.createTrip('미국', 'USD');
	const store = new ExpenseStore(files);
	const expense = (id: string, date: string, amountMinor: number) => ({
		id, date, item: id, amountMinor, place: '식당', categoryId: 'food',
	});
	await store.upsert(first, expense('old-1', '2026-10-14', 1000));
	await store.upsert(first, expense('old-2', '2026-10-14', 500));
	await store.upsert(first, expense('new', '2026-10-15', 300));
	const removed = expense('empty', '2026-10-13', 400);
	await store.upsert(first, removed);
	await store.remove(first, removed.id, removed.date, removed);
	await store.upsert(second, expense('foreign', '2026-10-16', 900));

	assert.deepEqual(await store.listDaySummaries(first), [
		{ date: '2026-10-15', count: 1, totalMinor: 300 },
		{ date: '2026-10-14', count: 2, totalMinor: 1500 },
	]);
});

test('renaming the ledger folder preserves trips, categories, expenses, and note bodies', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const category = await new CategoryStore(files).add('기념품');
	await new ExpenseStore(files).upsert(trip, {
		id: 'e1', date: '2026-10-14', item: '키링', amountMinor: 500, place: '역', categoryId: category.id,
	});
	const oldDayPath = dayPath(trip.folderPath, '2026-10-14');
	files.seed(oldDayPath, (await files.readFrontmatter(oldDayPath))!, '여행 메모');
	await files.renameRoot('내 여행');

	const movedTrip = (await readValidTrips(new TripStore(files)))[0]!;
	assert.equal(movedTrip.folderPath, trip.folderPath.replace('Trip Ledger/', '내 여행/'));
	assert.equal((await new CategoryStore(files).list())[0]?.id, category.id);
	assert.equal((await new ExpenseStore(files).loadDay(movedTrip, '2026-10-14'))[0]?.item, '키링');
	assert.equal(files.bodyAt(dayPath(movedTrip.folderPath, '2026-10-14', files.root)), '여행 메모');
	await assert.rejects(files.readFrontmatter(oldDayPath), /Path outside ledger/);
});

test('an existing target folder prevents ledger migration without changing records', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	files.seed('내 여행', { owner: 'another note' });
	await assert.rejects(files.renameRoot('내 여행'), /already exists/);
	assert.equal(files.root, 'Trip Ledger');
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});

test('folder migration waits for active file work and holds later work', async () => {
	const gate = new RootOperationGate();
	const events: string[] = [];
	let signalStarted!: () => void;
	const started = new Promise<void>((resolve) => { signalStarted = resolve; });
	let releaseWork!: () => void;
	const held = new Promise<void>((resolve) => { releaseWork = resolve; });
	const active = gate.run(async () => { signalStarted(); await held; events.push('active'); });
	await started;
	const migration = gate.migrate(async () => { events.push('migration'); });
	const later = gate.run(async () => { events.push('later'); });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(events, []);
	releaseWork();
	await Promise.all([active, migration, later]);
	assert.deepEqual(events, ['active', 'migration', 'later']);
});

test('an expense using the old folder cannot recreate it after migration', async () => {
	let signalDayCreation!: () => void;
	const dayCreationStarted = new Promise<void>((resolve) => { signalDayCreation = resolve; });
	let releaseDayCreation!: () => void;
	const dayCreationReleased = new Promise<void>((resolve) => { releaseDayCreation = resolve; });
	class PausingDayFiles extends MemoryLedgerFiles {
		async createManagedFile(path: string, kind: 'trip' | 'day' | 'categories', initial: Record<string, unknown>): Promise<void> {
			if (kind === 'day') {
				signalDayCreation();
				await dayCreationReleased;
			}
			await super.createManagedFile(path, kind, initial);
		}
	}
	const files = new PausingDayFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const saving = new ExpenseStore(files).upsert(trip, {
		id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food',
	});
	await dayCreationStarted;
	await files.renameRoot('내 여행');
	releaseDayCreation();
	await assert.rejects(saving, /Path outside ledger/);
	assert.equal(await files.rootExists('Trip Ledger'), false);
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});

test('a failed category addition leaves a readable category file', async () => {
	const files = new FailingMutationFiles();
	files.failMutation = true;
	const store = new CategoryStore(files);
	await assert.rejects(store.add('기념품'));
	assert.deepEqual(await store.list(), []);
});

test('a failed first expense leaves a readable empty day file', async () => {
	const files = new FailingMutationFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	files.failMutation = true;
	const store = new ExpenseStore(files);
	await assert.rejects(store.upsert(trip, {
		id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food',
	}));
	assert.deepEqual(await store.loadDay(trip, '2026-10-14'), []);
});

test('trip currency must be a supported currency code', async () => {
	await assert.rejects(new TripStore(new MemoryLedgerFiles()).createTrip('가상 여행', 'QQQ'));
});

test('trip creation accepts a supported currency when Intl.supportedValuesOf is unavailable', async () => {
	const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
	const original = intl.supportedValuesOf;
	try {
		intl.supportedValuesOf = undefined;
		const files = new MemoryLedgerFiles();
		const trip = await new TripStore(files).createTrip('일본', 'JPY');
		assert.equal(trip.currency, 'JPY');
	} finally {
		intl.supportedValuesOf = original;
	}
});

test('trip creation rejects an unknown currency when Intl.supportedValuesOf is unavailable', async () => {
	const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
	const original = intl.supportedValuesOf;
	try {
		intl.supportedValuesOf = undefined;
		await assert.rejects(new TripStore(new MemoryLedgerFiles()).createTrip('일본', 'QQQ'), /Invalid currency/);
	} finally {
		intl.supportedValuesOf = original;
	}
});

test('invalid trip details do not partly change the currency', async () => {
	const files = new MemoryLedgerFiles();
	const store = new TripStore(files);
	const trip = await store.createTrip('일본', 'JPY');
	await assert.rejects(store.updateTripDetails(trip, ' ', 'KRW'));
	assert.equal((await readValidTrips(store))[0]?.currency, 'JPY');
	const updated = await store.updateTripDetails(trip, '다시 일본', 'KRW');
	assert.equal(updated.name, '다시 일본');
	assert.equal((await readValidTrips(store))[0]?.currency, 'KRW');
});

test('malformed managed files report their vault path', async () => {
	const files = new MemoryLedgerFiles();
	const tripStore = new TripStore(files);
	const trip = await tripStore.createTrip('일본', 'JPY');
	const day = dayPath(trip.folderPath, '2026-10-14');
	files.seed(day, { 'trip-ledger': 'day', schemaVersion: 2 });
	await assert.rejects(new ExpenseStore(files).loadDay(trip, '2026-10-14'), (error: Error) => error.message.includes(day));
	const tripPath = tripFilePath(trip.folderPath);
	files.seed(tripPath, { 'trip-ledger': 'trip', schemaVersion: 2 });
	assert.match((await tripStore.listTripCandidates())[0]?.error ?? '', /trip\.md/);
	files.seed('Trip Ledger/categories.md', { 'trip-ledger': 'categories', schemaVersion: 2 });
	await assert.rejects(new CategoryStore(files).list(), (error: Error) => error.message.includes('Trip Ledger/categories.md'));
});

test('custom categories remain available to history after archiving', async () => {
	const store = new CategoryStore(new MemoryLedgerFiles());
	const category = await store.add('기념품');
	await store.setArchived(category.id, true);
	assert.deepEqual(await store.list(), [{ ...category, archived: true }]);
	await store.setArchived(category.id, false);
	assert.deepEqual(await store.list(), [{ ...category, archived: false }]);
	await assert.rejects(store.add('기념품'));
});

test('expense edits preserve day note body and unrelated frontmatter', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const store = new ExpenseStore(files);
	const first = { id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' };
	await store.upsert(trip, first);
	const path = dayPath(trip.folderPath, first.date);
	const frontmatter = (await files.readFrontmatter(path))!;
	files.seed(path, { ...frontmatter, myNoteKey: 'preserve' }, '사용자 메모');
	await store.upsert(trip, { ...first, amountMinor: 1300 }, first);
	assert.equal((await store.loadDay(trip, first.date))[0]?.amountMinor, 1300);
	assert.equal((await files.readFrontmatter(path))?.myNoteKey, 'preserve');
	assert.equal(files.bodyAt(path), '사용자 메모');
	assert.equal((await files.readFrontmatter(tripFilePath(trip.folderPath)))?.currencyLocked, true);
});

test('stale expense edit is rejected without replacing newer data', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const store = new ExpenseStore(files);
	const first = { id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' };
	await store.upsert(trip, first);
	await store.upsert(trip, { ...first, amountMinor: 1300 }, first);
	await assert.rejects(store.upsert(trip, { ...first, amountMinor: 1400 }, first));
	assert.equal((await store.loadDay(trip, first.date))[0]?.amountMinor, 1300);
});

test('an expense form with an old trip currency cannot save a new day', async () => {
	const files = new MemoryLedgerFiles();
	const trips = new TripStore(files);
	const oldTrip = await trips.createTrip('일본', 'JPY');
	await trips.updateTripDetails(oldTrip, oldTrip.name, 'USD');
	const store = new ExpenseStore(files);
	await assert.rejects(store.upsert(oldTrip, {
		id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food',
	}));
	assert.deepEqual(await store.loadDay(oldTrip, '2026-10-14'), []);
});

test('a currency change cannot overtake an expense after its currency check', async () => {
	let signalDayCreation!: () => void;
	const dayCreationStarted = new Promise<void>((resolve) => { signalDayCreation = resolve; });
	let releaseDayCreation!: () => void;
	const dayCreationReleased = new Promise<void>((resolve) => { releaseDayCreation = resolve; });
	class PausingDayFiles extends MemoryLedgerFiles {
		async createManagedFile(path: string, kind: 'trip' | 'day' | 'categories', initial: Record<string, unknown>): Promise<void> {
			if (kind === 'day') {
				signalDayCreation();
				await dayCreationReleased;
			}
			await super.createManagedFile(path, kind, initial);
		}
	}

	const files = new PausingDayFiles();
	const trips = new TripStore(files);
	const trip = await trips.createTrip('일본', 'JPY');
	const expenseStore = new ExpenseStore(files);
	const expense = { id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' };
	const saving = expenseStore.upsert(trip, expense);
	await dayCreationStarted;
	const changing = trips.updateTripDetails(trip, trip.name, 'USD');
	await new Promise<void>((resolve) => setImmediate(resolve));
	releaseDayCreation();

	assert.deepEqual(await saving, {});
	await assert.rejects(changing, /Currency is locked/);
	assert.equal((await readValidTrips(trips))[0]?.currency, 'JPY');
	assert.equal((await expenseStore.loadDay(trip, expense.date))[0]?.amountMinor, 1200);
});

test('a saved expense reports a lock warning and the next save repairs it', async () => {
	const files = new FailingLockFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const store = new ExpenseStore(files);
	files.failNextLock = true;
	const first = { id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' };
	const result = await store.upsert(trip, first);
	assert.match(result.warning ?? '', /trip\.md/);
	assert.equal((await store.loadDay(trip, first.date)).length, 1);
	assert.equal((await files.readFrontmatter(tripFilePath(trip.folderPath)))?.currencyLocked, false);
	await store.upsert(trip, { ...first, id: 'e2' });
	assert.equal((await files.readFrontmatter(tripFilePath(trip.folderPath)))?.currencyLocked, true);
});

test('moving an expense changes the two dates and not another trip', async () => {
	const files = new MemoryLedgerFiles();
	const trips = new TripStore(files);
	const firstTrip = await trips.createTrip('일본', 'JPY');
	const secondTrip = await trips.createTrip('일본', 'JPY');
	const store = new ExpenseStore(files);
	const expense = { id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' };
	await store.upsert(firstTrip, expense);
	await store.upsert(secondTrip, { ...expense, id: 'e2' });
	await store.moveDate(firstTrip, { ...expense, date: '2026-10-15' }, '2026-10-14', expense);
	assert.deepEqual(await store.listDates(firstTrip), ['2026-10-15']);
	assert.equal((await store.loadDay(firstTrip, '2026-10-14')).length, 0);
	assert.equal((await store.loadDay(secondTrip, '2026-10-14')).length, 1);
	await assert.rejects(trips.updateTripDetails(firstTrip, firstTrip.name, 'KRW'));
});

test('folder rename waits for an expense save to finish its currency lock', async () => {
	let signalDaySaved!: () => void;
	const daySaved = new Promise<void>((resolve) => { signalDaySaved = resolve; });
	let releaseDay!: () => void;
	const heldDay = new Promise<void>((resolve) => { releaseDay = resolve; });
	class PausingFiles extends MemoryLedgerFiles {
		async mutateFrontmatter(path: string, mutation: (data: Record<string, unknown>) => void): Promise<void> {
			await super.mutateFrontmatter(path, mutation);
			if (path.endsWith('/2026-10-14.md')) { signalDaySaved(); await heldDay; }
		}
	}
	const files = new PausingFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const store = new ExpenseStore(files);
	const save = store.upsert(trip, { id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' });
	await daySaved;
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	const rename = new RootManager(files, settings, async () => {}).rename('내 여행');
	await new Promise<void>((resolve) => setImmediate(resolve));
	releaseDay();
	assert.equal((await save).warning, undefined);
	await rename;
	const movedTrip = (await readValidTrips(new TripStore(files)))[0];
	assert.ok(movedTrip);
	assert.equal((await store.loadDay(movedTrip, '2026-10-14')).length, 1);
	assert.equal(await new TripStore(files).currencyLockState(movedTrip), true);
});

test('folder rename waits until a date move removes the old expense copy', async () => {
	let signalNewDaySaved!: () => void;
	const newDaySaved = new Promise<void>((resolve) => { signalNewDaySaved = resolve; });
	let releaseNewDay!: () => void;
	const heldNewDay = new Promise<void>((resolve) => { releaseNewDay = resolve; });
	class PausingFiles extends MemoryLedgerFiles {
		pause = false;
		async mutateFrontmatter(path: string, mutation: (data: Record<string, unknown>) => void): Promise<void> {
			await super.mutateFrontmatter(path, mutation);
			if (this.pause && path.endsWith('/2026-10-15.md')) { signalNewDaySaved(); await heldNewDay; }
		}
	}
	const files = new PausingFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const store = new ExpenseStore(files);
	const original = { id: 'e1', date: '2026-10-14', item: '점심', amountMinor: 1200, place: '식당', categoryId: 'food' };
	await store.upsert(trip, original);
	files.pause = true;
	const move = store.moveDate(trip, { ...original, date: '2026-10-15' }, original.date, original);
	await newDaySaved;
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	const rename = new RootManager(files, settings, async () => {}).rename('내 여행');
	await new Promise<void>((resolve) => setImmediate(resolve));
	releaseNewDay();
	await move;
	await rename;
	const movedTrip = (await readValidTrips(new TripStore(files)))[0];
	assert.ok(movedTrip);
	assert.deepEqual(await store.listDates(movedTrip), ['2026-10-15']);
	assert.equal((await store.loadDay(movedTrip, '2026-10-14')).length, 0);
});
