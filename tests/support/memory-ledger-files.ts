import type { LedgerFiles, ManagedKind } from '../../src/storage/obsidian-files';
import { assertLedgerPath, DEFAULT_LEDGER_ROOT, validateLedgerRootName } from '../../src/storage/paths';
import { RootOperationGate } from '../../src/storage/root-operation-gate';
import { RootTargetExistsError, TripFolderExistsError } from '../../src/storage/errors';

interface MemoryFile {
	frontmatter: Record<string, unknown>;
	body: string;
}

export class MemoryLedgerFiles implements LedgerFiles {
	private folders = new Set<string>();
	private files = new Map<string, MemoryFile>();
	private gate = new RootOperationGate();
	private blockedReason: string | null = null;
	root: string;

	constructor(root = DEFAULT_LEDGER_ROOT) {
		this.root = validateLedgerRootName(root);
	}

	private checkPath(path: string): void {
		if (this.blockedReason) throw new Error(this.blockedReason);
		assertLedgerPath(path, this.root);
	}

	async rootExists(name: string): Promise<boolean> {
		return this.gate.run(async () => this.files.has(name) || this.folders.has(name) ||
			[...this.files.keys(), ...this.folders].some((path) => path.startsWith(`${name}/`)));
	}

	async renameRoot(name: string): Promise<void> {
		const next = validateLedgerRootName(name);
		if (next === this.root) return;
		await this.gate.migrate(async () => {
			if (this.blockedReason) throw new Error(this.blockedReason);
			if (this.files.has(next) || this.folders.has(next) ||
				[...this.files.keys(), ...this.folders].some((path) => path.startsWith(`${next}/`))) {
				throw new RootTargetExistsError(next);
			}
			const old = this.root;
			const movedFiles = new Map<string, MemoryFile>();
			for (const [path, value] of this.files) {
				movedFiles.set(path === old || path.startsWith(`${old}/`) ? `${next}${path.slice(old.length)}` : path, value);
			}
			this.files = movedFiles;
			this.folders = new Set([...this.folders].map((path) =>
				path === old || path.startsWith(`${old}/`) ? `${next}${path.slice(old.length)}` : path));
			this.root = next;
		});
	}

	async changeEmptyRoot(name: string, commit: () => Promise<void>): Promise<void> {
		const next = validateLedgerRootName(name);
		await this.gate.migrate(async () => {
			if (this.blockedReason) throw new Error(this.blockedReason);
			const previous = this.root;
			if (this.files.has(previous) || this.folders.has(previous) ||
				[...this.files.keys(), ...this.folders].some((path) => path.startsWith(`${previous}/`))) {
				throw new Error(`Ledger folder appeared; retry rename: ${previous}`);
			}
			if (this.files.has(next) || this.folders.has(next) ||
				[...this.files.keys(), ...this.folders].some((path) => path.startsWith(`${next}/`))) {
				throw new RootTargetExistsError(next);
			}
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
			const exists = this.folders.has(next) || this.files.has(next) ||
				[...this.folders, ...this.files.keys()].some((path) => path.startsWith(`${next}/`));
			if (!exists) throw new Error(`Missing ledger folder: ${next}`);
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

	seed(path: string, frontmatter: Record<string, unknown>, body = ''): void {
		this.files.set(path, { frontmatter: structuredClone(frontmatter), body });
	}

	bodyAt(path: string): string | undefined {
		return this.files.get(path)?.body;
	}

	async readFrontmatter(path: string): Promise<Record<string, unknown> | null> {
		return this.gate.run(async () => {
			this.checkPath(path);
			const value = this.files.get(path);
			return value ? structuredClone(value.frontmatter) : null;
		});
	}

	async createManagedFile(path: string, kind: ManagedKind, initial: Record<string, unknown>): Promise<void> {
		await this.gate.run(async () => {
			this.checkPath(path);
			if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
			this.seed(path, { ...initial, 'trip-ledger': kind, schemaVersion: 1 });
		});
	}

	async mutateFrontmatter(path: string, mutation: (data: Record<string, unknown>) => void): Promise<void> {
		await this.gate.run(async () => {
			this.checkPath(path);
			const value = this.files.get(path);
			if (!value) throw new Error(`Missing file: ${path}`);
			const data = structuredClone(value.frontmatter);
			mutation(data);
			value.frontmatter = data;
		});
	}

	async listChildFolders(folder: string): Promise<string[]> {
		return this.gate.run(async () => {
			this.checkPath(folder);
			const prefix = `${folder}/`;
			return [...this.folders].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
		});
	}

	async listMarkdownPaths(folder: string): Promise<string[]> {
		return this.gate.run(async () => {
			this.checkPath(folder);
			const prefix = `${folder}/`;
			return [...this.files.keys()].filter((path) => path.startsWith(prefix) &&
				!path.slice(prefix.length).includes('/') && path.endsWith('.md'));
		});
	}

	async ensureFolder(path: string): Promise<void> {
		await this.gate.run(async () => {
			this.checkPath(path);
			this.folders.add(path);
		});
	}

	async createTripFolder(path: string): Promise<void> {
		await this.gate.run(async () => {
			this.checkPath(path);
			if (path.slice(0, path.lastIndexOf('/')) !== this.root) throw new Error(`Invalid trip folder: ${path}`);
			if (this.folders.has(path) || this.files.has(path) ||
				[...this.folders, ...this.files.keys()].some((item) => item.startsWith(`${path}/`))) {
				throw new TripFolderExistsError(path);
			}
			this.folders.add(this.root);
			this.folders.add(path);
		});
	}
}
