/* Bottom sheet: slides up over a fading scrim; tap scrim to dismiss.
 *
 * On iOS the on-screen keyboard is laid *over* the page rather than resizing
 * it, so a bottom-anchored sheet (and its input) would sit behind the
 * keyboard. We track the visualViewport and lift the sheet by the keyboard
 * height so the input + actions stay visible — no manual keyboard dismiss. */
import { useEffect, useState } from "react";

export function BottomSheet({ title, onClose, children }) {
  const [kb, setKb] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKb(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div className="m-scrim" onClick={onClose}>
      <div
        className="m-sheet"
        style={{ bottom: kb, paddingBottom: kb > 0 ? 16 : undefined }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <span className="m-grab" />
        {title && <div className="m-sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
