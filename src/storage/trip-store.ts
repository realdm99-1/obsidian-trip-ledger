import type { Trip } from '../model/types';
import { parseDay, parseTrip } from './schema';
import { datesFolderPath, plainTripFolderPath, tripFilePath, tripFolderPath } from './paths';
import type { LedgerFiles } from './obsidian-files';
import { TripFolderExistsError, withFilePath } from './errors';
import { withTripWriteLock } from './trip-write-lock';
import { isSupportedCurrency } from '../model/currencies';

function cleanName(name: string): string {
	const value = name.trim();
	if (!value || value.length > 80) throw new Error('Invalid trip name');
	return value;
}

function cleanCurrency(currency: string): string {
	const code = currency.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(code)) throw new Error('Invalid currency');
	try {
		if (!isSupportedCurrency(code)) throw new Error('Invalid currency');
		new Intl.NumberFormat('en', { style: 'currency', currency: code });
	} catch {
		throw new Error('Invalid currency');
	}
	return code;
}

export interface TripCandidate {
	folderPath: string;
	idHint: string | null;
	trip: Trip | null;
	error: string | null;
}

export class TripStore {
	constructor(private files: LedgerFiles) {}

	async listTripCandidates(): Promise<TripCandidate[]> {
		const folders = await this.files.listChildFolders(this.files.root);
		const candidates: TripCandidate[] = [];
		for (const folder of folders) {
			const path = tripFilePath(folder, this.files.root);
			let idHint: string | null = null;
			try {
				const raw = await this.files.readFrontmatter(path);
				if (raw === null) {
					candidates.push({ folderPath: folder, idHint, trip: null, error: `Missing trip file: ${path}` });
					continue;
				}
				idHint = typeof raw.id === 'string' && raw.id.trim() ? raw.id : null;
				const trip = withFilePath(path, () => parseTrip(raw, folder, this.files.root));
				candidates.push({ folderPath: folder, idHint, trip, error: null });
			} catch (error) {
				candidates.push({ folderPath: folder, idHint, trip: null,
					error: `${path}: ${error instanceof Error ? error.message : String(error)}` });
			}
		}
		const idCounts = new Map<string, number>();
		for (const candidate of candidates) {
			if (candidate.idHint) idCounts.set(candidate.idHint, (idCounts.get(candidate.idHint) ?? 0) + 1);
		}
		for (const candidate of candidates) {
			if (candidate.idHint && (idCounts.get(candidate.idHint) ?? 0) > 1) {
				candidate.trip = null;
				candidate.error = `${candidate.folderPath}: Duplicate trip ID: ${candidate.idHint}${candidate.error ? `; ${candidate.error}` : ''}`;
			}
		}
		return candidates.sort((a, b) => a.folderPath.localeCompare(b.folderPath));
	}

	async createTrip(name: string, currency: string): Promise<Trip> {
		const clean = cleanName(name);
		const code = cleanCurrency(currency);
		return withTripWriteLock(this.files, 'create-trip', async () => {
			const id = crypto.randomUUID().replace(/-/g, '');
			const root = this.files.root;
			let folderPath = plainTripFolderPath(clean, root);
			try {
				await this.files.createTripFolder(folderPath);
			} catch (error) {
				if (!(error instanceof TripFolderExistsError)) throw error;
				folderPath = tripFolderPath(clean, id, root);
				await this.files.createTripFolder(folderPath);
			}
			const path = tripFilePath(folderPath, root);
			await this.files.createManagedFile(path, 'trip', {
				id, name: clean, currency: code, currencyLocked: false,
			});
			return { id, name: clean, currency: code, currencyLocked: false, folderPath };
		});
	}

	async updateTripDetails(trip: Trip, name: string, currency: string): Promise<Trip> {
		const clean = cleanName(name);
		const code = cleanCurrency(currency);
		return withTripWriteLock(this.files, trip.id, async () => {
			if (code !== trip.currency) {
				const dates = await this.files.listMarkdownPaths(datesFolderPath(trip.folderPath, this.files.root));
				for (const path of dates) {
					const date = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
					const raw = await this.files.readFrontmatter(path);
					if (raw !== null && withFilePath(path, () => parseDay(raw, trip.id, date)).expenses.length > 0) {
						throw new Error('Currency is locked after the first expense');
					}
				}
			}
			const path = tripFilePath(trip.folderPath, this.files.root);
			await this.files.mutateFrontmatter(path, (data) => {
				const current = parseTrip(data, trip.folderPath, this.files.root);
				if (current.id !== trip.id || current.name !== trip.name || current.currency !== trip.currency) {
					throw new Error('Trip changed outside this view');
				}
				if (code !== current.currency && current.currencyLocked) throw new Error('Currency is locked');
				data.name = clean;
				data.currency = code;
			});
			return { ...trip, name: clean, currency: code };
		});
	}

	async lockCurrency(trip: Trip): Promise<void> {
		await this.files.mutateFrontmatter(tripFilePath(trip.folderPath, this.files.root), (data) => {
			const current = parseTrip(data, trip.folderPath, this.files.root);
			if (current.id !== trip.id || current.currency !== trip.currency) throw new Error('Trip currency changed');
			data.currencyLocked = true;
		});
	}

	async currencyLockState(trip: Trip): Promise<boolean> {
		const path = tripFilePath(trip.folderPath, this.files.root);
		const raw = await this.files.readFrontmatter(path);
		if (raw === null) throw new Error(`Missing trip file: ${path}`);
		const current = withFilePath(path, () => parseTrip(raw, trip.folderPath, this.files.root));
		if (current.id !== trip.id || current.currency !== trip.currency) throw new Error(`Trip currency changed: ${path}`);
		return current.currencyLocked;
	}
}
