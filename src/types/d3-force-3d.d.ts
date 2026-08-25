// Type declarations for d3-force-3d v3 (ships no own types)
declare module "d3-force-3d" {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum<NodeT extends SimulationNodeDatum> {
    source: NodeT | string | number;
    target: NodeT | string | number;
    index?: number;
  }

  export function forceSimulation(
    nodes?: SimulationNodeDatum[],
    numDimensions?: 1 | 2 | 3
  ): ForceSimulation;

  export interface ForceSimulation {
    stop(): this;
    tick(iterations?: number): this;
    on(typenames: string, callback?: (event: any) => void): this;
    nodes(nodes: SimulationNodeDatum[]): this;
    numDimensions(n: 1 | 2 | 3): this;
    alpha(alpha: number): this;
    alphaMin(min: number): this;
    alphaDecay(decay: number): this;
    velocityDecay(decay: number): this;
    force(name: string, force: any): this;
    force(name: string): any;
  }

  export function forceLink(links?: SimulationLinkDatum<any>[]): ForceLink;
  export interface ForceLink {
    id(accessor: (d: any) => string): this;
    distance(distance: number | ((d: any, i: number) => number)): this;
    strength(strength: number | ((d: any, i: number) => number)): this;
    iterations(n: number): this;
  }

  export function forceManyBody(): ForceManyBody;
  export interface ForceManyBody {
    strength(strength: number | ((d: any, i: number) => number)): this;
    distanceMin(n: number): this;
    distanceMax(n: number): this;
  }

  export function forceCenter(x?: number, y?: number, z?: number): ForceCenter;
  export interface ForceCenter {
    strength(s: number): this;
  }

  export function forceRadial(
    radius: number | ((d: any) => number),
    x?: number,
    y?: number,
    z?: number
  ): ForceRadial;
  export interface ForceRadial {
    strength(strength: number | ((d: any) => number)): this;
  }
}
