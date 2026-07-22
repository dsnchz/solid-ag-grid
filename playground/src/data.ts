/* Shared datasets for the playground. Deterministic PRNG so every reload looks the same. */

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** mulberry32 — tiny deterministic PRNG */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(rand: () => number, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

/* ------------------------------------------------------------------ employees */

export type Employee = {
  id: number;
  name: string;
  dept: string;
  country: string;
  salary: number;
  hireYear: number;
  rating: number;
};

export const DEPARTMENTS = [
  "Engineering",
  "Design",
  "Sales",
  "Marketing",
  "Finance",
  "Support",
] as const;

const COUNTRIES = ["USA", "Ireland", "Germany", "Japan", "Brazil", "Canada", "Spain"] as const;
const FIRST = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Donald", "Margaret", "John", "Radia", "Linus", "Anita", "Ken"] as const;
const LAST = ["Lovelace", "Hopper", "Turing", "Dijkstra", "Liskov", "Knuth", "Hamilton", "Backus", "Perlman", "Torvalds", "Borg", "Thompson"] as const;

export const makeEmployees = (count = 250, seed = 42): Employee[] => {
  const rand = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `${pick(rand, FIRST)} ${pick(rand, LAST)}`,
    dept: pick(rand, DEPARTMENTS),
    country: pick(rand, COUNTRIES),
    salary: 55000 + Math.floor(rand() * 1200) * 100,
    hireYear: 2008 + Math.floor(rand() * 18),
    rating: Math.round((2 + rand() * 3) * 10) / 10,
  }));
};

/* ------------------------------------------------------------------ cars + orders */

export type Car = { id: string; make: string; model: string; price: number; year: number };

export const makeCars = (tag = ""): Car[] => [
  { id: "c1", make: `Toyota${tag}`, model: "Celica", price: 35000, year: 2021 },
  { id: "c2", make: `Ford${tag}`, model: "Mondeo", price: 32000, year: 2020 },
  { id: "c3", make: `Porsche${tag}`, model: "Boxster", price: 72000, year: 2023 },
  { id: "c4", make: `BMW${tag}`, model: "M3", price: 61000, year: 2022 },
  { id: "c5", make: `Ford${tag}`, model: "Focus", price: 24000, year: 2019 },
];

export type Order = { order: string; customer: string; qty: number; total: number };

export const makeOrders = (carId: string): Order[] => {
  const rand = rng(carId.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
  return Array.from({ length: 4 }, (_, i) => ({
    order: `${carId.toUpperCase()}-${1000 + i}`,
    customer: `${pick(rand, FIRST)} ${pick(rand, LAST)}`,
    qty: 1 + Math.floor(rand() * 4),
    total: Math.round((10 + rand() * 90) * 1000),
  }));
};

/* ---------------------------------------------------------- alternate datasets (async page) */

export type Product = { id: string; name: string; category: string; price: number; stock: number };

const DATASET_SOURCES = {
  laptops: [
    ["ThinkPad X1", "ultrabook", 1899], ["MacBook Pro 14", "pro", 1999], ["Framework 13", "modular", 1049],
    ["XPS 15", "creator", 1749], ["ZenBook S", "ultrabook", 1199], ["Legion 5", "gaming", 1399],
  ],
  phones: [
    ["Pixel 9", "android", 799], ["iPhone 16", "ios", 829], ["Galaxy S25", "android", 899],
    ["Fairphone 5", "repairable", 699], ["Nothing 3", "android", 599],
  ],
  monitors: [
    ["UltraSharp 27", "office", 449], ["Odyssey G7", "gaming", 649], ["Studio Display", "creator", 1599],
    ["ProArt 32", "creator", 1099], ["ThinkVision M14", "portable", 249],
  ],
} as const;

export type DatasetName = keyof typeof DATASET_SOURCES;
export const DATASET_NAMES = Object.keys(DATASET_SOURCES) as DatasetName[];

export const makeProducts = (name: DatasetName, generation: number): Product[] => {
  const rand = rng(generation * 7 + name.length);
  return DATASET_SOURCES[name].map(([n, cat, price], i) => ({
    id: `${name}-${i}`,
    name: n,
    category: cat,
    price,
    stock: Math.floor(rand() * 500),
  }));
};

/* ------------------------------------------------------------------ tickers */

export type Ticker = { symbol: string; company: string; base: number };

export const TICKERS: Ticker[] = [
  { symbol: "SOL", company: "Solid Industries", base: 142.5 },
  { symbol: "AGG", company: "AG Grid Corp", base: 88.25 },
  { symbol: "SIG", company: "Signal Systems", base: 45.1 },
  { symbol: "MEMO", company: "Memoized Holdings", base: 210.4 },
  { symbol: "FLUX", company: "Flux Capital", base: 12.75 },
  { symbol: "RXG", company: "Reactive Graph Ltd", base: 66.6 },
  { symbol: "SSR", company: "Serverside Rendering Inc", base: 33.2 },
  { symbol: "HYD", company: "Hydration Partners", base: 154.0 },
];

/* ------------------------------------------------------------------ performance rows */

export type PerfRow = {
  id: number;
  trader: string;
  symbol: string;
  qty: number;
  price: number;
  pnl: number;
};

const PERF_SYMBOLS = ["SOL", "AGG", "SIG", "MEMO", "FLUX", "RXG", "SSR", "HYD", "QTZ", "BAL"] as const;
const TRADERS = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"] as const;

export const makePerfRows = (count = 100_000, seed = 7): PerfRow[] => {
  const rand = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    trader: pick(rand, TRADERS),
    symbol: pick(rand, PERF_SYMBOLS),
    qty: 1 + Math.floor(rand() * 1000),
    price: Math.round(rand() * 50000) / 100,
    pnl: Math.round((rand() - 0.5) * 200000) / 100,
  }));
};

export const money = (v: number | null | undefined) =>
  v == null ? "" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
