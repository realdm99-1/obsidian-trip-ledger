import type { LedgerFiles } from './obsidian-files';

interface WriteState {
	pendingByTrip: Map<string, Promise<void>>;
	active: number;
	pause: Promise<void> | null;
	idleWaiters: Array<() => void>;
}

const states = new WeakMap<LedgerFiles, WriteState>();

function stateFor(files: LedgerFiles): WriteState {
	let state = states.get(files);
	if (!state) {
		state = { pendingByTrip: new Map(), active: 0, pause: null, idleWaiters: [] };
		states.set(files, state);
	}
	return state;
}

export async function withTripWriteLock<T>(files: LedgerFiles, tripId: string, operation: () => Promise<T>): Promise<T> {
	const state = stateFor(files);
	while (state.pause) await state.pause;
	state.active++;
	const previous = state.pendingByTrip.get(tripId);
	let release!: () => void;
	const current = new Promise<void>((resolve) => { release = resolve; });
	state.pendingByTrip.set(tripId, current);
	if (previous) await previous;
	try {
		return await operation();
	} finally {
		release();
		if (state.pendingByTrip.get(tripId) === current) state.pendingByTrip.delete(tripId);
		state.active--;
		if (state.active === 0) {
			for (const resolve of state.idleWaiters.splice(0)) resolve();
		}
	}
}

export async function withTripWritesPaused<T>(files: LedgerFiles, operation: () => Promise<T>): Promise<T> {
	const state = stateFor(files);
	if (state.pause) throw new Error('Ledger folder rename already in progress');
	let release!: () => void;
	state.pause = new Promise<void>((resolve) => { release = resolve; });
	try {
		if (state.active > 0) await new Promise<void>((resolve) => { state.idleWaiters.push(resolve); });
		return await operation();
	} finally {
		state.pause = null;
		release();
	}
}
