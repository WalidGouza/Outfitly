import { useEffect, useRef, useSyncExternalStore } from "react";

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

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let onScreen = false;
    // Play only while visible and motion is welcome; otherwise the poster
    // (identical to the loop's first frame) stays as a still illustration.
    const sync = () => {
      if (onScreen && !reduced.matches) el.play().catch(() => {});
      else el.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    observer.observe(el);
    reduced.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      reduced.removeEventListener("change", sync);
    };
  }, [theme]);

  const src = `/video/studio-loop-${theme}`;
  return (
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
    >
      <source src={`${src}.mp4`} type="video/mp4" />
      <source src={`${src}.webm`} type="video/webm" />
    </video>
  );
}
