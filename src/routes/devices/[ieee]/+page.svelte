<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import IssueRow from '../../../lib/components/IssueRow.svelte';
	import LineChart from '../../../lib/components/LineChart.svelte';
	import MuteForm from '../../../lib/components/MuteForm.svelte';
	import { KNOWN_TYPES } from '../../../lib/battery-types';
	import { availOf, formatAgo, formatDaysLeft, formatDetail, formatTime, formatVoltage, sortIssues, TYPE_LABEL } from '../../../lib/views';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const d = $derived(data.device);
	const muted = $derived(d.mutedUntil && d.mutedUntil > data.now ? d.mutedUntil : null);
	const RANGES = [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d']] as const;
	const avail = $derived(availOf(d.availability));
	const issues = $derived(sortIssues(data.issues));
	const bt = $derived(d.batteryType);
	// primitives: the 15 s reload brings a new batteryType object, but an equal string or number does not reset the form fields below
	const btType = $derived(bt?.type ?? null);
	const btCells = $derived(bt?.cells ?? 1);
	const known = (t: string) => (KNOWN_TYPES as readonly string[]).includes(t);
	// derived, so the server-rendered page already selects the device's type (an $effect only runs after loading); writable for the select
	let pick = $derived(btType ? (known(btType) ? btType : 'Other') : 'CR2032');
	const submit = (e: Event) => (e.currentTarget as HTMLInputElement).form?.requestSubmit();
	const empty = $derived(data.daysLeft === null ? null : new Date(data.now + data.daysLeft * 86_400_000).toLocaleDateString('en-GB', { timeZone: data.tz, dateStyle: 'medium' }));
</script>

<div class="page">
	<a class="crumb" href={resolve('/devices')}><svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-arrow-left" /></svg>Devices</a>
	<header class="stack" style="gap:11px">
		<div class="row" style="gap:16px">
			<h1 style="max-width:760px;text-wrap:pretty">{d.name}</h1>
			<span class="avail {avail[0]}" style="font-size:15px" title={formatTime(d.lastSeenAt, data.tz)}><svg class="i" aria-hidden="true"><use href={avail[1]} /></svg>{avail[2]} · seen {formatAgo(d.lastSeenAt, data.now)}</span>
		</div>
		<div class="row" style="gap:6px 17px;font-size:13px">
			<span class="tag tag-outline">{TYPE_LABEL[d.type as keyof typeof TYPE_LABEL] ?? d.type}</span>
			{#if d.model || d.vendor}<span class="muted">{[d.model, d.vendor].filter(Boolean).join(' · ')}</span>{/if}
			{#if d.powerSource}<span class="muted">{d.powerSource}</span>{/if}
			{#if data.parent}<span class="tag tag-outline">Parent {#if data.parent.name}<a href={resolve('/devices/[ieee]', { ieee: data.parent.ieee })}>{data.parent.name}</a>{:else}{data.parent.ieee}{/if} · LQI {data.parent.lqi}{data.parent.changed ? ' · changed since previous scan' : ''}</span>{/if}
			{#if data.nearbyAll && data.nearbyWifi.length > 1}
				<span class="tag tag-outline">Nearby Wi-Fi: <a href={resolve('/wifi')}>all {data.nearbyWifi.length} APs</a>{data.nearbyWifi.some((w) => w.overlaps) ? ` · ${data.nearbyWifi.filter((w) => w.overlaps).length} overlap` : ''}{data.wifiRecent ? '' : ' · no recent data'}</span>
			{:else}{#each data.nearbyWifi as w (w.mac)}<span class="tag tag-outline">Nearby Wi-Fi: <a href={resolve('/wifi')}>{w.name}</a> · channel {w.channel}{w.overlaps ? ' (overlaps)' : ''}{w.busy === null ? ' · no recent data' : ` · ${w.busy} % busy`}</span>{/each}{/if}
			{#if data.routed}<span class="tag tag-outline">{data.routed} {data.routed === 1 ? 'device routes' : 'devices route'} through this router</span>{/if}
			<span class="tag tag-outline">Health {data.score}</span>
			{#if d.ignored}<span class="tag tag-accent"><svg class="i" style="width:12px;height:12px" aria-hidden="true"><use href="#i-tag" /></svg>ignored</span>{/if}
			{#if data.rules.some((r) => !r.on)}{@const off = data.rules.filter((r) => !r.on).length}<span class="tag tag-accent"><svg class="i" style="width:12px;height:12px" aria-hidden="true"><use href="#i-tag" /></svg>{off} {off === 1 ? 'rule' : 'rules'} off</span>{/if}
			{#if d.chatty}<span class="tag tag-accent"><svg class="i" style="width:12px;height:12px" aria-hidden="true"><use href="#i-tag" /></svg>chatty</span>{/if}
			{#if d.rechargeable}<span class="tag tag-accent"><svg class="i" style="width:12px;height:12px" aria-hidden="true"><use href="#i-tag" /></svg>rechargeable</span>{/if}
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
					{#if data.eventCount}<a class="btn btn-sm" style="margin-top:8px" href="{resolve('/events')}?device={d.ieee}">Show all {data.eventCount} events</a>{/if}
				</section>
		</div>

		<aside class="stack" style="gap:11px">
			{#if d.batteryPowered}
				<section class="panel panel-pad stack" style="gap:11px" aria-labelledby="dev-bat">
					<h2 id="dev-bat" class="muted" style="font-size:12px;font-weight:500">Battery forecast</h2>
					<p style="font-size:20px;font-weight:500;letter-spacing:-0.01em;text-wrap:pretty">
						{d.rechargeable ? 'No forecast' : data.daysLeft !== null ? `${formatDaysLeft(data.daysLeft).replace(/^about/, 'About')} until ${data.targetPct} %` : 'No forecast yet'}
					</p>
					<p class="muted" style="font-size:13px">{d.rechargeable ? 'Rechargeable batteries stay level and then drop fast, so MeshPulse warns on a sudden drop instead.' : empty ? `Empty around ${empty}.` : 'Not enough battery readings yet.'}</p>
					<hr class="rule" />
					<dl class="kv">
						<dt>Now</dt><dd>{d.battery !== null ? `${Math.round(d.battery)} %` : '—'}{d.voltage !== null ? ` · ${formatVoltage(d.voltage)} V` : ''}</dd>
						<dt>Last swap</dt><dd>{data.lastSwapAt ? formatTime(data.lastSwapAt, data.tz) : '—'}</dd>
						<dt>Battery type</dt><dd>{bt ? `${bt.type} ×${bt.cells} · ${bt.source === 'override' ? 'set by you' : 'built-in list'}` : 'Unknown'}</dd>
					</dl>
					<form class="stack" style="gap:8px" method="post" action="?range={data.range}&/batteryType" use:enhance>
						<div class="row" style="gap:8px">
							<label class="sr-only" for="btype">Battery type</label>
							<select class="select" id="btype" name="type" bind:value={pick}>
								{#each KNOWN_TYPES as t (t)}<option value={t}>{t}</option>{/each}
								<option value="Other">Other</option>
							</select>
							{#if pick === 'Other'}<label class="sr-only" for="bother">Other type</label><input class="input" id="bother" name="other" maxlength="20" style="width:110px" value={btType && !known(btType) ? btType : ''} aria-invalid={form?.batteryError?.field === 'other' ? 'true' : undefined} />{/if}
							<label class="sr-only" for="bcells">Cells</label>
							<input class="input" id="bcells" name="cells" type="number" min="1" max="8" style="width:64px" value={btCells} aria-invalid={form?.batteryError?.field === 'cells' ? 'true' : undefined} />
							<button class="btn btn-sm">Save</button>
						</div>
						{#if form?.batteryError}<p class="field-error" role="alert">{form.batteryError.message}</p>{/if}
						{#if bt?.source === 'override'}<button class="btn btn-sm btn-ghost" name="reset" value="1" style="align-self:flex-start">Reset to built-in</button>{/if}
					</form>
				</section>
			{/if}

			<section class="panel panel-pad stack" style="gap:17px" aria-labelledby="dev-ctl">
				<h2 id="dev-ctl" class="muted" style="font-size:12px;font-weight:500">Alerts for this device</h2>
				{#if form?.error}<p class="field-error" role="alert">{form.error}</p>{/if}
				<MuteForm action="?range={data.range}&/mute" id="dmute" {muted} tz={data.tz} />
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
				{#if d.batteryPowered}
					<hr class="rule" />
					<form method="post" action="?range={data.range}&/rechargeable" use:enhance class="stack" style="gap:6px">
						<label class="toggle"><input type="checkbox" role="switch" name="on" value="1" checked={d.rechargeable} onchange={submit} /><span class="track"></span>Rechargeable battery</label>
						<p class="field-help">For NiMH cells, which read low from the day they go in: uses the rechargeable thresholds, warns on a sudden drop, skips the forecast.</p>
						<noscript><button class="btn btn-sm">Apply</button></noscript>
					</form>
				{/if}
			</section>
			{#if !d.ignored}
				<section class="panel panel-pad stack" style="gap:10px" aria-labelledby="dev-rules">
					<h2 id="dev-rules" class="muted" style="font-size:12px;font-weight:500">Rules for this device</h2>
					<p class="field-help">Turn a rule off when this device is just like that. Its open issue closes on the next check.</p>
					{#each data.rules as r (r.rule)}
						<form method="post" action="?range={data.range}&/rule" use:enhance>
							<input type="hidden" name="rule" value={r.rule} />
							<label class="toggle"><input type="checkbox" role="switch" name="on" value="1" checked={r.on} onchange={submit} /><span class="track"></span>{r.label}</label>
							<noscript><button class="btn btn-sm">Apply</button></noscript>
						</form>
					{/each}
				</section>
			{/if}
		</aside>
	</div>
</div>
