import "./latticeMap.css";

export interface LatticeVector3 {
  x: number;
  y: number;
  z: number;
}

export interface LatticeMapProps {
  dimensions: LatticeVector3;
  selected: LatticeVector3[];
  revealedExit?: LatticeVector3 | null;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface ProjectionAxis {
  x: number;
  y: number;
}

// Renders a standalone SVG lattice. It knows only maze dimensions and the selected cube.
export function renderLatticeMap({ dimensions, selected, revealedExit = null }: LatticeMapProps): string {
  const projection = createProjection(dimensions);
  const points = createPoints(dimensions, projection);
  const latticeLines = createLatticeLines(dimensions, points);
  const selectedCubeLines = selected.slice(0, 10).flatMap((position, index) => createSelectedCubeLines(position, points, index));
  const exitCubeLines = revealedExit ? createCubeLines(revealedExit, points, "exit") : [];

  return `
    <svg class="lattice-map" viewBox="0 0 ${projection.width} ${projection.height}" role="img" aria-label="3D lattice position grid">
      <g class="lattice-map__lines">${latticeLines.join("")}</g>
      <g class="lattice-map__exit">${exitCubeLines.join("")}</g>
      <g class="lattice-map__selected">${selectedCubeLines.join("")}</g>
      <g class="lattice-map__points">${[...points.values()].map((point) => `<circle cx="${point.x}" cy="${point.y}" r="1.5" />`).join("")}</g>
    </svg>
  `;
}

function createProjection(dimensions: LatticeVector3): { cell: number; margin: number; width: number; height: number; xAxis: ProjectionAxis; yAxis: ProjectionAxis; zAxis: ProjectionAxis } {
  const cell = 22;
  const margin = 36;
  // X and Z use a shallow 22.5-degree-like screen slope; Y remains the vertical height axis.
  const xAxis = { x: 20, y: 8 };
  const yAxis = { x: 0, y: -22 };
  const zAxis = { x: 20, y: -8 };
  return {
    cell,
    margin,
    xAxis,
    yAxis,
    zAxis,
    width: margin * 2 + (dimensions.x + dimensions.y + dimensions.z) * cell,
    height: margin * 2 + (dimensions.y + dimensions.z) * cell
  };
}

function createPoints(dimensions: LatticeVector3, projection: ReturnType<typeof createProjection>): Map<string, ScreenPoint> {
  const points = new Map<string, ScreenPoint>();
  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let y = 0; y <= dimensions.y; y += 1) {
      for (let z = 0; z <= dimensions.z; z += 1) {
        points.set(key(x, y, z), projectPoint(x, y, z, projection));
      }
    }
  }
  return points;
}

function projectPoint(x: number, y: number, z: number, projection: ReturnType<typeof createProjection>): ScreenPoint {
  // Orthographic projection keeps the grid predictable while the axes define the visual angle.
  return {
    x: projection.margin + x * projection.xAxis.x + y * projection.yAxis.x + z * projection.zAxis.x + 80,
    y: projection.margin + x * projection.xAxis.y + y * projection.yAxis.y + z * projection.zAxis.y + 40
  };
}

function createLatticeLines(dimensions: LatticeVector3, points: Map<string, ScreenPoint>): string[] {
  const lines: string[] = [];
  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let y = 0; y <= dimensions.y; y += 1) {
      for (let z = 0; z <= dimensions.z; z += 1) {
        if (x < dimensions.x) lines.push(line(points, x, y, z, x + 1, y, z));
        if (y < dimensions.y) lines.push(line(points, x, y, z, x, y + 1, z));
        if (z < dimensions.z) lines.push(line(points, x, y, z, x, y, z + 1));
      }
    }
  }
  return lines;
}

function createSelectedCubeLines(selected: LatticeVector3, points: Map<string, ScreenPoint>, index: number): string[] {
  const strength = index === 0 ? 1 : Math.max(0.7 - (index - 1) * 0.075, 0.1);
  return createCubeLines(selected, points, "selected").map((edge) => edge.replace("/>", ` style="--selection-strength:${strength}" />`));
}

function createCubeLines(position: LatticeVector3, points: Map<string, ScreenPoint>, kind: "selected" | "exit"): string[] {
  const { x, y, z } = position;
  return [
    line(points, x, y, z, x + 1, y, z), line(points, x, y, z, x, y + 1, z), line(points, x, y, z, x, y, z + 1),
    line(points, x + 1, y + 1, z + 1, x, y + 1, z + 1), line(points, x + 1, y + 1, z + 1, x + 1, y, z + 1), line(points, x + 1, y + 1, z + 1, x + 1, y + 1, z),
    line(points, x + 1, y, z, x + 1, y + 1, z), line(points, x + 1, y, z, x + 1, y, z + 1),
    line(points, x, y + 1, z, x + 1, y + 1, z), line(points, x, y + 1, z, x, y + 1, z + 1),
    line(points, x, y, z + 1, x + 1, y, z + 1), line(points, x, y, z + 1, x, y + 1, z + 1)
  ].map((edge) => edge.replace("/>", ` data-kind="${kind}" />`));
}

function line(points: Map<string, ScreenPoint>, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): string {
  const a = points.get(key(x1, y1, z1));
  const b = points.get(key(x2, y2, z2));
  if (!a || !b) return "";
  return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}
