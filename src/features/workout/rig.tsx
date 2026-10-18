// The demo figure: design/assets/exercise/rig-side.svg and rig-front.svg as react-native-svg elements, and the
// catalog's tracks as numbers. Both come from src/assets/motion/exercises.json (scripts/extract-exercise-motion.mjs).
import type { ComponentType, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import data from '../../assets/motion/exercises.json';
import { motion } from '../../shared/motion/motion';

type Node = { tag: string; id?: string; origin?: number[]; attrs: Record<string, string>; children: Node[] };
type Keyframe = { transform: string; offset?: number };
type Phase = { ms: number };
export type Move = {
  rig: 'side' | 'front';
  demo: 'rig' | 'breath';
  durationToken: keyof typeof motion.durationsMs;
  prop: string[];
  /** The cycle fraction of the key pose (the poster, and the still picture under reduced motion). */
  poster: number;
  pattern?: (Phase & { label: string })[];
  highlight?: (Phase & { region: string })[];
  tracks: { target: string; keyframes: Keyframe[]; easingToken?: keyof typeof motion.easing }[];
};
const rigs = data.rigs as unknown as Record<Move['rig'], Node>;
/** Every `kind: "exercise"` entry of design/motion/catalog.json, by id (a move's `demoCode`). */
export const moves = data.moves as unknown as Record<string, Move>;

/** [a, b, c, d, e, f] of SVG `matrix()`, the form react-native-svg takes as `transform`. */
export type Matrix = [number, number, number, number, number, number];
/** One track, ready to sample: the group it moves, its pivot, and per key the offset and [tx, ty, deg, sx, sy]. */
/** A mounted group of the figure, as a player moves it. */
export type Group = { setNativeProps: (props: object) => void } | null;
export type Track = { id: string; origin: number[]; offsets: number[]; values: number[][]; easing: keyof typeof motion.easing };

const NUMBER = /-?[\d.]+/g;
/** "translate(-1.8px, 3.4px) rotate(12deg) scale(1, 0.9)" (any of the three, in this order) -> [tx, ty, deg, sx, sy]. */
export function parseTransform(text: string): number[] {
  const part = (name: string) => new RegExp(`${name}\\(([^)]*)\\)`).exec(text)?.[1].match(NUMBER)?.map(Number);
  const [tx = 0, ty = 0] = part('translate') ?? [];
  const [deg = 0] = part('rotate') ?? [];
  const [sx = 1, sy = sx] = part('scale') ?? [];
  return [tx, ty, deg, sx, sy];
}

/** Web Animations offsets: the first defaults to 0, the last to 1, the missing ones are spread evenly in between. */
function offsetsOf(keyframes: Keyframe[]): number[] {
  const given = keyframes.map((key, i) => key.offset ?? (i === 0 ? 0 : i === keyframes.length - 1 ? 1 : undefined));
  return given.map((offset, i) => {
    if (offset !== undefined) return offset;
    let before = i - 1;
    while (given[before] === undefined) before -= 1;
    let after = i + 1;
    while (given[after] === undefined) after += 1;
    return (given[before] as number) + (((given[after] as number) - (given[before] as number)) * (i - before)) / (after - before);
  });
}

const origins = new Map<string, number[]>();
const collect = (node: Node, rig: string) => {
  if (node.id && node.origin) origins.set(`${rig}#${node.id}`, node.origin);
  node.children.forEach(child => collect(child, rig));
};
Object.entries(rigs).forEach(([name, tree]) => collect(tree, name));

export function tracksOf(move: Move): Track[] {
  return move.tracks.map(track => {
    const id = track.target.slice(1);
    return {
      id,
      origin: origins.get(`${move.rig}#${id}`) ?? [0, 0],
      offsets: offsetsOf(track.keyframes),
      values: track.keyframes.map(key => parseTransform(key.transform)),
      easing: track.easingToken ?? 'linear',
    };
  });
}

/** The group's matrix at `progress` (0–1 of the cycle): keys interpolated linearly, applied about its pivot. */
export function matrixAt(track: Track, progress: number): Matrix {
  const { offsets, values } = track;
  let i = 0;
  while (i < offsets.length - 2 && progress > offsets[i + 1]) i += 1;
  const span = offsets[i + 1] - offsets[i];
  const t = span > 0 ? Math.min(1, Math.max(0, (progress - offsets[i]) / span)) : 1;
  const [tx, ty, deg, sx, sy] = values[i].map((from, k) => from + ((values[i + 1] ?? values[i])[k] - from) * t);
  const [ox, oy] = track.origin;
  const r = (deg * Math.PI) / 180;
  const [a, b, c, d] = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy];
  // translate(o + t) rotate scale translate(-o): CSS transform-origin in the viewBox.
  return [a, b, c, d, ox + tx - (a * ox + c * oy), oy + ty - (b * ox + d * oy)];
}

const ELEMENTS: Record<string, ComponentType<Record<string, unknown>>> = { g: G, rect: Rect, line: Line, circle: Circle, ellipse: Ellipse, path: Path } as never;
// The playground's highlight colour (a drop-shadow there; a tinted copy of the part here).
const HIGHLIGHT = '#88D64B';
const tintOf = (shape: Node) => {
  const Shape = ELEMENTS[shape.tag];
  const paint = { ...shape.attrs, ...(shape.attrs.fill && shape.attrs.fill !== 'none' ? { fill: HIGHLIGHT } : null), ...(shape.attrs.stroke ? { stroke: HIGHLIGHT } : null) };
  return <Shape key="tint" {...paint} opacity={0.75} />;
};

type RigProps = {
  move: Move;
  tracks: Track[];
  /** The cycle fraction drawn by React; a player then moves the groups itself through `groups`. */
  at: number;
  /** Filled with the mounted group of each track, by id. */
  groups?: Map<string, Group>;
  /** The joint group drawn tinted (the body scan's current region). */
  highlight?: string;
};

/** The figure of `move` at one moment, with its props (`#prop-<name>`, `#prop-<name>-*`) and no others. */
export function Rig({ move, tracks, at, groups, highlight }: RigProps) {
  const byId = new Map(tracks.map(track => [track.id, track]));
  const shown = (id: string) => move.prop.some(name => id === `prop-${name}` || id.startsWith(`prop-${name}-`));
  const draw = (node: Node, key: number): ReactNode => {
    if (node.id?.startsWith('prop-') && !shown(node.id)) return null;
    const Element = ELEMENTS[node.tag];
    const track = node.id ? byId.get(node.id) : undefined;
    // The tint is a copy of the part's base shape (its first child), drawn right above it: what the part draws after
    // it (the face on the head, a nested joint) stays on top and visible.
    const [base, ...rest] = node.children;
    const tinted = node.id === highlight && base && base.tag !== 'g';
    return (
      <Element
        key={key}
        id={node.id}
        {...node.attrs}
        {...(track ? { transform: matrixAt(track, at), ref: (group: Group) => groups?.set(track.id, group) } : null)}
      >
        {tinted ? [draw(base, 0), tintOf(base), ...rest.map((child, i) => draw(child, i + 1))] : node.children.map(draw)}
      </Element>
    );
  };
  // The posters' frame (design/motion/render-poses.mjs): the 200 x 160 rig with 20 / 10 units around it.
  return (
    <Svg viewBox="-20 -10 240 180" style={styles.svg}>
      {rigs[move.rig].children.map(draw)}
    </Svg>
  );
}

const styles = StyleSheet.create({ svg: { width: '100%', aspectRatio: 4 / 3 } });
