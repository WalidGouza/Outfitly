import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable as RNPressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { settle } from "@/motion";
import { font, radius, useTheme } from "@/theme";

// The pressable itself is the animated element, so layout styles (flex, width) apply to it.
const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

type ScaleProps = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** Large surfaces (cards) move less than buttons, or they look like they jump. */
  size?: "small" | "large";
};

/**
 * Press feedback starts on touch-down, not release, with a critically damped spring that
 * can reverse mid-way. With `onLongPress`, the surface sinks slowly for the whole hold so
 * the user feels the action coming; release always snaps back quickly.
 */
export function PressableScale({
  style,
  children,
  size = "small",
  onPressIn,
  onPressOut,
  onLongPress,
  delayLongPress = 350,
  disabled,
  ...rest
}: ScaleProps) {
  const scale = useSharedValue(1);
  const pressed = size === "large" ? 0.985 : 0.97;
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, animated, disabled && { opacity: 0.5 }]}
      disabled={disabled}
      delayLongPress={delayLongPress}
      onPressIn={(e) => {
        scale.set(onLongPress
          ? withTiming(0.94, { duration: delayLongPress ?? 350, easing: Easing.linear })
          : withSpring(pressed, settle));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withSpring(1, settle));
        onPressOut?.(e);
      }}
      onLongPress={
        onLongPress &&
        ((e) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          scale.set(withSpring(1, settle));
          onLongPress(e);
        })
      }
    >
      {children}
    </AnimatedPressable>
  );
}

type ButtonProps = Omit<ScaleProps, "children"> & {
  title: string;
  variant?: "primary" | "secondary" | "destructive";
  busy?: boolean;
  icon?: ReactNode;
};

// No haptic on press: screens give one haptic for the outcome (success or error), not two.
export function Button({ title, variant = "primary", busy, icon, style, disabled, ...rest }: ButtonProps) {
  const t = useTheme();
  const colors = {
    // Primary actions are ink; coral is reserved for the destructive confirmation.
    primary: { bg: t.ink, fg: t.onInk, border: t.ink },
    secondary: { bg: t.surface, fg: t.text, border: t.border },
    // Ink on coral is 4.9:1; white on coral would be 3.3:1.
    destructive: { bg: t.accent, fg: "#1E221D", border: t.accent },
  }[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      style={[styles.button, { backgroundColor: colors.bg, borderColor: colors.border }, style]}
      {...rest}
    >
      {busy ? <ActivityIndicator color={colors.fg} /> : icon}
      <Text style={[styles.buttonText, { color: colors.fg }]}>{title}</Text>
    </PressableScale>
  );
}

/** Selection chip: a selection haptic, and no animation (chips are tapped constantly). */
export function Chip({
  label,
  selected,
  onPress,
  onGlass = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** On a glass bar, unselected chips drop their surface so the material shows through. */
  onGlass?: boolean;
}) {
  const t = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        if (!selected) void Haptics.selectionAsync();
        onPress();
      }}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: t.ink, borderColor: t.ink }
          : onGlass
            ? { backgroundColor: "transparent", borderColor: "transparent" }
            : { backgroundColor: t.surface, borderColor: t.border },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? t.onInk : t.text }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonText: { fontFamily: font.semibold, fontSize: 16, letterSpacing: -0.1 },
  chip: {
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  chipText: { fontFamily: font.medium, fontSize: 14 },
});
