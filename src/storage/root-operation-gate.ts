export class RootOperationGate {
	private active = 0;
	private migration: Promise<void> | null = null;
	private idleWaiters: Array<() => void> = [];

	async run<T>(operation: () => Promise<T>): Promise<T> {
		while (this.migration) await this.migration;
		this.active++;
		try {
			return await operation();
		} finally {
			this.active--;
			if (this.active === 0) {
				for (const resolve of this.idleWaiters.splice(0)) resolve();
			}
		}
	}

	async migrate<T>(operation: () => Promise<T>): Promise<T> {
		if (this.migration) throw new Error('Ledger folder rename already in progress');
		let release!: () => void;
		this.migration = new Promise<void>((resolve) => { release = resolve; });
		try {
			if (this.active > 0) {
				await new Promise<void>((resolve) => { this.idleWaiters.push(resolve); });
			}
			return await operation();
		} finally {
			this.migration = null;
			release();
		}
	}
}
