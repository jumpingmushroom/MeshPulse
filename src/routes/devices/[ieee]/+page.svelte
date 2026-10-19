<script lang="ts">
	import { enhance } from '$app/forms';
	import IssueRow from '../../../lib/components/IssueRow.svelte';
	import LineChart from '../../../lib/components/LineChart.svelte';
	import { FOREVER, formatAgo, formatDaysLeft, formatDetail, formatTime, formatVoltage, sortIssues } from '../../../lib/views';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const d = $derived(data.device);
	const muted = $derived(d.mutedUntil && d.mutedUntil > data.now ? d.mutedUntil : null);
	const RANGES = [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d']] as const;
	const TYPE = { Coordinator: 'Coordinator', Router: 'Router', EndDevice: 'End device' } as const;
	const AVAIL = { online: ['avail-online', '#i-ok', 'Online'], offline: ['avail-offline', '#i-x', 'Offline'] } as const;
	const avail = $derived(AVAIL[d.availability as keyof typeof AVAIL] ?? (['avail-unknown', '#i-unknown', 'Unknown'] as const));
	const issues = $derived(sortIssues(data.issues));
	const submit = (e: Event) => (e.currentTarget as HTMLInputElement).form?.requestSubmit();
	const empty = $derived(data.daysLeft === null ? null : new Date(data.now + data.daysLeft * 86_400_000).toLocaleDateString('en-GB', { timeZone: data.tz, dateStyle: 'medium' }));
</script>

<div class="page">
	<a class="crumb" href="/devices"><svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-arrow-left" /></svg>Devices</a>
	<header class="stack" style="gap:11px">
		<div class="row" style="gap:16px">
			<h1 style="max-width:760px;text-wrap:pretty">{d.name}</h1>
			<span class="avail {avail[0]}" style="font-size:15px" title={formatTime(d.lastSeenAt, data.tz)}><svg class="i" aria-hidden="true"><use href={avail[1]} /></svg>{avail[2]} · seen {formatAgo(d.lastSeenAt, data.now)}</span>
		</div>
		<div class="row" style="gap:6px 17px;font-size:13px">
			<span class="tag tag-outline">{TYPE[d.type as keyof typeof TYPE] ?? d.type}</span>
			{#if d.model || d.vendor}<span class="muted">{[d.model, d.vendor].filter(Boolean).join(' · ')}</span>{/if}
			{#if d.powerSource}<span class="muted">{d.powerSource}</span>{/if}
			<span class="tag tag-outline">Health {data.score}</span>
			{#if d.ignored}<span class="tag tag-accent"><svg class="i" style="width:12px;height:12px" aria-hidden="true"><use href="#i-tag" /></svg>ignored</span>{/if}
			{#if d.chatty}<span class="tag tag-accent"><svg class="i" style="width:12px;height:12px" aria-hidden="true"><use href="#i-tag" /></svg>chatty</span>{/if}
		</div>
	</header>

	<div class="split">
		<div class="stack" style="gap:22px;min-width:0">
			{#if issues.length}
				<section aria-labelledby="dev-iss">
					<div class="section-head"><h2 id="dev-iss">Open issues for this device <span class="count">{issues.length}</span></h2></div>
					<div class="issues">{#each issues as i (i.id)}<IssueRow issue={i} now={data.now} />{/each}</div>
				</section>
			{/if}

			<section class="stack" aria-labelledby="dev-hist">
				<div class="section-head">
					<h2 id="dev-hist">History</h2>
					<nav class="seg" aria-label="Chart range">
						{#each RANGES as [k, label] (k)}<a href="?range={k}" aria-current={data.range === k ? 'true' : undefined}>{label}</a>{/each}
					</nav>
				</div>
				<div class="charts">
					{#each data.charts as c (c.title)}{@const half = c.title === 'Battery' || c.title === 'Voltage'}<div class:chart-wide={!half} style="min-width:0;display:grid"><LineChart {...c} w={half ? 300 : 600} /></div>{/each}
				</div>
			</section>

				<section class="panel panel-pad" aria-labelledby="dev-ev">
					<div class="section-head"><h2 id="dev-ev">Recent events</h2></div>
					{#if data.events.length}<ol class="timeline">
						{#each data.events as e (e.id)}
							<li><time>{formatTime(e.ts, data.tz)}</time><span class="dot"></span><div class="what">{e.label} <span class="faint">{formatDetail(e.kind, e.detail)}</span></div></li>
						{/each}
					</ol>{:else}<p class="muted">No events yet.</p>{/if}
					<a class="btn btn-sm" style="margin-top:8px" href="/events?device={d.ieee}">Show all {data.eventCount} events</a>
				</section>
		</div>

		<aside class="stack" style="gap:11px">
			{#if d.batteryPowered}
				<section class="panel panel-pad stack" style="gap:11px" aria-labelledby="dev-bat">
					<h2 id="dev-bat" class="muted" style="font-size:12px;font-weight:500">Battery forecast</h2>
					<p style="font-size:20px;font-weight:500;letter-spacing:-0.01em;text-wrap:pretty">
						{data.daysLeft !== null ? `${formatDaysLeft(data.daysLeft).replace(/^about/, 'About')} until ${data.targetPct} %` : 'No forecast yet'}
					</p>
					<p class="muted" style="font-size:13px">{empty ? `Empty around ${empty}.` : 'Not enough battery readings yet.'}</p>
					<hr class="rule" />
					<dl class="kv">
						<dt>Now</dt><dd>{d.battery !== null ? `${d.battery} %` : '—'}{d.voltage !== null ? ` · ${formatVoltage(d.voltage)} V` : ''}</dd>
						<dt>Last swap</dt><dd>{data.lastSwapAt ? formatTime(data.lastSwapAt, data.tz) : '—'}</dd>
					</dl>
				</section>
			{/if}

			<section class="panel panel-pad stack" style="gap:17px" aria-labelledby="dev-ctl">
				<h2 id="dev-ctl" class="muted" style="font-size:12px;font-weight:500">Alerts for this device</h2>
				{#if form?.error}<p class="field-error" role="alert">{form.error}</p>{/if}
				<form class="mute" method="post" action="?range={data.range}&/mute" use:enhance>
					<div class="mute-status" class:is-muted={muted}>{muted === FOREVER ? 'Muted forever' : muted ? `Muted until ${formatTime(muted, data.tz)}` : 'Not muted'}</div>
					<div class="mute-row">
						<label class="sr-only" for="dmute">Mute for</label>
						<select class="select" id="dmute" name="duration">
							<option value="1h">1 hour</option><option value="24h">24 hours</option>
							<option value="7d">7 days</option><option value="forever">forever</option>
							{#if muted}<option value="unmute">unmute</option>{/if}
						</select>
						<button class="btn">Mute</button>
					</div>
				</form>
				<hr class="rule" />
				<form method="post" action="?range={data.range}&/ignore" use:enhance class="stack" style="gap:6px">
					<label class="toggle"><input type="checkbox" role="switch" name="on" value="1" checked={d.ignored} onchange={submit} /><span class="track"></span>Ignore this device</label>
					<p class="field-help">Turns every rule off for it. It stays in the device list, greyed.</p>
					<noscript><button class="btn btn-sm">Apply</button></noscript>
				</form>
				<hr class="rule" />
				<form method="post" action="?range={data.range}&/chatty" use:enhance class="stack" style="gap:6px">
					<label class="toggle"><input type="checkbox" role="switch" name="on" value="1" checked={d.chatty} onchange={submit} /><span class="track"></span>Chatty device</label>
					<p class="field-help">Leaves this device out of the 'dominant' check.</p>
					<noscript><button class="btn btn-sm">Apply</button></noscript>
				</form>
			</section>
		</aside>
	</div>
</div>
