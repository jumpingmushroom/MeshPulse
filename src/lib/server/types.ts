import { MinuteCounters } from './trends/minutes';

export type Severity = 'info' | 'warning' | 'critical';

export interface DeviceState {
	ieee: string;
	friendlyName: string;
	type: 'Coordinator' | 'Router' | 'EndDevice';
	powerSource: string | null;
	model: string | null;
	vendor: string | null;
	firmware: string | null;
	networkAddress: number | null;
	availability: 'online' | 'offline' | null;
	lastSeenAt: number | null;
	removedAt: number | null;
	mutedUntil: number | null;
	tags: string[];
	ignoreRules: string[];
	typicalGapMs: number | null;
	maxVoltage: number | null;
	lqi: number | null;
	battery: number | null;
	voltage: number | null;
	batteryLow: boolean | null;
	/** user override; null = use the built-in table */
	batteryType: string | null;
	batteryCells: number | null;
	recentSeen: number[];
	lastSampleAt: number | null;
	offlineSince: number | null;
}

export interface BridgeState {
	state: 'online' | 'offline' | null;
	onlineSince: number | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	info: Record<string, any> | null;
	version: string | null;
	permitJoin: boolean;
	permitJoinSince: number | null;
	lastUptimeSec: number | null;
	lastLiveAt: number | null;
	/** last live message on a device topic: Z2M's own health/log/availability traffic does not prove the mesh works */
	lastDeviceAt: number | null;
	/** start of the current run of device messages (no gap of 2 min or more) */
	deviceSince: number | null;
	/** end and length of the last gap in device messages of 2 min or more */
	silenceEndedAt: number | null;
	silenceMs: number;
	restartedAt: number | null;
}

export interface MonitorState {
	connected: boolean;
	downSince: number | null;
	connectedAt: number | null;
	startedAt: number;
	lastRulesRunAt: number | null;
	lastError: string | null;
}

export interface MqttMsg {
	ts: number;
	topic: string;
	payload: unknown;
	retain: boolean;
}

export interface AppState {
	devices: Map<string, DeviceState>;
	byName: Map<string, string>;
	devicesLoaded: boolean;
	pending: MqttMsg[];
	bridge: BridgeState;
	monitor: MonitorState;
	/** live messages per device per hour, key `${ieee}|${hourStart}`; drained by rollupHours */
	msgCounts: Map<string, number>;
	/** live device messages per minute (not persisted) */
	minutes: MinuteCounters;
	/** last bridge/health counters per device; null until the first sample */
	lastHealth: Record<string, { leaves: number; addr: number }> | null;
	/** UniFi poller status (not persisted) */
	wifi: { lastOkAt: number | null; failures: number; lastError: string | null };
}

export type EventKind =
	| 'availability'
	| 'bridge_state'
	| 'bridge_restart'
	| 'bridge_version'
	| 'device_joined'
	| 'device_leave'
	| 'device_announce'
	| 'device_interview'
	| 'battery_swap'
	| 'route_error'
	| 'leave_count_up'
	| 'address_changed'
	| 'wifi_channel';

export interface NewEvent {
	ts: number;
	ieee: string | null;
	kind: EventKind;
	detail: Record<string, unknown>;
}

export type Effect =
	| { kind: 'event'; event: NewEvent }
	| { kind: 'sample'; ieee: string; ts: number; lqi: number | null; battery: number | null; voltage: number | null }
	| { kind: 'health'; ts: number; uptimeSec: number | null; mqttQueued: number | null; devices: Record<string, { leaves: number; addr: number }> }
	| { kind: 'dirty'; ieee: string };

export function createState(now: number): AppState {
	return {
		devices: new Map(),
		byName: new Map(),
		devicesLoaded: false,
		pending: [],
		bridge: {
			state: null,
			onlineSince: null,
			info: null,
			version: null,
			permitJoin: false,
			permitJoinSince: null,
			lastUptimeSec: null,
			lastLiveAt: null,
			lastDeviceAt: null,
			deviceSince: null,
			silenceEndedAt: null,
			silenceMs: 0,
			restartedAt: null
		},
		monitor: { connected: false, downSince: null, connectedAt: null, startedAt: now, lastRulesRunAt: null, lastError: null },
		msgCounts: new Map(),
		minutes: new MinuteCounters(),
		lastHealth: null,
		wifi: { lastOkAt: null, failures: 0, lastError: null }
	};
}
