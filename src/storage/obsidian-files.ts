import { App, getFrontMatterInfo, parseYaml, stringifyYaml, TFile, TFolder } from 'obsidian';
import { assertLedgerPath, DEFAULT_LEDGER_ROOT, validateLedgerRootName } from './paths';
import { fileError, RootTargetExistsError, TripFolderExistsError } from './errors';
import { RootOperationGate } from './root-operation-gate';

export type ManagedKind = 'trip' | 'day' | 'categories';

export interface LedgerFiles {
	readonly root: string;
	rootExists(name: string): Promise<boolean>;
	renameRoot(name: string): Promise<void>;
	changeEmptyRoot(name: string, commit: () => Promise<void>): Promise<void>;
	switchRoot(name: string, commit: () => Promise<void>): Promise<void>;
	adoptRoot(name: string): void;
	blockRoot(reason: string): void;
	readFrontmatter(path: string): Promise<Record<string, unknown> | null>;
	createManagedFile(path: string, kind: ManagedKind, initial: Record<string, unknown>): Promise<void>;
	mutateFrontmatter(path: string, mutation: (data: Record<string, unknown>) => void): Promise<void>;
	listChildFolders(folder: string): Promise<string[]>;
	listMarkdownPaths(folder: string): Promise<string[]>;
	createTripFolder(path: string): Promise<void>;
}

const KINDS: ManagedKind[] = ['trip', 'day', 'categories'];

export class ObsidianLedgerFiles implements LedgerFiles {
	root: string;
	private gate = new RootOperationGate();
	private blockedReason: string | null = null;

	constructor(private app: App, root = DEFAULT_LEDGER_ROOT) {
		this.root = validateLedgerRootName(root);
	}

	private checkPath(path: string): void {
		if (this.blockedReason) throw new Error(this.blockedReason);
		assertLedgerPath(path, this.root);
	}

	private async runPath<T>(path: string, operation: () => Promise<T>): Promise<T> {
		return this.gate.run(async () => {
			this.checkPath(path);
			return operation();
		});
	}

	async rootExists(name: string): Promise<boolean> {
		const clean = validateLedgerRootName(name);
		return this.gate.run(async () => this.app.vault.getAbstractFileByPath(clean) !== null);
	}

	async renameRoot(name: string): Promise<void> {
		const next = validateLedgerRootName(name);
		if (next === this.root) return;
		await this.gate.migrate(async () => {
			if (this.blockedReason) throw new Error(this.blockedReason);
			if (this.app.vault.getAbstractFileByPath(next) !== null) throw new RootTargetExistsError(next);
			const previous = this.root;
			const folder = this.app.vault.getAbstractFileByPath(previous);
			if (folder !== null && !(folder instanceof TFolder)) throw new Error(`Not a folder: ${previous}`);
			if (folder) {
				try {
					await this.app.fileManager.renameFile(folder, next);
				} catch (error) {
					const oldExists = this.app.vault.getAbstractFileByPath(previous) !== null;
					const newExists = this.app.vault.getAbstractFileByPath(next) !== null;
					if (!oldExists && newExists) this.root = next;
					else if (oldExists === newExists) this.blockRoot(`Check ledger folders: ${previous}, ${next}`);
					throw new Error(`Could not rename ${previous} to ${next}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			this.root = next;
		});
	}

	async changeEmptyRoot(name: string, commit: () => Promise<void>): Promise<void> {
		const next = validateLedgerRootName(name);
		await this.gate.migrate(async () => {
			if (this.blockedReason) throw new Error(this.blockedReason);
			const previous = this.root;
			if (this.app.vault.getAbstractFileByPath(previous) !== null) throw new Error(`Ledger folder appeared; retry rename: ${previous}`);
			if (this.app.vault.getAbstractFileByPath(next) !== null) throw new RootTargetExistsError(next);
			this.root = next;
			try {
				await commit();
			} catch (error) {
				this.root = previous;
				throw error;
			}
		});
	}

	async switchRoot(name: string, commit: () => Promise<void>): Promise<void> {
		const next = validateLedgerRootName(name);
		await this.gate.migrate(async () => {
			if (this.blockedReason) throw new Error(this.blockedReason);
			const target = this.app.vault.getAbstractFileByPath(next);
			if (!(target instanceof TFolder)) throw new Error(`Missing ledger folder: ${next}`);
			const previous = this.root;
			this.root = next;
			try {
				await commit();
			} catch (error) {
				this.root = previous;
				throw error;
			}
		});
	}

	adoptRoot(name: string): void {
		this.root = validateLedgerRootName(name);
	}

	blockRoot(reason: string): void {
		this.blockedReason = reason;
	}

	async readFrontmatter(path: string): Promise<Record<string, unknown> | null> {
		return this.runPath(path, async () => {
			try {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file === null) return null;
				if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Not a Markdown file');
				const content = await this.app.vault.read(file);
				const info = getFrontMatterInfo(content);
				if (!info.exists) throw new Error('Missing frontmatter');
				const value: unknown = parseYaml(info.frontmatter);
				if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid frontmatter');
				return value as Record<string, unknown>;
			} catch (error) {
				throw fileError(path, error);
			}
		});
	}

	async createManagedFile(path: string, kind: ManagedKind, initial: Record<string, unknown>): Promise<void> {
		await this.runPath(path, async () => {
			try {
				if (this.app.vault.getAbstractFileByPath(path)) throw new Error('File already exists');
				const slash = path.lastIndexOf('/');
				await this.ensureFolderCore(path.slice(0, slash));
				const yaml = stringifyYaml({ ...initial, 'trip-ledger': kind, schemaVersion: 1 }).trimEnd();
				await this.app.vault.create(path, `---\n${yaml}\n---\n`);
			} catch (error) {
				throw fileError(path, error);
			}
		});
	}

	async mutateFrontmatter(path: string, mutation: (data: Record<string, unknown>) => void): Promise<void> {
		await this.runPath(path, async () => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || file.extension !== 'md') throw new Error(`Missing Markdown file: ${path}`);
			try {
				await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
					if (!KINDS.includes(data['trip-ledger'] as ManagedKind) || data.schemaVersion !== 1) {
						throw new Error('Unrecognized ledger file');
					}
					mutation(data);
				});
			} catch (error) {
				throw fileError(path, error);
			}
		});
	}

	async listChildFolders(folder: string): Promise<string[]> {
		return this.runPath(folder, async () => {
			const item = this.app.vault.getAbstractFileByPath(folder);
			if (item === null) return [];
			if (!(item instanceof TFolder)) throw new Error(`Not a folder: ${folder}`);
			return item.children.filter((child): child is TFolder => child instanceof TFolder).map((child) => child.path);
		});
	}

	async listMarkdownPaths(folder: string): Promise<string[]> {
		return this.runPath(folder, async () => {
			const item = this.app.vault.getAbstractFileByPath(folder);
			if (item === null) return [];
			if (!(item instanceof TFolder)) throw new Error(`Not a folder: ${folder}`);
			return item.children.filter((child): child is TFile => child instanceof TFile && child.extension === 'md').map((child) => child.path);
		});
	}

	async createTripFolder(path: string): Promise<void> {
		await this.runPath(path, async () => {
			if (path.slice(0, path.lastIndexOf('/')) !== this.root) throw new Error(`Invalid trip folder: ${path}`);
			await this.ensureFolderCore(this.root);
			if (this.app.vault.getAbstractFileByPath(path)) throw new TripFolderExistsError(path);
			try {
				await this.app.vault.createFolder(path);
			} catch (error) {
				if (this.app.vault.getAbstractFileByPath(path)) throw new TripFolderExistsError(path);
				throw fileError(path, error);
			}
		});
	}

	private async ensureFolderCore(path: string): Promise<void> {
		const parts = path.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing === null) {
				await this.app.vault.createFolder(current);
			} else if (!(existing instanceof TFolder)) {
				throw new Error(`Not a folder: ${current}`);
			}
		}
	}
}
