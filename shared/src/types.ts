export const GRID_SIZE = { x: 10, y: 10, z: 3 } as const;

export type Vec3 = { x: number; y: number; z: number };

export type CellState = "empty" | "miss" | "hit" | "sunk";

export type Axis = "x" | "y" | "z";

export type ShipClass =
  | "destroyer"
  | "cruiser"
  | "battleship"
  | "carrier"
  | "submarine";

export type WeaponId =
  | "cannon"
  | "torpedo"
  | "cluster_missile";

export type Territory = "own" | "enemy";

export interface PlacedShip {
  shipClass: ShipClass;
  origin: Vec3;
  axis: Axis;
  cells: Vec3[];
  territory?: Territory;
  damage?: boolean[];
}
