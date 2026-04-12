import { z } from "zod";

export const Vec3Schema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  z: z.number().int().min(0),
});

export const PlaceShipMsg = z.object({
  type: z.literal("place_ship"),
  shipClass: z.string(),
  origin: Vec3Schema,
  axis: z.enum(["x", "y", "z"]),
});

const DirSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

export const FireMsg = z.object({
  type: z.literal("fire"),
  weapon: z.string(),
  target: Vec3Schema,
  direction: DirSchema.optional(),
});

export const BuyMsg = z.object({
  type: z.literal("buy"),
  weapon: z.string(),
  qty: z.number().int().min(1).max(10),
});

export const ReadyMsg = z.object({ type: z.literal("ready") });

export const MoveSubMsg = z.object({
  type: z.literal("move_sub"),
  delta: z.object({
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
});

export const ClientMsg = z.discriminatedUnion("type", [
  PlaceShipMsg,
  FireMsg,
  BuyMsg,
  ReadyMsg,
  MoveSubMsg,
]);

export type ClientMsg = z.infer<typeof ClientMsg>;
