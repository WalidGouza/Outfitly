import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "./ui";

// The rendered motion piece from video/ (Remotion): sample pieces gather into an
// outfit, swap to alternatives, and resolve into the logo. 8 s seamless loop.

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const currentTheme = () =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export function StudioLoopVideo() {
  // Follows the resolved theme, including system changes; the video's background
  // is baked in, so each theme has its own render.
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const video = useRef<HTMLVideoElement>(null);
  const onScreen = useRef(false);
  // null = follow the reduced-motion setting; otherwise the viewer's explicit choice.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Plays only while visible. Reduced motion means it starts paused on the poster
    // (identical to the loop's first frame), but the viewer can still choose to play.
    const sync = () => {
      const wanted = choice ? choice === "play" : !reduced.matches;
      if (onScreen.current && wanted) el.play().catch(() => {});
      else el.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen.current = entry.isIntersecting;
      sync();
    });
    observer.observe(el);
    reduced.addEventListener("change", sync);
    sync();
    return () => {
      observer.disconnect();
      reduced.removeEventListener("change", sync);
    };
  }, [theme, choice]);

  const src = `/video/studio-loop-${theme}`;
  return (
    <>
      <video
        key={theme}
        ref={video}
        className="board-video"
        poster={`${src}.jpg`}
        muted
        loop
        playsInline
        preload="metadata"
        disablePictureInPicture
        aria-hidden="true"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={`${src}.mp4`} type="video/mp4" />
        <source src={`${src}.webm`} type="video/webm" />
      </video>
      {/* Looping motion longer than 5 s needs a pause control (WCAG 2.2.2). */}
      <button
        type="button"
        className="board-video-toggle"
        aria-label={playing ? "Pause animation" : "Play animation"}
        title={playing ? "Pause animation" : "Play animation"}
        onClick={() => {
          // A click means the board is on screen; respond at once.
          onScreen.current = true;
          setChoice(playing ? "pause" : "play");
        }}
      >
        <Icon name={playing ? "pause" : "play"} filled />
      </button>
    </>
  );
}
