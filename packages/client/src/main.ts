import * as THREE from "three";
import type { ClientMessage, Direction, GameState, MazeSummary, ServerMessage } from "@maze3d/shared";
import "./styles.css";

const directionLabels: Record<Direction, string> = {
  left: "← Bal",
  right: "Jobb →",
  up: "↑ Föl",
  down: "↓ Le",
  forward: "Előre ⤴",
  backward: "Hátra ⤵"
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

let socket: WebSocket;
let mazes: MazeSummary[] = [];
let state: GameState | null = null;
let selectedMazeId = "";
let lastNotice = "Connecting...";

const appElement = requireElement<HTMLDivElement>("#app");

// The client renders a fixed current-cell scene, not a free-camera maze explorer.
const renderer = createRenderer();
renderer?.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(4, 4, 6);
camera.lookAt(0, 0, 0);

const ambient = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambient);
const directional = new THREE.DirectionalLight(0xffffff, 0.9);
directional.position.set(4, 8, 6);
scene.add(directional);

const cellGroup = new THREE.Group();
scene.add(cellGroup);

connect();
render();

window.addEventListener("resize", renderThreeScene);

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
    if (!renderer && host) {
      host.innerHTML = fallbackViewTemplate(state);
    } else if (renderer && host && renderer.domElement.parentElement !== host) {
      host.innerHTML = "";
      host.appendChild(renderer.domElement);
    }
    if (renderer) {
      updateThreeScene(state);
      renderThreeScene();
    }
  }
}

function lobbyTemplate(): string {
  return `
    <main class="shell lobby">
      <section class="panel hero">
        <p class="eyebrow">Multiplayer 3D maze</p>
        <h1>Maze3D</h1>
        <p>Choose a generated maze, enter a name and color, then find the only exit while leaving and collecting your own crumbs.</p>
        <p class="notice">${escapeHtml(lastNotice)}</p>
      </section>
      <section class="panel form-panel">
        <label>Name <input id="name" maxlength="24" value="Player ${Math.floor(Math.random() * 1000)}" /></label>
        <label>Color <input id="color" type="color" value="#4f8cff" /></label>
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
  return `
    <main class="shell game">
      <section class="panel view-panel">
        <div class="topline">
          <div><strong>${escapeHtml(game.maze.name)}</strong> · ${game.maze.dimensions.x}×${game.maze.dimensions.y}×${game.maze.dimensions.z}</div>
          <button id="leave">Leave</button>
        </div>
        <div id="maze-view" class="maze-view"></div>
        <p class="notice ${game.cell.isExit ? "success" : ""}">${escapeHtml(game.cell.isExit ? "You found the exit!" : lastNotice)}</p>
      </section>
      <section class="panel controls-panel">
        <h2>Available directions</h2>
        <div class="directions">
          ${controlLayout.map((direction) => `
            <button class="direction" data-direction="${direction}" ${game.cell.availableDirections.includes(direction) ? "" : "disabled"}>${directionLabels[direction]}</button>
          `).join("")}
        </div>
        <div class="actions">
          <button id="place" ${game.self.remainingCrumbs <= 0 ? "disabled" : ""}>Place crumb</button>
          <button id="pickup" ${ownCrumbHere ? "" : "disabled"}>Pick up own crumb</button>
        </div>
        <h2>Status</h2>
        <dl class="stats">
          <dt>Position</dt><dd>${game.self.position.x}, ${game.self.position.y}, ${game.self.position.z}</dd>
          <dt>Cell wear visits</dt><dd>${game.cell.visitCount}</dd>
          <dt>Crumbs</dt><dd>${game.self.remainingCrumbs}/${game.self.crumbLimit} remaining</dd>
          <dt>Traveled</dt><dd>${game.self.traveledDistance}</dd>
        </dl>
        <h2>Players nearby</h2>
        <ul class="list">${game.players.map((player) => `<li><span style="color:${player.color}">●</span> ${escapeHtml(player.name)}: ${player.manhattanDistance}</li>`).join("") || "<li>No other players.</li>"}</ul>
        <h2>Crumbs on this field</h2>
        <ul class="list">${game.cell.crumbs.map((crumb) => `<li><span style="color:${crumb.ownerColor}">●</span> ${escapeHtml(crumb.ownerName)} · ${new Date(crumb.placedAt).toLocaleTimeString()}</li>`).join("") || "<li>No crumbs here.</li>"}</ul>
      </section>
    </main>
  `;
}

function fallbackViewTemplate(game: GameState): string {
  const wear = Math.min(game.cell.visitCount / 12, 1);
  return `
    <div class="fallback-view" style="--wear: ${wear}">
      <div class="fallback-compass">
        ${fallbackDirection(game, "up")}
        ${fallbackDirection(game, "left")}
        <div class="fallback-center ${game.cell.isExit ? "exit" : ""}">
          <strong>${game.cell.isExit ? "Exit" : "Current field"}</strong>
          <span>${game.self.position.x}, ${game.self.position.y}, ${game.self.position.z}</span>
          <span>${game.cell.visitCount} visit(s)</span>
        </div>
        ${fallbackDirection(game, "right")}
        ${fallbackDirection(game, "down")}
        ${fallbackDirection(game, "forward")}
        ${fallbackDirection(game, "backward")}
      </div>
      <p>WebGL is unavailable, so Maze3D is using an accessible fixed-cell fallback view.</p>
    </div>
  `;
}

function fallbackDirection(game: GameState, direction: Direction): string {
  return `
    <div class="fallback-arrow ${direction} ${game.cell.availableDirections.includes(direction) ? "open" : "closed"}">
      <span>${fallbackArrows[direction]}</span>
      <small>${directionLabels[direction]}</small>
    </div>
  `;
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
    render();
  });
}

function updateThreeScene(game: GameState): void {
  cellGroup.clear();
  // Visual wear maps visit count to the current field material.
  const wear = Math.min(game.cell.visitCount / 12, 1);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.18 + wear * 0.45, 0.2 - wear * 0.08, 0.28 - wear * 0.1), roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.18, 4), material);
  floor.position.y = -1;
  cellGroup.add(floor);

  addWall("left", !game.cell.availableDirections.includes("left"));
  addWall("right", !game.cell.availableDirections.includes("right"));
  addWall("forward", !game.cell.availableDirections.includes("forward"));
  addWall("backward", !game.cell.availableDirections.includes("backward"));
  addWall("up", !game.cell.availableDirections.includes("up"));
  addWall("down", !game.cell.availableDirections.includes("down"));

  if (game.cell.isExit) {
    const exit = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 12, 48), new THREE.MeshStandardMaterial({ color: 0x8cff66, emissive: 0x274d1c }));
    exit.rotation.x = Math.PI / 2;
    exit.position.set(0, 0.1, 0);
    cellGroup.add(exit);
  }

  game.cell.crumbs.forEach((crumb, index) => {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), new THREE.MeshStandardMaterial({ color: crumb.ownerColor }));
    sphere.position.set(-0.5 + index * 0.25, -0.78, 0);
    cellGroup.add(sphere);
  });
}

function addWall(direction: Direction, closed: boolean): void {
  const wallMaterial = new THREE.MeshStandardMaterial({ color: closed ? 0x273244 : 0x1a7f4f, transparent: true, opacity: closed ? 0.95 : 0.3 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(direction === "left" || direction === "right" ? 0.14 : 4, direction === "up" || direction === "down" ? 0.14 : 3, direction === "forward" || direction === "backward" ? 0.14 : 4), wallMaterial);
  if (direction === "left") wall.position.x = -2;
  if (direction === "right") wall.position.x = 2;
  if (direction === "forward") wall.position.z = -2;
  if (direction === "backward") wall.position.z = 2;
  if (direction === "up") wall.position.y = 1.5;
  if (direction === "down") wall.position.y = -1;
  cellGroup.add(wall);
}

function renderThreeScene(): void {
  if (!renderer) return;
  const host = document.querySelector<HTMLDivElement>("#maze-view");
  if (!host) return;
  const width = host.clientWidth;
  const height = host.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function createRenderer(): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    console.warn("WebGL is unavailable; using fallback view.", error);
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character] ?? character));
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector} element`);
  return element;
}
