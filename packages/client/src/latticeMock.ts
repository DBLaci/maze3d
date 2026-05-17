import { renderLatticeMap } from "./components/latticeMap";
import "./styles.css";

const app = requireElement<HTMLDivElement>("#app");

let dimensions = { x: 4, y: 4, z: 4 };
let selected = [
  { x: 1, y: 1, z: 1 },
  { x: 1, y: 1, z: 0 },
  { x: 0, y: 1, z: 0 }
];
let revealedExit = { x: 3, y: 2, z: 0 };

render();

function render(): void {
  app.innerHTML = `
    <main class="shell lobby">
      <section class="panel hero">
        <p class="eyebrow">Standalone component mock</p>
        <h1>Lattice Map</h1>
        <p>This page is independent from Maze3D game state and only tests the lattice component inputs.</p>
      </section>
      <section class="panel form-panel">
        ${numberInput("size-x", "Size X", dimensions.x)}
        ${numberInput("size-y", "Size Y", dimensions.y)}
        ${numberInput("size-z", "Size Z", dimensions.z)}
        ${selected.map((position, index) => `
          <fieldset class="mock-selection">
            <legend>Selected ${index + 1}</legend>
            ${numberInput(`pos-${index}-x`, "X", position.x)}
            ${numberInput(`pos-${index}-y`, "Y", position.y)}
            ${numberInput(`pos-${index}-z`, "Z", position.z)}
          </fieldset>
        `).join("")}
        <fieldset class="mock-selection">
          <legend>Revealed exit</legend>
          ${numberInput("exit-x", "X", revealedExit.x)}
          ${numberInput("exit-y", "Y", revealedExit.y)}
          ${numberInput("exit-z", "Z", revealedExit.z)}
        </fieldset>
        <div class="mock-preview">${renderLatticeMap({ dimensions, selected, revealedExit })}</div>
      </section>
    </main>
  `;

  bind("size-x", (value) => dimensions = { ...dimensions, x: value });
  bind("size-y", (value) => dimensions = { ...dimensions, y: value });
  bind("size-z", (value) => dimensions = { ...dimensions, z: value });
  selected.forEach((_position, index) => {
    bind(`pos-${index}-x`, (value) => selected[index] = { ...selected[index], x: value });
    bind(`pos-${index}-y`, (value) => selected[index] = { ...selected[index], y: value });
    bind(`pos-${index}-z`, (value) => selected[index] = { ...selected[index], z: value });
  });
  bind("exit-x", (value) => revealedExit = { ...revealedExit, x: value });
  bind("exit-y", (value) => revealedExit = { ...revealedExit, y: value });
  bind("exit-z", (value) => revealedExit = { ...revealedExit, z: value });
}

function numberInput(id: string, label: string, value: number): string {
  return `<label>${label}<input id="${id}" type="number" min="0" max="10" value="${value}" /></label>`;
}

function bind(id: string, update: (value: number) => void): void {
  document.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", (event) => {
    update(Number.parseInt((event.target as HTMLInputElement).value, 10));
    selected = selected.slice(0, 10).map((position) => ({
      x: Math.min(position.x, dimensions.x - 1),
      y: Math.min(position.y, dimensions.y - 1),
      z: Math.min(position.z, dimensions.z - 1)
    }));
    revealedExit = {
      x: Math.min(revealedExit.x, dimensions.x - 1),
      y: Math.min(revealedExit.y, dimensions.y - 1),
      z: Math.min(revealedExit.z, dimensions.z - 1)
    };
    render();
  });
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector} element`);
  return element;
}
