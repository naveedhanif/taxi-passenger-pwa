import { useEffect, useState } from "react";

/**
 * Tracks the part of the screen that is actually visible — on iPhone that
 * shrinks when the keyboard opens, while the normal layout viewport does
 * not. A bottom-fixed chat sheet anchored to the layout viewport ends up
 * hidden behind the keyboard (or makes the page jump/zoom); anchoring it to
 * this instead keeps the message box visible above the keyboard.
 */
export function useVisualViewport(active) {
  const read = () => {
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    const offsetTop = vv ? vv.offsetTop : 0;
    return { height, keyboardInset: Math.max(0, window.innerHeight - height - offsetTop) };
  };
  const [state, setState] = useState(read);

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const update = () => setState(read());
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return state;
}
