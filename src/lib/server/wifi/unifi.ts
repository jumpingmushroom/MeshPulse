import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type ControllerKind = "unifi-os" | "network-app";

export interface WifiAp {
  mac: string;
  name: string;
  model: string;
  radio24: {
    channel: number;
    width: number;
    cuTotal: number | null;
    cuSelfRx: number | null;
    cuSelfTx: number | null;
    numSta: number | null;
    txPower: number | null;
  } | null;
}

export type Transport = (req: {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}) => Promise<{
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}>;

const BAD = "Unexpected stat/device response";
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function parseDevices(json: unknown): WifiAp[] {
  if (!isObj(json) || !Array.isArray(json.data)) throw new Error(BAD);
  const aps: WifiAp[] = [];
  for (const d of json.data) {
    if (!isObj(d)) throw new Error(BAD);
    if (d.type !== "uap") continue;
    const find = (k: string) =>
      (Array.isArray(d[k]) ? (d[k] as unknown[]) : []).find(
        (r): r is Obj => isObj(r) && r.radio === "ng",
      );
    const cfg = find("radio_table");
    const st = find("radio_table_stats");
    // stats carry the live channel; the table may say "auto"
    const channel = num(st?.channel) ?? num(cfg?.channel);
    aps.push({
      mac: String(d.mac ?? ""),
      name: String(d.name ?? d.mac ?? ""),
      model: String(d.model ?? ""),
      radio24:
        cfg && channel !== null
          ? {
              channel,
              width: num(cfg.ht) ?? 20,
              cuTotal: num(st?.cu_total),
              cuSelfRx: num(st?.cu_self_rx),
              cuSelfTx: num(st?.cu_self_tx),
              numSta: num(st?.num_sta),
              txPower: num(st?.tx_power) ?? num(cfg.tx_power),
            }
          : null,
    });
  }
  return aps;
}

// Self-signed consoles are normal; TLS checks are off only for this one configured host.
function defaultTransport(): Transport {
  return (req) =>
    new Promise((resolve, reject) => {
      const u = new URL(req.url);
      const send = u.protocol === "http:" ? httpRequest : httpsRequest;
      const r = send(
        u,
        { method: req.method, headers: req.headers, rejectUnauthorized: false },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[]>,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      // hard deadline for the whole request, not an idle timeout
      const timer = setTimeout(
        () => r.destroy(new Error("timeout")),
        req.timeoutMs,
      );
      r.on("close", () => clearTimeout(timer));
      r.on("error", reject);
      r.end(req.body);
    });
}

export function createUnifi(opts: {
  url: string;
  site: string;
  user: string;
  password: string;
  transport?: Transport;
  timeoutMs?: number;
}) {
  const transport = opts.transport ?? defaultTransport();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const base = opts.url.replace(/\/+$/, "");
  let kind: ControllerKind | null = null;
  let fw: string | null = null;
  let apCount = 0;
  let cookie = "";
  let csrf = "";

  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (csrf) headers["x-csrf-token"] = csrf;
    try {
      return await transport({
        method,
        url: base + path,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Controller not reachable: ${opts.password ? reason.split(opts.password).join("***") : reason}`,
      );
    }
  }

  const header = (h: Record<string, string | string[]>, name: string) => {
    const k = Object.keys(h).find((x) => x.toLowerCase() === name);
    const v = k ? h[k] : undefined;
    return Array.isArray(v) ? v : v === undefined ? [] : [v];
  };

  async function login() {
    cookie = "";
    csrf = "";
    const creds = { username: opts.user, password: opts.password };
    const paths: [ControllerKind, string][] = [
      ["unifi-os", "/api/auth/login"],
      ["network-app", "/api/login"],
    ];
    for (const [k, path] of paths) {
      if (kind && kind !== k) continue;
      const res = await call("POST", path, creds);
      if (res.status === 404) continue;
      if (
        res.status >= 400 &&
        (res.status === 499 || /2fa|mfa/i.test(res.body))
      )
        throw new Error(
          "This account uses MFA — create a local account without MFA",
        );
      if (res.status === 400 || res.status === 401 || res.status === 403)
        throw new Error("Wrong user or password");
      if (res.status < 200 || res.status >= 300)
        throw new Error(`Controller not reachable: HTTP ${res.status}`);
      kind = k;
      cookie = header(res.headers, "set-cookie")
        .map((c) => c.split(";")[0])
        .join("; ");
      csrf = header(res.headers, "x-csrf-token")[0] ?? "";
      return;
    }
    throw new Error("Controller not reachable: no UniFi login endpoint found");
  }

  async function fetchDevices() {
    const prefix = kind === "unifi-os" ? "/proxy/network" : "";
    return call(
      "GET",
      `${prefix}/api/s/${encodeURIComponent(opts.site)}/stat/device`,
    );
  }

  return {
    async devices(): Promise<WifiAp[]> {
      if (!kind || !cookie) await login();
      let res = await fetchDevices();
      if (res.status === 401) {
        await login();
        res = await fetchDevices();
        if (res.status === 401) throw new Error("Wrong user or password");
      }
      let json: unknown;
      try {
        json = JSON.parse(res.body);
      } catch {
        json = null;
      }
      const msg =
        isObj(json) && isObj(json.meta) ? String(json.meta.msg ?? "") : "";
      if (res.status === 403)
        throw new Error(
          "Access denied — check the account has at least View Only access",
        );
      if (res.status >= 500)
        throw new Error(`Controller not reachable: HTTP ${res.status}`);
      if (res.status === 400 || msg === "api.err.NoSiteContext")
        throw new Error(`Unknown site "${opts.site}"`);
      if (res.status < 200 || res.status >= 300) throw new Error(BAD);
      const aps = parseDevices(json);
      // the console reports the Network version via its own device entry (udm/uxg/ugw), when present
      const gw = (json as { data: Obj[] }).data.find(
        (d) =>
          typeof d.version === "string" && /^u(dm|xg|gw)/.test(String(d.type)),
      );
      fw = gw ? String(gw.version) : fw;
      apCount = aps.length;
      return aps;
    },
    kind: () => kind,
    // gateway firmware equals the UniFi OS version; a Network Application has no such value
    version: () => (kind === "unifi-os" ? fw : null),
    describe: () =>
      `Connected to ${kind === "unifi-os" ? `UniFi OS${fw ? ` ${fw}` : ""}` : "UniFi Network Application"}, site ${opts.site}: ${apCount} access points`,
    async logout() {
      if (!kind || !cookie) return;
      try {
        await call(
          "POST",
          kind === "unifi-os" ? "/api/auth/logout" : "/api/logout",
          {},
        );
      } catch {
        /* best effort on shutdown */
      }
      cookie = "";
      csrf = "";
    },
  };
}
