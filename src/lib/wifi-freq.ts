// Client-safe: imported by the browser; server/wifi/overlap.ts re-exports these.
export const zigbeeMHz = (c: number) => 2405 + 5 * (c - 11);
export const wifiMHz = (n: number) => (n === 14 ? 2484 : 2407 + 5 * n);
