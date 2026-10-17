// The prints on the welcome table: works from the author's archive at
// aquavo.cn, rebuilt with `node scripts/make-prints.mjs`. Each caption is what
// Déjà would write down about the picture, condensed from the archive's own
// description. Listed in stacking order, last on top.
import moonlitReedfield from "./prints/moonlit-reedfield.jpg";
import refraction from "./prints/refraction.jpg";
import rootless from "./prints/rootless.jpg";
import sharedSight from "./prints/shared-sight.jpg";
import unboundBloom from "./prints/unbound-bloom.jpg";
import verdantNotes from "./prints/verdant-notes.jpg";
import watercolorRose from "./prints/watercolor-rose.jpg";
import type { Spot } from "./table";

export type Print = Spot & {
  src: string;
  caption: string;
  /** Width over height. */
  ratio: number;
};

export const PRINTS: Print[] = [
  { src: verdantNotes, caption: "蕨叶、桉枝与细碎白花", ratio: 16 / 9, dx: -0.92, dy: 0.32, rotate: -6 },
  { src: refraction, caption: "冰蓝与淡紫水彩叠染的钻石", ratio: 1, dx: 0.6, dy: -0.66, rotate: 7 },
  { src: rootless, caption: "水墨里，武士横棍迎向猛虎", ratio: 16 / 9, dx: 0.98, dy: 0.18, rotate: 10 },
  { src: watercolorRose, caption: "胭脂红与珊瑚粉的水彩玫瑰", ratio: 16 / 9, dx: -0.72, dy: -0.46, rotate: -8 },
  { src: unboundBloom, caption: "珊瑚红与洋红的花束向外舒展", ratio: 16 / 9, dx: 0.62, dy: 0.66, rotate: -6 },
  { src: moonlitReedfield, caption: "金色芒草原，持刀女武士与巨月", ratio: 1, dx: -0.3, dy: 0.58, rotate: 4 },
  { src: sharedSight, caption: "黑发女人与渡鸦，共享金色视线", ratio: 16 / 9, dx: 0.08, dy: -0.1, rotate: -2 },
];
