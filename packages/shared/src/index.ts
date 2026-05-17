export type Direction = "left" | "right" | "up" | "down" | "forward" | "backward";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

export interface MazeSummary {
  id: string;
  name: string;
  dimensions: Dimensions;
  playerCount: number;
}

export interface CrumbState {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerColor: string;
  position: Vector3;
  placedAt: string;
}

export interface PlayerPublicState {
  id: string;
  name: string;
  color: string;
  position: Vector3;
  joinedAt: string;
  traveledDistance: number;
}

export interface CellViewState {
  position: Vector3;
  visitCount: number;
  availableDirections: Direction[];
  isExit: boolean;
  crumbs: CrumbState[];
}

// The server sends a player-relative projection instead of exposing the full maze graph.
export interface GameState {
  maze: MazeSummary & { exit: Vector3 };
  self: PlayerPublicState & { remainingCrumbs: number; crumbLimit: number };
  cell: CellViewState;
  players: Array<PlayerPublicState & { manhattanDistance: number }>;
  crumbs: CrumbState[];
}

export type ClientMessage =
  | { type: "listMazes" }
  | { type: "joinMaze"; mazeId: string; name: string; color: string }
  | { type: "move"; direction: Direction }
  | { type: "placeCrumb" }
  | { type: "pickupCrumb" };

export type ServerMessage =
  | { type: "mazeList"; mazes: MazeSummary[] }
  | { type: "joined"; playerId: string; state: GameState }
  | { type: "stateUpdate"; state: GameState }
  | { type: "playerJoined"; player: PlayerPublicState }
  | { type: "playerLeft"; playerId: string; playerName: string }
  | { type: "exitReached"; playerId: string; playerName: string; traveledDistance: number }
  | { type: "error"; message: string };

// Directions are absolute world axes because the game intentionally has no player rotation.
export const DIRECTIONS: Direction[] = ["left", "right", "up", "down", "forward", "backward"];

export const DIRECTION_DELTAS: Record<Direction, Vector3> = {
  left: { x: -1, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
  forward: { x: 0, y: 0, z: 1 },
  backward: { x: 0, y: 0, z: -1 }
};

export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
  forward: "backward",
  backward: "forward"
};

export function samePosition(a: Vector3, b: Vector3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function manhattanDistance(a: Vector3, b: Vector3): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}
