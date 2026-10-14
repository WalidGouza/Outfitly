import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated from "react-native-reanimated";
import type { Look } from "@/api";
import { useWardrobe } from "@/wardrobe";
import { Button } from "@/components/Pressable";
import { EmptyState, LookCard, ScreenTitle, WardrobePill } from "@/components/ui";
import { fadeOut, reflow } from "@/motion";
import { useTheme } from "@/theme";

export default function Saved() {
  const t = useTheme();
  const { saved, loading, refresh, removeLook } = useWardrobe();

  const confirmRemove = (look: Look) =>
    Alert.alert(`Remove ${look.name ?? "this outfit"}?`, "The pieces stay in your wardrobe.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        // Optimistic: the card leaves at once and returns if the server refuses.
        onPress: () =>
          removeLook(look)
            .then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
            .catch((e) => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Couldn't remove this outfit", (e as Error).message);
            }),
      },
    ]);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.page }}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={t.muted} />}
      >
        <View style={{ marginBottom: 4 }}>
          <ScreenTitle eyebrow="Saved outfits" title="Ready to repeat." />
          <WardrobePill />
        </View>
        {saved.length ? (
          saved.map((look, i) => (
            // A removed outfit fades out; the cards below slide up into its place.
            <Animated.View key={look.id ?? String(i)} exiting={fadeOut} layout={reflow}>
              <LookCard look={look} title={look.name ?? "Saved look"} saved onToggle={() => confirmRemove(look)} />
            </Animated.View>
          ))
        ) : loading ? null : (
          <EmptyState
            icon="bookmark-outline"
            title="No saved outfits yet"
            message="Generate a few looks in the studio and save the ones you love."
          >
            <Button title="Open the studio" onPress={() => router.navigate("/studio")} style={{ alignSelf: "stretch" }} />
          </EmptyState>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 16 },
});
