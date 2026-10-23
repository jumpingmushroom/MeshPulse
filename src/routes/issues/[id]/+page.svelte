<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import LineChart from '../../../lib/components/LineChart.svelte';
	import KV from '../../../lib/components/KV.svelte';
	import MuteForm from '../../../lib/components/MuteForm.svelte';
	import SevBadge from '../../../lib/components/SevBadge.svelte';
	import { evidenceRows, formatAgo, formatDuration, formatTime, formatDetail, isWifiKey, ISSUE_STATE, RULE_LABELS, SEV_CLASS } from '../../../lib/views';
	import type { RuleId } from '../../../lib/server/rules/types';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = $derived(data.issue);
	const muted = $derived(data.device?.mutedUntil && data.device.mutedUntil > data.now ? data.device.mutedUntil : null);
	const evidence = $derived(evidenceRows(data.issue.evidence ?? {}, data.tz, new Map(Object.entries(data.byName))));
	const st = $derived(ISSUE_STATE[i.state as keyof typeof ISSUE_STATE] ?? ['', i.state]);
</script>

<div class="page {SEV_CLASS[i.severity]}">
	<a class="crumb" href={resolve('/issues')}><svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-arrow-left" /></svg>Issues</a>
	<header class="stack" style="gap:11px">
		<div class="row">
			<SevBadge severity={i.severity} large />
			<span class="state {st[0]}">{st[1]}</span>
			<span class="faint" style="font-size:13px">{RULE_LABELS[i.rule as RuleId] ?? i.rule}</span>
		</div>
		<h1 style="max-width:820px;text-wrap:pretty">{i.summary}</h1>
		<p class="muted" style="font-size:13px">
			Opened {formatTime(i.openedAt, data.tz)} ({formatAgo(i.openedAt, data.now)})
			{#if i.resolvedAt} · resolved {formatTime(i.resolvedAt, data.tz)} · open for {formatDuration(i.resolvedAt - i.openedAt)}
			{:else} · open for {formatDuration(data.now - i.openedAt)}{/if}
		</p>
	</header>

	<div class="split">
		<div class="stack" style="gap:22px;min-width:0">
			{#if i.action}
				<section class="banner" style="grid-template-columns:auto minmax(0,1fr);padding:17px" aria-labelledby="act-h">
					<div class="banner-icon" style="width:36px;height:36px"><svg class="i" style="width:18px;height:18px" aria-hidden="true"><use href="#i-arrow-right" /></svg></div>
					<div><h2 id="act-h" class="banner-kicker" style="font-size:12px">Suggested action</h2><p style="font-size:16px;margin-top:3px;text-wrap:pretty">{i.action}</p></div>
				</section>
			{/if}

			{#if evidence.length}
				<section aria-labelledby="ev-h">
					<div class="section-head"><h2 id="ev-h">Evidence</h2></div>
					<div class="panel panel-pad"><KV rows={evidence} /></div>
				</section>
			{/if}

			{#if data.chart}<LineChart {...data.chart} />{/if}

			{#if data.parent}<p>Part of <a href={resolve('/issues/[id]', { id: String(data.parent.id) })}>{data.parent.summary}</a></p>{/if}
			{#if data.children.length}
				<section aria-labelledby="ch-h">
					<div class="section-head"><h2 id="ch-h">Grouped issues <span class="count">{data.children.length}</span></h2></div>
					<ul class="stack">{#each data.children as ch (ch.id)}<li><a href={resolve('/issues/[id]', { id: String(ch.id) })}>{ch.summary}</a>{#if ch.state === 'resolved'} <span class="muted">resolved</span>{/if}</li>{/each}</ul>
				</section>
			{/if}

			{#if data.events.length}
				<section class="panel panel-pad" aria-labelledby="re-h">
					<div class="section-head"><h2 id="re-h">Recent events for {data.device?.name ?? i.ieee}</h2></div>
					<ol class="timeline">
						{#each data.events as e (e.id)}
							<li><time>{formatTime(e.ts, data.tz)}</time><span class="dot"></span><div class="what">{e.label} <span class="faint">{formatDetail(e.kind, e.detail)}</span></div></li>
						{/each}
					</ol>
				</section>
			{/if}
		</div>

		<aside class="stack" style="gap:11px">
			<section class="panel panel-pad stack" style="gap:11px" aria-label="Actions">
				{#if form?.error}<p class="field-error" role="alert">{form.error}</p>{/if}
				{#if i.state === 'open'}
					<form method="post" action="?/acknowledge" use:enhance class="stack" style="gap:6px">
						<button class="btn btn-primary" style="width:100%"><svg class="i" aria-hidden="true"><use href="#i-check" /></svg>Acknowledge</button>
						<p class="field-help">Stops reminders. The issue stays open until it resolves.</p>
					</form>
				{/if}
				{#if isWifiKey(i.ieee)}
					<a href={resolve('/wifi')} class="crumb">Open Wi-Fi page<svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-arrow-right" /></svg></a>
				{/if}
				{#if data.device}
					{#if i.state === 'open'}<hr class="rule" />{/if}
					<MuteForm action="?/mute" id="imute" {muted} tz={data.tz} label="Mute {data.device.name}" />
					{#if data.canTurnOff}
						<hr class="rule" />
						<form method="post" action="?/ignoreRule" use:enhance class="stack" style="gap:6px">
							<button class="btn" style="width:100%">Turn off this rule</button>
							<p class="field-help">Stops “{RULE_LABELS[i.rule as keyof typeof RULE_LABELS] ?? i.rule}” for {data.device.name} only; turn it back on from the device page.</p>
						</form>
					{/if}
					<hr class="rule" />
					<a href={resolve('/devices/[ieee]', { ieee: data.device.ieee })} class="crumb">Open device page<svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-arrow-right" /></svg></a>
				{/if}
			</section>
		</aside>
	</div>
</div>
