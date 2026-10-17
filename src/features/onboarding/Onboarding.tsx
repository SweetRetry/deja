import { useEffect, useRef, useState } from "react";
import { FolderOpenIcon } from "@phosphor-icons/react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  usePresence,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useSession } from "@/app/store";
import { Kbd } from "@/components/ui/kbd";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { THUMB_WIDTH, usePreferences } from "@/features/settings/preferences";
import { OpenFolder, pickFolder } from "@/features/vault/OpenFolder";
import { inTauri } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import { useHotkey } from "@/lib/use-hotkey";
import { cn } from "@/lib/utils";
import { PRINTS, type Print } from "./prints";
import { FRAME, home, inStack, photoWidth, skeletonSlot, skeletonSlots, stack, type Size } from "./table";

type Place = { x: number; y: number; rotate: number };
type Target = Place & { scale: number; framed: boolean };
type Tilt = { x: MotionValue<number>; y: MotionValue<number> };

// Critically damped (damping = 2√stiffness): no overshoot, Retry's `bounce: 0`.
// Defined by physics rather than a duration, so a print retargeted mid-flight
// (the table narrows while the sidebar slides in) carries its speed on.
const SPRING = { type: "spring", stiffness: 170, damping: 26 } as const;
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/**
 * No folder is open. A folder opened from the table keeps it up until the
 * folder has loaded, so a failed open never flickers it away and back; an open
 * the table never showed for (the last folder, reopened at launch) does not
 * bring it up.
 */
export function useWelcome() {
  const loaded = useSession((s) => s.vault.library !== null);
  const opening = useSession((s) => s.vault.phase === "opening");
  const [shown, setShown] = useState(false);
  const welcome = !loaded && (!opening || shown);
  if (welcome !== shown) setShown(welcome);
  return welcome;
}

/** Fills the center while no folder is open. Leaves by laying out a wall
 *  skeleton of its own, docking the prints into it, then clearing to the real
 *  wall. */
export function Onboarding({ welcome }: { welcome: boolean }) {
  return <AnimatePresence>{welcome ? <Table key="table" /> : null}</AnimatePresence>;
}

/**
 * A loose stack of prints on a table. They can be picked up and thrown; one
 * picked up or hovered types out what Déjà would write down about it. Thrown
 * prints stay where they land, and a double-click on the table gathers them.
 */
function Table() {
  const [present, safeToRemove] = usePresence();
  const error = useSession((s) => s.vault.error);
  const opening = useSession((s) => s.vault.phase === "opening");
  const cell = usePreferences((p) => THUMB_WIDTH[p.size]);
  const reduce = useReducedMotion();
  const table = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [thrown, setThrown] = useState<Record<number, Place>>({});
  const [order, setOrder] = useState(() => PRINTS.map((_, index) => index));
  const [fanned, setFanned] = useState(false);
  const [touched, setTouched] = useState(false);
  const leaving = !present;
  // Staggers count from when their phase began, so a re-render never restarts them.
  const [dealtAt] = useState(() => performance.now());
  const [leftAt, setLeftAt] = useState<number | null>(null);
  const after = (start: number | null, seconds: number) =>
    Math.max(0, seconds - (start === null ? 0 : (performance.now() - start) / 1000));
  const pointer = { x: useMotionValue(0), y: useMotionValue(0) };
  const tilt = { x: useSpring(pointer.x, { stiffness: 60, damping: 20 }), y: useSpring(pointer.y, { stiffness: 60, damping: 20 }) };

  useEffect(() => {
    const element = table.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The slots follow the table's live width, so they track the sidebar sliding in.
  useEffect(() => {
    if (present) return;
    pointer.x.set(0);
    pointer.y.set(0);
    setLeftAt(performance.now());
    const timer = setTimeout(() => safeToRemove?.(), reduce ? 0 : 1400);
    return () => clearTimeout(timer);
  }, [present, safeToRemove, reduce, pointer.x, pointer.y]);

  useHotkey("mod+o", () => void pickFolder(), { enabled: present });

  const target = (print: Print, index: number): Target => {
    if (!size) return { x: 0, y: 0, rotate: 0, scale: 1, framed: true };
    if (leaving) {
      const slot = skeletonSlot(order.indexOf(index), { width: size.width, cell });
      return { x: slot.x, y: slot.y, rotate: 0, scale: slot.side / photoWidth(print.ratio), framed: false };
    }
    const rest = thrown[index] ?? home(print, size);
    if (!fanned || !inStack(rest, size)) return { ...rest, scale: 1, framed: true };
    const center = stack(size);
    return {
      x: rest.x + (rest.x - center.x) * 0.16,
      y: rest.y + (rest.y - center.y) * 0.16 - 6,
      rotate: rest.rotate * 1.6,
      scale: 1,
      framed: true,
    };
  };

  const center = size ? stack(size) : null;
  const slots = size && leaving ? skeletonSlots(size, cell) : [];
  return (
    <motion.div
      ref={table}
      className="absolute inset-0 z-30 overflow-hidden bg-background"
      animate={{ opacity: present ? 1 : 0 }}
      transition={{ duration: 0.3, delay: present ? 0 : 1 }}
      onPointerMove={(event) => {
        if (reduce || !present) return;
        const box = event.currentTarget.getBoundingClientRect();
        pointer.x.set((event.clientX - box.left) / box.width - 0.5);
        pointer.y.set((event.clientY - box.top) / box.height - 0.5);
      }}
      onPointerLeave={() => {
        pointer.x.set(0);
        pointer.y.set(0);
      }}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-print], button")) return;
        setThrown({});
      }}
    >
      {/* A wave of empty squares spreads out from where the stack was. */}
      {center
        ? slots.map((slot, index) => (
            <motion.div
              key={index}
              className="absolute rounded-md bg-surface-2"
              style={{ left: slot.x - slot.side / 2, top: slot.y - slot.side / 2, width: slot.side, height: slot.side }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: 0.2 + Math.hypot(slot.x - center.x, slot.y - center.y) * 0.0005 }}
            />
          ))
        : null}

      {/* Hidden while opening: the sidebar's own settings mount with the path, and
          two would answer ⌘, at once. */}
      {present && !opening ? (
        <div
          data-tauri-drag-region
          className={cn("absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-end px-3", inTauri && "pl-20")}
        >
          <SettingsDialog />
        </div>
      ) : null}

      <motion.div
        className="pointer-events-none absolute inset-y-0 left-0 flex w-1/2 flex-col justify-center gap-8 pr-6 pl-16 xl:pl-24"
        animate={present ? { opacity: 1, x: 0 } : { opacity: 0, x: -24 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-6xl font-semibold">
          {["散落的素材，", "收进一面墙。"].map((line, index) => (
            <span key={line} className="block overflow-hidden pb-1">
              <motion.span
                className="block"
                initial={{ y: "105%" }}
                animate={{ y: 0 }}
                transition={{ duration: 0.9, delay: 0.1 + index * 0.09 }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.div
          className="flex max-w-sm flex-col gap-2"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <p className="text-base text-muted-foreground">
            选一个文件夹，文件留在原处。Déjà 记下每张图片和每段视频里有什么，之后描述画面就能找到。
          </p>
          {error ? <p className="text-sm text-pretty text-destructive">打不开这个文件夹。{humanError(error)}</p> : null}
        </motion.div>
        <motion.div
          className="pointer-events-auto flex items-start gap-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.42 }}
        >
          <OpenFolder
            size="lg"
            onPointerEnter={() => setFanned(true)}
            onPointerLeave={() => setFanned(false)}
            onFocus={() => setFanned(true)}
            onBlur={() => setFanned(false)}
            disabled={opening}
          >
            <FolderOpenIcon aria-hidden />
            {opening ? "正在打开…" : "打开文件夹"}
          </OpenFolder>
          {inTauri ? (
            <span className="flex h-9 items-center gap-1" aria-hidden>
              <Kbd>⌘</Kbd>
              <Kbd>O</Kbd>
            </span>
          ) : null}
        </motion.div>
      </motion.div>

      {size && center ? (
        <div aria-hidden>
          {PRINTS.map((print, index) => (
            <PrintCard
              key={print.src}
              print={print}
              target={target(print, index)}
              z={order.indexOf(index) + 1}
              depth={0.35 + (index / PRINTS.length) * 0.9}
              tilt={tilt}
              table={size}
              grabbable={present}
              delay={leaving ? after(leftAt, index * 0.045) : after(dealtAt, 0.5 + index * 0.07)}
              onGrab={() => {
                setTouched(true);
                setOrder((current) => [...current.filter((item) => item !== index), index]);
              }}
              onLand={(place) => setThrown((current) => ({ ...current, [index]: place }))}
            />
          ))}
          <motion.p
            className="pointer-events-none absolute -translate-x-1/2 text-xs text-subtle-foreground"
            style={{ left: center.x, top: center.y + center.spread * 0.66 + 150 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: touched || !present ? 0 : 1 }}
            transition={{ duration: 0.4, delay: touched || !present ? 0 : 1.8 }}
          >
            拿起一张，看 Déjà 记下了什么
          </motion.p>
        </div>
      ) : null}
    </motion.div>
  );
}

type PrintProps = {
  print: Print;
  target: Target;
  z: number;
  /** How far the print drifts with the pointer: the top of the stack moves most. */
  depth: number;
  tilt: Tilt;
  table: Size;
  grabbable: boolean;
  delay: number;
  onGrab: () => void;
  onLand: (place: Place) => void;
};

function PrintCard({ print, target, z, depth, tilt, table, grabbable, delay, onGrab, onLand }: PrintProps) {
  const reduce = useReducedMotion();
  const width = photoWidth(print.ratio);
  const height = width / print.ratio;
  const outer = target.framed
    ? { width: width + FRAME.side * 2, height: height + FRAME.top + FRAME.bottom }
    : { width, height };
  const left = target.x - outer.width / 2;
  const top = target.y - outer.height / 2;

  const x = useMotionValue(left);
  const y = useMotionValue(top - 260);
  const [held, setHeld] = useState(false);
  const [reading, setReading] = useState(false);
  const [typed, setTyped] = useState(0);
  const velocity = useRef(0);
  // The print swings against the pull while carried; the pile tilts toward the pointer.
  const swing = useSpring(0, { stiffness: 300, damping: 30 });
  const driftX = useTransform(tilt.x, (value) => value * -26 * depth);
  const driftY = useTransform(tilt.y, (value) => value * -18 * depth);
  const rotateX = useTransform(tilt.y, (value) => value * -9);
  const rotateY = useTransform(tilt.x, (value) => value * 11);

  const length = print.caption.length;
  useEffect(() => {
    if (!reading || typed >= length) return;
    if (reduce) return setTyped(length);
    const timer = setTimeout(() => setTyped((count) => count + 1), typed === 0 ? 120 : 45);
    return () => clearTimeout(timer);
  }, [reading, typed, length, reduce]);

  return (
    <motion.div
      data-print
      className={cn("absolute top-0 left-0 touch-none", grabbable && "cursor-grab active:cursor-grabbing")}
      style={{ x, y, zIndex: z }}
      initial={{ rotate: target.rotate * 3, opacity: 0 }}
      animate={{ x: left, y: top, rotate: target.rotate, scale: target.scale, opacity: 1 }}
      transition={{ default: { ...SPRING, delay }, opacity: { duration: 0.3, delay } }}
      drag={grabbable}
      // Numbers, not a ref: Motion rescales ref-bound elements on every layout
      // change and stops their animation, freezing prints mid-flight. The left
      // third is the copy's, so the button is never covered.
      dragConstraints={{
        left: table.width / 3,
        right: table.width - outer.width,
        top: 0,
        bottom: table.height - outer.height,
      }}
      dragElastic={0.08}
      dragTransition={{ power: 0.35, timeConstant: 260, bounceStiffness: 400, bounceDamping: 50 }}
      whileHover={grabbable ? { scale: 1.035 } : undefined}
      whileDrag={{ scale: 1.08 }}
      onHoverStart={() => grabbable && setReading(true)}
      onDragStart={() => {
        setHeld(true);
        setReading(true);
        onGrab();
      }}
      onDrag={(_, info) => {
        velocity.current = info.velocity.x;
        swing.set(clamp(info.velocity.x * 0.012, 14));
      }}
      onDragEnd={() => {
        setHeld(false);
        swing.set(0);
      }}
      onDragTransitionEnd={() =>
        onLand({
          x: x.get() + outer.width / 2,
          y: y.get() + outer.height / 2,
          rotate: clamp(target.rotate + (velocity.current / 1000) * 4, 12),
        })
      }
    >
      <motion.div style={{ x: driftX, y: driftY, rotateX, rotateY, rotate: swing, transformPerspective: 900 }}>
        <motion.div
          className={cn(
            "relative rounded-xs bg-paper transition-shadow",
            target.framed ? (held ? "shadow-print-lifted" : "shadow-print") : "shadow-none",
          )}
          initial={false}
          animate={{
            padding: target.framed ? `${FRAME.top}px ${FRAME.side}px ${FRAME.bottom}px` : "0px",
          }}
          transition={{ ...SPRING, delay }}
        >
          <img src={print.src} alt="" draggable={false} width={width} height={height} className="block rounded-xs" />
          <motion.p
            className="absolute inset-x-3 bottom-0 flex h-9 items-center overflow-hidden text-xs whitespace-nowrap text-ink"
            animate={{ opacity: target.framed ? 1 : 0 }}
            transition={{ duration: 0.15 }}
          >
            {print.caption.slice(0, typed)}
            {reading && typed < length ? <span className="ml-px h-3 w-px bg-ink" /> : null}
          </motion.p>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
