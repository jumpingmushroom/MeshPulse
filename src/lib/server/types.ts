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
	restartedAt: number | null;
}

export interface MonitorState {
	connected: boolean;
	downSince: number | null;
	connectedAt: number | null;
	startedAt: number;
	lastRulesRunAt: number | null;
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
	| 'battery_swap';

export interface NewEvent {
	ts: number;
	ieee: string | null;
	kind: EventKind;
	detail: Record<string, unknown>;
}

export type Effect =
	| { kind: 'event'; event: NewEvent }
	| { kind: 'sample'; ieee: string; ts: number; lqi: number | null; battery: number | null; voltage: number | null }
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
			restartedAt: null
		},
		monitor: { connected: false, downSince: null, connectedAt: null, startedAt: now, lastRulesRunAt: null }
	};
}
