import { Composition } from "remotion";
import { StudioLoop } from "./StudioLoop";

// 3:2 to fill the app's studio board; 8 s seamless loop at 30 fps.
const common = { component: StudioLoop, durationInFrames: 240, fps: 30, width: 1200, height: 800 } as const;

export function Root() {
  return (
    <>
      <Composition id="StudioLoopLight" {...common} defaultProps={{ theme: "light" as const }} />
      <Composition id="StudioLoopDark" {...common} defaultProps={{ theme: "dark" as const }} />
    </>
  );
}
