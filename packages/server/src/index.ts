import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  ClientMessage,
  CrumbState,
  DIRECTION_DELTAS,
  DIRECTIONS,
  Direction,
  GameState,
  MazeSummary,
  OPPOSITE_DIRECTION,
  PlayerPublicState,
  ServerMessage,
  Vector3,
  manhattanDistance,
  samePosition
} from "@maze3d/shared";

interface Cell {
  position: Vector3;
  visitCount: number;
  open: Set<Direction>;
}

interface Player {
  id: string;
  name: string;
  color: string;
  position: Vector3;
  joinedAt: string;
  traveledDistance: number;
  socket: WebSocket;
  mazeId: string;
}

interface Maze {
  id: string;
  name: string;
  dimensions: Vector3;
  exit: Vector3;
  cells: Map<string, Cell>;
  players: Map<string, Player>;
  crumbs: Map<string, CrumbState>;
}

// Runtime settings define the generated in-memory world; no game state is persisted.
const config = {
  port: readIntEnv("PORT", 3000, 1, 65535),
  mazeCount: readIntEnv("MAZE_COUNT", 3, 1, 50),
  dimensions: {
    x: readIntEnv("MAZE_SIZE_X", 4, 2, 50),
    y: readIntEnv("MAZE_SIZE_Y", 4, 2, 50),
    z: readIntEnv("MAZE_SIZE_Z", 4, 2, 50)
  },
  crumbLimit: readIntEnv("CRUMB_LIMIT", 10, 0, 100)
};

const mazes = new Map<string, Maze>();
const socketPlayers = new Map<WebSocket, Player>();

for (let index = 1; index <= config.mazeCount; index += 1) {
  const maze = generateMaze(`maze-${index}`, `Maze ${index}`, config.dimensions);
  mazes.set(maze.id, maze);
}

const app = express();
app.get("/health", (_request, response) => {
  response.json({ ok: true, mazes: mazes.size });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_request, response) => {
  response.sendFile(path.join(clientDist, "index.html"));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// A single WebSocket endpoint serves both lobby and in-game commands.
wss.on("connection", (socket) => {
  send(socket, { type: "mazeList", mazes: getMazeSummaries() });

  socket.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (!message) {
      send(socket, { type: "error", message: "Invalid JSON message." });
      return;
    }
    handleMessage(socket, message);
  });

  socket.on("close", () => removePlayer(socket));
});

server.listen(config.port, () => {
  console.log(`Maze3D server listening on http://localhost:${config.port}`);
  console.log(`Generated ${config.mazeCount} maze(s) with dimensions ${config.dimensions.x}x${config.dimensions.y}x${config.dimensions.z}`);
});

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function parseMessage(raw: string): ClientMessage | null {
  try {
    return JSON.parse(raw) as ClientMessage;
  } catch {
    return null;
  }
}

function handleMessage(socket: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case "listMazes":
      send(socket, { type: "mazeList", mazes: getMazeSummaries() });
      return;
    case "joinMaze":
      joinMaze(socket, message.mazeId, message.name, message.color);
      return;
    case "move":
      movePlayer(socket, message.direction);
      return;
    case "placeCrumb":
      placeCrumb(socket);
      return;
    case "pickupCrumb":
      pickupCrumb(socket);
      return;
    default:
      send(socket, { type: "error", message: "Unknown message type." });
  }
}

function generateMaze(id: string, name: string, dimensions: Vector3): Maze {
  const cells = new Map<string, Cell>();
  for (let x = 0; x < dimensions.x; x += 1) {
    for (let y = 0; y < dimensions.y; y += 1) {
      for (let z = 0; z < dimensions.z; z += 1) {
        const position = { x, y, z };
        cells.set(key(position), { position, visitCount: 0, open: new Set() });
      }
    }
  }

  const visited = new Set<string>();
  const stack: Vector3[] = [{ x: 0, y: 0, z: 0 }];
  visited.add(key(stack[0]));

  // Depth-first carving creates one connected 3D maze graph with bidirectional passages.
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const candidates = shuffle(DIRECTIONS)
      .map((direction) => ({ direction, next: add(current, DIRECTION_DELTAS[direction]) }))
      .filter(({ next }) => inBounds(next, dimensions) && !visited.has(key(next)));

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const { direction, next } = candidates[0];
    cell(cells, current).open.add(direction);
    cell(cells, next).open.add(OPPOSITE_DIRECTION[direction]);
    visited.add(key(next));
    stack.push(next);
  }

  const boundaryCells = [...cells.values()].filter(({ position }) => isBoundary(position, dimensions));
  const exit = boundaryCells[Math.floor(Math.random() * boundaryCells.length)].position;
  return { id, name, dimensions, exit, cells, players: new Map(), crumbs: new Map() };
}

function joinMaze(socket: WebSocket, mazeId: string, rawName: string, rawColor: string): void {
  removePlayer(socket);
  const maze = mazes.get(mazeId);
  if (!maze) {
    send(socket, { type: "error", message: "Maze not found." });
    return;
  }

  const player: Player = {
    id: crypto.randomUUID(),
    name: sanitizeName(rawName),
    color: sanitizeColor(rawColor),
    position: randomSpawn(maze),
    joinedAt: new Date().toISOString(),
    traveledDistance: 0,
    socket,
    mazeId: maze.id
  };

  maze.players.set(player.id, player);
  socketPlayers.set(socket, player);
  cell(maze.cells, player.position).visitCount += 1;

  send(socket, { type: "joined", playerId: player.id, state: buildGameState(maze, player) });
  broadcastToMaze(maze, { type: "playerJoined", player: publicPlayer(player) }, player.id);
  broadcastMazeList();
  broadcastStates(maze);
}

function movePlayer(socket: WebSocket, direction: Direction): void {
  const context = getContext(socket);
  if (!context) return;
  const { maze, player } = context;
  if (!DIRECTIONS.includes(direction)) {
    send(socket, { type: "error", message: "Invalid direction." });
    return;
  }

  const currentCell = cell(maze.cells, player.position);
  if (!currentCell.open.has(direction)) {
    send(socket, { type: "error", message: "That direction is blocked by a wall." });
    return;
  }

  player.position = add(player.position, DIRECTION_DELTAS[direction]);
  player.traveledDistance += 1;
  cell(maze.cells, player.position).visitCount += 1;
  broadcastStates(maze);

  if (samePosition(player.position, maze.exit)) {
    broadcastToMaze(maze, {
      type: "exitReached",
      playerId: player.id,
      playerName: player.name,
      traveledDistance: player.traveledDistance
    });
  }
}

function placeCrumb(socket: WebSocket): void {
  const context = getContext(socket);
  if (!context) return;
  const { maze, player } = context;
  const ownCrumbs = [...maze.crumbs.values()].filter((crumb) => crumb.ownerId === player.id);
  if (ownCrumbs.length >= config.crumbLimit) {
    send(socket, { type: "error", message: "No crumbs left." });
    return;
  }
  if (ownCrumbs.some((crumb) => samePosition(crumb.position, player.position))) {
    send(socket, { type: "error", message: "You already have a crumb on this field." });
    return;
  }

  const crumb: CrumbState = {
    id: crypto.randomUUID(),
    ownerId: player.id,
    ownerName: player.name,
    ownerColor: player.color,
    position: { ...player.position },
    placedAt: new Date().toISOString()
  };
  maze.crumbs.set(crumb.id, crumb);
  broadcastStates(maze);
}

function pickupCrumb(socket: WebSocket): void {
  const context = getContext(socket);
  if (!context) return;
  const { maze, player } = context;
  const crumb = [...maze.crumbs.values()].find((candidate) => candidate.ownerId === player.id && samePosition(candidate.position, player.position));
  if (!crumb) {
    send(socket, { type: "error", message: "There is no own crumb to pick up here." });
    return;
  }
  maze.crumbs.delete(crumb.id);
  broadcastStates(maze);
}

function removePlayer(socket: WebSocket): void {
  const player = socketPlayers.get(socket);
  if (!player) return;
  const maze = mazes.get(player.mazeId);
  socketPlayers.delete(socket);
  if (!maze) return;
  maze.players.delete(player.id);
  for (const crumb of [...maze.crumbs.values()]) {
    if (crumb.ownerId === player.id) maze.crumbs.delete(crumb.id);
  }
  broadcastToMaze(maze, { type: "playerLeft", playerId: player.id, playerName: player.name });
  broadcastStates(maze);
  broadcastMazeList();
}

function getContext(socket: WebSocket): { maze: Maze; player: Player } | null {
  const player = socketPlayers.get(socket);
  const maze = player ? mazes.get(player.mazeId) : undefined;
  if (!player || !maze) {
    send(socket, { type: "error", message: "Join a maze first." });
    return null;
  }
  return { maze, player };
}

function buildGameState(maze: Maze, self: Player): GameState {
  const currentCell = cell(maze.cells, self.position);
  const crumbs = [...maze.crumbs.values()];
  const ownCrumbCount = crumbs.filter((crumb) => crumb.ownerId === self.id).length;
  // Clients receive only the current cell, public player data, and global crumb markers.
  return {
    maze: { ...summary(maze), exit: maze.exit },
    self: { ...publicPlayer(self), remainingCrumbs: config.crumbLimit - ownCrumbCount, crumbLimit: config.crumbLimit },
    cell: {
      position: self.position,
      visitCount: currentCell.visitCount,
      availableDirections: [...currentCell.open],
      isExit: samePosition(self.position, maze.exit),
      crumbs: crumbs.filter((crumb) => samePosition(crumb.position, self.position))
    },
    players: [...maze.players.values()]
      .filter((player) => player.id !== self.id)
      .map((player) => ({ ...publicPlayer(player), manhattanDistance: manhattanDistance(self.position, player.position) })),
    crumbs
  };
}

function broadcastStates(maze: Maze): void {
  for (const player of maze.players.values()) {
    send(player.socket, { type: "stateUpdate", state: buildGameState(maze, player) });
  }
}

function broadcastToMaze(maze: Maze, message: ServerMessage, exceptPlayerId?: string): void {
  for (const player of maze.players.values()) {
    if (player.id !== exceptPlayerId) send(player.socket, message);
  }
}

function broadcastMazeList(): void {
  const message: ServerMessage = { type: "mazeList", mazes: getMazeSummaries() };
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) send(socket, message);
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function getMazeSummaries(): MazeSummary[] {
  return [...mazes.values()].map(summary);
}

function summary(maze: Maze): MazeSummary {
  return { id: maze.id, name: maze.name, dimensions: maze.dimensions, playerCount: maze.players.size };
}

function publicPlayer(player: Player): PlayerPublicState {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    position: player.position,
    joinedAt: player.joinedAt,
    traveledDistance: player.traveledDistance
  };
}

function randomSpawn(maze: Maze): Vector3 {
  const candidates = [...maze.cells.values()].map((candidate) => candidate.position).filter((position) => !samePosition(position, maze.exit));
  return { ...candidates[Math.floor(Math.random() * candidates.length)] };
}

function sanitizeName(name: string): string {
  const trimmed = name.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : "Anonymous";
}

function sanitizeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#4f8cff";
}

function cell(cells: Map<string, Cell>, position: Vector3): Cell {
  const found = cells.get(key(position));
  if (!found) throw new Error(`Missing cell ${key(position)}`);
  return found;
}

function key(position: Vector3): string {
  return `${position.x},${position.y},${position.z}`;
}

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function inBounds(position: Vector3, dimensions: Vector3): boolean {
  return position.x >= 0 && position.y >= 0 && position.z >= 0 && position.x < dimensions.x && position.y < dimensions.y && position.z < dimensions.z;
}

function isBoundary(position: Vector3, dimensions: Vector3): boolean {
  return position.x === 0 || position.y === 0 || position.z === 0 || position.x === dimensions.x - 1 || position.y === dimensions.y - 1 || position.z === dimensions.z - 1;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
