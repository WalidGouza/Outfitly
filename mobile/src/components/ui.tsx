import { useEffect, useRef, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import type { Look } from "@/api";
import { useWardrobe } from "@/wardrobe";
import { fadeIn, fadeOut, settle } from "@/motion";
import { radius, type, useTheme } from "@/theme";
import { PieceArt } from "./PieceArt";
import { PressableScale } from "./Pressable";

/** Large title block, iOS-style: eyebrow, title, optional subtitle and trailing action. */
export function ScreenTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.titleRow}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={[type.eyebrow, { color: t.muted }]}>{eyebrow.toUpperCase()}</Text> : null}
        <Text accessibilityRole="header" style={[type.display, { color: t.text, marginTop: eyebrow ? 6 : 0 }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[type.body, { color: t.muted, marginTop: 6 }]}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

/** Shows the current wardrobe; opens the switcher sheet. */
export function WardrobePill() {
  const t = useTheme();
  const { wardrobes, wardrobeId } = useWardrobe();
  const current = wardrobes.find((w) => w.id === wardrobeId);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Wardrobe: ${current?.name ?? "none"}. Change wardrobe`}
      onPress={() => router.push("/wardrobes")}
      style={[styles.pill, { backgroundColor: t.surface, borderColor: t.border }]}
    >
      <Ionicons name="layers-outline" size={16} color={t.text} />
      <Text numberOfLines={1} style={[type.callout, { color: t.text, maxWidth: 200 }]}>
        {current?.name ?? (wardrobes.length ? "Choose a wardrobe" : "No wardrobe yet")}
      </Text>
      <Ionicons name="chevron-down" size={15} color={t.muted} />
    </PressableScale>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[styles.empty, { borderColor: t.border, backgroundColor: t.surface }]}>
      <Ionicons name={icon} size={30} color={t.muted} />
      <Text style={[type.title, { color: t.text, textAlign: "center" }]}>{title}</Text>
      <Text style={[type.body, { color: t.muted, textAlign: "center" }]}>{message}</Text>
      {children}
    </View>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  const t = useTheme();
  return (
    <Animated.View
      entering={fadeIn}
      exiting={fadeOut}
      accessibilityRole="alert"
      style={[styles.error, { backgroundColor: t.accentSoft, borderColor: t.accent }]}
    >
      <Ionicons name="alert-circle-outline" size={18} color={t.text} />
      <Text style={[type.caption, { color: t.text, flex: 1 }]}>{message}</Text>
    </Animated.View>
  );
}

/** A generated or saved outfit: 2×2 flat lay, name and a save/remove control. */
export function LookCard({
  look,
  saved,
  onToggle,
  title,
}: {
  look: Look;
  saved: boolean;
  onToggle: () => void;
  title: string;
}) {
  const t = useTheme();
  // A small pop when an outfit becomes saved: the state change is felt, not just seen.
  const pop = useSharedValue(1);
  const wasSaved = useRef(saved);
  useEffect(() => {
    if (saved && !wasSaved.current) pop.set(withSequence(withTiming(0.85, { duration: 70 }), withSpring(1, settle)));
    wasSaved.current = saved;
  }, [saved, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={[styles.flatLay, { backgroundColor: t.soft }]}>
        {look.items.map((piece) => (
          <View key={piece.id} style={styles.cell}>
            <PieceArt piece={piece} rounded={12} />
          </View>
        ))}
      </View>
      <View style={styles.cardFooter}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.eyebrow, { color: t.muted }]}>
            {look.style.toUpperCase()}
            {look.score != null ? ` · ${look.score}% MATCH` : ""}
          </Text>
          <Text style={[type.headline, { color: t.text }]}>{title}</Text>
          <Text numberOfLines={2} style={[type.caption, { color: t.muted }]}>
            {look.items.map((i) => i.name).join(" · ")}
          </Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={saved ? "Remove from saved outfits" : "Save outfit"}
          accessibilityState={{ selected: saved }}
          onPress={onToggle}
          // Saved state is one of the few places coral appears.
          style={[
            styles.saveButton,
            saved ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.border },
          ]}
        >
          <Animated.View style={popStyle}>
            <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={19} color={saved ? "#1E221D" : t.text} />
          </Animated.View>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 18 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    alignItems: "center",
    gap: 10,
    padding: 28,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  error: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    padding: 12,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  flatLay: { flexDirection: "row", flexWrap: "wrap", padding: 8, gap: 8 },
  cell: { width: "48.5%", aspectRatio: 1 },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
