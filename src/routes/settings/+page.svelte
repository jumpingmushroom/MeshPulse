<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatTime } from '../../lib/views';
	import { GROUPS } from '../../lib/settings-groups';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const s = $derived(data.settings);
	const msg = (section: string) => (form?.section === section ? form : null);
	const errs = $derived(msg('settings')?.errors ?? []);
	const count = (keys: string[]) => errs.filter((e) => keys.includes(e.field)).length;
	const nThresh = $derived(count(GROUPS.flatMap(([, fs]) => fs.map(([k]) => k))));
	const nQuiet = $derived(count(['quietStart', 'quietEnd']));
	const nHeart = $derived(count(['heartbeatUrl']));
	const errOf = (key: string) => errs.find((e) => e.field === key)?.message;
	// after a failed save keep what the user typed
	const val = (key: keyof typeof data.settings) => msg('settings')?.values?.[key] ?? s[key];
	const wf = $derived(msg('wifi')?.values); // after a failed save/test keep what was typed (never the password)
	// editable copy of the saved areas; "Suggest" adds unsaved rows, nothing is stored until Save
	let rows = $state<{ name: string; match: string }[]>([]);
	let apSel = $state<Record<string, string>>({});
	$effect.pre(() => { rows = data.areas.areas.map((a) => ({ ...a })); apSel = Object.fromEntries(data.areas.aps.map((a) => [a.mac, a.area ?? ''])); });
	const suggest = () => { for (const n of data.areas.suggested) if (!rows.some((r) => r.name.toLowerCase() === n.toLowerCase())) rows.push({ name: n, match: n }); };
	const keep = () => ({ update }: { update: (o: { reset: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<div class="page">
	<div class="page-head"><div><h1>Settings</h1><p class="sub">Thresholds, notifications and prerequisites.</p></div></div>
	<div class="settings-layout">
		<nav class="subnav" aria-label="Settings sections">
			<a href="#thresholds">Thresholds{#if nThresh}<span class="sev is-crit" aria-label="{nThresh} errors">{nThresh}</span>{/if}</a>
			<a href="#quiet">Quiet hours{#if nQuiet}<span class="sev is-crit" aria-label="{nQuiet} errors">{nQuiet}</span>{/if}</a>
			<a href="#notifications">Notifications</a>
			<a href="#heartbeat">Heartbeat{#if nHeart}<span class="sev is-crit" aria-label="{nHeart} errors">{nHeart}</span>{/if}</a>
			<a href="#z2m">Zigbee2MQTT</a>
			<a href="#failed">Failed notifications</a>
			<a href="#active">Active features</a>
			<a href="#wifi">Wi-Fi (UniFi)</a>
			<a href="#areas">Areas</a>
		</nav>
		<div class="stack" style="gap: var(--space-12)">
			<form method="post" action="?/save" class="stack" style="gap: var(--space-12)" use:enhance={keep}>
				<section id="thresholds" class="stack" style="gap: var(--space-8)">
					<h2>Thresholds</h2>
					{#if nThresh}
						<div class="form-error" role="alert"><svg class="i"><use href="#i-crit" /></svg>
							<div><strong>{nThresh} setting{nThresh === 1 ? '' : 's'} need{nThresh === 1 ? 's' : ''} fixing.</strong> Nothing was saved; your other changes are kept below.</div></div>
					{/if}
					{#each GROUPS as [title, fields] (title)}
						<fieldset class="fieldset"><legend>{title}</legend>
							<div class="field-grid">
								{#each fields as [key, label, unit, help] (key)}
									<div class="field">
										<label for={key}>{label}</label>
										<div class="input-unit">
											<input class="input" id={key} name={key} type="number" step="any" min="0" value={val(key)} required
												aria-invalid={errOf(key) ? 'true' : undefined} aria-describedby="{key}-help" />
											{#if unit}<span>{unit}</span>{/if}
										</div>
										<span class="field-help" id="{key}-help">{help}</span>
										{#if errOf(key)}<span class="field-error" role="alert"><svg class="i"><use href="#i-crit" /></svg>{errOf(key)}</span>{/if}
									</div>
								{/each}
							</div>
						</fieldset>
					{/each}
				</section>

				<section id="quiet" class="stack">
					<h2>Quiet hours</h2>
					<label class="toggle"><input name="quietEnabled" type="checkbox" checked={msg('settings')?.values ? msg('settings')?.values?.quietEnabled === 'on' : s.quietEnabled} /><span class="track"></span>Hold non-critical messages during quiet hours</label>
					<div class="field-grid">
						<div class="field"><label for="quietStart">From</label><input class="input" id="quietStart" name="quietStart" type="time" value={val('quietStart')} required aria-invalid={errOf('quietStart') ? 'true' : undefined} />
							{#if errOf('quietStart')}<span class="field-error" role="alert"><svg class="i"><use href="#i-crit" /></svg>{errOf('quietStart')}</span>{/if}</div>
						<div class="field"><label for="quietEnd">To</label><input class="input" id="quietEnd" name="quietEnd" type="time" value={val('quietEnd')} required aria-invalid={errOf('quietEnd') ? 'true' : undefined} />
							{#if errOf('quietEnd')}<span class="field-error" role="alert"><svg class="i"><use href="#i-crit" /></svg>{errOf('quietEnd')}</span>{/if}</div>
					</div>
				</section>

				<section id="heartbeat" class="stack">
					<h2>Heartbeat</h2>
					<div class="field">
						<label for="heartbeatUrl">Heartbeat URL</label>
						<input class="input" id="heartbeatUrl" name="heartbeatUrl" type="url" value={val('heartbeatUrl')} placeholder="https://…"
							aria-invalid={errOf('heartbeatUrl') ? 'true' : undefined} />
						<span class="field-help">Pinged every minute while MeshPulse runs, so an external monitor can tell when it stops.
							{#if !data.heartbeat.configured}Not configured.{:else if !data.heartbeat.last}Last ping —{:else if data.heartbeat.last.error}Last ping {formatTime(data.heartbeat.last.at, data.tz)}, failed: {data.heartbeat.last.error}{:else}Last ping {formatTime(data.heartbeat.last.at, data.tz)}, HTTP {data.heartbeat.last.status}{/if}</span>
						{#if errOf('heartbeatUrl')}<span class="field-error" role="alert"><svg class="i"><use href="#i-crit" /></svg>{errOf('heartbeatUrl')}</span>{/if}
					</div>
				</section>

				{#if msg('settings')?.saved}<p role="status">Saved.</p>{/if}
				<div class="form-actions"><button class="btn btn-primary">Save settings</button></div>
			</form>

			<section id="notifications" class="stack" style="gap: var(--space-8)">
				<h2>Notifications</h2>
				<form method="post" action="?/saveChannel" class="channel" use:enhance={keep}>
					<div class="channel-head"><h3>Discord</h3>
						<label class="toggle"><input name="enabled" type="checkbox" checked={data.channel?.enabled ?? true} /><span class="track"></span>Enabled</label></div>
					<div class="field">
						<label for="webhookUrl">Webhook URL</label>
						<input class="input" id="webhookUrl" name="webhookUrl" type="url" autocomplete="off"
							placeholder={data.channel?.configured ? 'Configured (leave empty to keep it)' : 'https://discord.com/api/webhooks/…'} />
						<span class="field-help">{data.channel?.configured ? 'A webhook is configured.' : 'No webhook configured.'} It is write-only and never shown again.</span>
					</div>
					<div class="field-grid">
						<div class="field"><label for="d-sev">Minimum severity</label>
							<select class="select" id="d-sev" name="minSeverity" value={data.channel?.minSeverity ?? 'warning'}>
								<option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
							</select></div>
						<label class="toggle"><input name="mentionCritical" type="checkbox" checked={data.channel?.mentionCritical ?? false} /><span class="track"></span>@here on critical</label>
						<label class="toggle"><input name="weeklyDigest" type="checkbox" checked={data.channel?.weeklyDigest ?? true} /><span class="track"></span>Weekly digest (Sunday 18:00)</label>
					</div>
					{#if msg('channel')?.error}<div class="form-error" role="alert"><svg class="i"><use href="#i-crit" /></svg><div>{msg('channel')?.error}</div></div>{/if}
					{#if msg('channel')?.saved}<p class="test-result" role="status"><svg class="i"><use href="#i-ok" /></svg>Channel saved.</p>{/if}
					{#if msg('channel')?.tested}<p class="test-result" role="status"><svg class="i"><use href="#i-ok" /></svg>Test message sent.</p>{/if}
					<div class="form-actions">
						<button class="btn btn-primary">Save channel</button>
						<button class="btn" formaction="?/test" formnovalidate disabled={!data.channel}>Send test</button>
						{#if !data.channel}<span class="field-help">Save a URL first to send a test.</span>{/if}
					</div>
				</form>

				<form method="post" action="?/saveApprise" class="channel" use:enhance={keep}>
					<div class="channel-head"><h3>Apprise</h3>
						<label class="toggle"><input name="enabled" type="checkbox" checked={data.apprise?.enabled ?? true} /><span class="track"></span>Enabled</label></div>
					<div class="field-grid">
						<div class="field"><label for="apiUrl">Apprise API URL</label>
							<input class="input" id="apiUrl" name="apiUrl" type="url" required autocomplete="off" value={data.apprise?.apiUrl ?? ''} placeholder="http://apprise:8000" /></div>
						<div class="field"><label for="key">Config key (stateful mode)</label>
							<input class="input" id="key" name="key" autocomplete="off" value={data.apprise?.key ?? ''} /></div>
					</div>
					<div class="field">
						<label for="urls">Notification URLs (stateless mode, one per line)</label>
						<textarea class="input" id="urls" name="urls" rows="3" autocomplete="off"
							placeholder={data.apprise?.urlsConfigured ? 'Configured (leave empty to keep them)' : 'tgram://…'}></textarea>
						<span class="field-help">Use either a key or notification URLs. {data.apprise?.urlsConfigured ? 'Notification URLs are configured.' : ''}</span>
					</div>
					<div class="field-grid">
						<div class="field"><label for="a-sev">Minimum severity</label>
							<select class="select" id="a-sev" name="minSeverity" value={data.apprise?.minSeverity ?? 'warning'}>
								<option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
							</select></div>
						<label class="toggle"><input name="weeklyDigest" type="checkbox" checked={data.apprise?.weeklyDigest ?? false} /><span class="track"></span>Weekly digest (Sunday 18:00)</label>
					</div>
					{#if msg('apprise')?.error}<div class="form-error" role="alert"><svg class="i"><use href="#i-crit" /></svg><div>{msg('apprise')?.error}</div></div>{/if}
					{#if msg('apprise')?.saved}<p class="test-result" role="status"><svg class="i"><use href="#i-ok" /></svg>Channel saved.</p>{/if}
					{#if msg('apprise')?.tested}<p class="test-result" role="status"><svg class="i"><use href="#i-ok" /></svg>Test message sent.</p>{/if}
					<div class="form-actions">
						<button class="btn btn-primary">Save channel</button>
						<button class="btn" formaction="?/testApprise" formnovalidate disabled={!data.apprise}>Send test</button>
						{#if !data.apprise}<span class="field-help">Save a URL first to send a test.</span>{/if}
					</div>
				</form>
			</section>

			<section id="z2m" class="stack">
				<h2>Zigbee2MQTT prerequisites</h2>
				{#if data.prereqs.length}
					<ul class="checklist">
						{#each data.prereqs as p (p.key)}
							<li class={p.ok ? 'ok' : 'bad'}>
								<svg class="i"><use href={p.ok ? '#i-ok' : '#i-warn'} /></svg>
								<code>{p.key}</code>
								<span>{p.ok ? 'OK' : 'Missing'}{#if !p.ok}<pre>{p.fix}</pre>{/if}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted">Unknown until the bridge reports its configuration.</p>
				{/if}
			</section>

			<section id="failed" class="stack">
				<h2>Failed notifications</h2>
				{#if data.failed.length}
					<table class="dt compact">
						<thead><tr><th scope="col">Time</th><th scope="col">Message</th><th scope="col">Error</th></tr></thead>
						<tbody>
							{#each data.failed as f (f.id)}
								<tr><td>{formatTime(f.createdAt, data.tz)}</td><td>{f.title}</td><td>{f.lastError}</td></tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="muted">None.</p>
				{/if}
			</section>
			<section id="active" class="stack">
				<h2>Active features</h2>
				<p class="muted">These send requests into your Zigbee network. Everything else MeshPulse does is read-only. Off by default.</p>
				<form method="post" action="?/saveActive" class="stack" use:enhance={keep}>
					{#each [
						{ name: 'activeCoordinatorCheck', label: 'Daily coordinator check', help: 'Runs at 03:30. Asks the coordinator which routers it no longer knows.', info: data.active.check },
						{ name: 'activeNetworkScan', label: 'Nightly network scan', help: `Runs at 04:00. A scan of ${data.active.devices} devices takes 2–4 minutes and briefly loads the mesh.`, info: data.active.scan }
					] as f (f.name)}
						<div class="field">
							<label class="toggle"><input name={f.name} type="checkbox" checked={s[f.name as 'activeCoordinatorCheck' | 'activeNetworkScan']} /><span class="track"></span>{f.label}</label>
							<span class="field-help">{f.help}</span>
							<span class="field-help">
								Last run: {#if f.info.last}{formatTime(f.info.last.at, data.tz)}, {f.info.last.status}{#if f.info.last.reason} ({f.info.last.reason}){/if}{:else}never{/if}.
								{#if s[f.name as 'activeCoordinatorCheck' | 'activeNetworkScan']}Next run: {f.info.next}.{/if}
							</span>
						</div>
					{/each}
					{#if msg('active')?.saved}<p role="status">Saved.</p>{/if}
					<div class="form-actions"><button class="btn btn-primary">Save</button></div>
				</form>
			</section>
			<section id="wifi" class="stack">
				<h2>Wi-Fi (UniFi)</h2>
				<p class="muted">Read-only: logs in to your UniFi controller every 5 minutes to read the 2.4 GHz channel and airtime of each access point. Use a local account without MFA. Off by default. The busy thresholds are under Thresholds.</p>
				<form method="post" action="?/saveWifi" class="stack" use:enhance={keep}>
					<label class="toggle"><input name="wifiEnabled" type="checkbox" checked={wf ? !!wf.wifiEnabled : data.wifi.enabled} /><span class="track"></span>Enabled</label>
					<div class="field-grid">
						<div class="field"><label for="wifi-url">Controller URL</label><input class="input" id="wifi-url" name="url" autocomplete="off" value={wf?.url ?? data.wifi.url} placeholder="https://192.168.1.1" /></div>
						<div class="field"><label for="wifi-site">Site</label><input class="input" id="wifi-site" name="site" autocomplete="off" value={wf?.site ?? data.wifi.site} placeholder="default" /></div>
						<div class="field"><label for="wifi-user">User</label><input class="input" id="wifi-user" name="user" autocomplete="off" value={wf?.user ?? data.wifi.user} /></div>
						<div class="field"><label for="wifi-pass">Password</label>
							<input class="input" id="wifi-pass" name="password" type="password" autocomplete="new-password" placeholder={data.wifi.passwordSet ? 'Configured (leave empty to keep it)' : ''} />
							<span class="field-help">Write-only and never shown again.</span></div>
					</div>
					<p class="field-help">Last poll: {#if data.wifi.status.lastOkAt}{formatTime(data.wifi.status.lastOkAt, data.tz)}, ok{:else}none yet{/if}.
						{#if data.wifi.status.lastError}Failing ({data.wifi.status.failures} in a row): {data.wifi.status.lastError}{/if}</p>
					{#if msg('wifi')?.error}<div class="form-error" role="alert"><svg class="i"><use href="#i-crit" /></svg><div>{msg('wifi')?.error}</div></div>{/if}
					{#if msg('wifi')?.saved}<p class="test-result" role="status"><svg class="i"><use href="#i-ok" /></svg>Saved.</p>{/if}
					{#if msg('wifi')?.tested}<p class="test-result" role="status"><svg class="i"><use href="#i-ok" /></svg>{msg('wifi')?.tested}</p>{/if}
					<div class="form-actions">
						<button class="btn btn-primary">Save</button>
						<button class="btn" formaction="?/testWifi" formnovalidate>Test connection</button>
					</div>
				</form>
			</section>
			<section id="areas" class="stack">
				<h2>Areas</h2>
				<p class="muted">Optional. Areas group devices and access points, for example by room or floor, so a Wi-Fi hint can name the access points near a device. A device belongs to an area when its name contains the match text. With no areas, everything is the whole network.</p>
				<form method="post" action="?/saveAreas" class="stack" use:enhance={keep}>
					{#each rows as r, n (n)}
						<div class="field-grid">
							<div class="field"><label for="an{n}">Area</label><input class="input" id="an{n}" name="areaName" bind:value={r.name} autocomplete="off" /></div>
							<div class="field"><label for="am{n}">Device names containing</label><input class="input" id="am{n}" name="areaMatch" bind:value={r.match} autocomplete="off" placeholder={r.name} /></div>
							<div class="field"><button type="button" class="btn" onclick={() => rows.splice(n, 1)}>Remove</button></div>
						</div>
					{/each}
					<div class="form-actions">
						<button type="button" class="btn" onclick={() => rows.push({ name: '', match: '' })}>Add area</button>
						<button type="button" class="btn" onclick={suggest}>Suggest areas from device names</button>
					</div>
					{#if data.areas.aps.length}
						<h3>Access points</h3>
						{#each data.areas.aps as a (a.mac)}
							<div class="field-grid">
								<input type="hidden" name="apMac" value={a.mac} />
								<div class="field"><label for="ap{a.mac}">{a.name} <span class="faint">{a.model}</span></label>
									<select class="select" id="ap{a.mac}" name="ap:{a.mac}" bind:value={apSel[a.mac]}>
										<option value="">Whole network</option>
										{#each rows.filter((r) => r.name.trim()) as r (r.name)}<option value={r.name.trim()}>{r.name.trim()}</option>{/each}
									</select></div>
								{#if a.hint && !apSel[a.mac]}<div class="field"><span class="field-help">Looks like {a.hint}.</span> <button type="button" class="btn" onclick={() => (apSel[a.mac] = a.hint!)}>Apply</button></div>{/if}
							</div>
						{/each}
					{/if}
					{#if msg('areas')?.saved}<p class="test-result" role="status"><svg class="i"><use href="#i-ok" /></svg>Saved.</p>{/if}
					<div class="form-actions"><button class="btn btn-primary">Save</button></div>
				</form>
			</section>
		</div>
	</div>
</div>
