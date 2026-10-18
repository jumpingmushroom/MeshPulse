export type Prereq = { key: 'availability' | 'health' | 'mqtt_log'; ok: boolean; fix: string };

export function checkPrereqs(info: Record<string, any> | null): Prereq[] {
	if (!info) return [];
	const c = info.config ?? {};
	const a = c.availability;
	return [
		{
			key: 'availability',
			// Z2M 2.x: an availability object without `enabled` means enabled
			ok: a === true || (!!a && typeof a === 'object' && a.enabled !== false),
			fix: 'availability:\n  enabled: true'
		},
		{
			key: 'health',
			ok: !!c.health,
			fix: 'health:\n  interval: 10\n  reset_on_check: false'
		},
		{
			key: 'mqtt_log',
			// Z2M 2.x always publishes bridge/logging and dropped 'mqtt' from log_output
			ok: parseInt(info.version) >= 2 || (Array.isArray(c.advanced?.log_output) && c.advanced.log_output.includes('mqtt')),
			fix: 'advanced:\n  log_output: [console, file, mqtt]\n  log_level: info'
		}
	];
}
