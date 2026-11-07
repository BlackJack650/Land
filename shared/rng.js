export function hashSeed(value) {
  let h = 2166136261;
  for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seededRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pickWeighted(weights, roll = 0.5) {
  const total = weights.reduce((a, b) => a + b, 0);
  let n = roll * total;
  for (let i = 0; i < weights.length; i++) { n -= weights[i]; if (n < 0) return i + 1; }
  return weights.length;
}
