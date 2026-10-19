import { useEffect, useRef, useState } from "react";
import { apiBase, readToken, type Store } from "./store";
import type { Theme } from "./theme";
import { Dialog, DialogHead, Icon, Seg, type ToastData } from "./ui";

export type Persona = {
  styles: { name: string; share: number }[];
  colors: { name: string; hex: string; share: number }[];
  fabrics: { name: string; share: number }[];
  garments: { name: string; count: number }[];
  summary: string;
  based_on: { pieces: number; outfits: number };
  feedback: { saved: number; dismissed: number; owned: number; outfits_saved?: number; outfits_dismissed?: number };
  /** What reactions to suggestions taught: traits worth more, or less, when ranking suggestions. */
  learned?: { likes: Learned[]; dislikes: Learned[]; signals: number };
  /** Read from the style tags alone, while photo analysis is unavailable. */
  estimated: boolean;
};

type Learned = { trait: string; value: string; weight: number };

export type Me = {
  email: string;
  username: string | null;
  avatar: boolean;
  wear: "women" | "men" | "both" | null;
  /** Styles picked at first sign-in or here; null = never asked, [] = skipped. */
  styles: string[] | null;
  /** New features already introduced to this account ("next-buys"). */
  seen?: string[];
};

/** The name shown for an account: its username, or the start of its email until one is set. */
export const displayName = (me: Me) => me.username || me.email.split("@")[0];
const initials = (me: Me) =>
  displayName(me)
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** The private profile photo as an object URL; `version` changes after each upload. */
export function useAvatarUrl(me: Me | null, version: number) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!me?.avatar) return;
    let active = true;
    let object = "";
    fetch(`${apiBase()}/me/avatar`, { headers: { Authorization: `Bearer ${readToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        object = URL.createObjectURL(b);
        if (active) setUrl(object);
        else URL.revokeObjectURL(object);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [me?.avatar, version]);
  return url;
}

export function Avatar({ me, url, size = 34 }: { me: Me | null; url: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), overflow: "hidden" }}>
      {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : me ? initials(me) : <Icon name="out" />}
    </span>
  );
}

type Props = {
  store: Store;
  me: Me | null;
  setMe: (me: Me) => void;
  avatarUrl: string;
  bumpAvatar: () => void;
  editStyles: () => void;
  /** A password change signs out other devices and hands this one a new token. */
  renewSession: (token: string) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toast: (t: ToastData) => void;
  signIn: () => void;
  signOut: () => void;
};

export function AccountPage({ store, me, setMe, avatarUrl, bumpAvatar, editStyles, renewSession, theme, setTheme, toast, signIn, signOut }: Props) {
  const appearance = (
    <section className="account__section">
      <h2 className="account__label">Appearance</h2>
      <div className="group account__group" style={{ padding: 12 }}>
        <Seg
          label="Appearance"
          radio
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
    </section>
  );

  if (store.demo)
    return (
      <div className="account">
        <h1 className="t-large">Account</h1>
        <div className="card card--pad account__guest">
          <p className="t-head">You’re exploring a sample wardrobe.</p>
          <p className="muted">Sign in to add your own pieces from photos, keep your outfits and set up your profile.</p>
          <button className="btn btn--primary" onClick={signIn}>
            Sign in or create an account
          </button>
        </div>
        {appearance}
      </div>
    );

  if (!me)
    return (
      <div className="account">
        <h1 className="t-large">Account</h1>
        <p className="muted">Loading your account…</p>
      </div>
    );

  return <SignedIn {...{ store, me, setMe, avatarUrl, bumpAvatar, editStyles, renewSession, toast, signOut, appearance }} />;
}

function SignedIn({
  store,
  me,
  setMe,
  avatarUrl,
  bumpAvatar,
  editStyles,
  renewSession,
  toast,
  signOut,
  appearance,
}: Pick<Props, "store" | "setMe" | "avatarUrl" | "bumpAvatar" | "editStyles" | "renewSession" | "toast" | "signOut"> & { me: Me; appearance: React.ReactNode }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(me.username ?? "");
  const [editingPassword, setEditingPassword] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const nameChanged = editingName && name.trim() !== (me.username ?? "");
  const dirty = nameChanged || editingPassword;
  const problem =
    nameChanged && name.trim().length < 2
      ? "Username must be at least 2 characters."
      : editingPassword && !current
        ? "Enter your current password."
        : editingPassword && next.length < 10
          ? "New password must be at least 10 characters."
          : editingPassword && next !== confirm
            ? "The new passwords don’t match."
            : "";

  const cancel = () => {
    setEditingName(false);
    setName(me.username ?? "");
    setEditingPassword(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
  };

  async function save() {
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      if (nameChanged) setMe(await store.call<Me>("/me", "PATCH", { username: name.trim() }));
      if (editingPassword) {
        const r = await store.call<{ token: string }>("/me/password", "POST", { current_password: current, new_password: next });
        renewSession(r.token);
      }
      toast({
        kind: "Saved",
        text: nameChanged && editingPassword
          ? "Profile and password updated"
          : editingPassword
            ? "Password updated. Other devices are signed out."
            : "Profile updated",
      });
      setEditingName(false);
      setEditingPassword(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Saved straight away, like Appearance: it only changes what the app suggests.
  async function saveWear(wear: string) {
    setError("");
    try {
      setMe(await store.call<Me>("/me", "PATCH", { wear }));
      toast({ kind: "Saved", text: wear === "both" ? "Showing women’s and men’s clothes" : wear === "women" ? "Showing women’s clothes" : "Showing men’s clothes" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
    try {
      await store.call("/me/sign-out-everywhere", "POST");
      signOut();
      toast({ kind: "Signed out", text: "You’re signed out on every device.", tone: "plain" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file?: File | null) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError("Use a JPG, PNG or WebP photo.");
    setPhotoBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("image", file);
      setMe(await store.call<Me>("/me/avatar", "PUT", body));
      bumpAvatar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      setMe(await store.call<Me>("/me/avatar", "DELETE"));
      bumpAvatar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="account">
      <h1 className="t-large">Account</h1>

      <div className="account__hero">
        <div className="account__photo">
          <Avatar me={me} url={avatarUrl} size={112} />
          <button
            className="account__camera"
            aria-label={me.avatar ? "Change profile photo" : "Add a profile photo"}
            onClick={() => fileInput.current?.click()}
            disabled={photoBusy}
          >
            <Icon name="camera" />
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <span className="t-title2">{displayName(me)}</span>
        <span className="t-foot muted">{me.email}</span>
        {me.avatar && (
          <button className="btn btn--plain btn--sm" onClick={removePhoto} disabled={photoBusy}>
            Remove photo
          </button>
        )}
      </div>

      <section className="account__section">
        <h2 className="account__label">Profile</h2>
        <div className="group account__group">
          <div className="row account__row">
            <span className="account__key">Username</span>
            {editingName ? (
              <input className="input account__input" value={name} maxLength={30} autoFocus placeholder={displayName(me)} onChange={(e) => setName(e.target.value)} aria-label="Username" />
            ) : (
              <span className="account__value">{me.username ?? <span className="muted">Not set</span>}</span>
            )}
            {!editingName && (
              <button className="btn btn--plain btn--sm account__edit" onClick={() => { setEditingName(true); setName(me.username ?? ""); }}>
                Edit
              </button>
            )}
          </div>
          <div className="row account__row">
            <span className="account__key" id="wear-l">I wear</span>
            <Seg
              label="I mostly wear"
              radio
              className="account__wear"
              value={me.wear ?? "both"}
              onChange={saveWear}
              options={[
                { value: "women", label: "Women’s" },
                { value: "men", label: "Men’s" },
                { value: "both", label: "Both" },
              ]}
            />
          </div>
          <div className="row account__row">
            <span className="account__key">Styles</span>
            <span className="account__value persona__chips">
              {me.styles?.length ? (
                me.styles.map((s) => (
                  <span key={s} className="chip chip--sm">
                    {s}
                  </span>
                ))
              ) : (
                <span className="muted">Not chosen</span>
              )}
            </span>
            <button className="btn btn--plain btn--sm account__edit" onClick={editStyles}>
              {me.styles?.length ? "Edit" : "Choose"}
            </button>
          </div>
          <div className="row account__row">
            <span className="account__key">Email</span>
            <span className="account__value">{me.email}</span>
          </div>
          <div className="row account__row account__row--top">
            <span className="account__key">Password</span>
            {editingPassword ? (
              <span className="account__passwords">
                <input className="input" type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Current password" autoFocus />
                <input className="input" type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={next} onChange={(e) => setNext(e.target.value)} aria-label="New password" />
                <input className="input" type="password" autoComplete="new-password" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Repeat new password" />
              </span>
            ) : (
              <span className="account__value" aria-label="Hidden password">••••••••</span>
            )}
            {!editingPassword && (
              <button className="btn btn--plain btn--sm account__edit" onClick={() => setEditingPassword(true)}>
                Edit
              </button>
            )}
          </div>
        </div>
        <p className="t-foot muted account__hint">Email can’t be changed here.</p>
        {error && (
          <p role="alert" className="note note--error">
            {error}
          </p>
        )}
        <div className="account__actions">
          <button className="btn" onClick={cancel} disabled={!dirty || busy}>
            Cancel
          </button>
          <button className={`btn btn--primary${busy ? " btn--busy" : ""}`} onClick={save} disabled={!dirty || busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      <StyleProfile store={store} toast={toast} />

      {appearance}

      <section className="account__section">
        <h2 className="account__label">Danger zone</h2>
        <div className="group account__group">
          <div className="row account__row">
            <span className="account__value" style={{ fontWeight: 500 }}>
              Delete account
            </span>
            <button className="btn btn--danger btn--sm" onClick={() => setDeleting(true)}>
              <Icon name="trash" />
              Delete
            </button>
          </div>
        </div>
        <p className="t-foot muted account__hint">Your account can’t be recovered after deletion.</p>
      </section>

      <section className="account__section">
        <h2 className="account__label">Devices</h2>
        <div className="group account__group">
          <div className="row account__row">
            <span className="account__value" style={{ whiteSpace: "normal" }}>
              Signed in somewhere you don’t recognise, or on a device you lost?
            </span>
            <button className="btn btn--sm" onClick={signOutEverywhere} disabled={busy}>
              Sign out of all devices
            </button>
          </div>
        </div>
      </section>

      <button className="btn btn--block account__signout" onClick={signOut}>
        <Icon name="out" />
        Sign out
      </button>

      <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} store={store} toast={toast} signOut={signOut} />
    </div>
  );
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const CATEGORY_WORD: Record<string, string> = { pants: "bottoms", jackets: "layers" };
/** "sneakers", "white", "streetwear", "leather", "bottoms": how a learned trait reads in a chip. */
const traitWord = (l: Learned) => (l.trait === "category" ? (CATEGORY_WORD[l.value] ?? l.value) : l.value.toLowerCase());
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The persona: what Outfitly has read about the user's taste, used to rank suggestions. */
function StyleProfile({ store, toast }: Pick<Props, "store" | "toast">) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    store
      .call<Persona>("/me/persona")
      .then((p) => {
        setPersona(p);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, []);

  async function reset() {
    setBusy(true);
    try {
      await store.call("/me/suggestion-events", "DELETE");
      await load();
      toast({ kind: "Reset", text: "Suggestions start fresh from your wardrobe", tone: "plain" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Outfits are counted once each (their events are one per new piece).
  const outfitReactions = (persona?.feedback.outfits_saved ?? 0) + (persona?.feedback.outfits_dismissed ?? 0);
  const reactions = persona ? Math.max(persona.learned?.signals ?? 0, persona.feedback.saved + persona.feedback.dismissed + persona.feedback.owned) : 0;
  return (
    <section className="account__section" aria-labelledby="persona-l">
      <h2 className="account__label" id="persona-l">
        Your style
      </h2>
      <div className="group account__group persona">
        {!persona ? (
          <div className="persona__block">
            <p className="muted">{error || "Reading your wardrobe…"}</p>
          </div>
        ) : (
          <>
            <div className="persona__block">
              <p className="t-head">{persona.summary}</p>
              <p className="t-foot muted">
                From {plural(persona.based_on.pieces, "piece")} and {plural(persona.based_on.outfits, "saved outfit")}
                {persona.estimated ? ", read from your style tags while photo analysis is unavailable" : ""}.
              </p>
            </div>
            {persona.styles.length > 0 && (
              <div className="persona__block">
                <ul className="persona__styles" aria-label="Style mix">
                  {persona.styles.map((s) => (
                    <li key={s.name} className="persona__style">
                      <span className="persona__name">{s.name}</span>
                      <span className="persona__bar" aria-hidden="true">
                        <span style={{ width: pct(s.share) }} />
                      </span>
                      <span className="persona__pct num">{pct(s.share)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {persona.colors.length > 0 && (
              <div className="row account__row">
                <span className="account__key">Colours</span>
                <span className="persona__swatches">
                  {persona.colors.map((c) => (
                    <span key={c.name} className="persona__swatch" style={{ background: c.hex }} title={`${c.name} · ${pct(c.share)}`} aria-label={`${c.name}, ${pct(c.share)}`} role="img" />
                  ))}
                </span>
              </div>
            )}
            {persona.fabrics.length > 0 && (
              <div className="row account__row">
                <span className="account__key">Fabrics</span>
                <span className="persona__chips">
                  {persona.fabrics.map((f) => (
                    <span key={f.name} className="chip chip--sm">
                      {f.name} {pct(f.share)}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {persona.garments.length > 0 && (
              <div className="row account__row">
                <span className="account__key">You own most</span>
                <span className="persona__chips">
                  {persona.garments.map((g) => (
                    <span key={g.name} className="chip chip--sm">
                      {g.name} ×{g.count}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {(persona.learned?.likes.length || persona.learned?.dislikes.length) ? (
              <div className="row account__row account__row--top">
                <span className="account__key">Learned</span>
                <span className="persona__learned">
                  {persona.learned.likes.length > 0 && (
                    <span className="persona__chips" aria-label="More of">
                      <span className="t-cap muted persona__lead">More of</span>
                      {persona.learned.likes.map((l) => (
                        <span key={`${l.trait}-${l.value}`} className="chip chip--sm persona__like">
                          {traitWord(l)}
                        </span>
                      ))}
                    </span>
                  )}
                  {persona.learned.dislikes.length > 0 && (
                    <span className="persona__chips" aria-label="Less of">
                      <span className="t-cap muted persona__lead">Less of</span>
                      {persona.learned.dislikes.map((l) => (
                        <span key={`${l.trait}-${l.value}`} className="chip chip--sm persona__dislike">
                          {traitWord(l)}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </div>
            ) : null}
            <div className="row account__row">
              <span className="account__value">
                {reactions
                  ? `Learned from ${plural(reactions, "reaction")}${outfitReactions ? `, ${outfitReactions} on outfits` : ""}${persona.feedback.dismissed ? `, ${plural(persona.feedback.dismissed, "suggestion")} hidden` : ""}`
                  : "No feedback on suggestions yet"}
              </span>
              <button className="btn btn--plain btn--sm account__edit" onClick={reset} disabled={busy || !reactions}>
                Reset
              </button>
            </div>
          </>
        )}
      </div>
      <p className="t-foot muted account__hint">
        Outfitly uses this to choose which pieces to suggest. It updates as your wardrobe changes and learns from what you save, hide and add. Reset forgets what it learned.
      </p>
    </section>
  );
}

function DeleteAccountDialog({ open, onClose, store, toast, signOut }: { open: boolean; onClose: () => void } & Pick<Props, "store" | "toast" | "signOut">) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setPassword("");
      setError("");
    }
  }, [open]);
  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await store.call("/me", "DELETE", { password });
      onClose();
      signOut();
      toast({ kind: "Account deleted", text: "Your wardrobes, pieces and photos are gone.", tone: "plain" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} labelledBy="del-t" describedBy="del-d" alert width="min(420px, 100%)" top={140}>
      <DialogHead id="del-t" title="Delete your account?" onClose={onClose} />
      <form onSubmit={remove}>
        <div className="dialog__body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p id="del-d" className="muted">
            All your wardrobes, pieces, photos and saved outfits will be deleted. This can’t be undone.
          </p>
          <label className="field">
            <span className="field__label">Password</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus />
          </label>
          {error && (
            <p role="alert" className="note note--error">
              {error}
            </p>
          )}
        </div>
        <div className="dialog__foot">
          <button type="button" className="btn" onClick={onClose}>
            Keep account
          </button>
          <button className={`btn btn--danger-solid${busy ? " btn--busy" : ""}`} disabled={busy || !password}>
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
