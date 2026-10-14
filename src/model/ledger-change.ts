export function touchesLedgerRoot(currentPath: string, previousPath: string | undefined, root: string): boolean {
	const inside = (path: string): boolean => path === root || path.startsWith(`${root}/`);
	return inside(currentPath) || (previousPath !== undefined && inside(previousPath));
}
