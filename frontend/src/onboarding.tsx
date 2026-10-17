// "What's your style?": asked once, right after the first sign-in, so the persona has something
// to go on before any clothes are uploaded (backend: users.styles, persona.CHOSEN_WEIGHT).
// Also opened from the profile page to change the choice.
import { useEffect, useState } from "react";
import { styles, type Category, type Piece, type Wear } from "./store";
import { Dialog, DialogHead, Icon, PieceArt, tick } from "./ui";

const ABOUT: Record<string, string> = {
  Everyday: "Easy pieces for every day: tees, jeans, sneakers.",
  Minimal: "Clean lines, quiet colours, nothing extra.",
  "Smart casual": "Polished but relaxed: shirts, chinos, loafers.",
  Streetwear: "Hoodies, joggers and statement sneakers.",
  Evening: "Dressed up for going out.",
};

type Art = [Category, string, string, string]; // category, garment, colour, fabric
// A typical outfit for each style, drawn with the app's garment shapes.
const LOOKS: Record<string, { men: Art[]; women: Art[] }> = {
  Everyday: {
    men: [["tops", "t-shirt", "#F5F5F5", "cotton"], ["pants", "jeans", "#3E5C8C", "denim"], ["shoes", "sneakers", "#F5F5F5", "leather"]],
    women: [["tops", "t-shirt", "#EE96AA", "cotton"], ["pants", "jeans", "#3E5C8C", "denim"], ["shoes", "sneakers", "#F5F5F5", "leather"]],
  },
  Minimal: {
    men: [["tops", "sweater", "#F0E6CD", "knit"], ["pants", "trousers", "#3C4046", "other"], ["shoes", "loafers", "#191919", "leather"]],
    women: [["dresses", "midi dress", "#F0E6CD", "linen"], ["shoes", "mules", "#D6C4A3", "leather"]],
  },
  "Smart casual": {
    men: [["tops", "shirt", "#9BBEE1", "cotton"], ["pants", "chinos", "#D6C4A3", "cotton"], ["shoes", "loafers", "#6E482D", "leather"]],
    women: [["tops", "blouse", "#F5F5F5", "silk"], ["pants", "skirt", "#1E284B", "cotton"], ["shoes", "ankle boots", "#6E482D", "leather"]],
  },
  Streetwear: {
    men: [["tops", "hoodie", "#191919", "cotton"], ["pants", "joggers", "#808080", "cotton"], ["shoes", "sneakers", "#F5F5F5", "leather"]],
    women: [["tops", "crop top", "#F5F5F5", "cotton"], ["pants", "joggers", "#6B6B34", "cotton"], ["shoes", "sneakers", "#191919", "leather"]],
  },
  Evening: {
    men: [["jackets", "blazer", "#191919", "other"], ["pants", "trousers", "#191919", "other"], ["shoes", "dress shoes", "#191919", "leather"]],
    women: [["dresses", "mini dress", "#781928", "silk"], ["shoes", "heels", "#191919", "leather"]],
  },
};

const lookFor = (style: string, wear: Wear): Piece[] =>
  LOOKS[style][wear === "women" ? "women" : "men"].map(([category, garment, color, texture]) => ({
    id: `${style}-${garment}`, name: garment, category, garment, color, texture, style, image: null,
  }));

type Props = {
  open: boolean;
  /** First sign-in: "Skip for now" instead of "Cancel", and a different heading. */
  first: boolean;
  initial: string[];
  wear: Wear;
  onSave: (picked: string[]) => Promise<void>;
  onSkip: () => void;
  onClose: () => void;
};

export function StylePicker({ open, first, initial, wear, onSave, onSkip, onClose }: Props) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setPicked(initial);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset each time it opens
  }, [open]);
  const toggle = (s: string) => {
    tick();
    setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  };
  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(picked); // in the order picked: the first is where the studio starts
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} labelledBy="styles-t" describedBy="styles-d" width="min(720px, 100%)" top={40}>
      <DialogHead id="styles-t" title={first ? "What’s your style?" : "Styles you like"} onClose={onClose} />
      <div className="dialog__body style-pick">
        <p id="styles-d" className="muted">
          {first
            ? "Pick the styles you like to wear. Outfitly starts from them, then learns the rest from your wardrobe."
            : "Outfitly weighs these alongside what your wardrobe says."}
        </p>
        <div className="style-pick__grid" role="group" aria-label="Styles">
          {styles.map((s) => {
            const on = picked.includes(s);
            return (
              <button key={s} type="button" className={`style-pick__card${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(s)}>
                <span className="style-pick__art" aria-hidden="true">
                  {lookFor(s, wear).map((p) => (
                    <span key={p.id} className="style-pick__piece">
                      <PieceArt piece={p} />
                    </span>
                  ))}
                </span>
                <span className="style-pick__name">
                  {s}
                  <span className="style-pick__check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                </span>
                <span className="style-pick__about">{ABOUT[s]}</span>
              </button>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="note note--error">
            {error}
          </p>
        )}
      </div>
      <div className="dialog__foot">
        <button className="btn" onClick={first ? onSkip : onClose} disabled={busy}>
          {first ? "Skip for now" : "Cancel"}
        </button>
        <button className={`btn btn--primary${busy ? " btn--busy" : ""}`} onClick={save} disabled={busy || !picked.length}>
          {busy ? "Saving…" : first ? `Continue${picked.length ? ` with ${picked.length}` : ""}` : "Save"}
        </button>
      </div>
    </Dialog>
  );
}
