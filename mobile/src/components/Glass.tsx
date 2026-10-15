import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { useTheme } from "@/theme";

// Liquid Glass (iOS 26+) is for controls that float over content, never for content.
// Some iOS 26 betas lack the API and crash, so both checks are required.
const liquidGlass = Platform.OS === "ios" && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

function useReduceTransparency() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then((value) => active && setReduce(value));
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduce);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

type GlassProps = {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Glass that reacts to touch (iOS 26): for buttons and capsules. */
  interactive?: boolean;
  /** "clear" for small controls over photos; "regular" for bars over mixed content. */
  variant?: "regular" | "clear";
};

/**
 * Liquid Glass on iOS 26+; a system material blur on older iOS; a near-solid surface on
 * Android and whenever "Reduce Transparency" is on, where frostier means more legible.
 */
export function Glass({ style, children, interactive, variant = "regular" }: GlassProps) {
  const t = useTheme();
  const reduceTransparency = useReduceTransparency();

  if (liquidGlass && !reduceTransparency) {
    return (
      <GlassView style={style} glassEffectStyle={variant} isInteractive={interactive}>
        {children}
      </GlassView>
    );
  }
  const edge = { borderWidth: StyleSheet.hairlineWidth, borderColor: t.border };
  if (Platform.OS === "ios" && !reduceTransparency) {
    return (
      <BlurView
        style={[{ overflow: "hidden" }, edge, style]}
        intensity={variant === "clear" ? 40 : 70}
        tint={t.scheme === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      >
        {children}
      </BlurView>
    );
  }
  // Android blur is costly and inconsistent; a slightly translucent surface reads as a layer.
  return (
    <View style={[{ backgroundColor: reduceTransparency ? t.surface : `${t.surface}F2` }, edge, style]}>{children}</View>
  );
}
