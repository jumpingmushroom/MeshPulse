const M = 60_000;
const KEEP = 61; // 60 complete minutes plus the current one

/** Live device messages per minute, per device and for the network. In memory only. */
export class MinuteCounters {
	private net = new Map<number, number>();
	private dev = new Map<string, Map<number, number>>();

	add(ieee: string, ts: number): void {
		const m = Math.floor(ts / M);
		const bump = (map: Map<number, number>) => map.set(m, (map.get(m) ?? 0) + 1);
		bump(this.net);
		let d = this.dev.get(ieee);
		if (!d) this.dev.set(ieee, (d = new Map()));
		bump(d);
		// shortcut: prunes only the maps touched (<= 61 keys each); a silent device keeps stale minutes until it speaks, perMinute ignores them
		for (const map of [this.net, d]) for (const k of map.keys()) if (k <= m - KEEP) map.delete(k);
	}

	/** Oldest to newest, the `minutes` complete minutes before the one `now` is in. null = network. */
	perMinute(ieee: string | null, now: number, minutes: number): number[] {
		const map = ieee === null ? this.net : this.dev.get(ieee);
		const cur = Math.floor(now / M);
		return Array.from({ length: minutes }, (_, i) => map?.get(cur - minutes + i) ?? 0);
	}

	/** Busiest device outside `exclude`, as a share of all network messages in the window. */
	topShare(now: number, minutes: number, exclude: Set<string>): { ieee: string; share: number; total: number } | null {
		const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
		const total = sum(this.perMinute(null, now, minutes));
		let best: { ieee: string; n: number } | null = null;
		for (const ieee of this.dev.keys()) {
			if (exclude.has(ieee)) continue;
			const n = sum(this.perMinute(ieee, now, minutes));
			if (n > 0 && (!best || n > best.n)) best = { ieee, n };
		}
		return best && { ieee: best.ieee, share: best.n / total, total };
	}
}
