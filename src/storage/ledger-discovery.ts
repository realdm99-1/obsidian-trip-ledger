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

	private async inspectKnownRoot(root: string): Promise<LedgerCandidate | null> {
		const categories = await this.source.readFrontmatter(categoriesPath(root));
		if (categories !== null) parseCategories(categories);
		const validIds: string[] = [];
		const idCounts = new Map<string, number>();
		for (const folder of await this.source.listTripFolders(root)) {
			try {
				const raw = await this.source.readFrontmatter(`${folder}/trip.md`);
				if (raw === null) continue;
				const idHint = typeof raw.id === 'string' && raw.id.trim() ? raw.id : null;
				if (idHint) idCounts.set(idHint, (idCounts.get(idHint) ?? 0) + 1);
				validIds.push(parseTrip(raw, folder, root).id);
			} catch {
				continue;
			}
		}
		const tripIds = validIds.filter((id) => idCounts.get(id) === 1);
		return tripIds.length ? { root, tripIds } : null;
	}
}
