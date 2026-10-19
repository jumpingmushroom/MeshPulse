<script lang="ts">
	import { formatAgo, formatTime, formatVoltage, type SortKey } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const COLS: [SortKey, string, boolean][] = [['name', 'Name', false], ['type', 'Type', false], ['availability', 'Availability', false], ['lastSeenAt', 'Last seen', false],
		['lqi', 'LQI now · 24 h · base', false], ['battery', 'Battery', true], ['msgH', 'Msg/h', true], ['score', 'Health', true], ['openIssues', 'Issues', true]];
	const CHIPS = [['routers', 'Routers'], ['battery', 'Battery'], ['offline', 'Offline'], ['issues', 'Has issues']] as const;
	const SEV = { critical: 'is-crit', warning: 'is-warn', info: 'is-info' } as const;
	const SEV_ICON = { critical: '#i-crit', warning: '#i-warn', info: '#i-info' } as const;
	const AVAIL = { online: ['avail-online', '#i-ok', 'Online'], offline: ['avail-offline', '#i-x', 'Offline'] } as const;
	const TYPE_ICON = { Coordinator: '#i-cpu', Router: '#i-plug', EndDevice: '#i-sensor' } as const;

	const params = (over: Record<string, string | null> = {}) => {
		const p = new URLSearchParams();
		if (data.f.q) p.set('q', data.f.q);
		for (const [k] of CHIPS) if (data.f[k]) p.set(k, '1');
		p.set('sort', data.sort);
		p.set('dir', data.asc ? 'asc' : 'desc');
		if (data.comfortable) p.set('density', 'comfortable');
		for (const [k, v] of Object.entries(over)) v === null ? p.delete(k) : p.set(k, v);
		return `?${p}`;
	};
	const sortHref = (k: SortKey) => params({ sort: k, dir: data.sort === k && data.asc ? 'desc' : 'asc' });
	const avail = (a: string | null) => AVAIL[a as keyof typeof AVAIL] ?? (['avail-unknown', '#i-unknown', 'Unknown'] as const);
	const weak = (lqi: number | null) => lqi !== null && lqi < data.lqiWeak;
	const TYPE = { Coordinator: 'Coordinator', Router: 'Router', EndDevice: 'End device' } as const;
	const SHORT: Partial<Record<SortKey, string>> = { lqi: 'LQI', lastSeenAt: 'last seen', openIssues: 'issues', msgH: 'msg/h' };
	const summary = $derived(`${data.counts.total} devices · ${data.counts.routers} routers · ${data.counts.battery} on battery`);
</script>

<div class="page">
	<div class="page-head">
		<div>
			<h1>Devices</h1>
			<p class="sub">{summary}</p>
		</div>
		<div class="seg" role="group" aria-label="Density">
			<a href={params({ density: null })} aria-current={data.comfortable ? undefined : 'true'}>Compact</a>
			<a href={params({ density: 'comfortable' })} aria-current={data.comfortable ? 'true' : undefined}>Comfortable</a>
		</div>
	</div>

	<form method="get" class="toolbar" aria-label="Filter devices">
		<input type="hidden" name="sort" value={data.sort} />
		<input type="hidden" name="dir" value={data.asc ? 'asc' : 'desc'} />
		{#if data.comfortable}<input type="hidden" name="density" value="comfortable" />{/if}
		<div class="search">
			<svg class="i"><use href="#i-search" /></svg>
			<input class="input" type="search" name="q" value={data.f.q} placeholder="Search devices" aria-label="Search devices" />
		</div>
		<fieldset class="chips">
			<legend class="sr-only">Show only</legend>
			{#each CHIPS as [k, label] (k)}
				<label class="chip">
					<input type="checkbox" name={k} value="1" checked={data.f[k]} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
					<span class="box"><svg class="i"><use href="#i-check" /></svg></span>{label}<span class="n">{data.counts[k]}</span>
				</label>
			{/each}
		</fieldset>
		<noscript><button class="btn btn-sm">Apply</button></noscript>
	</form>

	{#if data.rows.length}
		<div class="dt-wrap dt-desktop">
			<div class="dt-scroll">
				<table class="dt" class:compact={!data.comfortable}>
					<thead>
						<tr>
							{#each COLS as [k, label, num] (k)}
								<th scope="col" class:num aria-sort={data.sort === k ? (data.asc ? 'ascending' : 'descending') : undefined}>
									<a class="sort" href={sortHref(k)}>{label}<svg class="i"><use href={data.sort === k ? (data.asc ? '#i-up' : '#i-down') : '#i-sort'} /></svg></a>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.rows as r (r.ieee)}
							{@const [ac, ai, al] = avail(r.availability)}
							<tr class:muted={r.ignored} class={r.worst ? `is-flagged ${SEV[r.worst]}` : ''}>
								<td class="name"><a href="/devices/{r.ieee}">{r.name}</a>{#if r.ignored}<span class="sub">ignored</span>{:else if r.mutedUntil && r.mutedUntil > data.now}<span class="sub">muted</span>{/if}</td>
								<td><span class="avail"><svg class="i"><use href={TYPE_ICON[r.type]} /></svg>{TYPE[r.type]}</span></td>
								<td><span class="avail {ac}"><svg class="i"><use href={ai} /></svg>{al}</span></td>
								<td title={formatTime(r.lastSeenAt, data.tz)}>{formatAgo(r.lastSeenAt, data.now)}</td>
								<td class={weak(r.lqi) ? 'lqi-weak' : ''}>
									{#if r.lqi === null}<span class="dash">—</span>{:else}<span class="lqi-meter"><i style="width:{Math.round((r.lqi / 255) * 100)}%"></i></span>{r.lqi}<span class="sub">{weak(r.lqi) ? 'weak · ' : ''}24 h {r.lqi24 === null ? '—' : Math.round(r.lqi24)} · base {r.lqiBase === null ? 'learning' : Math.round(r.lqiBase)}</span>{/if}
								</td>
								<td class="num">{r.battery === null ? '—' : `${Math.round(r.battery)} %`}<span class="sub">{r.voltage === null ? '' : `${formatVoltage(r.voltage)} V`}</span></td>
								<td class="num">{r.msgH === null ? '—' : Math.round(r.msgH)}</td>
								<td class="num"><span class="health" class:health-low={r.score < 70}>{r.score}</span></td>
								<td class="num">
									{#if r.worst}<span class="issue-count {SEV[r.worst]}"><svg class="i"><use href={SEV_ICON[r.worst]} /></svg>{r.openIssues}</span>{:else}<span class="dash">—</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="dt-foot"><span>Showing {data.rows.length} of {data.counts.total}</span><span>Sorted by {SHORT[data.sort] ?? COLS.find((c) => c[0] === data.sort)?.[1].toLowerCase()}, {data.asc ? 'ascending' : 'descending'}</span></div>
		</div>

		<div class="dcards" role="list">
			{#each data.rows as r (r.ieee)}
				{@const [ac, ai, al] = avail(r.availability)}
				<article class="dcard {r.worst ? `is-flagged ${SEV[r.worst]}` : ''}" class:muted={r.ignored} role="listitem">
					<div>
						<a class="dcard-name" href="/devices/{r.ieee}">{r.name}</a>
						<div class="dcard-type">{TYPE[r.type]} · seen {formatAgo(r.lastSeenAt, data.now)}</div>
					</div>
					<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
						<span class="avail {ac}"><svg class="i"><use href={ai} /></svg>{al}</span>
						{#if r.worst}<span class="issue-count {SEV[r.worst]}"><svg class="i"><use href={SEV_ICON[r.worst]} /></svg>{r.openIssues}</span>{/if}
					</div>
					<div class="dcard-metrics">
						<span>LQI <b>{r.lqi ?? '—'}</b></span>
						{#if r.battery !== null}<span>Battery <b>{Math.round(r.battery)} %</b></span>{/if}
						<span>Msg/h <b>{r.msgH === null ? '—' : Math.round(r.msgH)}</b></span>
						<span>Health <b>{r.score}</b></span>
					</div>
				</article>
			{/each}
		</div>
	{:else}
		<div class="panel"><div class="empty"><strong>No devices match</strong></div></div>
	{/if}
</div>
