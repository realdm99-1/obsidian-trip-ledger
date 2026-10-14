export class SettingsWriteQueue<T extends object> {
	private tail: Promise<void> = Promise.resolve();

	constructor(
		private settings: T,
		private save: (snapshot: T) => Promise<void>,
	) {}

	async update(patch: Partial<T>): Promise<void> {
		const requested = { ...patch };
		const run = this.tail.then(async () => {
			const snapshot = { ...this.settings, ...requested };
			await this.save(snapshot);
			Object.assign(this.settings, requested);
		});
		this.tail = run.catch(() => {});
		await run;
	}
}
