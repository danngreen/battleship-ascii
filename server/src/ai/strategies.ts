import {
  DEFAULT_FLEET,
  GRID_SIZE,
  SHIPS,
  validatePlacement,
  type Axis,
  type PlacedShip,
  type Vec3,
  type WeaponId,
} from "@battleship/shared";

export interface AIContext {
  fleet: PlacedShip[];
  ammo: Map<WeaponId, number>;
  myHits: Map<string, Vec3>;
  myMisses: Map<string, Vec3>;
}

export type AIAction =
  | { type: "fire"; weapon: WeaponId; target: Vec3; direction?: Vec3 }
  | { type: "move_sub"; delta: Vec3 }
  | { type: "pass" };

export interface AIStrategy {
  readonly name: string;
  placeFleet(): PlacedShip[];
  takeTurn(ctx: AIContext): AIAction;
}

export class EasyStrategy implements AIStrategy {
  readonly name = "easy";

  placeFleet(): PlacedShip[] {
    const placed: PlacedShip[] = [];
    for (const shipClass of DEFAULT_FLEET) {
      const spec = SHIPS[shipClass];
      for (let tries = 0; tries < 500; tries++) {
        const axis: Axis = Math.random() < 0.5 ? "x" : "y";
        const territory: "own" | "enemy" =
          shipClass === "submarine" && Math.random() < 0.5 ? "enemy" : "own";
        const z = spec.minDepth + Math.floor(Math.random() * (spec.maxDepth - spec.minDepth + 1));
        const lenX = axis === "x" ? spec.length : 1;
        const lenY = axis === "y" ? spec.length : 1;
        const origin: Vec3 = {
          x: Math.floor(Math.random() * (GRID_SIZE.x - lenX + 1)),
          y: Math.floor(Math.random() * (GRID_SIZE.y - lenY + 1)),
          z,
        };
        const result = validatePlacement(shipClass, origin, axis, placed);
        if (!result.ok) continue;
        placed.push({
          shipClass,
          origin,
          axis,
          cells: result.cells,
          territory,
          damage: result.cells.map(() => false),
        });
        break;
      }
    }
    return placed;
  }

  takeTurn(ctx: AIContext): AIAction {
    const surfaceZ = GRID_SIZE.z - 1;
    for (let tries = 0; tries < 200; tries++) {
      const x = Math.floor(Math.random() * GRID_SIZE.x);
      const y = Math.floor(Math.random() * GRID_SIZE.y);
      const k = `${x},${y},${surfaceZ}`;
      if (ctx.myHits.has(k) || ctx.myMisses.has(k)) continue;
      return { type: "fire", weapon: "cannon", target: { x, y, z: surfaceZ } };
    }
    return { type: "fire", weapon: "cannon", target: { x: 0, y: 0, z: surfaceZ } };
  }
}

export function createStrategy(name: "easy"): AIStrategy {
  switch (name) {
    case "easy":
      return new EasyStrategy();
  }
}
