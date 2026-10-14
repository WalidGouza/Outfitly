import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSession } from "@/session";
import { useWardrobe } from "@/wardrobe";
import { Button, PressableScale } from "@/components/Pressable";
import { ErrorBanner } from "@/components/ui";
import { font, radius, type, useTheme } from "@/theme";

/** Sheet: switch the current wardrobe, or create a new one. */
export default function Wardrobes() {
  const t = useTheme();
  const { demo } = useSession();
  const { wardrobes, wardrobeId, selectWardrobe, createWardrobe } = useWardrobe();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createWardrobe(name.trim());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: t.page }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.group, { backgroundColor: t.surface, borderColor: t.border }]}>
        {wardrobes.map((w, i) => (
          <PressableScale
            key={w.id}
            accessibilityRole="button"
            accessibilityState={{ selected: w.id === wardrobeId }}
            onPress={() => {
              void Haptics.selectionAsync();
              selectWardrobe(w.id);
              router.back();
            }}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
          >
            <Text style={[type.body, { color: t.text, flex: 1 }]}>{w.name}</Text>
            {w.id === wardrobeId ? <Ionicons name="checkmark" size={20} color={t.text} /> : null}
          </PressableScale>
        ))}
        {!wardrobes.length ? (
          <Text style={[type.body, styles.row, { color: t.muted, paddingVertical: 16 }]}>No wardrobes yet.</Text>
        ) : null}
      </View>

      {demo ? (
        <Text style={[type.caption, { color: t.muted, marginTop: 16 }]}>
          Sign in to create your own wardrobes.
        </Text>
      ) : (
        <View style={{ marginTop: 28, gap: 12 }}>
          <Text style={[type.eyebrow, { color: t.muted }]}>NEW WARDROBE</Text>
          {error ? <ErrorBanner message={error} /> : null}
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Summer in the city"
            placeholderTextColor={t.faint}
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={() => name.trim() && create()}
            accessibilityLabel="Wardrobe name"
            style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
          />
          <Button title="Create wardrobe" busy={busy} disabled={!name.trim()} onPress={create} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  group: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    fontFamily: font.regular,
    fontSize: 16,
  },
});
