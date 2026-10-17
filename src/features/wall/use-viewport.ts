import { useCallback, useRef, useState } from "react";

/**
 * The wall's scroll container: its size and scroll offset, throttled to one
 * update a frame. The container only exists while there are tiles, so the
 * returned ref callback wires it up whenever it mounts.
 */
export function useViewport() {
  const viewport = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const attach = useCallback((element: HTMLDivElement) => {
    viewport.current = element;
    const measure = () =>
      setBox((last) =>
        last.width === element.clientWidth && last.height === element.clientHeight
          ? last
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    setScrollTop(element.scrollTop);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(element.scrollTop);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      viewport.current = null;
    };
  }, []);

  return { viewport, attach, box, scrollTop };
}
