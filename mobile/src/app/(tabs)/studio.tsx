import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated from "react-native-reanimated";
import { enterUp } from "@/motion";
import { harmonies, styles as styleNames, type Look } from "@/api";
import { useWardrobe } from "@/wardrobe";
import { Button, Chip, PressableScale } from "@/components/Pressable";
import { EmptyState, ErrorBanner, LookCard, ScreenTitle, WardrobePill } from "@/components/ui";
import { PieceArt } from "@/components/PieceArt";
import { radius, type, useTheme } from "@/theme";

export default function Studio() {
  const t = useTheme();
  const { pieces, loading, refresh, generate, isSaved, saveLook, removeLook, saved, error, wardrobes } = useWardrobe();
  const [style, setStyle] = useState<string>("Everyday");
  const [harmony, setHarmony] = useState<string>("balanced");
  const [includeJacket, setIncludeJacket] = useState(true);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [looks, setLooks] = useState<Look[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await generate({ style, harmony, includeJacket, anchorId });
      setLooks(result);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setProblem((e as Error).message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  // Saving is optimistic, so the haptic confirms the tap itself; failures get their own.
  const toggleSave = async (look: Look) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const existing = saved.find((s) => s.items.map((i) => i.id).sort().join() === look.items.map((i) => i.id).sort().join());
      if (existing) await removeLook(existing);
      else await saveLook(look);
    } catch (e) {
      setProblem((e as Error).message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const section = (label: string) => <Text style={[type.eyebrow, { color: t.muted, marginTop: 24, marginBottom: 10 }]}>{label}</Text>;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.page }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={t.muted} />}
      >
        <ScreenTitle eyebrow="Outfit studio" title="Make it feel like you." />
        <WardrobePill />
        {error ? <View style={{ marginTop: 16 }}><ErrorBanner message={error} /></View> : null}

        {!wardrobes.length && !loading ? (
          <View style={{ marginTop: 24 }}>
            <EmptyState icon="layers-outline" title="Create a wardrobe" message="Start with a wardrobe, then add a few pieces.">
              <Button title="New wardrobe" onPress={() => router.push("/wardrobes")} style={{ alignSelf: "stretch" }} />
            </EmptyState>
          </View>
        ) : (
          <>
            {section("YOUR STYLE")}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {styleNames.map((s) => (
                <Chip key={s} label={s} selected={style === s} onPress={() => setStyle(s)} />
              ))}
            </ScrollView>

            {section("COLOUR DIRECTION")}
            <View style={styles.row}>
              {harmonies.map((h) => (
                <Chip key={h.value} label={h.label} selected={harmony === h.value} onPress={() => setHarmony(h.value)} />
              ))}
            </View>

            <View style={[styles.switchRow, { borderColor: t.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[type.callout, { color: t.text }]}>Include a layer</Text>
                <Text style={[type.caption, { color: t.muted }]}>Add a jacket or cardigan when it fits.</Text>
              </View>
              <Switch
                value={includeJacket}
                onValueChange={(v) => {
                  void Haptics.selectionAsync();
                  setIncludeJacket(v);
                }}
                trackColor={{ true: t.ink, false: t.board }}
                thumbColor={includeJacket ? t.onInk : undefined}
                accessibilityLabel="Include a layer"
              />
            </View>

            {section("START WITH A PIECE")}
            {pieces.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {pieces.map((piece) => {
                  const selected = anchorId === piece.id;
                  return (
                    <PressableScale
                      key={piece.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${piece.name}${selected ? ", starting piece" : ""}`}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setAnchorId(selected ? null : piece.id);
                      }}
                      // The selected piece is one of coral's few roles.
                      style={[styles.anchor, { borderColor: selected ? t.accent : "transparent" }]}
                    >
                      <PieceArt piece={piece} rounded={12} />
                    </PressableScale>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={[type.caption, { color: t.muted }]}>Add pieces in the Wardrobe tab to anchor an outfit.</Text>
            )}

            <Button
              title={busy ? "Putting it together…" : "Find my next outfit"}
              busy={busy}
              icon={busy ? null : <Ionicons name="sparkles" size={18} color={t.onInk} />}
              onPress={run}
              style={{ marginTop: 28 }}
            />
            {problem ? <View style={{ marginTop: 14 }}><ErrorBanner message={problem} /></View> : null}

            {looks.length ? (
              <View style={{ marginTop: 32, gap: 16 }}>
                <Text accessibilityRole="header" style={[type.title, { color: t.text }]}>
                  Fresh combinations
                </Text>
                {looks.map((look, i) => (
                  // Keyed by pieces, so a new set of looks cascades in again.
                  <Animated.View key={look.items.map((p) => p.id).join()} entering={enterUp(i)}>
                    <LookCard look={look} title={`Look ${i + 1}`} saved={isSaved(look)} onToggle={() => toggleSave(look)} />
                  </Animated.View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  strip: { flexDirection: "row", gap: 8, paddingRight: 20 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  anchor: { width: 84, height: 84, borderRadius: radius.md, borderWidth: 2, padding: 2 },
});
