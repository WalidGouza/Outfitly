import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { API_URL } from "@/api";
import { LogoSymbol } from "@/brand";
import { useSession } from "@/session";
import { useWardrobe } from "@/wardrobe";
import { Button, PressableScale } from "@/components/Pressable";
import { ScreenTitle } from "@/components/ui";
import { radius, type, useTheme } from "@/theme";

export default function Account() {
  const t = useTheme();
  const { demo, signOut } = useSession();
  const { wardrobes, wardrobeId, selectWardrobe, pieces, saved } = useWardrobe();

  const leave = () =>
    demo
      ? signOut().then(() => router.replace("/welcome"))
      : Alert.alert("Sign out?", "You can sign back in at any time.", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign out", style: "destructive", onPress: () => signOut().then(() => router.replace("/welcome")) },
        ]);

  const group = [styles.group, { backgroundColor: t.surface, borderColor: t.border }];
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.page }}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle eyebrow="Account" title={demo ? "Sample wardrobe" : "Your space"} />

        <View style={[group, styles.profile]}>
          <LogoSymbol ink={t.logoInk} height={44} title="" />
          <View style={{ flex: 1 }}>
            <Text style={[type.headline, { color: t.text }]}>{demo ? "Exploring Outfitly" : "Signed in"}</Text>
            <Text style={[type.caption, { color: t.muted }]}>
              {pieces.length} pieces · {saved.length} saved outfits
            </Text>
          </View>
        </View>

        <Text style={[type.eyebrow, styles.groupLabel, { color: t.muted }]}>WARDROBES</Text>
        <View style={group}>
          {wardrobes.map((w, i) => (
            <PressableScale
              key={w.id}
              accessibilityRole="button"
              accessibilityState={{ selected: w.id === wardrobeId }}
              onPress={() => selectWardrobe(w.id)}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
            >
              <Ionicons name="layers-outline" size={19} color={t.text} />
              <Text style={[type.body, { color: t.text, flex: 1 }]}>{w.name}</Text>
              {w.id === wardrobeId ? <Ionicons name="checkmark" size={20} color={t.text} /> : null}
            </PressableScale>
          ))}
          {!demo ? (
            <PressableScale
              accessibilityRole="button"
              onPress={() => router.push("/wardrobes")}
              style={[styles.row, wardrobes.length > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
            >
              <Ionicons name="add-circle-outline" size={19} color={t.text} />
              <Text style={[type.body, { color: t.text }]}>New wardrobe</Text>
            </PressableScale>
          ) : null}
        </View>

        <Text style={[type.eyebrow, styles.groupLabel, { color: t.muted }]}>APPEARANCE</Text>
        <View style={[group, styles.row]}>
          <Ionicons name="contrast-outline" size={19} color={t.text} />
          <Text style={[type.body, { color: t.text, flex: 1 }]}>Follows your system setting</Text>
          <Text style={[type.caption, { color: t.muted }]}>{t.scheme === "dark" ? "Dark" : "Light"}</Text>
        </View>

        <Button
          variant="secondary"
          title={demo ? "Sign in or create an account" : "Sign out"}
          onPress={leave}
          style={{ marginTop: 32 }}
        />
        <Text style={[type.caption, styles.server, { color: t.faint }]} selectable>
          {API_URL ? `Server: ${API_URL.replace(/^https?:\/\//, "")}` : "No server configured (EXPO_PUBLIC_API_URL)"}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  group: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  profile: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  groupLabel: { marginTop: 28, marginBottom: 10, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16 },
  server: { textAlign: "center", marginTop: 16 },
});
