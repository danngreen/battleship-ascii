import pkg from "colyseus";
import wsPkg from "@colyseus/ws-transport";
const { Server } = pkg;
const { WebSocketTransport } = wsPkg;
import { createServer } from "http";
import { BattleRoom } from "./rooms/BattleRoom.js";

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

gameServer.define("battle", BattleRoom).enableRealtimeListing();

gameServer.listen(PORT).then(() => {
  console.log(`⚓ battleship-ascii server listening on ws://localhost:${PORT}`);
});
