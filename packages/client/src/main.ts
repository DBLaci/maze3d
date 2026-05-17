import type { ClientMessage, Direction, GameState, MazeSummary, ServerMessage } from "@maze3d/shared";
import { renderLatticeMap } from "./components/latticeMap";
import "./styles.css";

const directionLabels: Record<Direction, string> = {
  left: "← Bal",
  right: "Jobb →",
  up: "⇞ Föl",
  down: "⇟ Le",
  forward: "↑ Előre Z+",
  backward: "↓ Hátra Z-"
};

const controlLayout: Direction[] = ["up", "down", "left", "right", "forward", "backward"];

const fallbackArrows: Record<Direction, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  forward: "⤴",
  backward: "⤴"
};

const keyboardDirections: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "forward",
  ArrowDown: "backward",
  PageUp: "up",
  PageDown: "down"
};

let socket: WebSocket;
let mazes: MazeSummary[] = [];
let state: GameState | null = null;
let selectedMazeId = "";
let lastNotice = "Connecting...";
let discoveredExit: GameState["maze"]["exit"] | null = null;
const preferredNameKey = "maze3d.preferredName";

const appElement = requireElement<HTMLDivElement>("#app");

connect();
render();

window.addEventListener("keydown", handleKeyboard);

function connect(): void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  socket.addEventListener("open", () => {
    lastNotice = "Connected.";
    send({ type: "listMazes" });
    render();
  });
  socket.addEventListener("message", (event) => handleServerMessage(JSON.parse(event.data) as ServerMessage));
  socket.addEventListener("close", () => {
    lastNotice = "Disconnected. Reconnecting...";
    render();
    window.setTimeout(connect, 1500);
  });
  socket.addEventListener("error", () => {
    lastNotice = "Connection error.";
    render();
  });
}

function handleServerMessage(message: ServerMessage): void {
  // Server state is authoritative; local state is only a rendered projection.
  switch (message.type) {
    case "mazeList":
      mazes = message.mazes;
      if (!selectedMazeId && mazes[0]) selectedMazeId = mazes[0].id;
      break;
    case "joined":
    case "stateUpdate":
      state = message.state;
      lastNotice = message.type === "joined" ? "Joined maze." : lastNotice;
      if (message.state.cell.isExit && !discoveredExit) {
        discoveredExit = message.state.maze.exit;
        lastNotice = "Exit discovered! From now on, your map shows it in red.";
      }
      break;
    case "playerJoined":
      lastNotice = `${message.player.name} joined.`;
      break;
    case "playerLeft":
      lastNotice = `${message.playerName} left.`;
      break;
    case "exitReached":
      lastNotice = `${message.playerName} reached the exit in ${message.traveledDistance} moves!`;
      break;
    case "error":
      lastNotice = message.message;
      break;
  }
  render();
}

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function render(): void {
  appElement.innerHTML = state ? gameTemplate(state) : lobbyTemplate();
  bindEvents();
  if (state) {
    const host = document.querySelector<HTMLDivElement>("#maze-view");
    if (host) host.innerHTML = perspectiveViewTemplate(state);
  }
}

function lobbyTemplate(): string {
  const preferredName = localStorage.getItem(preferredNameKey) ?? `Player ${Math.floor(Math.random() * 1000)}`;
  const randomColor = randomPlayerColor();
  return `
    <main class="shell lobby">
      <section class="panel hero">
        <p class="eyebrow">Multiplayer 3D maze</p>
        <h1>Maze3D</h1>
        <p>Choose a generated maze, enter a name and color, then find the only exit while leaving and collecting your own crumbs.</p>
        <p class="notice">${escapeHtml(lastNotice)}</p>
      </section>
      <section class="panel form-panel">
        <label>Name <input id="name" maxlength="24" value="${escapeHtml(preferredName)}" /></label>
        <label>Color <input id="color" type="color" value="${randomColor}" /></label>
        <div class="maze-list">
          ${mazes.map((maze) => `
            <label class="maze-card ${maze.id === selectedMazeId ? "selected" : ""}">
              <input type="radio" name="maze" value="${maze.id}" ${maze.id === selectedMazeId ? "checked" : ""} />
              <strong>${escapeHtml(maze.name)}</strong>
              <span>${maze.dimensions.x}×${maze.dimensions.y}×${maze.dimensions.z}</span>
              <span>${maze.playerCount} player(s)</span>
            </label>
          `).join("")}
        </div>
        <button id="join" ${mazes.length === 0 ? "disabled" : ""}>Join selected maze</button>
      </section>
    </main>
  `;
}

function gameTemplate(game: GameState): string {
  const ownCrumbHere = game.cell.crumbs.some((crumb) => crumb.ownerId === game.self.id);
  const localPlayers = playersOnCurrentField(game);
  return `
    <main class="shell game">
      <section class="panel view-panel">
        <div class="topline">
          <div><strong>${escapeHtml(game.maze.name)}</strong> · ${game.maze.dimensions.x}×${game.maze.dimensions.y}×${game.maze.dimensions.z}</div>
          <div class="player-header"><strong style="color:${game.self.color}">${escapeHtml(game.self.name)}</strong><button id="leave">Leave</button></div>
        </div>
        <p class="help-text">Goal: find the only exit. Move with buttons or keyboard arrows; PageUp/PageDown move vertically, Space places or picks up your own crumb.</p>
        ${discoveredExit ? `<div class="exit-banner">Exit discovered at ${discoveredExit.x}, ${discoveredExit.y}, ${discoveredExit.z}. It is marked red on your map.</div>` : ""}
        <div id="maze-view" class="maze-view"></div>
        <p class="notice ${game.cell.isExit ? "success" : ""}">${escapeHtml(game.cell.isExit ? "You found the exit!" : lastNotice)}</p>
      </section>
      <section class="panel controls-panel">
        <h2>Available directions</h2>
        <div class="directions">
          ${controlLayout.map((direction) => `
            <button class="direction ${game.cell.backtrackDirection === direction ? "backtrack" : ""}" data-direction="${direction}" ${game.cell.availableDirections.includes(direction) ? "" : "disabled"}>${directionLabels[direction]}</button>
          `).join("")}
        </div>
        <div class="actions">
          <button id="place" ${game.self.remainingCrumbs <= 0 ? "disabled" : ""}>Place crumb</button>
          <button id="pickup" ${ownCrumbHere ? "" : "disabled"}>Pick up own crumb</button>
        </div>
        <h2>Status</h2>
        <dl class="stats">
          <dt>Position</dt><dd>${game.self.position.x}, ${game.self.position.y}, ${game.self.position.z}</dd>
          <dt></dt><dd>${miniMapTemplate(game)}</dd>
          <dt>Cell wear visits</dt><dd>${game.cell.visitCount}</dd>
          <dt>Crumbs</dt><dd>${game.self.remainingCrumbs}/${game.self.crumbLimit} remaining</dd>
          <dt>Traveled</dt><dd>${game.self.traveledDistance}</dd>
        </dl>
        <h2>Players nearby</h2>
        <ul class="list">${game.players.map((player) => `<li><span style="color:${player.color}">●</span> ${escapeHtml(player.name)}: ${player.manhattanDistance}</li>`).join("") || "<li>No other players.</li>"}</ul>
        ${localPlayers.length > 0 ? `<h2>Here with you</h2><ul class="list">${localPlayers.map((player) => `<li><span style="color:${player.color}">${escapeHtml(player.name)}</span></li>`).join("")}</ul>` : ""}
        ${game.cell.crumbs.length > 0 ? `<h2>Crumbs here</h2><ul class="list">${game.cell.crumbs.map((crumb) => `<li><span style="color:${crumb.ownerColor}">${escapeHtml(crumb.ownerName)}</span> · ${new Date(crumb.placedAt).toLocaleTimeString()}</li>`).join("")}</ul>` : ""}
      </section>
    </main>
  `;
}

function perspectiveViewTemplate(game: GameState): string {
  const wear = Math.min(game.cell.visitCount / 12, 1);
  const localPlayers = playersOnCurrentField(game);
  return `
    <div class="fallback-view" style="--wear: ${wear}">
      <div class="fallback-scratches">${scratchTemplate(game.cell.visitCount)}</div>
      <div class="fallback-compass">
        ${fallbackDirection(game, "up")}
        ${fallbackDirection(game, "left")}
        <div class="fallback-center ${game.cell.isExit ? "exit" : ""}">
          <strong>${game.cell.isExit ? "Exit" : "Current field"}</strong>
          <span>${game.self.position.x}, ${game.self.position.y}, ${game.self.position.z}</span>
          <span>${game.cell.visitCount} visit(s)</span>
          <div class="fallback-players">${localPlayers.map((player) => `<span title="${escapeHtml(player.name)}" style="--player-color:${player.color}"></span>`).join("")}</div>
        </div>
        ${fallbackDirection(game, "right")}
        ${fallbackDirection(game, "down")}
        ${fallbackDirection(game, "forward")}
        ${fallbackDirection(game, "backward")}
      </div>
      <p>Fixed 2D perspective view: available directions are highlighted.</p>
    </div>
  `;
}

function fallbackDirection(game: GameState, direction: Direction): string {
  return `
    <div class="fallback-arrow ${direction} ${game.cell.availableDirections.includes(direction) ? "open" : "closed"} ${game.cell.backtrackDirection === direction ? "backtrack" : ""}">
      <span>${fallbackArrows[direction]}</span>
      <small>${directionLabels[direction]}</small>
    </div>
  `;
}

function miniMapTemplate(game: GameState): string {
  return renderLatticeMap({ dimensions: game.maze.dimensions, selected: game.self.positionHistory, revealedExit: discoveredExit });
}

function bindEvents(): void {
  document.querySelectorAll<HTMLInputElement>("input[name='maze']").forEach((input) => {
    input.addEventListener("change", () => {
      selectedMazeId = input.value;
      render();
    });
  });
  document.querySelector<HTMLButtonElement>("#join")?.addEventListener("click", () => {
    const name = document.querySelector<HTMLInputElement>("#name")?.value ?? "Anonymous";
    const color = document.querySelector<HTMLInputElement>("#color")?.value ?? "#4f8cff";
    localStorage.setItem(preferredNameKey, name);
    send({ type: "joinMaze", mazeId: selectedMazeId, name, color });
  });
  document.querySelectorAll<HTMLButtonElement>(".direction").forEach((button) => {
    button.addEventListener("click", () => send({ type: "move", direction: button.dataset.direction as Direction }));
  });
  document.querySelector<HTMLButtonElement>("#place")?.addEventListener("click", () => send({ type: "placeCrumb" }));
  document.querySelector<HTMLButtonElement>("#pickup")?.addEventListener("click", () => send({ type: "pickupCrumb" }));
  document.querySelector<HTMLButtonElement>("#leave")?.addEventListener("click", () => {
    socket.close();
    state = null;
    discoveredExit = null;
    render();
  });
}

function handleKeyboard(event: KeyboardEvent): void {
  if (!state || event.repeat || isTypingTarget(event.target)) return;
  const direction = keyboardDirections[event.code];
  if (direction) {
    event.preventDefault();
    if (state.cell.availableDirections.includes(direction)) send({ type: "move", direction });
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    const ownCrumbHere = state.cell.crumbs.some((crumb) => crumb.ownerId === state?.self.id);
    send({ type: ownCrumbHere ? "pickupCrumb" : "placeCrumb" });
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function playersOnCurrentField(game: GameState): GameState["players"] {
  return game.players.filter((player) => player.position.x === game.self.position.x && player.position.y === game.self.position.y && player.position.z === game.self.position.z);
}

function scratchTemplate(visitCount: number): string {
  return Array.from({ length: Math.min(visitCount, 18) }, (_, index) => `<span style="--x:${(index * 17) % 92}%;--y:${(index * 29) % 88}%;--r:${-35 + ((index * 23) % 70)}deg"></span>`).join("");
}

function randomPlayerColor(): string {
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character] ?? character));
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector} element`);
  return element;
}
