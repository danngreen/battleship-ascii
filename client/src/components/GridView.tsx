import React from "react";
import { Box, Text } from "ink";
import { GRID_SIZE, type PlacedShip, type Vec3 } from "@battleship/shared";

const RAMP = ["░", "·", ":", "-", "+"];
const keyOf = (c: Vec3) => `${c.x},${c.y},${c.z}`;

interface Props {
  title: string;
  cursor?: Vec3 | null;
  placed?: PlacedShip[];
  preview?: Vec3[];
  previewValid?: boolean;
  hits?: Vec3[];
  misses?: Vec3[];
  revealed?: Vec3[];
  mySubCells?: Vec3[];
  enemySubCells?: Vec3[];
  torpedoPreview?: Vec3[];
  subHitsFresh?: Vec3[];
  subHitsFaded?: Vec3[];
  clusterPreview?: Vec3[];
}

export function GridView({
  title,
  cursor = null,
  placed = [],
  preview = [],
  previewValid = true,
  hits = [],
  misses = [],
  revealed = [],
  mySubCells = [],
  enemySubCells = [],
  torpedoPreview = [],
  subHitsFresh = [],
  subHitsFaded = [],
  clusterPreview = [],
}: Props) {
  const shipCells = new Set(placed.flatMap((s) => s.cells.map(keyOf)));
  const ownSubDamageSet = new Set(
    placed
      .filter((s) => s.shipClass === "submarine")
      .flatMap((s) => s.cells.filter((_, i) => s.damage?.[i]).map(keyOf)),
  );
  const ownDamageSet = new Set(
    placed
      .filter((s) => s.shipClass !== "submarine")
      .flatMap((s) => s.cells.filter((_, i) => s.damage?.[i]).map(keyOf)),
  );
  const subHitFreshSet = new Set(subHitsFresh.map(keyOf));
  const subHitFadedSet = new Set(subHitsFaded.map(keyOf));
  const clusterPreviewSet = new Set(clusterPreview.map(keyOf));
  const previewSet = new Set(preview.map(keyOf));
  const hitSet = new Set(hits.map(keyOf));
  const missSet = new Set(misses.map(keyOf));
  const revealedSet = new Set(revealed.map(keyOf));
  const subSet = new Set(mySubCells.map(keyOf));
  const enemySubSet = new Set(enemySubCells.map(keyOf));
  const torpedoSet = new Set(torpedoPreview.map(keyOf));

  const layers: React.ReactNode[] = [];
  for (let z = GRID_SIZE.z - 1; z >= 0; z--) {
    const rows: React.ReactNode[] = [];
    for (let y = 0; y < GRID_SIZE.y; y++) {
      const cells: React.ReactNode[] = [];
      for (let x = 0; x < GRID_SIZE.x; x++) {
        const k = keyOf({ x, y, z });
        const isCursor = !!cursor && cursor.x === x && cursor.y === y && cursor.z === z;

        let ch: string;
        let color: string;
        if (ownSubDamageSet.has(k))   { ch = "✖"; color = "redBright"; }
        else if (ownDamageSet.has(k)) { ch = "✸"; color = "redBright"; }
        else if (subHitFreshSet.has(k)){ ch = "✸"; color = "redBright"; }
        else if (subHitFadedSet.has(k)){ ch = "."; color = "red"; }
        else if (hitSet.has(k))       { ch = "✸"; color = "redBright"; }
        else if (missSet.has(k))      { ch = "○"; color = "gray"; }
        else if (subSet.has(k))       { ch = "◆"; color = "cyanBright"; }
        else if (enemySubSet.has(k))  { ch = "◈"; color = "redBright"; }
        else if (revealedSet.has(k))  { ch = "▲"; color = "magentaBright"; }
        else if (shipCells.has(k))    { ch = "■"; color = "whiteBright"; }
        else if (isCursor)            { ch = "▣"; color = "greenBright"; }
        else if (previewSet.has(k))   { ch = "▢"; color = previewValid ? "greenBright" : "redBright"; }
        else if (clusterPreviewSet.has(k)){ ch = "▢"; color = "yellowBright"; }
        else if (torpedoSet.has(k))   { ch = "⋯"; color = "yellowBright"; }
        else if (z >= GRID_SIZE.z - 1){ ch = "~"; color = "blueBright"; }
        else                          { ch = RAMP[z] ?? "."; color = "blue"; }

        if (isCursor && ch !== "▣") color = "greenBright";
        cells.push(<Text key={x} color={color}>{ch + " "}</Text>);
      }
      rows.push(<Box key={y}>{cells}</Box>);
    }
    layers.push(
      <Box key={z} flexDirection="column" marginBottom={1}>
        <Text dimColor>── z={z} {z >= GRID_SIZE.z - 1 ? "(surface)" : "(underwater)"} ──</Text>
        {rows}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color="cyanBright">[ {title} ]</Text>
      {layers}
    </Box>
  );
}
