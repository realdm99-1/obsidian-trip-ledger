import { categoriesPath, validateLedgerRootName } from './paths';
import { parseCategories, parseTrip } from './schema';

export interface LedgerDiscoverySource {
	listRoots(): Promise<string[]>;
	listTripFolders(root: string): Promise<string[]>;
	readFrontmatter(path: string): Promise<Record<string, unknown> | null>;
}

export interface LedgerCandidate {
	root: string;
	tripIds: string[];
}

export class LedgerDiscovery {
	constructor(private source: LedgerDiscoverySource) {}

	async inspect(root: string): Promise<LedgerCandidate | null> {
		try {
			if (validateLedgerRootName(root) !== root || !(await this.source.listRoots()).includes(root)) return null;
			return await this.inspectKnownRoot(root);
		} catch {
			return null;
		}
	}

	async inspectForConfiguration(root: string): Promise<LedgerCandidate | null> {
		if (validateLedgerRootName(root) !== root || !(await this.source.listRoots()).includes(root)) return null;
		return this.inspectKnownRoot(root, true, true);
	}

	async list(): Promise<LedgerCandidate[]> {
		const candidates: LedgerCandidate[] = [];
		for (const root of await this.source.listRoots()) {
			try {
				const candidate = await this.inspectKnownRoot(root);
				if (candidate) candidates.push(candidate);
			} catch {
				continue;
			}
		}
		return candidates.sort((a, b) => a.root.localeCompare(b.root));
	}

	private async inspectKnownRoot(root: string, allowUninitialized = false, reportInvalidFiles = false): Promise<LedgerCandidate | null> {
		const categoryFile = categoriesPath(root);
		try {
			const categories = await this.source.readFrontmatter(categoryFile);
			if (categories !== null) parseCategories(categories);
		} catch (error) {
			if (reportInvalidFiles) throw new Error(`${categoryFile}: ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}
		const validIds: string[] = [];
		const idCounts = new Map<string, number>();
		let hasTripFile = false;
		let firstInvalidTrip: string | null = null;
		for (const folder of await this.source.listTripFolders(root)) {
			try {
				const raw = await this.source.readFrontmatter(`${folder}/trip.md`);
				if (raw === null) continue;
				hasTripFile = true;
				const idHint = typeof raw.id === 'string' && raw.id.trim() ? raw.id : null;
				if (idHint) idCounts.set(idHint, (idCounts.get(idHint) ?? 0) + 1);
				validIds.push(parseTrip(raw, folder, root).id);
			} catch (error) {
				hasTripFile = true;
				if (reportInvalidFiles && firstInvalidTrip === null) {
					firstInvalidTrip = `${folder}/trip.md: ${error instanceof Error ? error.message : String(error)}`;
				}
				continue;
			}
		}
		const tripIds = validIds.filter((id) => idCounts.get(id) === 1);
		if (tripIds.length || (allowUninitialized && !hasTripFile)) return { root, tripIds };
		if (reportInvalidFiles && firstInvalidTrip) throw new Error(firstInvalidTrip);
		const duplicateId = [...idCounts].find(([, count]) => count > 1)?.[0];
		if (reportInvalidFiles && duplicateId) throw new Error(`Duplicate trip ID: ${duplicateId}`);
		return null;
	}
}
