# Welcome table

The screen shown while no folder is open (`src/features/onboarding`). It inherits everything in DESIGN.md except the overrides below, and only this screen may use them.

## Job

Someone who has not opened a folder yet learns what Déjà does by touching it: a stack of prints they can pick up, each typing out what Déjà would write down about the picture. The one verb is still 打开文件夹.

## Overrides

- **Shadow.** The prints are objects on a table, and a print without a shadow reads as a sticker. They use `shadow-print` at rest and `shadow-print-lifted` while carried. The shadow leaves as a print docks into the wall, and nothing else in the app uses either token.
- **Paper and ink.** `bg-paper` and `text-ink` are the photo paper and its caption. They are the same in both themes, because paper does not change color with the room.
- **Ambient motion.** The prints are dealt onto the table when it appears, and the stack tilts toward the pointer. Neither answers a state change. Both stop when a folder opens, and both are off under reduced motion.
- **Springs by physics.** Prints use `{ stiffness: 170, damping: 26 }`, which is critically damped and so the same no-bounce feel as `bounce: 0`. A spring defined by stiffness and damping carries its speed into a new target. The table narrows while the sidebar slides in, and a duration-based spring would restart at every step.
- **Hero size.** The claim is `text-6xl` on the left, once, the way the site's cover uses it.

## Exit

Opening a folder keeps the table up until the folder has loaded, so a failed open never flickers it away and back. Then the table lays out a wall skeleton of its own, the prints shed their frames and land in its first slots, and the table fades to the real wall underneath. The exit never depends on how fast the folder loads or on the real wall's layout.
