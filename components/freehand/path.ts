// Path generation utilities for freehand drawing using perfect-freehand library
import getStroke from 'perfect-freehand';

// Configuration options for the freehand stroke path generation
// size: Base stroke width in pixels
// thinning: How much the stroke thins based on pressure (0 = no thinning, 1 = full thinning)
// smoothing: How much to smooth the path (0 = no smoothing, 1 = full smoothing)
// streamline: How much to streamline the path (0 = no streamlining, 1 = full streamlining)
// easing: Easing function for the stroke (linear by default)
// start/end: Taper configuration for stroke start and end
export const pathOptions = {
  size: 7, // Base stroke width
  thinning: 0.5, // Pressure-based thinning amount
  smoothing: 0.5, // Path smoothing amount
  streamline: 0.5, // Path streamlining amount
  easing: (t: number) => t, // Linear easing function
  start: {
    taper: 0, // No taper at start
    easing: (t: number) => t, // Linear easing
    cap: true, // Cap the start of the stroke
  },
  end: {
    taper: 0.1, // Small taper at end
    easing: (t: number) => t, // Linear easing
    cap: true, // Cap the end of the stroke
  },
};

// Convert stroke points array to SVG path string
// stroke: Array of [x, y] coordinate pairs representing the stroke outline
// Returns: SVG path data string (d attribute)
export function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return ''; // Return empty string if no stroke points

  // Build path using quadratic curves between points
  // M = move to, Q = quadratic curve to, Z = close path
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]; // Get next point (wraps to first for closing)
      acc.push(x0, y0, ',', (x0 + x1) / 2, (y0 + y1) / 2); // Add point and midpoint for curve
      return acc;
    },
    ['M', ...stroke[0], 'Q'] // Start with move to first point, then quadratic curve
  );

  d.push('Z'); // Close the path
  return d.join(' '); // Join all path commands with spaces
}

// Convert drawing points to SVG path string
// points: Array of [x, y, pressure] tuples from pointer events
// zoom: Current viewport zoom level (default 1) - used to scale stroke size
// Returns: SVG path data string for rendering the stroke
export function pointsToPath(points: [number, number, number][], zoom = 1) {
  // Generate stroke outline from points using perfect-freehand
  // Scale stroke size by zoom level to maintain visual consistency
  const stroke = getStroke(points, {
    ...pathOptions,
    size: pathOptions.size * zoom, // Scale stroke size by zoom
  });
  // Convert stroke outline to SVG path string
  return getSvgPathFromStroke(stroke);
}




