import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Client, Room } from "colyseus.js";
import { GridView } from "./components/GridView.js";
import {
  GRID_SIZE,
  SHIPS,
  WEAPONS,
  computeShipCells,
  torpedoDirections,
  torpedoPath,
  validatePlacement,
  type Axis,
  type PlacedShip,
  type ShipClass,
  type Vec3,
  type WeaponId,
} from "@battleship/shared";

type Phase = "menu" | "connecting" | "lobby" | "placement" | "market" | "combat" | "ended";
type Mode = "vs-human" | "vs-cpu-easy";

interface SubHit { cell: Vec3; territory: "own" | "enemy" }
interface TerritoryView {
  hits: Vec3[];
  misses: Vec3[];
  revealedShipCells: Vec3[];
  mySubInEnemy: Vec3[];
  enemySubCells: Vec3[];
  enemySubOn: "own" | "enemy" | null;
  torpedoTrail: { cells: Vec3[]; territory: "own" | "enemy" } | null;
  subHitsFresh: SubHit[];
  subHitsFaded: SubHit[];
}

const WEAPON_KEYS: WeaponId[] = ["cannon", "torpedo", "cluster_missile"];

export function App({ serverUrl }: { serverUrl: string }) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [mode, setMode] = useState<Mode | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [turnPlayerId, setTurnPlayerId] = useState<string>("");
  const [winnerId, setWinnerId] = useState<string>("");
  const [cursor, setCursor] = useState<Vec3>({ x: 0, y: 0, z: 2 });
  const [axis, setAxis] = useState<Axis>("x");
  const [placementTerritory, setPlacementTerritory] = useState<"own" | "enemy">("own");
  const [placed, setPlaced] = useState<PlacedShip[]>([]);
  const [remaining, setRemaining] = useState<ShipClass[]>([]);
  const [enemy, setEnemy] = useState<TerritoryView>({
    hits: [], misses: [], revealedShipCells: [], mySubInEnemy: [],
    enemySubCells: [], enemySubOn: null, torpedoTrail: null,
    subHitsFresh: [], subHitsFaded: [],
  });
  const [weapon, setWeapon] = useState<WeaponId>("cannon");
  const [torpedoDirIdx, setTorpedoDirIdx] = useState(0);
  const [torpedoArmed, setTorpedoArmed] = useState(false);
  const [ammo, setAmmo] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>(["Booting radar…"]);

  useEffect(() => {
    if (!mode) return;
    const client = new Client(serverUrl);
    const name = process.env.USER ?? "Captain";
    const promise = mode === "vs-cpu-easy"
      ? client.create("battle", { name, solo: true })
      : client.joinOrCreate("battle", { name });
    promise
      .then((r) => {
        setRoom(r);
        setSessionId(r.sessionId);
        setPhase("lobby");
        r.onStateChange((s: any) => {
          setPhase(s.phase);
          setTurnPlayerId(s.turnPlayerId);
          setWinnerId(s.winnerId);
        });
        r.onMessage("error", (e: any) => setLog((l) => [...l, `! ${e.message}`]));
        r.onMessage("fleet_update", (f: any) => {
          setPlaced(f.placed);
          setRemaining(f.remaining);
        });
        r.onMessage("territory_view", (v: TerritoryView) => setEnemy(v));
        r.onMessage("inventory_update", (inv: Record<string, number>) => setAmmo(inv));
        r.onMessage("ship_sunk", (e: { ownerId: string; shipClass: string }) => {
          const mine = e.ownerId === r.sessionId;
          const who = mine ? "Your" : "Enemy";
          const suffix = mine ? "D=" : "=D";
          setLog((l) => [...l, `>> ${who} ${e.shipClass} destroyed! ${suffix}`]);
        });
      })
      .catch((err) => setLog((l) => [...l, `connect failed: ${err.message}`]));
  }, [serverUrl, mode]);

  const currentShip = remaining[0];
  const currentSpec = currentShip ? SHIPS[currentShip] : null;
  const myTurn = turnPlayerId === sessionId;

  useEffect(() => {
    if (phase !== "placement" || !currentSpec) return;
    if (cursor.z < currentSpec.minDepth || cursor.z > currentSpec.maxDepth) {
      setCursor((c) => ({ ...c, z: currentSpec.minDepth }));
    }
    setPlacementTerritory("own");
  }, [phase, currentShip]);

  useEffect(() => {
    if (phase === "combat") setCursor({ x: 0, y: 0, z: 2 });
  }, [phase]);

  const preview =
    phase === "placement" && currentSpec
      ? computeShipCells(cursor, axis, currentSpec.length)
      : [];
  const previewValid =
    phase === "placement" && currentShip
      ? validatePlacement(currentShip, cursor, axis, placed).ok
      : false;

  useInput((input, key) => {
    if (phase === "menu") {
      if (input === "1") { setMode("vs-human"); setPhase("connecting"); }
      if (input === "2") { setMode("vs-cpu-easy"); setPhase("connecting"); }
      return;
    }
    const subPlacement = phase === "placement" && currentShip === "submarine";
    if (key.leftArrow) {
      if (subPlacement && placementTerritory === "enemy" && cursor.x === 0) {
        setPlacementTerritory("own");
        setCursor((c) => ({ ...c, x: GRID_SIZE.x - 1 }));
      } else {
        setCursor((c) => ({ ...c, x: Math.max(0, c.x - 1) }));
      }
    }
    if (key.rightArrow) {
      if (subPlacement && placementTerritory === "own" && cursor.x === GRID_SIZE.x - 1) {
        setPlacementTerritory("enemy");
        setCursor((c) => ({ ...c, x: 0 }));
      } else {
        setCursor((c) => ({ ...c, x: Math.min(GRID_SIZE.x - 1, c.x + 1) }));
      }
    }
    if (key.upArrow)    setCursor((c) => ({ ...c, y: Math.max(0, c.y - 1) }));
    if (key.downArrow)  setCursor((c) => ({ ...c, y: Math.min(GRID_SIZE.y - 1, c.y + 1) }));

    if (phase === "placement") {
      if (subPlacement && (input === "r" || input === "f")) {
        if (!currentSpec) return;
        const dz = input === "r" ? 1 : -1;
        setCursor((c) => {
          const nz = c.z + dz;
          if (nz < currentSpec.minDepth || nz > currentSpec.maxDepth) return c;
          return { ...c, z: nz };
        });
      }
      if (key.tab && !subPlacement) setAxis((a) => (a === "x" ? "y" : "x"));
      if ((key.return || input === " ") && room && currentShip) {
        const territory = currentShip === "submarine" ? placementTerritory : "own";
        room.send("place_ship", { shipClass: currentShip, origin: cursor, axis, territory });
      }
    } else if (phase === "combat") {
      if (input === "2") {
        if (weapon === "torpedo" && torpedoArmed) setTorpedoDirIdx((i) => (i + 1) % 6);
        else { setWeapon("torpedo"); setTorpedoDirIdx(0); setTorpedoArmed(true); }
      } else if (input === "1" || input === "3") {
        const idx = "123".indexOf(input);
        setWeapon(WEAPON_KEYS[idx]);
        setTorpedoArmed(false);
      }

      if ((input === " " || key.return) && room) {
        if (weapon === "torpedo") {
          const mySub = placed.find((s) => s.shipClass === "submarine");
          const dirs = mySub ? torpedoDirections(mySub.axis) : [];
          const dir = dirs[torpedoDirIdx];
          if (mySub && dir) {
            room.send("fire", { weapon: "torpedo", target: mySub.origin, direction: dir });
            setTorpedoArmed(false);
          }
        } else {
          room.send("fire", { weapon, target: cursor });
        }
      }
      const moveKey = "adwsrf".includes(input);
      if (moveKey && room) setTorpedoArmed(false);
      if (input === "a" && room) room.send("move_sub", { delta: { x: -1, y: 0, z: 0 } });
      if (input === "d" && room) room.send("move_sub", { delta: {  x: 1, y: 0, z: 0 } });
      if (input === "w" && room) room.send("move_sub", { delta: { x: 0, y: -1, z: 0 } });
      if (input === "s" && room) room.send("move_sub", { delta: { x: 0, y:  1, z: 0 } });
      if (input === "r" && room) room.send("move_sub", { delta: { x: 0, y: 0, z:  1 } });
      if (input === "f" && room) room.send("move_sub", { delta: { x: 0, y: 0, z: -1 } });
    }
  });

  const ownShips = placed.filter((s) => (s.territory ?? "own") === "own");
  const currentWeapon = WEAPONS[weapon];
  const ammoFor = (w: WeaponId) => ammo[w] ?? 0;
  const fmtAmmo = (n: number) => (n === -1 ? "∞" : String(n));

  const mySub = placed.find((s) => s.shipClass === "submarine");
  const torpedoDirs = mySub ? torpedoDirections(mySub.axis) : [];
  const torpedoDir = torpedoDirs[torpedoDirIdx] ?? null;
  const showTorpedo = phase === "combat" && weapon === "torpedo" && torpedoArmed && !!mySub && !!torpedoDir;
  const torpedoPreviewCells = showTorpedo && mySub && torpedoDir
    ? torpedoPath(mySub, torpedoDir).path
    : [];
  const subTerritory = mySub?.territory ?? "own";
  const clusterPreview: Vec3[] =
    phase === "combat" && weapon === "cluster_missile"
      ? [
          { x: cursor.x,     y: cursor.y,     z: 2 },
          { x: cursor.x + 1, y: cursor.y,     z: 2 },
          { x: cursor.x - 1, y: cursor.y,     z: 2 },
          { x: cursor.x,     y: cursor.y + 1, z: 2 },
          { x: cursor.x,     y: cursor.y - 1, z: 2 },
        ].filter((c) => c.x >= 0 && c.x < GRID_SIZE.x && c.y >= 0 && c.y < GRID_SIZE.y)
      : [];
  const dirLabel = (d: Vec3) => {
    if (d.x !== 0) return d.x > 0 ? "+X" : "-X";
    if (d.y !== 0) return d.y > 0 ? "+Y" : "-Y";
    return d.z > 0 ? "+Z" : "-Z";
  };

  if (phase === "menu") {
    return (
      <Box flexDirection="column">
        <Text color="cyanBright">╔══ BATTLESHIP-ASCII • 3D TACTICAL ══╗</Text>
        <Text> </Text>
        <Text>Choose mode:</Text>
        <Text color="yellowBright">  [1] VS HUMAN (online)</Text>
        <Text color="yellowBright">  [2] VS CPU — Easy</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="cyanBright">╔══ BATTLESHIP-ASCII • 3D TACTICAL ══╗</Text>
      <Box>
        <GridView
          title="YOUR WATERS"
          cursor={phase === "placement" && placementTerritory === "own" ? cursor : null}
          placed={ownShips}
          preview={placementTerritory === "own" ? preview : []}
          previewValid={previewValid}
          subHitsFresh={enemy.subHitsFresh.filter(h => h.territory === "own").map(h => h.cell)}
          subHitsFaded={enemy.subHitsFaded.filter(h => h.territory === "own").map(h => h.cell)}
          enemySubCells={enemy.enemySubOn === "own" ? enemy.enemySubCells : []}
          torpedoPreview={[
            ...(showTorpedo && subTerritory === "own" ? torpedoPreviewCells : []),
            ...(enemy.torpedoTrail?.territory === "own" ? enemy.torpedoTrail.cells : []),
          ]}
        />
        <Box marginLeft={2}>
          <GridView
            title="ENEMY WATERS"
            cursor={
              phase === "combat"
                ? cursor
                : phase === "placement" && placementTerritory === "enemy"
                ? cursor
                : null
            }
            preview={phase === "placement" && placementTerritory === "enemy" ? preview : []}
            previewValid={previewValid}
            hits={enemy.hits}
            misses={enemy.misses}
            revealed={enemy.revealedShipCells}
            mySubCells={enemy.mySubInEnemy}
            subHitsFresh={enemy.subHitsFresh.filter(h => h.territory === "enemy").map(h => h.cell)}
            subHitsFaded={enemy.subHitsFaded.filter(h => h.territory === "enemy").map(h => h.cell)}
            clusterPreview={clusterPreview}
            enemySubCells={enemy.enemySubOn === "enemy" ? enemy.enemySubCells : []}
            torpedoPreview={[
              ...(showTorpedo && subTerritory === "enemy" ? torpedoPreviewCells : []),
              ...(enemy.torpedoTrail?.territory === "enemy" ? enemy.torpedoTrail.cells : []),
            ]}
          />
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {phase === "placement" && currentSpec ? (
          <>
            <Text color="yellowBright">
              Placing: {currentSpec.name} (len {currentSpec.length})  {currentShip === "submarine" ? `waters: ${placementTerritory.toUpperCase()}` : `axis: ${axis.toUpperCase()}`}  z{currentSpec.minDepth}-z{currentSpec.maxDepth}
            </Text>
            <Text dimColor>
              fleet: {placed.length}/{placed.length + remaining.length}  •  arrows=move{currentShip === "submarine" ? "/cross" : ""}  {currentShip === "submarine" ? "r/f=depth" : "tab=axis"}  space/enter=place
            </Text>
          </>
        ) : phase === "placement" ? (
          <Text color="greenBright">✓ fleet deployed — waiting for opponent</Text>
        ) : phase === "combat" ? (
          <>
            <Text color={myTurn ? "greenBright" : "gray"}>
              {myTurn ? "▶ YOUR TURN" : "◦ opponent's turn"}
            </Text>
            <Text>
              Weapon: <Text color="yellowBright">{currentWeapon.name}{showTorpedo && torpedoDir ? ` (${dirLabel(torpedoDir)})` : ""}</Text>
              {"  "}ammo: <Text color="cyanBright">{fmtAmmo(ammoFor(weapon))}</Text>
            </Text>
            <Box>
              {WEAPON_KEYS.map((w, i) => (
                <Box key={w} marginRight={2}>
                  <Text color={w === weapon ? "yellowBright" : "gray"}>
                    [{i + 1}]{WEAPONS[w].name.split(" ")[0]}({fmtAmmo(ammoFor(w))})
                  </Text>
                </Box>
              ))}
            </Box>
            <Text dimColor>arrows=aim  1-3=weapon (2 cycles torpedo dir)  space/enter=fire</Text>
            <Text dimColor>wasd=move sub (xy)  r/f=sub depth</Text>
          </>
        ) : phase === "ended" ? (
          <Text color={winnerId === sessionId ? "greenBright" : "redBright"}>
            {winnerId === sessionId ? "★ VICTORY ★" : "✗ DEFEATED ✗"}
          </Text>
        ) : (
          <Text dimColor>{phase}</Text>
        )}
        {log.slice(-4).map((l, i) => <Text key={i} color="yellow">{l}</Text>)}
      </Box>
    </Box>
  );
}
