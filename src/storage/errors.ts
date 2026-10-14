export function withFilePath<T>(path: string, action: () => T): T {
	try {
		return action();
	} catch (error) {
		throw fileError(path, error);
	}
}

export class RootTargetExistsError extends Error {
	constructor(path: string) {
		super(`Folder already exists: ${path}`);
	}
}

export class TripFolderExistsError extends Error {
	constructor(path: string) {
		super(`Folder already exists: ${path}`);
	}
}

export function fileError(path: string, error: unknown): Error {
	const detail = error instanceof Error ? error.message : String(error);
	return error instanceof Error && detail.includes(path) ? error : new Error(`${path}: ${detail}`);
}
