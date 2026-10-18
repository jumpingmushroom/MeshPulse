<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatTime } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const s = $derived(data.settings);
	const NUMBERS: [keyof typeof data.settings, string, string][] = [
		['batteryLowPct', 'Battery low', '%'], ['batteryCriticalPct', 'Battery critical', '%'], ['batteryClearPct', 'Battery OK again', '%'],
		['voltageLow', 'Coin cell low', 'V'], ['voltageCritical', 'Coin cell critical', 'V'], ['voltageClear', 'Coin cell OK again', 'V'],
		['coinCellMaxV', 'Coin cell max voltage', 'V'],
		['graceMin', 'Offline grace', 'min'], ['bridgeSilenceMin', 'Bridge silence', 'min'], ['permitJoinMaxMin', 'Permit join max', 'min'],
		['mqttLostSec', 'MQTT lost after', 's'], ['restartWarnCount', 'Bridge restarts warning', 'per day'],
		['silenceMultiplier', 'Silent after typical gap ×', ''], ['silenceMinH', 'Silence at least', 'h'], ['silenceMaxH', 'Silence at most', 'h'],
		['flappingCount', 'Flapping at', 'drops'], ['flappingClearBelow', 'Flapping clears below', 'drops'], ['flappingWindowH', 'Flapping window', 'h'],
		['reminderCriticalH', 'Remind critical every', 'h'], ['reminderWarningH', 'Remind warning every', 'h'],
		['lqiWeak', 'Weak link below', 'LQI'], ['lqiWeakClear', 'Weak link clears above', 'LQI'], ['lqiMinHours', 'Link rules need data in', 'h'],
		['lqiDegradePct', 'Link degrading at', '% below normal'], ['lqiRecoverPct', 'Link recovered within', '% of normal'],
		['baselineMinDays', 'Baseline needs', 'days'],
		['routeFailWarn', 'Route failures warning at', 'per 24 h'], ['routeFailCrit', 'Route failures critical at', 'per 24 h'],
		['routeFailClear', 'Route failures clear below', 'per 24 h'],
		['netRouteFactor', 'Network failures above', '× normal per hour'], ['netRouteMin', 'Network failures at least', 'per hour'],
		['netRouteClearFactor', 'Network failures clear below', '× normal per hour'],
		['forecastTargetPct', 'Battery forecast target', '%'], ['forecastWarnDays', 'Forecast warns within', 'days'],
		['forecastClearDays', 'Forecast clears above', 'days'], ['forecastMinDays', 'Forecast needs', 'days of data'],
		['massOfflineDevices', 'Mass offline at', 'devices'], ['massOfflineRouterPct', 'Mass offline at', '% of routers'],
		['massOfflineWindowMin', 'Mass offline window', 'min'], ['massOfflineClearPct', 'Mass offline clears below', '% of routers'],
		['churnAnnounce', 'Rejoin churn at', 'announces'], ['churnAddrChanges', 'Rejoin churn at', 'address changes'],
		['churnWindowH', 'Rejoin churn window', 'h'], ['churnCritical', 'Rejoin churn critical at', 'rejoins in 24 h'],
		['churnClearH', 'Rejoin churn clears after', 'h quiet'], ['netChurnDevices', 'Network churn at', 'devices'],
		['netChurnWindowMin', 'Network churn window', 'min'], ['netChurnQuietH', 'Network churn clears after', 'h quiet'],
		['backlogHigh', 'MQTT backlog above', 'messages'], ['backlogClear', 'MQTT backlog clears below', 'messages']
	];
	const msg = (section: string) => (form?.section === section ? form : null);
</script>

<h1>Settings</h1>

<form method="post" action="?/save" use:enhance={() => ({ update }) => update({ reset: false })}>
	<h2>Thresholds</h2>
	<div class="grid">
		{#each NUMBERS as [key, label, unit] (key)}
			<label>{label} {#if unit}<span class="muted">({unit})</span>{/if}
				<input name={key} type="number" step="any" min="0" value={s[key]} required />
			</label>
		{/each}
	</div>
	<p class="muted">Bridge silence: on a small or very quiet mesh, raise this. It is the time without any device message before "Zigbee network silent" fires.</p>
	<h2>Quiet hours</h2>
	<div class="grid">
		<label><input name="quietEnabled" type="checkbox" checked={s.quietEnabled} /> Hold non-critical messages during quiet hours</label>
		<label>From <input name="quietStart" type="time" value={s.quietStart} required /></label>
		<label>To <input name="quietEnd" type="time" value={s.quietEnd} required /></label>
	</div>
	<h2>Heartbeat</h2>
	<label>Heartbeat URL <input name="heartbeatUrl" type="url" value={s.heartbeatUrl} placeholder="https://…" /></label>
	{#if msg('settings')?.error}<p class="error" role="alert">{msg('settings')?.error}</p>{/if}
	{#if msg('settings')?.saved}<p role="status">Saved.</p>{/if}
	<p><button>Save settings</button></p>
</form>

<h2>Discord</h2>
<form method="post" action="?/saveChannel" use:enhance={() => ({ update }) => update({ reset: false })}>
	<label>Webhook URL
		<input name="webhookUrl" type="url" autocomplete="off"
			placeholder={data.channel?.configured ? 'Configured (leave empty to keep it)' : 'https://discord.com/api/webhooks/…'} />
	</label>
	<p class="muted">{data.channel?.configured ? 'A webhook is configured.' : 'No webhook configured.'}</p>
	<label><input name="enabled" type="checkbox" checked={data.channel?.enabled ?? true} /> Enabled</label>
	<label><input name="mentionCritical" type="checkbox" checked={data.channel?.mentionCritical ?? false} /> @here on critical</label>
	<label>Minimum severity
		<select name="minSeverity" value={data.channel?.minSeverity ?? 'warning'}>
			<option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
		</select>
	</label>
	{#if msg('channel')?.error}<p class="error" role="alert">{msg('channel')?.error}</p>{/if}
	{#if msg('channel')?.saved}<p role="status">Channel saved.</p>{/if}
	{#if msg('channel')?.tested}<p role="status">Test message sent.</p>{/if}
	<p>
		<button>Save channel</button>
		{#if data.channel}<button formaction="?/test" formnovalidate>Send test</button>{/if}
	</p>
</form>

<h2>Apprise</h2>
<form method="post" action="?/saveApprise" use:enhance={() => ({ update }) => update({ reset: false })}>
	<label>Apprise API URL
		<input name="apiUrl" type="url" required autocomplete="off" value={data.apprise?.apiUrl ?? ''} placeholder="http://apprise:8000" />
	</label>
	<label>Config key (stateful mode)
		<input name="key" autocomplete="off" value={data.apprise?.key ?? ''} />
	</label>
	<label>Notification URLs (stateless mode, one per line)
		<textarea name="urls" rows="3" autocomplete="off"
			placeholder={data.apprise?.urlsConfigured ? 'Configured (leave empty to keep them)' : 'tgram://…'}></textarea>
	</label>
	<p class="muted">Use either a key or notification URLs. {data.apprise?.urlsConfigured ? 'Notification URLs are configured.' : ''}</p>
	<label><input name="enabled" type="checkbox" checked={data.apprise?.enabled ?? true} /> Enabled</label>
	<label>Minimum severity
		<select name="minSeverity" value={data.apprise?.minSeverity ?? 'warning'}>
			<option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
		</select>
	</label>
	{#if msg('apprise')?.error}<p class="error" role="alert">{msg('apprise')?.error}</p>{/if}
	{#if msg('apprise')?.saved}<p role="status">Channel saved.</p>{/if}
	{#if msg('apprise')?.tested}<p role="status">Test message sent.</p>{/if}
	<p>
		<button>Save channel</button>
		{#if data.apprise}<button formaction="?/testApprise" formnovalidate>Send test</button>{/if}
	</p>
</form>

<h2>Zigbee2MQTT prerequisites</h2>
{#if data.prereqs.length}
	<ul>
		{#each data.prereqs as p (p.key)}
			<li>{p.key}: <strong>{p.ok ? 'OK' : 'missing'}</strong>{#if !p.ok}<pre>{p.fix}</pre>{/if}</li>
		{/each}
	</ul>
{:else}
	<p>Unknown until the bridge reports its configuration.</p>
{/if}

<h2>Failed messages</h2>
{#if data.failed.length}
	<table>
		<thead><tr><th scope="col">Time</th><th scope="col">Message</th><th scope="col">Error</th></tr></thead>
		<tbody>
			{#each data.failed as f (f.id)}
				<tr><td>{formatTime(f.createdAt, data.tz)}</td><td>{f.title}</td><td>{f.lastError}</td></tr>
			{/each}
		</tbody>
	</table>
{:else}
	<p>None.</p>
{/if}
