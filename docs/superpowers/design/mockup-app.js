<script type="text/x-dc" data-dc-script="" data-props="{&quot;scenario&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;healthy&quot;,&quot;attention&quot;,&quot;critical&quot;,&quot;stale&quot;,&quot;learning&quot;],&quot;default&quot;:&quot;attention&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;State&quot;},&quot;page&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;overview&quot;,&quot;devices&quot;,&quot;device&quot;,&quot;issues&quot;,&quot;issue&quot;,&quot;batteries&quot;,&quot;events&quot;,&quot;map&quot;,&quot;settings&quot;,&quot;login&quot;],&quot;default&quot;:&quot;overview&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;State&quot;},&quot;theme&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;auto&quot;,&quot;dark&quot;,&quot;light&quot;],&quot;default&quot;:&quot;dark&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;Look&quot;}}">
const TZ = 'Europe/Oslo';
const NOW = Date.UTC(2026, 9, 18, 12, 12, 0); // Sun 18 Oct 2026, 14:12 Oslo
const fT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fDM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
const fDMY = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const fWd = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });
const MIN_TODAY = 14 * 60 + 12;
const at = m => new Date(NOW - m * 60000);
const when = m => m <= MIN_TODAY ? 'Today ' + fT.format(at(m)) : m <= MIN_TODAY + 1440 ? 'Yesterday ' + fT.format(at(m)) : fDM.format(at(m)) + ', ' + fT.format(at(m));
const ago = m => m == null ? 'never' : m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' d ago';
const dur = m => { if (m < 60) return m + ' min'; if (m < 2880) { const h = Math.floor(m / 60), r = m % 60; return r ? h + ' h ' + r + ' min' : h + ' h'; } const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return h ? d + ' d ' + h + ' h' : d + ' d'; };
function rng(seed) { let s = (seed * 9301 + 49297) % 233280 + 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const SEV = {
  critical: { label: 'Critical', cls: 'is-crit', icon: '#i-crit', rank: 0, pts: 25 },
  warning: { label: 'Warning', cls: 'is-warn', icon: '#i-warn', rank: 1, pts: 8 },
  info: { label: 'Info', cls: 'is-info', icon: '#i-info', rank: 2, pts: 1 },
};
const RULES = { bridge_offline: 'Bridge offline', bridge_restarted: 'Bridge restarted', permit_join: 'Permit join left open', mqtt_lost: 'MeshPulse lost MQTT', offline: 'Device offline', silent: 'Device silent too long', flapping: 'Device flapping', battery_low: 'Battery low', battery_critical: 'Battery critical', weak_link: 'Weak link', degrading_link: 'Degrading link', route_failures: 'Route failures', network_route_errors: 'Network route errors', battery_forecast: 'Battery forecast', rejoin_churn: 'Rejoin churn', device_left: 'Device left', network_churn: 'Network churn', message_storm: 'Message storm', dominant_device: 'Dominant device', network_storm: 'Network storm', battery_instability: 'Battery causing instability', mass_offline: 'Mass offline', router_impact: 'Router offline impact' };
const KINDS = {
  availability: { label: 'Availability', icon: '#i-signal' }, join: { label: 'Join', icon: '#i-plus' }, leave: { label: 'Leave', icon: '#i-minus' },
  announce: { label: 'Announce', icon: '#i-broadcast' }, route_error: { label: 'Route error', icon: '#i-route' }, delivery_error: { label: 'Delivery error', icon: '#i-route' },
  battery_swap: { label: 'Battery swap', icon: '#i-battery' }, bridge: { label: 'Bridge', icon: '#i-restart' },
};
const RANGES = { '24h': { n: 48, step: 30, every: 12, fmt: d => fT.format(new Date(Math.floor(d / 3600000) * 3600000)) }, '7d': { n: 84, step: 120, every: 12, fmt: d => fWd.format(d) }, '30d': { n: 60, step: 720, every: 14, fmt: d => fDM.format(d) } };
const HALL_KIDS = ['Hall temperature sensor', 'Front door contact', 'Hall motion sensor', 'Stairs temperature sensor', 'Stairs door contact', 'Hallway upstairs motion sensor'];

function buildDevices(s) {
  const r = rng(42);
  const rooms = ['Hall', 'Kitchen', 'Living room', 'Dining room', 'Bedroom', 'Kids room', 'Guest room', 'Bathroom', 'Office', 'Garage', 'Laundry', 'Attic', 'Basement', 'Porch', 'Stairs', 'Hallway upstairs', 'Garden shed', 'Utility room', 'Sauna'];
  const D = [];
  const add = o => { o.id = 'd' + D.length; o.idx = D.length; D.push(o); return o; };
  add({ name: 'Coordinator', type: 'Coordinator', model: 'SLZB-06M', vendor: 'SMLIGHT', power: 'Mains (PoE)' });
  rooms.forEach(rm => { add({ name: rm + ' plug', type: 'Router', model: 'TS011F', vendor: 'Tuya', power: 'Mains' }); add({ name: rm + ' ceiling bulb', type: 'Router', model: 'LED2109G6', vendor: 'IKEA', power: 'Mains' }); });
  const kinds = [['temperature sensor', 'WSDCGQ11LM', 'Aqara', 'CR2032'], ['door contact', 'MCCGQ11LM', 'Aqara', 'CR1632'], ['motion sensor', 'RTCGQ11LM', 'Aqara', 'CR2450'], ['radiator thermostat', 'TS0601', 'Tuya', '2× AA'], ['remote', 'E1743', 'IKEA', 'CR2032'], ['leak sensor', 'SJCGQ11LM', 'Aqara', 'CR2032']];
  let n = 0;
  outer: for (const k of kinds) for (const rm of rooms) { if (n >= 101) break outer; add({ name: rm + ' ' + k[0], type: 'End device', model: k[1], vendor: k[2], power: 'Battery', cell: k[3], kind: k[0] }); n++; }
  const ren = { 'Bathroom temperature sensor': 'Bad sensor', 'Laundry radiator thermostat': 'Laundry floor thermostat, 2nd floor bathroom', 'Hall door contact': 'Front door contact' };
  let unknownRemotes = 0;
  for (const d of D) {
    if (ren[d.name]) d.name = ren[d.name];
    const R = d.type === 'Router', C = d.type === 'Coordinator';
    d.battery = d.power === 'Battery';
    d.avail = 'online';
    d.lastSeen = C ? 0 : R ? Math.floor(r() * 3) : Math.floor(r() * 48) + 1;
    d.lqi = C ? null : R ? 130 + Math.floor(r() * 105) : 70 + Math.floor(r() * 120);
    d.lqiAvg = d.lqi && clamp(d.lqi + Math.round((r() - 0.5) * 14), 0, 255);
    d.lqiBase = d.lqi && clamp(d.lqi + Math.round((r() - 0.4) * 12), 0, 255);
    d.mph = C ? 1840 : R ? 14 + Math.floor(r() * 60) : 2 + Math.floor(r() * 20);
    d.score = C ? 100 : 88 + Math.floor(r() * 13);
    d.rejoins = 0;
    if (d.battery) {
      d.batt = 45 + Math.floor(r() * 56);
      const aa = d.cell === '2× AA';
      d.volt = aa ? 2.4 + d.batt / 100 * 0.8 : 2.72 + d.batt / 100 * 0.43;
      d.days = r() < 0.08 ? null : 45 + Math.floor(r() * 520);
      d.swapMin = Math.floor((25 + r() * 320) * 1440);
      if (d.kind === 'remote' && unknownRemotes < 2) { unknownRemotes++; d.avail = 'unknown'; d.lastSeen = null; d.lqi = null; d.lqiAvg = null; d.days = null; d.mph = 0; }
    }
  }
  const by = nm => D.find(d => d.name === nm);
  const set = (nm, o) => Object.assign(by(nm), o);
  set('Porch motion sensor', { batt: 22, volt: 2.82, days: 19, swapMin: 290 * 1440 });
  set('Kitchen door contact', { batt: 27, volt: 2.85, days: 26 });
  set('Kids room remote', { batt: 24, volt: 2.83, days: 12 });
  set('Bad sensor', { batt: 46, volt: 2.93, days: 128, swapMin: 167 * 1440, lqi: 108, lqiAvg: 104, lqiBase: 112, mph: 9 });
  set('Garage door contact', { lqi: 88, lqiAvg: 90, lqiBase: 92 });
  if (s === 'attention' || s === 'critical') {
    set('Bad sensor', { batt: 18, volt: 2.71, days: 6, score: 61, rejoins: 4, lastSeen: 2, lqi: 71, lqiAvg: 77, mph: 24 });
  }
  if (s === 'attention') {
    set('Garage door contact', { lqi: 24, lqiAvg: 27, lqiBase: 92, score: 68, lastSeen: 14 });
    set('Laundry floor thermostat, 2nd floor bathroom', { score: 57, lastSeen: 31 });
  }
  if (s === 'critical') {
    set('Hall plug', { avail: 'offline', lastSeen: 11, score: 40 });
    HALL_KIDS.forEach((nm, i) => set(nm, { avail: 'offline', lastSeen: 9 + i % 3, score: 55 }));
  }
  if (s === 'stale') D.forEach(d => { if (d.lastSeen != null) d.lastSeen += 6; });
  if (s === 'learning') D.forEach(d => { d.lqiBase = null; d.score = null; if (d.battery) d.days = null; if (d.type !== 'Coordinator') d.avail = 'unknown'; d.lqiAvg = d.lqi; });
  return D;
}

function buildIssues(s, by) {
  const L = [];
  const mk = o => { o.state = o.state || 'open'; L.push(o); return o; };
  const hist = () => {
    mk({ id: 'r1', sev: 'warning', rule: 'offline', dev: 'Hall plug', title: 'Hall plug is offline', act: 'Check power to the router', actionLong: 'Check power to the router. If it is on, re-pair it — end devices that routed through it will follow.', opened: 2 * 1440 + 1219, resolved: 2 * 1440 + 1214, state: 'resolved', ev: [['Availability', 'offline'], ['Offline since', '16 Oct, 17:53'], ['Offline for', '5 min'], ['Offline grace', '15 min (router: 2 min)']] });
    mk({ id: 'r2', sev: 'warning', rule: 'battery_low', dev: 'Kids room remote', title: 'Replace battery in Kids room remote: 21 %', act: 'Replace the battery', actionLong: 'Replace the battery (CR2032).', opened: 9 * 1440, resolved: 8 * 1440 + 300, state: 'resolved', ev: [['Battery', '21 %'], ['Threshold', 'below 25 %']] });
    mk({ id: 'r3', sev: 'critical', rule: 'bridge_offline', title: 'Zigbee bridge was offline for 4 min', act: 'Check the Zigbee2MQTT container', actionLong: 'Check the Zigbee2MQTT container and the coordinator connection.', opened: 4 * 1440 + 200, resolved: 4 * 1440 + 196, state: 'resolved', ev: [['Bridge state', 'offline'], ['Offline for', '4 min']] });
    mk({ id: 'r4', sev: 'warning', rule: 'permit_join', title: 'Permit join was left open for 14 min', act: 'Close permit join in Zigbee2MQTT', actionLong: 'Close permit join in Zigbee2MQTT when you are done pairing.', opened: 6 * 1440 + 90, resolved: 6 * 1440 + 76, state: 'resolved', ev: [['Open for', '14 min'], ['Limit', '10 min']] });
    mk({ id: 'r5', sev: 'warning', rule: 'degrading_link', dev: 'Office ceiling bulb', title: 'Office ceiling bulb link is degrading: LQI 61 (baseline 148)', act: 'Check for new interference near the office', actionLong: 'Check for new interference near the office — a moved Wi-Fi router or USB 3 device.', opened: 12 * 1440, resolved: 11 * 1440, state: 'resolved', ev: [['LQI 24 h avg', '61'], ['Baseline', '148'], ['Drop', '59 %']] });
  };
  if (s === 'attention' || s === 'critical') {
    mk({ id: 'a1', sev: 'warning', rule: 'battery_low', dev: 'Bad sensor', title: 'Replace battery in Bad sensor: 18 % / 2.71 V, rejoined 4 times today', act: 'Replace the battery', actionLong: 'Replace the battery (CR2032). The rejoins usually stop once the voltage is back above 2.9 V.', opened: 47, metric: 'batt', ev: [['Battery', '18 %'], ['Voltage', '2.71 V'], ['Threshold', 'Battery low below 25 %'], ['Rejoins today', '4 (last Today 13:31)'], ['Forecast', 'About 6 days until 10 %'], ['Last swap', '4 May 2026 · 5 months ago']] });
  }
  if (s === 'attention') {
    mk({ id: 'a2', sev: 'warning', rule: 'weak_link', dev: 'Garage door contact', title: 'Weak link: Garage door contact at LQI 24 (baseline 92)', act: 'Add or move a router between the garage and the hall', actionLong: 'Add a router between the garage and the hall, or move the Garage plug closer to the door. Metal doors absorb a lot of signal.', opened: 185, metric: 'lqi', ev: [['LQI now', '24'], ['24 h average', '27'], ['7-day baseline', '92'], ['Weak below', '30'], ['Below threshold for', '2 h 40 min'], ['Parent router', 'Garage plug']] });
    mk({ id: 'a3', sev: 'warning', rule: 'flapping', dev: 'Laundry floor thermostat, 2nd floor bathroom', title: 'Laundry floor thermostat, 2nd floor bathroom is flapping: dropped 5 times in 6 h', act: 'Check its signal — it may sit at the edge of the mesh', actionLong: 'It may sit at the edge of the mesh. A router in the laundry room usually fixes this.', opened: 262, state: 'acknowledged', acked: 205, metric: 'lqi', ev: [['Drops in window', '5'], ['Window', '6 h'], ['Flapping at', '4 drops'], ['Last drop', 'Today 13:40, back after 3 min']] });
    mk({ id: 'a4', sev: 'info', rule: 'bridge_restarted', title: 'Zigbee2MQTT restarted at 09:14', act: 'Nothing to do if you restarted it', actionLong: 'Nothing to do if you restarted it. More than 3 restarts in a day raises a warning.', opened: 298, ev: [['Version', '2.1.0'], ['Uptime before restart', '6 d 3 h'], ['Restarts today', '1 of 3']] });
  }
  if (s === 'critical') {
    mk({ id: 'c1', sev: 'critical', rule: 'bridge_offline', title: 'Zigbee bridge is offline', act: 'Check the Zigbee2MQTT container, then the coordinator', actionLong: 'Check the Zigbee2MQTT container on Unraid, then the coordinator (SLZB-06M) network link. Device data stops until the bridge is back.', opened: 3, ev: [['Bridge state', 'offline (MQTT last will)'], ['Last bridge message', 'Today 14:09'], ['Offline for', '3 min'], ['Restarts today', '0']] });
    const kids = [mk({ id: 'k0', parent: 'c2', sev: 'warning', rule: 'offline', dev: 'Hall plug', title: 'Hall plug is offline', act: 'Check power', actionLong: 'Check power to the router.', opened: 11, ev: [['Offline since', 'Today 14:01']] })];
    HALL_KIDS.forEach((nm, i) => kids.push(mk({ id: 'k' + (i + 1), parent: 'c2', sev: 'warning', rule: 'silent', dev: nm, title: nm + ' went silent', act: 'Will rejoin when Hall plug is back', actionLong: 'It should rejoin on its own once Hall plug is back.', opened: 9 + i % 3, ev: [['Last seen', 'Today 14:0' + (3 - i % 3)]] })));
    mk({ id: 'c2', sev: 'critical', rule: 'router_impact', dev: 'Hall plug', title: 'Router Hall plug offline: 6 sensors went silent', act: 'Check power to Hall plug', actionLong: 'Check power to Hall plug — someone may have switched it off at the wall. The 6 sensors that route through it rejoin by themselves within ~15 min of it coming back.', opened: 11, children: kids.map(k => k.id), ev: [['Router', 'Hall plug (offline since 14:01)'], ['End devices gone silent', '6 within 5 min'], ['Last LQI', '142'], ['Window', '5 min']] });
  }
  if (s === 'stale') {
    mk({ id: 's1', sev: 'critical', rule: 'mqtt_lost', title: 'MeshPulse lost its MQTT connection', act: 'Check the MQTT broker is running', actionLong: 'Check that the MQTT broker (Mosquitto) is running and reachable from MeshPulse. Everything else is frozen at 14:06 until it reconnects.', opened: 6, ev: [['Broker', 'mqtt://192.168.1.20:1883'], ['Last message', 'Today 14:06:12'], ['Reconnect attempts', '37'], ['Last error', 'ECONNREFUSED']] });
  }
  hist();
  return L;
}

function series(seed, n, base, spread) { const r = rng(seed); let v = base; const out = []; for (let i = 0; i < n; i++) { v += (r() - 0.5) * spread; v = v * 0.8 + base * 0.2; out.push(v); } return out; }

function mkChart(o) {
  const L = 34, R = 592, T = 8, B = 146, n = o.vals.length;
  const x = i => L + (R - L) * i / (n - 1), y = v => B - (B - T) * (v - o.ymin) / (o.ymax - o.ymin);
  const f = v => v.toFixed(1);
  let line = '', pen = false;
  o.vals.forEach((v, i) => { if (v == null) { pen = false; return; } line += (pen ? 'L' : 'M') + f(x(i)) + ' ' + f(y(v)) + ' '; pen = true; });
  if (line.split('M').length - 1 === 1 && o.vals.filter(v => v != null).length === 1) { const i = o.vals.findIndex(v => v != null); line += 'L' + f(x(i) + 0.1) + ' ' + f(y(o.vals[i])); }
  let band = '';
  if (o.min) { let seg = []; const flush = () => { if (seg.length > 1) band += 'M' + seg.map(i => f(x(i)) + ' ' + f(y(o.max[i]))).join(' L') + ' L' + seg.slice().reverse().map(i => f(x(i)) + ' ' + f(y(o.min[i]))).join(' L') + ' Z '; seg = []; }; o.vals.forEach((v, i) => { if (v == null) flush(); else seg.push(i); }); flush(); }
  const gaps = []; const first = o.vals.findIndex(v => v != null);
  let gs = -1; o.vals.forEach((v, i) => { if (i < first) return; if (v == null && gs < 0) gs = i; if (v != null && gs >= 0) { gaps.push({ x: f(x(gs - 1)), w: f(x(i) - x(gs - 1)) }); gs = -1; } });
  const grid = o.yt.map(v => 'M' + L + ' ' + f(y(v)) + ' H' + R).join(' ');
  const rc = RANGES[o.range];
  const xt = []; for (let i = n - 1 - rc.every; i >= 0; i -= rc.every) xt.unshift({ x: f(x(i)), label: rc.fmt(new Date(NOW - (n - 1 - i) * rc.step * 60000)) });
  const refs = (o.refs || []).map(rf => ({ y: f(y(rf.v)), ly: f(y(rf.v) - 4), label: rf.label, cls: rf.cls, tcls: rf.cls === 'ref' ? 'ref-label' : 'thr-label' }));
  const legend = [{ cls: '', label: o.lineLabel || 'Average' }];
  if (o.min) legend.push({ cls: 'band', label: 'Min–max' });
  (o.refs || []).forEach(rf => legend.push({ cls: rf.cls === 'ref' ? 'ref' : 'thr', label: rf.legend || rf.label }));
  if (gaps.length) legend.push({ cls: 'gap', label: 'No data (line breaks)' });
  (o.extraLegend || []).forEach(l => legend.push(l));
  return { title: o.title, now: o.now, nowSub: o.nowSub || '', cls: o.wide ? 'chart-wide' : '', empty: false, hasData: true, line, band, gaps, grid, yt: o.yt.map(v => ({ y: f(y(v) + 3), label: o.ytFmt ? o.ytFmt(v) : v })), xt, refs, legend, summary: o.summary };
}
const emptyChart = (title, text, wide) => ({ title, now: '—', nowSub: '', cls: wide ? 'chart-wide' : '', empty: true, hasData: false, emptyText: text, gaps: [], yt: [], xt: [], refs: [], legend: [] });

function deviceCharts(d, s, range, learning) {
  const rc = RANGES[range], n = rc.n, seed = d.idx * 13 + n;
  const keep = learning ? (range === '24h' ? 4 : 1) : n;
  const mask = arr => arr.map((v, i) => i < n - keep ? null : v);
  const out = [];
  if (d.type !== 'Coordinator') {
    if (d.lqi == null && !learning) out.push(emptyChart('Link quality (LQI)', d.name + ' has never reported. Remotes only talk when pressed.', true));
    else {
      let avg = series(seed, n, d.lqiBase || d.lqiAvg || 120, 22);
      if (d.name === 'Garage door contact' && s === 'attention') avg = avg.map((v, i) => i > n * 0.72 ? 22 + (v % 9) : v - (i / n) * 10);
      if (d.name === 'Bad sensor' && (s === 'attention' || s === 'critical')) avg = avg.map((v, i) => v - (i / n) * 30);
      const r = rng(seed + 3); const mn = avg.map(v => clamp(v - 6 - r() * 18, 0, 255)), mx = avg.map(v => clamp(v + 5 + r() * 16, 0, 255));
      let vals = avg.map(v => Math.round(v));
      const gapAt = d.name === 'Bad sensor' && s !== 'healthy' && !learning ? [Math.floor(n * 0.55), Math.floor(n * 0.82)] : d.name.startsWith('Laundry floor') && s === 'attention' ? [Math.floor(n * 0.4), Math.floor(n * 0.62), Math.floor(n * 0.86)] : [];
      gapAt.forEach(g => { vals[g] = null; vals[g + 1] = null; });
      if (d.avail === 'offline') vals[n - 1] = null;
      if (learning) vals = mask(vals);
      const real = vals.filter(v => v != null); const lo = Math.min(...real), hi = Math.max(...real), av = Math.round(real.reduce((a, b) => a + b, 0) / real.length);
      const refs = []; if (d.lqiBase) refs.push({ v: d.lqiBase, cls: 'ref', label: '7-day baseline ' + d.lqiBase }); refs.push({ v: 30, cls: 'thr', label: 'Weak 30', legend: 'Weak threshold (30)' });
      out.push(mkChart({ title: 'Link quality (LQI)', now: d.lqi == null ? '—' : d.lqi, nowSub: 'now · 24 h avg ' + (d.lqiAvg ?? '—'), wide: true, range, vals, min: mn, max: mx, ymin: 0, ymax: 255, yt: [0, 50, 100, 150, 200, 250], refs, extraLegend: learning ? [{ cls: 'ref', label: 'Baseline: learning (needs 3 days)' }] : [],
        summary: `Link quality over the last ${range}: average ${av}, ranging ${lo} to ${hi}.` + (d.lqiBase ? ` 7-day baseline ${d.lqiBase}.` : ' Baseline still learning.') + (lo < 30 ? ' Dropped below the weak threshold of 30.' : ' Stayed above the weak threshold of 30.') + (gapAt.length ? ` ${gapAt.length} gaps with no data.` : '') }));
    }
  }
  if (d.battery) {
    const span = range === '24h' ? 0.6 : range === '7d' ? 3 : 12;
    const steep = d.name === 'Bad sensor' && s !== 'healthy' ? 2.2 : 1;
    let pct = Array.from({ length: n }, (_, i) => d.batt + span * steep * (1 - i / (n - 1)) + (rng(seed + i)() - 0.5) * 1.2);
    if (learning) pct = mask(pct);
    const real = pct.filter(v => v != null);
    out.push(mkChart({ title: 'Battery', now: d.batt + ' %', nowSub: '', range, vals: pct.map(v => v == null ? null : Math.round(v)), ymin: 0, ymax: 100, yt: [0, 25, 50, 75, 100], lineLabel: 'Battery %', refs: [{ v: 25, cls: 'thr', label: 'Low 25 %' }, { v: 10, cls: 'thr thr-crit', label: 'Critical 10 %' }],
      summary: `Battery went from ${Math.round(real[0])} % to ${d.batt} % over the last ${range}. Low threshold 25 %, critical 10 %.` }));
    if (learning) out.push(emptyChart('Voltage', d.name + ' hasn\u2019t reported voltage since MeshPulse started. Sensors like this report every 1\u20136 h.'));
    else {
      const coin = d.cell !== '2× AA';
      const volt = pct.map(p => coin ? 2.72 + p / 100 * 0.43 + (rng(seed + p)() - 0.5) * 0.02 : 2.4 + p / 100 * 0.8);
      out.push(mkChart({ title: 'Voltage', now: d.volt.toFixed(2) + ' V', range, vals: volt, ymin: coin ? 2.5 : 2.2, ymax: coin ? 3.3 : 3.3, yt: coin ? [2.6, 2.8, 3.0, 3.2] : [2.4, 2.8, 3.2], ytFmt: v => v.toFixed(1), lineLabel: 'Voltage', refs: coin ? [{ v: 2.8, cls: 'thr', label: 'Coin cell low 2.8 V' }] : [],
        summary: `Voltage now ${d.volt.toFixed(2)} V.` + (coin ? ' Coin-cell low threshold 2.8 V.' : '') }));
    }
  }
  let m = series(seed + 9, n, d.mph || 1, Math.max(4, d.mph * 0.5)).map(v => Math.max(0, Math.round(v)));
  if (d.name === 'Bad sensor' && s !== 'healthy' && !learning) m = m.map((v, i) => i > n * 0.75 ? v + 18 : v);
  if (d.avail === 'offline') m[n - 1] = null;
  if (learning) m = mask(m);
  const mmax = Math.max(...m.filter(v => v != null), d.mph) * 1.4 || 10;
  const step = Math.max(1, Math.ceil(mmax / 4 / 5) * 5);
  out.push(mkChart({ title: 'Messages per hour', now: d.mph, nowSub: 'last hour', wide: !d.battery || learning ? true : true, range, vals: m, ymin: 0, ymax: step * 4, yt: [0, step, step * 2, step * 3, step * 4], lineLabel: 'Messages / h', refs: learning ? [] : [{ v: d.mph < 30 && d.name === 'Bad sensor' && s !== 'healthy' ? 8 : d.mph, cls: 'ref', label: 'Typical', legend: 'Typical for this device' }],
    summary: `Messages per hour over the last ${range}, currently ${d.mph}.` }));
  return out;
}

function deviceEvents(d, s, count) {
  const r = rng(d.idx * 31 + 5); const E = [];
  const push = (m, kind, text, detail, sev) => E.push({ m, kind, text, detail: detail || '', sev: sev || '' });
  if (s === 'critical' && (d.name === 'Hall plug' || HALL_KIDS.includes(d.name))) push(d.lastSeen, 'availability', 'Went offline', d.name === 'Hall plug' ? 'no response after 2 min' : 'silent since Hall plug dropped', 'is-crit');
  if ((s === 'attention' || s === 'critical') && d.name === 'Bad sensor') { [41, 77, 160, 402].forEach((m, i) => { push(m, 'announce', 'Rejoined the network', 'device announce, rejoin ' + (4 - i) + ' today', 'is-warn'); push(m + 2, 'delivery_error', 'Delivery failed', 'MAC no ACK after 3 retries', 'is-warn'); }); }
  if (s === 'attention' && d.name.startsWith('Laundry floor')) { [32, 95, 150, 210, 262].forEach(m => { push(m, 'availability', 'Back online', 'offline for 3 min', 'is-ok'); push(m + 3, 'availability', 'Went offline', '', 'is-crit'); }); }
  let m = 120;
  while (E.length < count) {
    m += Math.floor(200 + r() * 1400);
    const x = r();
    if (d.battery && E.length === count - 6) push(d.swapMin || m, 'battery_swap', 'Battery swapped', `${10 + Math.floor(r() * 20)} % → 100 %`, 'is-ok');
    else if (x < 0.35) push(m, 'availability', 'Back online', 'offline for ' + (2 + Math.floor(r() * 9)) + ' min', 'is-ok');
    else if (x < 0.55) push(m, 'announce', 'Announced', 'device announce');
    else if (x < 0.75) push(m, 'route_error', 'Route error', 'NWK route discovery failed via ' + (d.type === 'Router' ? 'Coordinator' : 'parent'));
    else if (x < 0.9) push(m, 'availability', 'Went offline', '', 'is-crit');
    else push(m, 'join', 'Interview completed', d.model + ' · ' + d.vendor);
  }
  return E.sort((a, b) => a.m - b.m).slice(0, count).map(e => ({ time: when(e.m), icon: KINDS[e.kind].icon, kind: KINDS[e.kind].label, sevCls: e.sev, text: e.text, detail: e.detail, m: e.m, k: e.kind }));
}

function buildMap(D, s) {
  const cx = 550, cy = 380, nodes = [], edges = [], pos = {};
  const routers = D.filter(d => d.type === 'Router'), ends = D.filter(d => d.type === 'End device');
  pos[D[0].id] = [cx, cy];
  routers.forEach((d, i) => { const ring = i < 22 ? 0 : 1; const k = ring ? i - 22 : i, tot = ring ? 16 : 22; const a = (k / tot) * Math.PI * 2 + (ring ? 0.2 : 0); const rr = ring ? 270 : 150; pos[d.id] = [cx + Math.cos(a) * rr * 1.25, cy + Math.sin(a) * rr]; d._parent = ring ? routers[Math.round(k / tot * 22) % 22] : D[0]; });
  const hall = routers.find(d => d.name === 'Hall plug');
  ends.forEach((d, i) => { let p = HALL_KIDS.includes(d.name) ? hall : routers[(i * 7) % 38]; d._parent = p; const pp = pos[p.id]; const a = Math.atan2(pp[1] - cy, pp[0] - cx) + ((i % 5) - 2) * 0.32; const rr = 38 + (i % 3) * 12; pos[d.id] = [pp[0] + Math.cos(a) * rr, pp[1] + Math.sin(a) * rr]; });
  const r1 = rng(9);
  [...routers, ...ends].forEach(d => { const a = pos[d.id], b = pos[d._parent.id]; const lqi = d.lqi ?? 0; const down = d.avail === 'offline'; edges.push({ x1: a[0].toFixed(0), y1: a[1].toFixed(0), x2: b[0].toFixed(0), y2: b[1].toFixed(0), cls: down ? 'e e-down' : lqi < 60 ? 'e e-weak' : 'e', title: `${d.name} → ${d._parent.name}: LQI ${d.lqi ?? '—'}` }); });
  D.forEach(d => { const p = pos[d.id]; const off = d.avail === 'offline'; const R = d.type === 'Coordinator' ? 14 : d.type === 'Router' ? 7 : 4.5; const rr = off ? R + 2 : R;
    nodes.push({ x: p[0].toFixed(0), y: p[1].toFixed(0), r: rr, cls: 'n ' + (off ? 'n-off' : d.type === 'Coordinator' ? 'n-coord' : d.type === 'Router' ? 'n-router' : ''), off, xd: `M${(p[0] - rr * 0.6).toFixed(0)} ${(p[1] - rr * 0.6).toFixed(0)} L${(p[0] + rr * 0.6).toFixed(0)} ${(p[1] + rr * 0.6).toFixed(0)} M${(p[0] + rr * 0.6).toFixed(0)} ${(p[1] - rr * 0.6).toFixed(0)} L${(p[0] - rr * 0.6).toFixed(0)} ${(p[1] + rr * 0.6).toFixed(0)}`,
      label: d.type === 'Coordinator' || off || (d.type === 'Router' && d.lqi < 145) ? d.name : '', lx: (p[0] + rr + 4).toFixed(0), ly: (p[1] + 3).toFixed(0), aria: `${d.name}, ${d.type}, ${d.avail}${d.lqi != null ? ', LQI ' + d.lqi : ''}`, id: d.id }); });
  return { nodes, edges };
}

class Component extends DCLogic {
  constructor(props) {
    super(props);
    const q = new URLSearchParams(location.search); this.q = q;
    this.state = { page: q.get('page') || props.page || 'overview', devId: q.get('id'), issueId: q.get('issue'), range: q.get('range') || '24h', sec: 3, fresh: false, sortKey: 'name', sortDir: 1, f: {}, search: '', density: 'compact', tab: q.get('tab') || 'open', acked: {}, muted: {}, muteChoice: '1h', ignored: {}, allEvents: false, evKind: 'all', evPage: 1, ruleF: 'all', sevF: 'all', copied: false, dTested: null };
    this.cache = {};
  }
  componentDidMount() { this.t = setInterval(() => { if (this.scen() === 'stale') return; this.setState(s => s.sec >= 14 ? { sec: 0, fresh: true } : { sec: s.sec + 1, fresh: false }); }, 1000); }
  componentWillUnmount() { clearInterval(this.t); }
  componentDidUpdate(pp) { if (pp.page !== this.props.page && this.props.page) this.setState({ page: this.props.page }); }
  scen() { return this.q.get('s') || this.props.scenario || 'attention'; }
  data(s) {
    if (this.cache[s]) return this.cache[s];
    const D = buildDevices(s); const by = nm => D.find(d => d.name === nm);
    const I = buildIssues(s, by);
    I.forEach(i => { i.device = i.dev ? by(i.dev) : null; });
    I.filter(i => i.state !== 'resolved' && i.device).forEach(i => { const d = i.device; d.issues = (d.issues || 0) + 1; if (d.worst == null || SEV[i.sev].rank < SEV[d.worst].rank) d.worst = i.sev; });
    return (this.cache[s] = { D, I, by, map: buildMap(D, s) });
  }
  renderVals() {
    const s = this.scen(), st = this.state, { D, I, by, map } = this.data(s);
    const learning = s === 'learning', stale = s === 'stale';
    const prevent = e => e.preventDefault();
    const nav = (page, extra) => e => { e && e.preventDefault && e.preventDefault(); this.setState(Object.assign({ page, allEvents: false }, extra || {})); window.scrollTo(0, 0); };
    const issState = i => st.acked[i.id] && i.state === 'open' ? 'acknowledged' : i.state;
    const unresolved = I.filter(i => i.state !== 'resolved' && !i.parent);
    const worst = unresolved.reduce((w, i) => w == null || SEV[i.sev].rank < SEV[w].rank ? i.sev : w, null);
    const scope = worst === 'critical' ? 'is-crit' : worst === 'warning' ? 'is-warn' : 'is-ok';
    const scoreVal = Math.max(0, 100 - unresolved.reduce((a, i) => a + SEV[i.sev].pts, 0));
    const byId = id => I.find(i => i.id === id);
    const issueView = i => { const sv = SEV[i.sev], stt = issState(i); const kids = (i.children || []).map(byId);
      return { id: i.id, sevCls: sv.cls, sevIcon: sv.icon, sevLabel: sv.label, title: i.title, act: i.act, hasDevice: !!i.device, deviceName: i.device && i.device.name, ruleLabel: RULES[i.rule], ago: stt === 'resolved' ? 'resolved ' + ago(i.resolved) : 'opened ' + ago(i.opened), stateLabel: stt === 'acknowledged' ? 'Acknowledged' : stt === 'resolved' ? 'Resolved' : 'Open', stateCls: stt === 'acknowledged' ? 'state-ack' : stt === 'resolved' ? 'state-resolved' : 'state-open',
        durText: stt === 'resolved' ? 'lasted ' + dur(i.opened - i.resolved) : '', open: nav('issue', { issueId: i.id }), openDevice: e => { e.stopPropagation(); nav('device', { devId: i.device.id })(e); },
        hasChildren: kids.length > 0, childSummary: kids.length ? `${kids.length} grouped issues: ${kids.filter(k => k.rule === 'offline').length} router offline, ${kids.filter(k => k.rule === 'silent').length} sensors silent` : '', childCount: kids.length,
        children: kids.map(k => ({ sevCls: SEV[k.sev].cls, sevIcon: SEV[k.sev].icon, sevLabel: SEV[k.sev].label, title: k.title, ago: ago(k.opened), open: nav('issue', { issueId: k.id }) })) }; };
    const sortIssues = L => L.slice().sort((a, b) => SEV[a.sev].rank - SEV[b.sev].rank || a.opened - b.opened);
    const openIssues = sortIssues(unresolved).map(issueView);
    const goKeys = ['overview', 'devices', 'batteries', 'issues', 'events', 'settings', 'map', 'login', 'device'];
    const go = {}; goKeys.forEach(k => go[k] = nav(k));

    const online = D.filter(d => d.avail === 'online').length, offline = D.filter(d => d.avail === 'offline').length;
    const routersOn = D.filter(d => d.type === 'Router' && d.avail === 'online').length;
    const due = D.filter(d => d.battery && d.days != null && d.days <= 30).sort((a, b) => a.days - b.days);
    const hasCrit = worst === 'critical';
    const navList = [['overview', 'Overview'], ['devices', 'Devices'], ['batteries', 'Batteries'], ['issues', 'Issues'], ['events', 'Events'], ['settings', 'Settings']].map(([k, label]) => {
      const cur = st.page === k || (k === 'devices' && (st.page === 'device' || st.page === 'map')) || (k === 'issues' && st.page === 'issue');
      const c = k === 'issues' ? unresolved.length : 0;
      return { label, current: cur ? 'page' : undefined, go: nav(k), hasCount: c > 0, count: c, countCls: scope, countAria: c + ' unresolved' };
    });

    const banner = stale ? { cls: 'is-crit', icon: '#i-unlink', kicker: 'Critical', title: 'MeshPulse can\u2019t reach MQTT', sub: 'Nothing below is live. Last update 14:06 (6 min ago). Check that Mosquitto is running.' }
      : worst === 'critical' ? { cls: 'is-crit', icon: '#i-crit', kicker: 'Critical', title: 'Zigbee bridge is offline, and router Hall plug took 6 sensors with it', sub: `${unresolved.filter(i => i.sev === 'critical').length} critical issues and ${unresolved.filter(i => i.sev === 'warning').length} warning. Start with the bridge — device data stops until it\u2019s back.` }
      : worst ? { cls: 'is-warn', icon: '#i-warn', kicker: 'Needs attention', title: `${unresolved.length} unresolved issues`, sub: `Nothing critical. Start with: ${openIssues[0].act.toLowerCase()} in ${openIssues[0].deviceName}.` }
      : learning ? { cls: 'is-ok', icon: '#i-ok', kicker: '', title: 'All good', sub: 'MeshPulse started 2 h ago and found 140 devices. Baselines, health scores and battery forecasts need 3 days of history.' }
      : { cls: 'is-ok', icon: '#i-ok', kicker: '', title: 'All good', sub: '140 devices, nothing needs you. The last issue resolved 2 days ago.' };
    const C = 2 * Math.PI * 31;
    const score = { value: learning ? '—' : scoreVal, dash: `${(C * (learning ? 0 : scoreVal) / 100).toFixed(1)} ${C.toFixed(1)}`, word: learning ? 'Learning' : scoreVal >= 90 ? 'Healthy' : scoreVal >= 60 ? 'Fair' : 'Poor', aria: learning ? 'Health score not available yet' : `Health score ${scoreVal} of 100` };

    const tiles = {
      dev: learning ? { value: '—', sub: 'Availability not enabled', icon: '#i-info', cls: 'has-sev is-info' } : offline ? { value: online, sub: `${offline} offline · 2 unknown`, icon: '#i-crit', cls: 'has-sev is-crit' } : { value: online, sub: '2 unknown — remotes that rarely talk', cls: '' },
      rt: learning ? { value: '—', sub: 'Availability not enabled', cls: '' } : routersOn < 38 ? { value: routersOn, sub: 'Hall plug offline', icon: '#i-crit', cls: 'has-sev is-crit' } : { value: routersOn, sub: 'All routers up', cls: '' },
      bat: learning ? { value: '—', sub: 'Forecasts after 3 days', cls: '' } : { value: due.length, sub: `Soonest: ${due[0].name}, ${due[0].days} days`, icon: due[0].days <= 7 ? '#i-warn' : '', cls: due[0].days <= 7 ? 'has-sev is-warn' : '' },
    };
    const mr = rng(77); const mN = 96; const mv = []; for (let i = 0; i < mN; i++) { const hr = (i / 4 + 14) % 24; const base = hr > 6 && hr < 9 ? 210 : hr > 17 && hr < 23 ? 175 : hr < 6 ? 95 : 140; mv.push(base + (mr() - 0.5) * 50 + (i === 70 ? 120 : 0)); }
    const mStart = learning ? mN - 8 : 0; const mx = i => (i / (mN - 1) * 300).toFixed(1), my = v => (42 - v / 360 * 40).toFixed(1);
    const mSlice = mv.map((v, i) => i < mStart ? null : (stale && i > mN - 2) ? null : v);
    let mLine = ''; let pen = false; mSlice.forEach((v, i) => { if (v == null) { pen = false; return; } mLine += (pen ? 'L' : 'M') + mx(i) + ' ' + my(v) + ' '; pen = true; });
    const lastI = stale ? mN - 2 : mN - 1;
    const msgs = { now: stale ? '—' : '142/min', line: mLine, area: mLine ? mLine + `L${mx(lastI)} 44 L${mx(mStart)} 44 Z` : '', sub: learning ? 'Only 2 h of history so far' : stale ? 'Frozen at 14:06' : '24 h · peak 312/min at 07:30 · quietest 03:00', aria: 'Messages per minute over 24 hours, currently 142, peak 312 at 07:30.' };
    const statusline = [
      hasCrit ? { cls: 'bad', icon: '#i-crit', text: 'Bridge offline since 14:09' } : { cls: 'ok', icon: '#i-ok', text: 'Bridge online' },
      { text: 'Zigbee2MQTT 2.1.0' }, { text: hasCrit ? 'was up 6 d 3 h' : learning ? 'up 2 h 4 min' : 'up 5 h 58 min' }, { text: 'Channel 15' }, { text: 'Coordinator zStack3x0 · SLZB-06M' },
      stale ? { cls: 'bad', icon: '#i-unlink', text: 'MQTT disconnected' } : { cls: 'ok', icon: '#i-ok', text: 'MQTT connected' },
      { icon: '#i-clock', text: stale ? 'Last update 14:06:12' : 'Last update 14:12:0' + (st.sec % 10) },
    ];
    const upd = stale ? { cls: 'is-stale', text: 'Stale · last update 14:06' } : { cls: st.fresh ? 'is-fresh' : '', text: st.sec === 0 ? 'Updated just now' : `Updated ${st.sec} s ago` };

    // Devices
    const f = st.f; const q = st.search.trim().toLowerCase();
    const keyF = { name: d => d.name.toLowerCase(), type: d => d.type, avail: d => ({ offline: 0, unknown: 1, online: 2 })[d.avail], lastSeen: d => d.lastSeen ?? 1e9, lqi: d => d.lqi ?? -1, batt: d => d.batt ?? 999, mph: d => d.mph, score: d => d.score ?? 999, issues: d => d.issues || 0 }[st.sortKey];
    const rowsD = D.filter(d => (!f.routers || d.type === 'Router') && (!f.battery || d.battery) && (!f.offline || d.avail === 'offline') && (!f.issues || d.issues) && (!q || d.name.toLowerCase().includes(q)))
      .sort((a, b) => { const x = keyF(a), y = keyF(b); return (x < y ? -1 : x > y ? 1 : 0) * st.sortDir; });
    const typeIcon = t => t === 'Coordinator' ? '#i-cpu' : t === 'Router' ? '#i-plug' : '#i-sensor';
    const availV = d => d.avail === 'online' ? ['avail-online', '#i-ok', 'Online'] : d.avail === 'offline' ? ['avail-offline', '#i-x', 'Offline'] : ['avail-unknown', '#i-unknown', 'Unknown'];
    const devRow = d => { const [ac, ai, al] = availV(d); const weak = d.lqi != null && d.lqi < 30; const sv = d.worst && SEV[d.worst];
      return { id: d.id, name: d.name, type: d.type, typeIcon: typeIcon(d.type), availCls: ac, availIcon: ai, avail: al, lastSeen: d.type === 'Coordinator' ? '—' : ago(d.lastSeen), lqi: d.lqi ?? '—', lqiW: d.lqi ? Math.round(d.lqi / 255 * 100) : 0, lqiCls: weak ? 'lqi-weak' : '', lqiSub: d.lqi == null ? '' : (weak ? 'weak · ' : '') + `24 h ${d.lqiAvg} · base ${d.lqiBase ?? 'learning'}`, batt: d.battery && d.batt != null ? d.batt + ' %' : '—', volt: d.battery ? d.volt.toFixed(2) + ' V' : '', mph: d.mph, score: d.score ?? '—', scoreCls: d.score != null && d.score < 70 ? 'health-low' : '', hasIssues: !!d.issues, noIssues: !d.issues, issues: d.issues, sevCls: sv ? sv.cls : '', sevIcon: sv ? sv.icon : '', flag: sv ? 'is-flagged ' + sv.cls : '', open: nav('device', { devId: d.id }) }; };
    const cols = [['name', 'Name'], ['type', 'Type'], ['avail', 'Availability'], ['lastSeen', 'Last seen'], ['lqi', 'LQI now · 24 h · base'], ['batt', 'Battery', 1], ['mph', 'Msg/h', 1], ['score', 'Health', 1], ['issues', 'Issues', 1]].map(([k, label, num]) => ({ label, cls: num ? 'num' : '', ariaSort: st.sortKey === k ? (st.sortDir > 0 ? 'ascending' : 'descending') : undefined, icon: st.sortKey === k ? (st.sortDir > 0 ? '#i-up' : '#i-down') : '#i-sort', onSort: () => this.setState(p => p.sortKey === k ? { sortDir: -p.sortDir } : { sortKey: k, sortDir: k === 'issues' || k === 'lqi' && false ? -1 : 1 }) }));
    const chips = [['routers', 'Routers', D.filter(d => d.type === 'Router').length], ['battery', 'Battery', D.filter(d => d.battery).length], ['offline', 'Offline', offline], ['issues', 'Has issues', D.filter(d => d.issues).length]].map(([k, label, n]) => ({ key: k, label, n, on: !!f[k], toggle: () => this.setState(p => ({ f: Object.assign({}, p.f, { [k]: !p.f[k] }) })) }));

    // Device detail
    const dv = (st.devId && D.find(d => d.id === st.devId)) || by('Bad sensor');
    const [dac, dai, dal] = availV(dv);
    const dIss = sortIssues(I.filter(i => i.device === dv && i.state !== 'resolved')).map(issueView);
    const mutedUntil = st.muted[dv.id];
    const isDev = st.page === 'device';
    const devEventsAll = isDev ? deviceEvents(dv, s, learning ? 4 : 50) : [];
    const dev = { name: dv.name, type: dv.type, typeIcon: typeIcon(dv.type), model: dv.model, vendor: dv.vendor, power: dv.battery ? `Battery (${dv.cell})` : dv.power, availCls: dac, availIcon: dai, avail: dal, lastSeen: dv.type === 'Coordinator' ? 'just now' : ago(dv.lastSeen), score: dv.score ?? 'learning', hasIssues: dIss.length > 0, issues: dIss, issueCount: dIss.length, battery: dv.battery, batt: (dv.batt ?? '—') + ' %', volt: dv.battery ? dv.volt.toFixed(2) + ' V' : '', cell: dv.cell,
      forecast: learning ? 'Forecast needs 3 days of history' : dv.days == null ? 'No forecast yet' : `About ${dv.days} days until 10 %`, forecastSub: learning ? 'About 2 days 22 h to go. Readings so far: 2.' : dv.days == null ? 'Not enough battery readings — this device reports rarely.' : 'Empty around ' + fDMY.format(new Date(NOW + dv.days * 86400000)) + (dv.days <= 30 ? ' — buy a ' + dv.cell + ' now.' : '.'), swap: learning ? 'Unknown (before MeshPulse)' : dv.swapMin ? fDMY.format(at(dv.swapMin)) + ' · ' + ago(dv.swapMin) : 'Never seen',
      isMuted: !!mutedUntil, muteCls: mutedUntil ? 'is-muted' : '', muteIcon: mutedUntil ? '#i-bell-off' : '#i-ok', muteStatus: mutedUntil || 'Not muted — alerts on', mutedText: mutedUntil || '', ignored: !!st.ignored[dv.id], tags: dv.mph > 60 && dv.type === 'Router' ? ['chatty'] : [] };
    const muteLabel = { '1h': 'Muted until Today 15:12', '24h': 'Muted until Mon 19 Oct, 14:12', '7d': 'Muted until Sun 25 Oct, 14:12', forever: 'Muted until you unmute' };
    const ranges = ['24h', '7d', '30d'].map(r => ({ label: r === '24h' ? '24 h' : r === '7d' ? '7 d' : '30 d', current: st.range === r ? 'true' : undefined, go: e => { e.preventDefault(); this.setState({ range: r }); } }));
    const charts = isDev ? deviceCharts(dv, s, st.range, learning) : [];

    // Issue detail
    const iRaw = (st.issueId && byId(st.issueId)) || sortIssues(unresolved)[0] || I.find(i => i.state === 'resolved');
    const iv = issueView(iRaw); const iSt = issState(iRaw);
    let iCharts = [];
    if (st.page === 'issue' && iRaw.device && iRaw.metric) { const all = deviceCharts(iRaw.device, s, iRaw.metric === 'batt' ? '7d' : '24h', false); iCharts = [iRaw.metric === 'batt' ? all.find(c => c.title === 'Battery') : all[0]].filter(Boolean).map(c => Object.assign({}, c, { title: (iRaw.metric === 'batt' ? 'Battery, last 7 days' : 'Link quality, last 24 h') + ' — evidence' })); }
    const iss = Object.assign({}, iv, { actionLong: iRaw.actionLong, evidence: iRaw.ev.map(([k, v]) => ({ k, v })),
      timeline: iSt === 'resolved' ? `Opened ${when(iRaw.opened)} · resolved ${when(iRaw.resolved)} · lasted ${dur(iRaw.opened - iRaw.resolved)}` : `Opened ${when(iRaw.opened)} (${ago(iRaw.opened)}) · open for ${dur(iRaw.opened)}` + (iSt === 'acknowledged' ? ` · acknowledged ${iRaw.acked ? when(iRaw.acked) : 'just now'}` : ''),
      canAck: iSt === 'open', isAck: iSt === 'acknowledged', isResolved: iSt === 'resolved', ackText: iRaw.acked ? when(iRaw.acked) : 'just now', resolvedText: iRaw.resolved ? when(iRaw.resolved) : '', hasChart: iCharts.length > 0, charts: iCharts, openDevice: iRaw.device ? nav('device', { devId: iRaw.device.id }) : prevent });
    const issEvents = st.page === 'issue' && iRaw.device ? deviceEvents(iRaw.device, s, 8) : [];

    // Issues list
    const inTab = t => I.filter(i => !i.parent && issState(i) === t && (st.ruleF === 'all' || i.rule === st.ruleF) && (st.sevF === 'all' || i.sev === st.sevF));
    const tabs = [['open', 'Open'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved']].map(([k, label]) => ({ label, n: I.filter(i => !i.parent && issState(i) === k).length, current: st.tab === k ? 'page' : undefined, go: e => { e.preventDefault(); this.setState({ tab: k }); } }));
    const tabList = inTab(st.tab); const tabIssues = (st.tab === 'resolved' ? tabList.slice().sort((a, b) => a.resolved - b.resolved) : sortIssues(tabList)).map(issueView);
    const ruleOpts = Object.keys(RULES).filter(k => k !== 'battery_forecast').map(v => ({ v, label: RULES[v] }));
    const sevOpts = [['all', 'All'], ['critical', 'Critical'], ['warning', 'Warning'], ['info', 'Info']].map(([v, label]) => ({ label, on: st.sevF === v ? 'true' : 'false', go: () => this.setState({ sevF: v }) }));

    // Batteries
    const bats = D.filter(d => d.battery);
    const bRow = d => { const r = rng(d.idx); const pts = Array.from({ length: 30 }, (_, i) => d.batt + (d.days ? 900 / d.days : 1) * (1 - i / 29) * (d.name === 'Bad sensor' && s !== 'healthy' ? 2 : 1) + (r() - 0.5) * 1.5); const lo = Math.min(...pts), hi = Math.max(...pts) + 0.01;
      return { name: d.name, open: nav('device', { devId: d.id }), days: d.days == null ? '—' : d.days + (d.days === 1 ? ' day' : ' days'), date: d.days == null ? 'No forecast' : fDM.format(new Date(NOW + d.days * 86400000)), batt: d.batt != null ? d.batt + ' %' : '—', volt: d.volt.toFixed(2) + ' V', cell: d.cell, swap: learning ? 'Unknown' : d.swapMin ? fDMY.format(at(d.swapMin)) : '—', spark: learning ? '' : pts.map((v, i) => (i ? 'L' : 'M') + (i / 29 * 96).toFixed(1) + ' ' + (20 - (v - lo) / (hi - lo) * 18).toFixed(1)).join(' '), sparkAria: `30-day battery trend, ${Math.round(pts[0])} % to ${d.batt} %`, flag: d.days != null && d.days <= 7 ? 'is-flagged is-warn' : '' }; };
    const bDue = bats.filter(d => d.days != null && d.days <= 30).sort((a, b) => a.days - b.days), bLater = bats.filter(d => d.days != null && d.days > 30).sort((a, b) => a.days - b.days), bNone = bats.filter(d => d.days == null);
    const cells = {}; bDue.forEach(d => cells[d.cell] = (cells[d.cell] || 0) + 1);
    const batGroups = st.page !== 'batteries' ? [] : learning ? [{ id: 'bg-none', title: 'No forecast yet', n: bats.length, note: 'Forecasts need 3 days of battery readings', rows: bats.map(bRow) }] : [
      { id: 'bg-due', title: 'Buy within 30 days', icon: '#i-warn', n: bDue.length, note: 'Shopping list: ' + Object.entries(cells).map(([c, n]) => n + '× ' + c).join(', '), rows: bDue.map(bRow) },
      { id: 'bg-later', title: 'Later', n: bLater.length, note: 'Sorted by days left', rows: bLater.slice(0, 18).map(bRow) },
      { id: 'bg-none', title: 'No forecast', n: bNone.length, note: 'Too few readings, or the device never reports', rows: bNone.map(bRow) }];
    const batSummary = learning ? `${bats.length} battery devices. Forecasts appear after 3 days of readings.` : `${bats.length} battery devices · ${bDue.length} need a new battery within 30 days.`;

    // Events
    const er = rng(5); const evAll = []; let em = 0;
    if (s === 'critical') { evAll.push({ m: 3, k: 'bridge', d: null, text: 'Bridge went offline', detail: 'bridge/state = offline', sev: 'is-crit' }); [by('Hall plug'), ...HALL_KIDS.map(by)].forEach(d => evAll.push({ m: d.lastSeen, k: 'availability', d, text: 'Went offline', detail: '', sev: 'is-crit' })); }
    for (let i = 0; i < (st.page === 'events' ? 160 : 0); i++) { em += Math.floor(er() * 30) + 2; const d = D[1 + Math.floor(er() * 139)]; const x = er(); const k = x < 0.4 ? 'availability' : x < 0.6 ? 'announce' : x < 0.75 ? 'route_error' : x < 0.85 ? 'delivery_error' : x < 0.92 ? 'join' : x < 0.97 ? 'battery_swap' : 'leave';
      const t = { availability: er() < 0.5 ? ['Back online', 'offline for ' + (2 + Math.floor(er() * 8)) + ' min', 'is-ok'] : ['Went offline', '', 'is-crit'], announce: ['Announced', 'device announce', ''], route_error: ['Route error', 'NWK route discovery failed', 'is-warn'], delivery_error: ['Delivery failed', 'MAC no ACK', 'is-warn'], join: ['Joined', 'interview completed', 'is-info'], battery_swap: ['Battery swapped', '→ 100 %', 'is-ok'], leave: ['Left the network', 'device_leave', 'is-warn'] }[k];
      evAll.push({ m: em + 12, k, d, text: t[0], detail: t[1], sev: t[2] }); }
    const evF = evAll.filter(e => st.evKind === 'all' || e.k === st.evKind).sort((a, b) => a.m - b.m);
    const evPage = st.evPage, per = 25; const evRowsRaw = evF.slice((evPage - 1) * per, evPage * per);
    const evRows = evRowsRaw.map(e => ({ time: when(e.m), kind: KINDS[e.k].label, icon: KINDS[e.k].icon, sevCls: e.sev, device: e.d ? e.d.name : 'Bridge', open: e.d ? nav('device', { devId: e.d.id }) : prevent, text: e.text, detail: e.detail }));
    const evTotal = learning ? '212' : '18,406'; const evPages = learning ? 9 : 737;

    // Map
    const offN = map.nodes.filter(n => n.off);
    const mapV = { edges: map.edges, nodes: map.nodes.map(n => Object.assign({}, n, { open: e => { e.preventDefault(); nav('device', { devId: n.id })(e); } })), aria: `Network map of 140 devices: coordinator, 38 routers, 101 end devices. ${offN.length} offline.`, offCount: offN.length, noneOff: offN.length === 0, offList: offN.map(n => ({ name: D.find(d => d.id === n.id).name, open: nav('device', { devId: n.id }) })) };

    // Settings
    const errMode = s === 'attention';
    const F = (id, label, unit, value, help, error) => ({ id, label, unit, value, help, error: error || '', invalid: error ? 'true' : undefined });
    const set = { hasErr: errMode, chanErr: errMode && st.dTested !== 'ok',
      groups: [
        { title: 'Bridge', fields: [F('bridge_silence', 'Bridge silence', 'min', 5, 'Bridge offline when Zigbee2MQTT says nothing for this long.'), F('permit_join', 'Permit join max', 'min', 10, 'Warn when pairing mode stays open longer.'), F('restarts', 'Bridge restarts warning', 'per day', 3, 'More restarts than this in 24 h is a warning.'), F('mqtt_lost', 'MQTT lost after', 's', 60, 'MeshPulse lost MQTT after this long disconnected.')] },
        { title: 'Availability', fields: [F('offline_grace', 'Offline grace', 'min', 15, 'Wait before an offline device becomes an issue.'), F('silent_x', 'Silent after typical gap', '×', 3, 'Silent when quiet for this many times its usual gap…'), F('silent_min', 'Silence at least', 'h', 2, '…but never sooner than this…'), F('silent_max', 'Silence at most', 'h', 25, '…and always by this.'), F('flap_at', 'Flapping at', 'drops', 4, 'Drops within the window that count as flapping.'), F('flap_clear', 'Flapping clears below', 'drops', 2, 'Resolves when drops fall under this.'), F('flap_window', 'Flapping window', 'h', 6, 'Sliding window for counting drops.')] },
        { title: 'Battery', fields: [F('batt_low', 'Battery low', '%', 25, 'Warning below this.'), F('batt_crit', 'Battery critical', '%', errMode ? 30 : 10, 'Critical below this.', errMode ? 'Must be lower than Battery low (25 %).' : ''), F('batt_ok', 'Battery OK again', '%', 40, 'Resolves only above this, so it doesn\u2019t bounce.'), F('coin_low', 'Coin cell low', 'V', 2.8, 'For CR2032-type cells, which report % badly.'), F('coin_crit', 'Coin cell critical', 'V', 2.6, ''), F('coin_ok', 'Coin cell OK again', 'V', 2.9, ''), F('coin_max', 'Coin cell max voltage', 'V', 3.3, 'A reading above this means a fresh battery.')] },
        { title: 'Link quality', fields: [F('weak', 'Weak link below', 'LQI', 30, 'LQI runs 0–255. Under 30 drops messages.'), F('degrade', 'Degrading at', '% below baseline', 40, 'Warn when the 24 h average falls this far under the baseline.'), F('baseline', 'Baseline window', 'days', 7, '')] },
        { title: 'Routes', fields: [F('route_fail', 'Route failures', 'per hour', 10, 'Per device.'), F('net_route', 'Network route errors', 'per 10 min', 100, 'Across the whole mesh.')] },
        { title: 'Forecast and reminders', fields: [F('fc_days', 'Warn when empty within', 'days', 30, 'Shown on Batteries and the device page only.'), F('fc_target', 'Forecast to', '%', 10, ''), F('remind_crit', 'Remind critical every', 'h', 6, 'Until acknowledged or resolved.'), F('remind_warn', 'Remind warning every', 'h', 24, '')] },
      ],
      dOk: st.dTested === 'ok' || (!errMode && st.dTested == null && s === 'healthy'), dErr: st.dTested === 'err' || (errMode && st.dTested == null), dTime: '14:10',
      prereqs: [['availability', !learning, 'Online/offline per device', 'Missing — add availability: enabled: true'], ['health', true, 'Bridge health messages (Z2M 2.x)', ''], ['mqtt_log', true, 'Route and delivery errors from the bridge log', ''], ['last_seen', !learning, 'Last seen timestamps', 'Missing — add advanced: last_seen: ISO_8601']].map(([key, ok, t, fix]) => ({ key, cls: ok ? 'ok' : 'bad', icon: ok ? '#i-ok' : '#i-warn', text: ok ? 'OK · ' + t : fix })),
      noFails: !errMode, hasFails: errMode, fails: [{ time: 'Today 13:25', ch: 'Discord', title: 'Warning: Replace battery in Bad sensor', err: '401 Unauthorized' }, { time: 'Today 11:01', ch: 'Discord', title: 'Warning: Weak link: Garage door contact', err: '401 Unauthorized' }] };

    const page = st.page;
    const P = {}; ['overview', 'devices', 'device', 'issues', 'issue', 'batteries', 'events', 'map', 'settings'].forEach(k => P[k] = page === k);
    const theme = this.q.get('theme') || this.props.theme || 'dark';
    return {
      themeAttr: theme === 'auto' ? undefined : theme, sevScope: scope, isLogin: page === 'login', isApp: page !== 'login', p: P, go, prevent, nav: navList, upd, stale, learning,
      login: { wrong: s === 'attention', locked: s === 'critical', wrongAttr: s === 'attention' ? 'true' : undefined, email: s === 'healthy' ? '' : 'admin@home.lan' },
      banner, score, hasOpen: openIssues.length > 0, openIssues, openCount: openIssues.length, tiles, msgs, statusline,
      copyLabel: st.copied ? 'Copied' : 'Copy', copyIcon: st.copied ? '#i-check' : '#i-copy', copyCls: st.copied ? 'mp-copied' : '', copy: () => { try { navigator.clipboard.writeText('availability:\n  enabled: true'); } catch (e) {} this.setState({ copied: true }); },
      devSummary: `${D.length} devices · ${D.filter(d => d.type === 'Router').length} routers · ${bats.length} on battery` + (offline ? ` · ${offline} offline` : ''), dens: { compact: st.density === 'compact' ? 'true' : 'false', comfy: st.density === 'compact' ? 'false' : 'true', cls: st.density === 'compact' ? 'compact' : '', setCompact: () => this.setState({ density: 'compact' }), setComfy: () => this.setState({ density: 'comfy' }) },
      onSearch: e => this.setState({ search: e.target.value }), chips, cols, rows: st.page === 'devices' ? rowsD.map(devRow) : [], rowCount: rowsD.length, sortLabel: cols.find(c => c.ariaSort) ? cols.find(c => c.ariaSort).label.toLowerCase() + (st.sortDir > 0 ? ', ascending' : ', descending') : 'name',
      dev, ranges, charts, devEvents: st.allEvents ? devEventsAll : devEventsAll.slice(0, 12), moreEvents: !st.allEvents && devEventsAll.length > 12, showAllEvents: () => this.setState({ allEvents: true }),
      setMuteChoice: e => this.setState({ muteChoice: e.target.value }), doMute: e => { e.preventDefault(); this.setState(p => ({ muted: Object.assign({}, p.muted, { [dv.id]: muteLabel[p.muteChoice] }) })); }, doUnmute: e => { e.preventDefault(); this.setState(p => ({ muted: Object.assign({}, p.muted, { [dv.id]: null }) })); }, toggleIgnore: () => this.setState(p => ({ ignored: Object.assign({}, p.ignored, { [dv.id]: !p.ignored[dv.id] }) })),
      iss, issEvents, ackIssue: e => { e.preventDefault(); this.setState(p => ({ acked: Object.assign({}, p.acked, { [iRaw.id]: true }) })); },
      tabs, tabIssues, tabHas: tabIssues.length > 0, tabEmpty: tabIssues.length === 0, tabEmptyTitle: st.tab === 'open' ? 'No open issues' : st.tab === 'acknowledged' ? 'Nothing acknowledged' : 'No resolved issues match', tabEmptyText: st.tab === 'open' ? 'Your Zigbee network is healthy. New issues appear here and on Discord.' : st.tab === 'acknowledged' ? 'Acknowledged issues wait here, without reminders, until they resolve.' : 'Try another rule or severity.', ruleOpts, sevOpts, setRule: e => this.setState({ ruleF: e.target.value }),
      batGroups, batSummary,
      evKinds: Object.keys(KINDS).map(v => ({ v, label: KINDS[v].label })), setEvKind: e => this.setState({ evKind: e.target.value, evPage: 1 }), evRows, evTotal, evPage, evPages, evFirst: evPage === 1, evRange: `Showing ${(evPage - 1) * per + 1}–${(evPage - 1) * per + evRows.length} of ${evTotal}`, evPrev: () => this.setState(p => ({ evPage: Math.max(1, p.evPage - 1) })), evNext: () => this.setState(p => ({ evPage: Math.min(6, p.evPage + 1) })),
      map: mapV, set, testDiscord: () => this.setState({ dTested: errMode ? 'err' : 'ok' }),
    };
  }
}
</script>
