import { ChannelError, type Channel, type Message } from './channel';

const COLORS: Record<Message['severity'], number> = { critical: 0xe53935, warning: 0xffb300, info: 0x1e88e5, resolved: 0x43a047 };
const MENTION_KINDS: readonly string[] = ['open', 'escalate', 'reminder'];

export function toDiscordPayload(m: Message, cfg: { mentionCritical: boolean }) {
	const mention = cfg.mentionCritical && m.severity === 'critical' && MENTION_KINDS.includes(m.kind);
	return {
		...(mention ? { content: '@here' } : {}),
		embeds: [{
			title: m.title.slice(0, 256),
			description: (m.summary + (m.action ? `\n\n**Suggested action:** ${m.action}` : '')).slice(0, 4096),
			color: COLORS[m.severity],
			// Discord rejects (400) more than 25 fields or values over 1024 chars
			fields: m.fields.slice(0, 25).map((f) => ({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: true })),
			...(m.url ? { url: m.url } : {}),
			timestamp: new Date().toISOString()
		}] as object[],
		allowed_mentions: { parse: mention ? ['everyone'] : [] }
	};
}

export const discord: Channel = {
	kind: 'discord',
	async send(config, message, fetchFn = fetch) {
		const res = await fetchFn(String(config.webhookUrl), {
			signal: AbortSignal.timeout(10_000),
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(toDiscordPayload(message, { mentionCritical: config.mentionCritical === true }))
		});
		if (res.ok) return;
		const text = await res.text().catch(() => '');
		if (res.status === 429) {
			let sec = Number(res.headers.get('retry-after'));
			try {
				sec = Number(JSON.parse(text).retry_after) || sec;
			} catch {
				// not JSON: keep the header value
			}
			throw new ChannelError('HTTP 429', (sec || 5) * 1000);
		}
		throw new ChannelError(`HTTP ${res.status} ${text.slice(0, 200)}`.trim());
	}
};
