import assert from 'node:assert/strict';
import test from 'node:test';
import { TripStore } from '../src/storage/trip-store';
import { RootManager, type RootSettings } from '../src/storage/root-manager';
import { MemoryLedgerFiles } from './support/memory-ledger-files';
import { readValidTrips } from './support/trips';

test('renaming a populated ledger journals the move and saves its final root', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	const saved: RootSettings[] = [];
	const manager = new RootManager(files, settings, async (next) => {
		saved.push({ ...next });
	});
	await manager.rename('내 여행');
	assert.equal(files.root, '내 여행');
	assert.equal(settings.ledgerRoot, '내 여행');
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.deepEqual(saved, [
		{ ledgerRoot: 'Trip Ledger', pendingLedgerRoot: '내 여행' },
		{ ledgerRoot: '내 여행', pendingLedgerRoot: undefined },
	]);
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});

test('a failed journal save leaves the original folder and settings untouched', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	const manager = new RootManager(files, settings, async () => { throw new Error('save failed'); });
	await assert.rejects(manager.rename('내 여행'), /save failed/);
	assert.equal(files.root, 'Trip Ledger');
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
	assert.equal(await files.rootExists('내 여행'), false);
});

test('a failed final save can be recovered from the moved folder on restart', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	let saves = 0;
	const manager = new RootManager(files, settings, async () => {
		if (++saves === 2) throw new Error('final save failed');
	});
	await assert.rejects(manager.rename('내 여행'), /final save failed/);
	assert.equal(files.root, '내 여행');
	assert.equal(settings.ledgerRoot, 'Trip Ledger');
	assert.equal(settings.pendingLedgerRoot, '내 여행');
	files.adoptRoot('Trip Ledger');
	await new RootManager(files, settings, async () => {}).recover();
	assert.equal(settings.ledgerRoot, '내 여행');
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});

test('a moved folder refreshes open views even when final settings save fails', async () => {
	const files = new MemoryLedgerFiles();
	await new TripStore(files).createTrip('일본', 'JPY');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	let saves = 0;
	let refreshes = 0;
	const manager = new RootManager(files, settings, async () => {
		if (++saves === 2) throw new Error('final save failed');
	}, () => { refreshes++; });
	await assert.rejects(manager.rename('내 여행'), /final save failed/);
	assert.equal(files.root, '내 여행');
	assert.equal(refreshes, 1);
});

test('failed folder move clears the journal when the original folder remains', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	files.renameRoot = async () => { throw new Error('move failed'); };
	const manager = new RootManager(files, settings, async () => {});
	await assert.rejects(manager.rename('내 여행'), /move failed/);
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.equal(files.root, 'Trip Ledger');
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});

test('recovery clears a journal when only the original folder remains', async () => {
	const files = new MemoryLedgerFiles();
	await new TripStore(files).createTrip('일본', 'JPY');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: '내 여행' as string | undefined };
	const warning = await new RootManager(files, settings, async () => {}).recover();
	assert.equal(warning, null);
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.equal(files.root, 'Trip Ledger');
});

test('recovery blocks writes if both original and target folders exist', async () => {
	const files = new MemoryLedgerFiles();
	await files.ensureFolder('Trip Ledger');
	files.seed('내 여행/unrelated.md', {});
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: '내 여행' as string | undefined };
	const warning = await new RootManager(files, settings, async () => {}).recover();
	assert.match(warning ?? '', /Trip Ledger.*내 여행/);
	await assert.rejects(new TripStore(files).createTrip('추가 여행', 'KRW'), /Trip Ledger.*내 여행/);
});

test('recovery blocks writes if neither original nor target folder exists', async () => {
	const files = new MemoryLedgerFiles();
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: '내 여행' as string | undefined };
	const warning = await new RootManager(files, settings, async () => {}).recover();
	assert.match(warning ?? '', /Trip Ledger.*내 여행/);
	await assert.rejects(new TripStore(files).createTrip('추가 여행', 'KRW'), /Trip Ledger.*내 여행/);
});

test('a target created during rename leaves the original ledger usable', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const originalRename = files.renameRoot.bind(files);
	files.renameRoot = async (name) => {
		files.seed(`${name}/unrelated.md`, {});
		await originalRename(name);
	};
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	await assert.rejects(new RootManager(files, settings, async () => {}).rename('내 여행'), /Folder already exists/);
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.equal(files.root, 'Trip Ledger');
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});

test('concurrent rename requests do not corrupt a healthy ledger', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	let signalSaveStarted!: () => void;
	const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve; });
	let releaseSave!: () => void;
	const heldSave = new Promise<void>((resolve) => { releaseSave = resolve; });
	let saves = 0;
	const manager = new RootManager(files, settings, async () => {
		if (++saves === 1) { signalSaveStarted(); await heldSave; }
	});
	const first = manager.rename('첫 여행');
	await saveStarted;
	await assert.rejects(manager.rename('둘째 여행'), /already in progress/);
	releaseSave();
	await first;
	assert.equal(files.root, '첫 여행');
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});

test('a failed settings save on an empty ledger restores the previous root', async () => {
	const files = new MemoryLedgerFiles();
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	const manager = new RootManager(files, settings, async () => { throw new Error('save failed'); });
	await assert.rejects(manager.rename('내 여행'), /save failed/);
	assert.equal(files.root, 'Trip Ledger');
	assert.equal(settings.ledgerRoot, 'Trip Ledger');
});

test('an empty-ledger rename failure lets a waiting new trip use the restored root', async () => {
	const files = new MemoryLedgerFiles();
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	let signalSaveStarted!: () => void;
	const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve; });
	let rejectSave!: (error: Error) => void;
	const pendingSave = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
	const manager = new RootManager(files, settings, async () => {
		signalSaveStarted();
		await pendingSave;
	});
	const rename = manager.rename('내 여행');
	await saveStarted;
	const createTrip = new TripStore(files).createTrip('일본', 'JPY');
	rejectSave(new Error('save failed'));
	await assert.rejects(rename, /save failed/);
	const trip = await createTrip;
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
	assert.equal(files.root, 'Trip Ledger');
	assert.equal(await files.rootExists('내 여행'), false);
});

test('renaming an empty ledger stores the new root without creating a folder', async () => {
	const files = new MemoryLedgerFiles();
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: undefined as string | undefined };
	await new RootManager(files, settings, async () => {}).rename('내 여행');
	assert.equal(files.root, '내 여행');
	assert.equal(settings.ledgerRoot, '내 여행');
	assert.equal(await files.rootExists('내 여행'), false);
});

test('startup recovery adopts the moved folder from an unfinished journal', async () => {
	const files = new MemoryLedgerFiles();
	const trip = await new TripStore(files).createTrip('일본', 'JPY');
	await files.renameRoot('내 여행');
	files.adoptRoot('Trip Ledger');
	const settings = { ledgerRoot: 'Trip Ledger', pendingLedgerRoot: '내 여행' as string | undefined };
	const manager = new RootManager(files, settings, async () => {});
	await manager.recover();
	assert.equal(files.root, '내 여행');
	assert.equal(settings.ledgerRoot, '내 여행');
	assert.equal(settings.pendingLedgerRoot, undefined);
	assert.equal((await readValidTrips(new TripStore(files)))[0]?.id, trip.id);
});
