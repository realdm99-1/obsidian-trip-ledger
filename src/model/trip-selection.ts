import type { Trip } from './types';
import type { TripCandidate } from '../storage/trip-store';
import type { LedgerFiles } from '../storage/obsidian-files';
import { withTripWriteLock } from '../storage/trip-write-lock';

export type CurrentTripState =
	| { kind: 'ready'; trip: Trip }
	| { kind: 'create' }
	| { kind: 'select' }
	| { kind: 'invalid'; folderPath: string; error: string };

export class TripSelection {
	private selectionTail: Promise<void> = Promise.resolve();

	constructor(
		private settings: { lastSelectedTripId: string | null },
		private save: (tripId: string) => Promise<void>,
		private files: LedgerFiles,
	) {}

	async choose(tripId: string): Promise<void> {
		const run = this.selectionTail.then(async () => {
			await this.save(tripId);
			this.settings.lastSelectedTripId = tripId;
		});
		this.selectionTail = run.catch(() => {});
		await run;
	}

	async chooseFolder(folderPath: string, candidates: TripCandidate[]): Promise<boolean> {
		return withTripWriteLock(this.files, 'current-trip-selection', async () => {
			if (!folderPath.startsWith(`${this.files.root}/`)) return false;
			const candidate = candidates.find((entry) => entry.folderPath === folderPath);
			if (!candidate?.trip || candidates.filter((entry) => entry.idHint === candidate.trip?.id).length !== 1) {
				return false;
			}
			await this.choose(candidate.trip.id);
			return true;
		});
	}

	resolve(candidates: TripCandidate[]): CurrentTripState {
		const emptyState = (): CurrentTripState =>
			candidates.some((candidate) => candidate.trip !== null) ? { kind: 'select' } : { kind: 'create' };
		const selectedId = this.settings.lastSelectedTripId;
		if (!selectedId) return emptyState();
		const matching = candidates.filter((candidate) => candidate.idHint === selectedId);
		if (matching.length === 0) return emptyState();
		const candidate = matching[0]!;
		if (matching.length > 1) {
			return { kind: 'invalid', folderPath: candidate.folderPath, error: `Duplicate trip ID: ${selectedId}` };
		}
		if (!candidate.trip) {
			return { kind: 'invalid', folderPath: candidate.folderPath, error: candidate.error ?? 'Invalid trip file' };
		}
		return { kind: 'ready', trip: candidate.trip };
	}
}
