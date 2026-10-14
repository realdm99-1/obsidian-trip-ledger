import { App, getFrontMatterInfo, parseYaml, TFile, TFolder } from 'obsidian';
import type { LedgerDiscoverySource } from './ledger-discovery';
import { validateLedgerRootName } from './paths';

export class ObsidianDiscoverySource implements LedgerDiscoverySource {
	constructor(private app: App) {}

	async listRoots(): Promise<string[]> {
		return this.app.vault.getRoot().children
			.filter((child): child is TFolder => child instanceof TFolder)
			.map((folder) => folder.name);
	}

	async listTripFolders(root: string): Promise<string[]> {
		if (validateLedgerRootName(root) !== root) throw new Error(`Invalid ledger folder: ${root}`);
		const folder = this.app.vault.getAbstractFileByPath(root);
		if (!(folder instanceof TFolder)) throw new Error(`Missing ledger folder: ${root}`);
		return folder.children.filter((child): child is TFolder => child instanceof TFolder)
			.map((child) => child.path);
	}

	async readFrontmatter(path: string): Promise<Record<string, unknown> | null> {
		const parts = path.split('/');
		const isCategories = parts.length === 2 && parts[1] === 'categories.md';
		const isTrip = parts.length === 3 && parts[2] === 'trip.md' && Boolean(parts[1]);
		if ((!isCategories && !isTrip) || !parts[0] || validateLedgerRootName(parts[0]) !== parts[0]) {
			throw new Error(`Invalid ledger discovery path: ${path}`);
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file === null) return null;
		if (!(file instanceof TFile) || file.extension !== 'md') throw new Error(`Not a Markdown file: ${path}`);
		const info = getFrontMatterInfo(await this.app.vault.read(file));
		if (!info.exists) throw new Error(`Missing frontmatter: ${path}`);
		const data: unknown = parseYaml(info.frontmatter);
		if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid frontmatter: ${path}`);
		return data as Record<string, unknown>;
	}
}
