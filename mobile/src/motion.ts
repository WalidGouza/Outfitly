import { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";

// One motion vocabulary for the app. Every preset follows the system "reduce motion"
// setting (Reanimated's default), where movement drops out and only fades remain.

/** Strong ease-out (same curve as the web app's --ease): instant start, gentle settle. */
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

/** Critically damped spring: responsive, never overshoots. Interruptible by design. */
export const settle = { duration: 260, dampingRatio: 1 } as const;

/** Items entering together: an 8 px rise and fade, staggered 50 ms apart. */
export const enterUp = (index = 0) =>
  FadeInDown.duration(240)
    .delay(Math.min(index, 8) * 50)
    .easing(easeOut)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })
    .reduceMotion(ReduceMotion.System);

/** Status and messages: fade in, and leave faster than they arrive. */
export const fadeIn = FadeIn.duration(200).easing(easeOut).reduceMotion(ReduceMotion.System);
export const fadeOut = FadeOut.duration(140).reduceMotion(ReduceMotion.System);

/** Neighbours slide into the space a removed item leaves. */
export const reflow = LinearTransition.duration(240).easing(easeOut).reduceMotion(ReduceMotion.System);
