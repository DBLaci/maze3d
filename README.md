# Maze3D

Maze3D is a multiplayer browser game where players explore generated 3D mazes through a fixed, non-rotating 2D perspective view. The game runs with a TypeScript Node.js server, an Express HTTP app, a `ws` WebSocket game channel, and a Vite browser client.

## Game rules

- A maze is generated automatically when the server starts.
- The default maze size is `4x4x4`, configurable through environment variables.
- Each maze has exactly one exit cell.
- Every player starts on a random non-exit cell.
- Players cannot look around or rotate; movement is absolute in six directions: left, right, up, down, forward, and backward.
- The UI shows only movement directions that are open from the current cell.
- Every successful move increments the player's traveled distance by `1`.
- Every cell stores a `visitCount`; repeated visits make the current field look more worn.
- The status panel shows other players and their Manhattan distance from the current player. Walls are ignored for this distance.
- Each player receives `10` crumbs by default.
- A player can place crumbs on visited fields and pick up only their own crumbs.
- Crumbs are visible to everyone and show owner name, owner color, and placement time.
- When a player disconnects, their crumbs are removed.

## Architecture

```text
.
├── packages/shared  Shared TypeScript message and game-state types
├── packages/server  Express + ws server and in-memory maze state
├── packages/client  Vite browser client
├── Dockerfile       Production container build
└── docker-compose.yml
```

The server keeps all game data in memory:

- generated mazes,
- cells and visit counts,
- one exit per maze,
- active players,
- player positions,
- join timestamps,
- traveled distances,
- placed crumbs.

Restarting the container regenerates all mazes and clears game state.

## Runtime configuration

| Variable | Default | Description |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP and WebSocket port inside the container. |
| `MAZE_COUNT` | `3` | Number of generated maze instances. |
| `MAZE_SIZE_X` | `4` | Maze width. |
| `MAZE_SIZE_Y` | `4` | Maze height. |
| `MAZE_SIZE_Z` | `4` | Maze depth. |
| `CRUMB_LIMIT` | `10` | Number of crumbs available to each joining player. |

## Docker Compose workflow

Docker Compose is the only supported workflow for installing dependencies, building, running, and checking the project.

Start the game in detached watch mode:

```bash
docker compose up -d
```

Open the browser at:

```text
http://localhost:3000
```

The default service installs dependencies in the container workspace when needed and then runs the shared package, server, and Vite client in watch mode. Source changes are picked up automatically.

View logs:

```bash
docker compose logs -f
```

Rebuild the base image after Dockerfile or package manifest changes:

```bash
docker compose up -d --build
```

Stop the game:

```bash
docker compose down
```

Configuration is read from `.env`:

```dotenv
HTTP_PORT=3000
MAZE_COUNT=3
MAZE_SIZE_X=4
MAZE_SIZE_Y=4
MAZE_SIZE_Z=4
CRUMB_LIMIT=10
```

Change `HTTP_PORT` to expose the browser UI on another host port.

Run one-off validation through the same Compose service:

```bash
docker compose run --rm app sh -c "npm install && npm run build"
docker compose run --rm app sh -c "npm install && npm run typecheck"
```

Because `node_modules/` is ignored by Git, dependencies created by the container stay local and are not committed.

Clean containers:

```bash
docker compose down
```

## Requirements

- Docker,
- Docker Compose.

## WebSocket protocol overview

The client connects to `/ws` and exchanges JSON messages.

Client-to-server messages:

- `listMazes` requests the lobby list.
- `joinMaze` joins a maze with `mazeId`, `name`, and `color`.
- `move` attempts movement in one of the six directions.
- `placeCrumb` places one own crumb on the current cell.
- `pickupCrumb` picks up one own crumb from the current cell.

Server-to-client messages:

- `mazeList` contains available mazes and player counts.
- `joined` confirms a successful join and includes initial game state.
- `stateUpdate` sends the current player's view and status data.
- `playerJoined` and `playerLeft` announce membership changes.
- `exitReached` announces when a player reaches the exit.
- `error` reports validation or protocol errors.

The exact TypeScript message contracts are defined in `packages/shared/src/index.ts`.

## Notes and limitations

- State is intentionally in-memory only.
- There is no authentication; display names are user-provided.
- Maze generation happens once on server startup.
- The client uses a stylized fixed 2D perspective current-cell view rather than a free-camera maze explorer, matching the rule that players cannot rotate or look around.
