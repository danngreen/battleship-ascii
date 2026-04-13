import type { Axis, PlacedShip, ShipClass, Vec3, WeaponId } from "./types.js";
import { GRID_SIZE } from "./types.js";

export interface ShipSpec {
  id: ShipClass;
  name: string;
  length: number;
  minDepth: number;
  maxDepth: number;
  weapons: WeaponId[];
  startingCredits?: number;
}

export const SHIPS: Record<ShipClass, ShipSpec> = {
  destroyer:   { id: "destroyer",   name: "Destroyer",   length: 2, minDepth: 2, maxDepth: 2, weapons: ["cannon"] },
  cruiser:     { id: "cruiser",     name: "Cruiser",     length: 3, minDepth: 2, maxDepth: 2, weapons: ["cannon", "cluster_missile"] },
  battleship:  { id: "battleship",  name: "Battleship",  length: 4, minDepth: 2, maxDepth: 2, weapons: ["cannon", "cluster_missile"] },
  carrier:     { id: "carrier",     name: "Carrier",     length: 5, minDepth: 2, maxDepth: 2, weapons: ["cannon"] },
  submarine:   { id: "submarine",   name: "Submarine",   length: 1, minDepth: 0, maxDepth: 1, weapons: ["torpedo"] },
};

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  cost: number;
  ammo: number;
  blurb: string;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  cannon:          { id: "cannon",          name: "Cannon",           cost: 0,   ammo: Infinity, blurb: "Standard surface shell. Single cell." },
  torpedo:         { id: "torpedo",         name: "Torpedo",          cost: 150, ammo: 6,        blurb: "Travels along a row underwater until it hits." },
  cluster_missile: { id: "cluster_missile", name: "Cluster Missile",  cost: 250, ammo: 2,        blurb: "Splash damage across a plus-shape on the surface." },
};

export const DEFAULT_FLEET: ShipClass[] = [
  "destroyer",
  "cruiser",
  "battleship",
  "carrier",
  "submarine",
];

export function computeShipCells(origin: Vec3, axis: Axis, length: number): Vec3[] {
  const cells: Vec3[] = [];
  for (let i = 0; i < length; i++) {
    cells.push({
      x: axis === "x" ? origin.x + i : origin.x,
      y: axis === "y" ? origin.y + i : origin.y,
      z: axis === "z" ? origin.z + i : origin.z,
    });
  }
  return cells;
}

export type PlacementError =
  | "out_of_bounds"
  | "depth_violation"
  | "collision"
  | "unknown_ship";

export function validatePlacement(
  shipClass: ShipClass,
  origin: Vec3,
  axis: Axis,
  existing: PlacedShip[],
): { ok: true; cells: Vec3[] } | { ok: false; error: PlacementError } {
  const spec = SHIPS[shipClass];
  if (!spec) return { ok: false, error: "unknown_ship" };
  const cells = computeShipCells(origin, axis, spec.length);

  for (const c of cells) {
    if (c.x < 0 || c.x >= GRID_SIZE.x) return { ok: false, error: "out_of_bounds" };
    if (c.y < 0 || c.y >= GRID_SIZE.y) return { ok: false, error: "out_of_bounds" };
    if (c.z < 0 || c.z >= GRID_SIZE.z) return { ok: false, error: "out_of_bounds" };
    if (c.z < spec.minDepth || c.z > spec.maxDepth) return { ok: false, error: "depth_violation" };
  }

  const occupied = new Set(
    existing.flatMap((s) => s.cells.map((c) => `${c.x},${c.y},${c.z}`)),
  );
  for (const c of cells) {
    if (occupied.has(`${c.x},${c.y},${c.z}`)) return { ok: false, error: "collision" };
  }

  return { ok: true, cells };
}

export const STARTER_AMMO: Record<WeaponId, number> = {
  cannon: -1, // -1 = unlimited
  torpedo: 3,
  cluster_missile: 1,
};

const keyOfVec = (c: Vec3) => `${c.x},${c.y},${c.z}`;

export interface FireResult {
  hits: Vec3[];
  misses: Vec3[];
  reveals: Vec3[];
}

export interface FireContext {
  enemyShipCells: Set<string>;
  enemySubCells?: Set<string>;
  shooterSub?: PlacedShip;
  direction?: Vec3;
}

export function torpedoDirections(subAxis: Axis): Vec3[] {
  const dirs: Vec3[] = [];
  if (subAxis === "x") {
    dirs.push({ x:  1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
    dirs.push({ x:  0, y: 1, z: 0 }, { x:  0, y: -1, z: 0 });
  } else {
    dirs.push({ x:  0, y: 1, z: 0 }, { x:  0, y: -1, z: 0 });
    dirs.push({ x:  1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
  }
  dirs.push({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 });
  return dirs;
}

export function torpedoPath(
  sub: PlacedShip,
  dir: Vec3,
  enemySubCellKeys?: Set<string>,
): { path: Vec3[]; hit: Vec3 | null } {
  let bestScore = -Infinity;
  let best = sub.cells[0];
  for (const c of sub.cells) {
    const s = c.x * dir.x + c.y * dir.y + c.z * dir.z;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  let cur = { x: best.x + dir.x, y: best.y + dir.y, z: best.z + dir.z };
  const path: Vec3[] = [];
  while (
    cur.x >= 0 && cur.x < GRID_SIZE.x &&
    cur.y >= 0 && cur.y < GRID_SIZE.y &&
    cur.z >= 0 && cur.z < 2
  ) {
    const p = { x: cur.x, y: cur.y, z: cur.z };
    path.push(p);
    if (enemySubCellKeys?.has(keyOfVec(p))) return { path, hit: p };
    cur = { x: cur.x + dir.x, y: cur.y + dir.y, z: cur.z + dir.z };
  }
  return { path, hit: null };
}

export function resolveFire(
  weapon: WeaponId,
  target: Vec3,
  ctx: FireContext,
): FireResult {
  const enemyShipCells = ctx.enemyShipCells;
  const inBounds = (c: Vec3) =>
    c.x >= 0 && c.x < GRID_SIZE.x &&
    c.y >= 0 && c.y < GRID_SIZE.y &&
    c.z >= 0 && c.z < GRID_SIZE.z;

  const classify = (cells: Vec3[]): { hits: Vec3[]; misses: Vec3[] } => {
    const hits: Vec3[] = [];
    const misses: Vec3[] = [];
    for (const c of cells) {
      if (!inBounds(c)) continue;
      if (enemyShipCells.has(keyOfVec(c))) hits.push(c);
      else misses.push(c);
    }
    return { hits, misses };
  };

  switch (weapon) {
    case "cannon":
      if (target.z !== 2) return { hits: [], misses: [], reveals: [] };
      return { ...classify([target]), reveals: [] };

    case "torpedo": {
      if (!ctx.shooterSub || !ctx.direction) return { hits: [], misses: [], reveals: [] };
      const { path, hit } = torpedoPath(ctx.shooterSub, ctx.direction, ctx.enemySubCells);
      if (hit) return { hits: [hit], misses: path.slice(0, -1), reveals: [] };
      return { hits: [], misses: path, reveals: [] };
    }

    case "cluster_missile":
      return {
        ...classify([
          { x: target.x,     y: target.y,     z: 2 },
          { x: target.x + 1, y: target.y,     z: 2 },
          { x: target.x - 1, y: target.y,     z: 2 },
          { x: target.x,     y: target.y + 1, z: 2 },
          { x: target.x,     y: target.y - 1, z: 2 },
        ]),
        reveals: [],
      };
  }
}
