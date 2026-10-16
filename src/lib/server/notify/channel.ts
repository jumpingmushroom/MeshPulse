import type { IssueRow, NotifyKind } from '../issues/lifecycle';
import type { DeviceState, Severity } from '../types';
import { formatDuration } from '../../views';

export interface Message {
	severity: Severity | 'resolved';
	title: string;
	summary: string;
	action?: string;
	fields: { name: string; value: string }[];
	url?: string;
	kind: NotifyKind | 'digest';
	/** overrides the per-kind @here rule (folded bursts) */
	mention?: boolean;
}

export class ChannelError extends Error {
	constructor(message: string, public retryAfterMs?: number) {
		super(message);
	}
}

export interface Channel {
	kind: string;
	send(config: Record<string, unknown>, message: Message, fetchFn?: typeof fetch): Promise<void>;
}

export const SEVERITY_LABEL: Record<Severity, string> = { info: 'Info', warning: 'Warning', critical: 'Critical' };

export function toMessage(issue: IssueRow, kind: NotifyKind, device: DeviceState | null, publicUrl?: string, tz?: string): Message {
	const fields: Message['fields'] = [];
	if (device) {
		fields.push({ name: 'Device', value: device.friendlyName });
		if (device.lqi !== null) fields.push({ name: 'LQI', value: String(device.lqi) });
		const battery = [device.battery !== null && `${device.battery}%`, device.voltage !== null && `${device.voltage} V`].filter(Boolean).join(' / ');
		if (battery) fields.push({ name: 'Battery', value: battery });
		if (device.lastSeenAt !== null)
			fields.push({ name: 'Last seen', value: new Date(device.lastSeenAt).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) });
	}
	const url = publicUrl ? `${publicUrl.replace(/\/+$/, '')}/issues/${issue.id}` : undefined;
	if (kind === 'resolved') {
		const ms = issue.evidence.durationMs;
		return { severity: 'resolved', kind, title: `Resolved: ${issue.summary}`, fields, url,
			summary: typeof ms === 'number' ? `${issue.summary}, resolved after ${formatDuration(ms)}` : issue.summary };
	}
	const note = kind === 'escalate' ? 'Escalated. ' : kind === 'reminder' ? 'Reminder: still open. ' : '';
	return { severity: issue.severity, kind, title: `${SEVERITY_LABEL[issue.severity]}: ${issue.summary}`, summary: note + issue.summary,
		action: issue.action || undefined, fields, url };
}
