import pkg from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import {
  ClientMsg,
  DEFAULT_FLEET,
  GRID_SIZE,
  STARTER_AMMO,
  WEAPONS,
  resolveFire,
  validatePlacement,
  type FireContext,
  type PlacedShip,
  type ShipClass,
  type Vec3,
  type WeaponId,
} from "@battleship/shared";
import { createStrategy, type AIStrategy } from "../ai/strategies.js";

const AI_ID = "AI";
const { Room } = pkg;
type Client = import("colyseus").Client;

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") credits = 500;
  @type("boolean") ready = false;
  @type("boolean") alive = true;
  @type("number") shipsPlaced = 0;
  @type("number") shipsTotal = DEFAULT_FLEET.length;
}

export class BattleState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("string") phase: "lobby" | "placement" | "market" | "combat" | "ended" = "lobby";
  @type("string") turnPlayerId = "";
  @type("string") winnerId = "";
  @type("number") tick = 0;
}

const cellKey = (c: Vec3) => `${c.x},${c.y},${c.z}`;

export class BattleRoom extends Room<BattleState> {
  maxClients = 2;
  private solo = false;
  private ai: AIStrategy | null = null;

  private placedShips = new Map<string, PlacedShip[]>();
  private remainingShips = new Map<string, ShipClass[]>();
  private revealedEnemy = new Map<string, Map<string, Vec3>>();
  private myHits = new Map<string, Map<string, Vec3>>();
  private myMisses = new Map<string, Map<string, Vec3>>();
  private ammo = new Map<string, Map<WeaponId, number>>();
  private torpedoTrails = new Map<string, { cells: Vec3[]; territory: "own" | "enemy" }>();
  private subHitsFresh = new Map<string, Map<string, { cell: Vec3; territory: "own" | "enemy" }>>();
  private subHitsFaded = new Map<string, Map<string, { cell: Vec3; territory: "own" | "enemy" }>>();

  onCreate(options: { solo?: boolean; aiLevel?: "easy" } = {}) {
    this.solo = !!options.solo;
    if (this.solo) {
      this.maxClients = 1;
      this.ai = createStrategy(options.aiLevel ?? "easy");
    }
    this.setState(new BattleState());
    this.onMessage("*", (client, type, payload) => {
      const parsed = ClientMsg.safeParse({ type, ...(payload ?? {}) });
      if (!parsed.success) {
        client.send("error", { message: parsed.error.message });
        return;
      }
      this.handle(client, parsed.data);
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = options.name ?? `Captain-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, p);

    this.placedShips.set(client.sessionId, []);
    this.remainingShips.set(client.sessionId, [...DEFAULT_FLEET]);
    this.revealedEnemy.set(client.sessionId, new Map());
    this.myHits.set(client.sessionId, new Map());
    this.myMisses.set(client.sessionId, new Map());
    this.subHitsFresh.set(client.sessionId, new Map());
    this.subHitsFaded.set(client.sessionId, new Map());
    const inv = new Map<WeaponId, number>();
    for (const [w, n] of Object.entries(STARTER_AMMO)) inv.set(w as WeaponId, n);
    this.ammo.set(client.sessionId, inv);

    this.sendFleet(client);
    this.sendInventory(client);
    this.sendTerritoryView(client);

    if (this.solo && !this.state.players.has(AI_ID)) this.synthesizeAIPlayer();

    if (this.state.players.size >= 2) this.state.phase = "placement";
  }

  private synthesizeAIPlayer() {
    const p = new PlayerState();
    p.id = AI_ID;
    p.name = "CPU";
    this.state.players.set(AI_ID, p);

    this.placedShips.set(AI_ID, []);
    this.remainingShips.set(AI_ID, [...DEFAULT_FLEET]);
    this.revealedEnemy.set(AI_ID, new Map());
    this.myHits.set(AI_ID, new Map());
    this.myMisses.set(AI_ID, new Map());
    this.subHitsFresh.set(AI_ID, new Map());
    this.subHitsFaded.set(AI_ID, new Map());
    const inv = new Map<WeaponId, number>();
    for (const [w, n] of Object.entries(STARTER_AMMO)) inv.set(w as WeaponId, n);
    this.ammo.set(AI_ID, inv);

    this.aiPlaceFleet();
  }

  private aiPlaceFleet() {
    if (!this.ai) return;
    const placed = this.ai.placeFleet();
    this.placedShips.set(AI_ID, placed);
    this.remainingShips.set(AI_ID, []);
    const p = this.state.players.get(AI_ID);
    if (p) {
      p.ready = true;
      p.shipsPlaced = placed.length;
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.placedShips.delete(client.sessionId);
    this.remainingShips.delete(client.sessionId);
    this.revealedEnemy.delete(client.sessionId);
    this.myHits.delete(client.sessionId);
    this.myMisses.delete(client.sessionId);
    this.ammo.delete(client.sessionId);
    this.torpedoTrails.delete(client.sessionId);
    this.subHitsFresh.delete(client.sessionId);
    this.subHitsFaded.delete(client.sessionId);
  }

  private opponentId(sessionId: string): string | undefined {
    for (const id of this.state.players.keys()) if (id !== sessionId) return id;
    return undefined;
  }

  private clientFor(sessionId: string): Client | undefined {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private flipTurn() {
    const ids = [...this.state.players.keys()];
    const other = ids.find((id) => id !== this.state.turnPlayerId);
    if (other) {
      this.state.turnPlayerId = other;
      let dirty = false;
      if (this.torpedoTrails.has(other)) {
        this.torpedoTrails.delete(other);
        dirty = true;
      }
      const fresh = this.subHitsFresh.get(other);
      const faded = this.subHitsFaded.get(other);
      if (fresh && fresh.size > 0 && faded) {
        for (const [k, v] of fresh) faded.set(k, v);
        fresh.clear();
        dirty = true;
      }
      if (dirty) {
        const oc = this.clientFor(other);
        if (oc) this.sendTerritoryView(oc);
      }
      if (this.solo && other === AI_ID) {
        this.clock.setTimeout(() => this.aiTakeTurn(), 700);
      }
    }
  }

  private sendFleet(client: Client) {
    client.send("fleet_update", {
      placed: this.placedShips.get(client.sessionId) ?? [],
      remaining: this.remainingShips.get(client.sessionId) ?? [],
    });
  }

  private sendInventory(client: Client) {
    const inv = this.ammo.get(client.sessionId);
    const out: Record<string, number> = {};
    if (inv) for (const [w, n] of inv) out[w] = n;
    client.send("inventory_update", out);
  }

  private sendTerritoryView(client: Client) {
    const placed = this.placedShips.get(client.sessionId) ?? [];
    const sub = placed.find((s) => s.shipClass === "submarine");
    const oppId = this.opponentId(client.sessionId);
    const oppSub = oppId
      ? (this.placedShips.get(oppId) ?? []).find((s) => s.shipClass === "submarine")
      : undefined;

    const mySubInEnemy: Vec3[] = [];
    let enemySubCells: Vec3[] = [];
    let enemySubOn: "own" | "enemy" | null = null;

    const persistent = this.revealedEnemy.get(client.sessionId) ?? new Map<string, Vec3>();
    if (sub && sub.territory === "enemy") {
      mySubInEnemy.push(...sub.cells);
      if (oppId) {
        const oppShips = this.placedShips.get(oppId) ?? [];
        const plus: Vec3[] = [];
        for (const sc of sub.cells) {
          for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
            plus.push({ x: sc.x + dx, y: sc.y + dy, z: GRID_SIZE.z - 1 });
          }
        }
        for (const ship of oppShips) {
          if (ship.shipClass === "submarine") continue;
          for (const oc of ship.cells) {
            for (const pc of plus) {
              if (pc.x === oc.x && pc.y === oc.y && pc.z === oc.z) {
                persistent.set(cellKey(oc), oc);
                break;
              }
            }
          }
        }
      }
    }
    const revealedShipCells: Vec3[] = [...persistent.values()];

    if (sub && oppSub) {
      const myTerr = sub.territory ?? "own";
      const oppTerr = oppSub.territory ?? "own";
      if (myTerr !== oppTerr) {
        let minDist = Infinity;
        for (const a of sub.cells) {
          for (const b of oppSub.cells) {
            const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
            if (d < minDist) minDist = d;
          }
        }
        if (minDist <= 2) {
          enemySubCells = oppSub.cells;
          enemySubOn = oppTerr === "own" ? "enemy" : "own";
        }
      }
    }

    const hits = [...(this.myHits.get(client.sessionId)?.values() ?? [])];
    const misses = [...(this.myMisses.get(client.sessionId)?.values() ?? [])];
    const trail = this.torpedoTrails.get(client.sessionId) ?? null;
    const subHitsFresh = [...(this.subHitsFresh.get(client.sessionId)?.values() ?? [])];
    const subHitsFaded = [...(this.subHitsFaded.get(client.sessionId)?.values() ?? [])];

    client.send("territory_view", {
      hits,
      misses,
      revealedShipCells,
      mySubInEnemy,
      enemySubCells,
      enemySubOn,
      torpedoTrail: trail,
      subHitsFresh,
      subHitsFaded,
    });
  }

  private broadcastTerritoryViews() {
    this.clients.forEach((c) => this.sendTerritoryView(c));
  }

  private doMoveSub(sessionId: string, delta: Vec3) {
    const client = this.clientFor(sessionId);
    if (this.state.phase !== "combat") {
      client?.send("error", { message: "not in combat" });
      return;
    }
    if (this.state.turnPlayerId !== sessionId) {
      client?.send("error", { message: "not your turn" });
      return;
    }
    const placed = this.placedShips.get(sessionId) ?? [];
    const sub = placed.find((s) => s.shipClass === "submarine");
    if (!sub) { client?.send("error", { message: "no submarine" }); return; }
    if (sub.damage && sub.damage.every((x) => x)) {
      client?.send("error", { message: "submarine destroyed" });
      return;
    }

    const stepSum = Math.abs(delta.x) + Math.abs(delta.y) + Math.abs(delta.z);
    if (stepSum !== 1) { client?.send("error", { message: "invalid move" }); return; }

    let newCells = sub.cells.map((c) => ({ x: c.x + delta.x, y: c.y + delta.y, z: c.z + delta.z }));
    let crossed = false;
    const offXMin = newCells.some((c) => c.x < 0);
    const offXMax = newCells.some((c) => c.x >= GRID_SIZE.x);
    if (offXMin || offXMax) {
      newCells = sub.cells.map((c) => ({ x: GRID_SIZE.x - 1 - c.x, y: c.y, z: c.z }));
      crossed = true;
    }

    for (const c of newCells) {
      if (c.y < 0 || c.y >= GRID_SIZE.y) { client?.send("error", { message: "out of bounds" }); return; }
      if (c.z < 0 || c.z > 1) { client?.send("error", { message: "submarine cannot surface" }); return; }
    }

    const currentTerritory = sub.territory ?? "own";
    const newTerritory = crossed ? (currentTerritory === "own" ? "enemy" : "own") : currentTerritory;

    if (newTerritory === "own") {
      const others = placed.filter((s) => s !== sub);
      const occupied = new Set(others.flatMap((s) => s.cells.map(cellKey)));
      for (const c of newCells) {
        if (occupied.has(cellKey(c))) { client?.send("error", { message: "collision" }); return; }
      }
    } else {
      const oppId = this.opponentId(sessionId);
      const oppSub = oppId
        ? (this.placedShips.get(oppId) ?? []).find(
            (s) => s.shipClass === "submarine" && (s.territory ?? "own") === "own",
          )
        : undefined;
      if (oppSub) {
        const occupied = new Set(oppSub.cells.map(cellKey));
        for (const c of newCells) {
          if (occupied.has(cellKey(c))) { client?.send("error", { message: "submerged collision" }); return; }
        }
      }
    }

    sub.cells = newCells;
    sub.origin = newCells[0];
    sub.territory = newTerritory;
    if (client) this.sendFleet(client);
    this.broadcastTerritoryViews();
    this.flipTurn();
  }

  private doFire(sessionId: string, weaponId: WeaponId, target: Vec3, direction?: Vec3) {
    const client = this.clientFor(sessionId);
    if (this.state.phase !== "combat") return;
    if (this.state.turnPlayerId !== sessionId) {
      client?.send("error", { message: "not your turn" });
      return;
    }
    const weapon = WEAPONS[weaponId];
    if (!weapon) { client?.send("error", { message: "unknown weapon" }); return; }
    const inv = this.ammo.get(sessionId);
    const have = inv?.get(weaponId);
    if (have === undefined || (have !== -1 && have <= 0)) {
      client?.send("error", { message: "out of ammo" });
      return;
    }

    const oppId = this.opponentId(sessionId);
    if (!oppId) return;
    const myPlaced = this.placedShips.get(sessionId) ?? [];
    const oppShips = this.placedShips.get(oppId) ?? [];
    const vulnerable = new Set<string>();
    for (const s of oppShips) {
      if ((s.territory ?? "own") === "own") {
        s.cells.forEach((c) => vulnerable.add(cellKey(c)));
      }
    }

    const mySub = myPlaced.find((s) => s.shipClass === "submarine");
    const oppSub = oppShips.find((s) => s.shipClass === "submarine");
    if (weaponId === "torpedo") {
      if (!mySub || (mySub.damage && mySub.damage.every((x) => x))) {
        client?.send("error", { message: "submarine destroyed" });
        return;
      }
    }
    const subsInSameWaters =
      !!mySub && !!oppSub &&
      ((mySub.territory ?? "own") !== (oppSub.territory ?? "own"));
    const enemySubCells = subsInSameWaters && oppSub
      ? new Set(oppSub.cells.map(cellKey))
      : new Set<string>();

    const ctx: FireContext = {
      enemyShipCells: vulnerable,
      enemySubCells,
      shooterSub: mySub,
      direction,
    };
    const { hits, misses, reveals } = resolveFire(weaponId, target, ctx);

    const sunkBefore = new Set<ShipClass>();
    for (const s of oppShips) {
      if (s.damage && s.damage.every((d) => d)) sunkBefore.add(s.shipClass);
    }

    for (const h of hits) {
      const k = cellKey(h);
      for (const s of oppShips) {
        const i = s.cells.findIndex((c) => cellKey(c) === k);
        if (i >= 0) {
          if (!s.damage) s.damage = s.cells.map(() => false);
          s.damage[i] = true;
          break;
        }
      }
    }

    for (const s of oppShips) {
      if (s.damage && s.damage.every((d) => d) && !sunkBefore.has(s.shipClass)) {
        this.broadcast("ship_sunk", { ownerId: oppId, shipClass: s.shipClass });
      }
    }

    const myH = this.myHits.get(sessionId)!;
    const myM = this.myMisses.get(sessionId)!;
    if (weaponId === "torpedo") {
      const territory: "own" | "enemy" = mySub?.territory ?? "own";
      const fresh = this.subHitsFresh.get(sessionId)!;
      const faded = this.subHitsFaded.get(sessionId)!;
      for (const h of hits) {
        const k = cellKey(h);
        faded.delete(k);
        fresh.set(k, { cell: h, territory });
      }
      if (misses.length > 0) {
        this.torpedoTrails.set(sessionId, {
          cells: misses,
          territory: mySub?.territory ?? "own",
        });
      }
    } else {
      for (const h of hits) myH.set(cellKey(h), h);
      for (const m of misses) {
        const k = cellKey(m);
        if (!myH.has(k)) myM.set(k, m);
      }
    }
    const rev = this.revealedEnemy.get(sessionId)!;
    for (const r of reveals) rev.set(cellKey(r), r);

    if (have !== -1) inv!.set(weaponId, have - 1);
    if (client) this.sendInventory(client);

    const oppClient = this.clientFor(oppId);
    if (oppClient) this.sendFleet(oppClient);

    if (this.isFleetSunk(oppId)) {
      this.state.phase = "ended";
      this.state.winnerId = sessionId;
      const opp = this.state.players.get(oppId);
      if (opp) opp.alive = false;
    }

    this.broadcastTerritoryViews();
    if (this.state.phase === "combat") this.flipTurn();
  }

  private aiTakeTurn() {
    if (!this.ai) return;
    if (this.state.phase !== "combat") return;
    if (this.state.turnPlayerId !== AI_ID) return;
    const action = this.ai.takeTurn({
      fleet: this.placedShips.get(AI_ID) ?? [],
      ammo: this.ammo.get(AI_ID) ?? new Map(),
      myHits: this.myHits.get(AI_ID) ?? new Map(),
      myMisses: this.myMisses.get(AI_ID) ?? new Map(),
    });
    if (action.type === "fire") {
      this.doFire(AI_ID, action.weapon, action.target, action.direction);
    } else if (action.type === "move_sub") {
      this.doMoveSub(AI_ID, action.delta);
    }
  }

  private isFleetSunk(sessionId: string): boolean {
    const ships = this.placedShips.get(sessionId) ?? [];
    if (ships.length === 0) return false;
    for (const s of ships) {
      if (!s.damage || s.damage.some((d) => !d)) return false;
    }
    return true;
  }

  private handle(client: Client, msg: ClientMsg) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    switch (msg.type) {
      case "place_ship": {
        if (this.state.phase !== "placement") return;
        const remaining = this.remainingShips.get(client.sessionId) ?? [];
        const shipClass = msg.shipClass as ShipClass;
        if (!remaining.includes(shipClass)) {
          client.send("error", { message: `already placed: ${shipClass}` });
          return;
        }
        const placed = this.placedShips.get(client.sessionId) ?? [];
        const result = validatePlacement(shipClass, msg.origin, msg.axis, placed);
        if (!result.ok) {
          client.send("error", { message: `invalid placement: ${result.error}` });
          return;
        }
        const territory = shipClass === "submarine" ? (msg.territory ?? "own") : "own";
        placed.push({
          shipClass,
          origin: msg.origin,
          axis: msg.axis,
          cells: result.cells,
          territory,
          damage: result.cells.map(() => false),
        });
        this.remainingShips.set(client.sessionId, remaining.filter((s) => s !== shipClass));
        player.shipsPlaced = placed.length;
        this.sendFleet(client);
        this.sendTerritoryView(client);

        if ((this.remainingShips.get(client.sessionId) ?? []).length === 0) {
          player.ready = true;
          if ([...this.state.players.values()].every((p) => p.ready)) {
            this.state.phase = "combat";
            this.state.turnPlayerId = [...this.state.players.keys()][0];
            this.broadcastTerritoryViews();
          }
        }
        return;
      }

      case "move_sub": {
        this.doMoveSub(client.sessionId, msg.delta);
        return;
      }

      case "fire": {
        this.doFire(client.sessionId, msg.weapon as WeaponId, msg.target, msg.direction);
        return;
      }

      case "ready":
        player.ready = true;
        return;

      case "buy": {
        const w = WEAPONS[msg.weapon as WeaponId];
        if (!w) return;
        const total = w.cost * msg.qty;
        if (player.credits < total) {
          client.send("error", { message: "insufficient credits" });
          return;
        }
        player.credits -= total;
        const inv = this.ammo.get(client.sessionId);
        if (inv) {
          const have = inv.get(msg.weapon as WeaponId) ?? 0;
          if (have !== -1) inv.set(msg.weapon as WeaponId, have + msg.qty);
        }
        this.sendInventory(client);
        return;
      }
    }
  }
}
