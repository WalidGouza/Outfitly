import { useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated from "react-native-reanimated";
import { fadeIn } from "@/motion";
import { categories, styles as styleNames, textures, type Category, type PhotoFile } from "@/api";
import { useWardrobe } from "@/wardrobe";
import { Button, Chip, PressableScale } from "@/components/Pressable";
import { ErrorBanner } from "@/components/ui";
import { font, radius, type, useTheme } from "@/theme";

// Expo Go has no native colour picker: the detected colour plus a wardrobe palette.
const palette = ["#1E1E1E", "#F2F0EA", "#8E8E8E", "#1F2A44", "#4A6FA5", "#506778", "#8B927A", "#4F6B4A", "#C19A6B", "#886448", "#7B2D2D", "#C9A227"];
// Below this confidence a detected field is flagged for the user to check.
const UNCERTAIN = 0.5;

type Draft = { name: string; category: Category; texture: string; style: string; color: string };
const emptyDraft: Draft = { name: "", category: "tops", texture: "cotton", style: "Everyday", color: "#8B927A" };

export default function AddPiece() {
  const t = useTheme();
  const { analyze, addPiece } = useWardrobe();
  const [photo, setPhoto] = useState<PhotoFile | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<"full" | "colour" | null>(null);
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fields the user changed are never overwritten by a late detection result.
  const edited = useRef(new Set<keyof Draft>());
  const run = useRef(0);

  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    edited.current.add(key);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const pick = async (source: "camera" | "library") => {
    setError(null);
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        source === "camera" ? "Camera access needed" : "Photo access needed",
        "Allow access in Settings to add pieces from your photos.",
      );
      return;
    }
    // quality < 1 re-encodes as JPEG, which the backend accepts (HEIC is not).
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8 };
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const file: PhotoFile = {
      uri: asset.uri,
      name: asset.fileName ?? "piece.jpg",
      type: asset.mimeType ?? "image/jpeg",
    };
    setPhoto(file);
    void detect(file);
  };

  const detect = async (file: PhotoFile) => {
    const id = ++run.current;
    edited.current.clear();
    setConfidence({});
    setDetected(null);
    setDetecting(true);
    try {
      const found = await analyze(file);
      if (id !== run.current) return;
      setDraft((d) => {
        const next = { ...d };
        for (const key of Object.keys(d) as (keyof Draft)[]) {
          const value = found[key as keyof typeof found];
          if (typeof value === "string" && value && !edited.current.has(key)) (next as Record<string, string>)[key] = value;
        }
        return next;
      });
      setConfidence(found.confidence ?? {});
      setDetected(found.detected ? "full" : "colour");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      if (id === run.current) setError((e as Error).message);
    } finally {
      if (id === run.current) setDetecting(false);
    }
  };

  const save = async () => {
    if (!photo) return;
    setSaving(true);
    setError(null);
    try {
      await addPiece(photo, draft);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setError((e as Error).message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const uncertain = (field: string) => detected === "full" && (confidence[field] ?? 1) < UNCERTAIN;
  const fieldLabel = (text: string, field?: string) => (
    <View style={styles.labelRow}>
      <Text style={[type.eyebrow, { color: t.muted }]}>{text}</Text>
      {field && uncertain(field) ? (
        <View style={[styles.check, { backgroundColor: t.accentSoft }]}>
          <View style={[styles.dot, { backgroundColor: t.accent }]} />
          <Text style={[type.caption, { color: t.text }]}>Please check</Text>
        </View>
      ) : null}
    </View>
  );
  const colours = [draft.color, ...palette.filter((c) => c.toLowerCase() !== draft.color.toLowerCase())];

  return (
    <ScrollView style={{ backgroundColor: t.page }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!photo ? (
        <View style={{ gap: 12 }}>
          <Text style={[type.body, { color: t.muted }]}>
            Use a clear photo of one garment. Outfitly fills in the details; you can change anything that’s off.
          </Text>
          <Button title="Take a photo" icon={<Ionicons name="camera" size={19} color={t.onInk} />} onPress={() => pick("camera")} />
          <Button
            variant="secondary"
            title="Choose from library"
            icon={<Ionicons name="images-outline" size={19} color={t.text} />}
            onPress={() => pick("library")}
          />
          {error ? <ErrorBanner message={error} /> : null}
        </View>
      ) : (
        <View style={{ gap: 22 }}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Change photo"
            onPress={() => pick("library")}
            style={[styles.preview, { backgroundColor: t.board }]}
          >
            <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
            {/* Re-keyed per state, so the status cross-fades instead of jumping. */}
            <Animated.View
              key={detecting ? "detecting" : (detected ?? "idle")}
              entering={fadeIn}
              style={[styles.status, { backgroundColor: t.surface }]}
            >
              {detecting ? <ActivityIndicator size="small" color={t.text} /> : <Ionicons name="sparkles" size={14} color={t.text} />}
              <Text style={[type.caption, { color: t.text }]}>
                {detecting
                  ? "Detecting details…"
                  : detected === "full"
                    ? "Details detected. Review below."
                    : detected === "colour"
                      ? "Colour detected. Choose the rest."
                      : "Tap to change photo"}
              </Text>
            </Animated.View>
          </PressableScale>

          {error ? <ErrorBanner message={error} /> : null}

          <View style={{ gap: 10, opacity: detecting ? 0.5 : 1 }} pointerEvents={detecting ? "none" : "auto"}>
            {fieldLabel("NAME")}
            <TextInput
              value={draft.name}
              onChangeText={(v) => edit("name", v)}
              placeholder="Relaxed linen shirt"
              placeholderTextColor={t.faint}
              maxLength={80}
              accessibilityLabel="Piece name"
              style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
            />
            {fieldLabel("CATEGORY", "category")}
            <View style={styles.chips}>
              {categories.map((c) => (
                <Chip key={c} label={c[0].toUpperCase() + c.slice(1)} selected={draft.category === c} onPress={() => edit("category", c)} />
              ))}
            </View>
            {fieldLabel("FABRIC", "texture")}
            <View style={styles.chips}>
              {textures.map((c) => (
                <Chip key={c} label={c[0].toUpperCase() + c.slice(1)} selected={draft.texture === c} onPress={() => edit("texture", c)} />
              ))}
            </View>
            {fieldLabel("STYLE", "style")}
            <View style={styles.chips}>
              {styleNames.map((c) => (
                <Chip key={c} label={c} selected={draft.style === c} onPress={() => edit("style", c)} />
              ))}
            </View>
            {fieldLabel("MAIN COLOUR")}
            <View style={styles.chips}>
              {colours.map((c) => {
                const selected = c.toLowerCase() === draft.color.toLowerCase();
                return (
                  <PressableScale
                    key={c}
                    accessibilityRole="button"
                    accessibilityLabel={`Colour ${c}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      edit("color", c);
                    }}
                    style={[styles.swatchRing, { borderColor: selected ? t.text : "transparent" }]}
                  >
                    <View style={[styles.swatch, { backgroundColor: c, borderColor: t.border }]} />
                  </PressableScale>
                );
              })}
            </View>
          </View>

          <Button
            title="Add to wardrobe"
            busy={saving}
            disabled={detecting || !draft.name.trim()}
            onPress={save}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  preview: { height: 280, borderRadius: radius.lg, overflow: "hidden", justifyContent: "flex-end", padding: 12 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  check: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    fontFamily: font.regular,
    fontSize: 16,
  },
  swatchRing: { padding: 3, borderRadius: 22, borderWidth: 2 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
});
