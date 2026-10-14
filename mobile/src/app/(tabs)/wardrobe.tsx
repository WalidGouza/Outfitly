import { useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated from "react-native-reanimated";
import { categories, type Category, type Piece } from "@/api";
import { useSession } from "@/session";
import { useWardrobe } from "@/wardrobe";
import { Button, Chip, PressableScale } from "@/components/Pressable";
import { EmptyState, ErrorBanner, ScreenTitle, WardrobePill } from "@/components/ui";
import { PieceArt } from "@/components/PieceArt";
import { fadeOut, reflow } from "@/motion";
import { radius, type, useTheme } from "@/theme";

const label = (c: Category | "all") => (c === "all" ? "All" : c[0].toUpperCase() + c.slice(1));

export default function WardrobeScreen() {
  const t = useTheme();
  const { demo } = useSession();
  const { pieces, saved, loading, refresh, removePiece, error, wardrobeId } = useWardrobe();
  const [filter, setFilter] = useState<Category | "all">("all");
  const visible = useMemo(() => pieces.filter((p) => filter === "all" || p.category === filter), [pieces, filter]);

  const add = () => {
    if (demo) {
      Alert.alert("Sign in to add pieces", "The sample wardrobe is read-only. Create an account to add your own clothes.");
      return;
    }
    router.push(wardrobeId ? "/add-piece" : "/wardrobes");
  };

  // Long-press (the card sinks during the hold): the confirmation names exactly what will be lost.
  const confirmRemove = (piece: Piece) => {
    if (demo) return;
    const outfits = saved.filter((l) => l.items.some((i) => i.id === piece.id)).length;
    Alert.alert(
      `Remove ${piece.name}?`,
      outfits
        ? `Its photo will be deleted, along with ${outfits} saved outfit${outfits === 1 ? "" : "s"} that use${outfits === 1 ? "s" : ""} it.`
        : "Its photo will be deleted. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          // Optimistic: the card leaves at once and returns if the server refuses.
          onPress: () =>
            removePiece(piece)
              .then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
              .catch((e) => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert("Couldn't remove this piece", (e as Error).message);
              }),
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.page }}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={t.muted} />}
      >
        <ScreenTitle
          eyebrow="My wardrobe"
          title="The pieces."
          subtitle={demo ? "Sample pieces. Sign in to add your own." : "Hold a piece to remove it."}
          action={
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Add a piece"
              onPress={add}
              style={[styles.addButton, { backgroundColor: t.ink }]}
            >
              <Ionicons name="add" size={26} color={t.onInk} />
            </PressableScale>
          }
        />
        <WardrobePill />
        {error ? (
          <View style={{ marginTop: 16 }}>
            <ErrorBanner message={error} />
          </View>
        ) : null}
        <View style={styles.filters}>
          {(["all", ...categories] as const).map((c) => (
            <Chip key={c} label={label(c)} selected={filter === c} onPress={() => setFilter(c)} />
          ))}
        </View>

        {visible.length ? (
          <View style={styles.grid}>
            {visible.map((item) => (
              // Removed cells fade out and the rest glide into the gap. No entrance animation:
              // filtering remounts cells and is tapped often, so it stays instant.
              <Animated.View key={item.id} style={styles.cell} exiting={fadeOut} layout={reflow}>
                <PressableScale
                  size="large"
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${item.texture} ${item.category}`}
                  accessibilityHint={demo ? undefined : "Hold to remove"}
                  onLongPress={demo ? undefined : () => confirmRemove(item)}
                  style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
                >
                  <View style={styles.art}>
                    <PieceArt piece={item} rounded={0} />
                  </View>
                  <View style={styles.info}>
                    <Text numberOfLines={1} style={[type.callout, { color: t.text }]}>
                      {item.name}
                    </Text>
                    <View style={styles.meta}>
                      <Text style={[type.caption, { color: t.muted, flex: 1 }]}>
                        {item.texture[0].toUpperCase() + item.texture.slice(1)} · {item.category}
                      </Text>
                      <View style={[styles.swatch, { backgroundColor: item.color }]} />
                    </View>
                  </View>
                </PressableScale>
              </Animated.View>
            ))}
          </View>
        ) : loading ? null : (
          <EmptyState
            icon="shirt-outline"
            title={filter === "all" ? "Nothing here yet" : `No ${filter} yet`}
            message="Photograph a piece and Outfitly fills in the details."
          >
            {!demo ? <Button title="Add a piece" onPress={add} style={{ alignSelf: "stretch" }} /> : null}
          </EmptyState>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  addButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18, marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  // Two columns: half the row minus half the 12 px gap.
  cell: { width: "48%", flexGrow: 1, maxWidth: "48.5%" },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  art: { aspectRatio: 1 },
  info: { padding: 12, gap: 4 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "#0003" },
});
