import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { settle } from "@/motion";
import { Logo } from "@/brand";
import { useSession } from "@/session";
import { Button, PressableScale } from "@/components/Pressable";
import { ErrorBanner } from "@/components/ui";
import { font, radius, type, useTheme } from "@/theme";

export default function Welcome() {
  const t = useTheme();
  const { signIn, explore } = useSession();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  // The selection pill slides between the two options (critically damped, interruptible).
  const [segmentWidth, setSegmentWidth] = useState(0);
  const pillX = useSharedValue(0);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pillX.get() }] }));
  const choose = (m: "login" | "register") => {
    if (m !== mode) void Haptics.selectionAsync();
    pillX.set(withSpring(m === "login" ? 0 : segmentWidth / 2, settle));
    setMode(m);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(mode, email, password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/studio");
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.page }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Logo ink={t.logoInk} height={40} />
          <View style={{ gap: 8 }}>
            <Text style={[type.display, { color: t.text, fontSize: 38, lineHeight: 42 }]}>
              Your wardrobe.{"\n"}
              <Text style={{ color: t.muted }}>New possibilities.</Text>
            </Text>
            <Text style={[type.body, { color: t.muted }]}>
              Organise your clothes into wardrobes and let Outfitly put them together.
            </Text>
          </View>

          {/* Segmented control: sign in or create an account. */}
          <View
            style={[styles.segment, { backgroundColor: t.soft }]}
            accessibilityRole="tablist"
            onLayout={(e) => setSegmentWidth(e.nativeEvent.layout.width - 8)}
          >
            {segmentWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.pill, { width: segmentWidth / 2, backgroundColor: t.surface }, pillStyle]}
              />
            ) : null}
            {(["login", "register"] as const).map((m) => (
              <PressableScale
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                onPress={() => choose(m)}
                style={styles.segmentItem}
              >
                <Text style={[type.callout, { color: mode === m ? t.text : t.muted, textAlign: "center" }]}>
                  {m === "login" ? "Sign in" : "Create account"}
                </Text>
              </PressableScale>
            ))}
          </View>

          <View style={{ gap: 12 }}>
            {error ? <ErrorBanner message={error} /> : null}
            <TextInput
              style={input}
              placeholder="Email"
              placeholderTextColor={t.faint}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              accessibilityLabel="Email"
            />
            <TextInput
              ref={passwordRef}
              style={input}
              placeholder={mode === "register" ? "Password (10+ characters)" : "Password"}
              placeholderTextColor={t.faint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              textContentType={mode === "register" ? "newPassword" : "password"}
              returnKeyType="go"
              onSubmitEditing={submit}
              accessibilityLabel="Password"
            />
            <Button
              title={mode === "login" ? "Sign in" : "Create account"}
              busy={busy}
              disabled={!email || password.length < (mode === "register" ? 10 : 1)}
              onPress={submit}
            />
          </View>

          <View style={styles.divider}>
            <View style={[styles.rule, { backgroundColor: t.border }]} />
            <Text style={[type.caption, { color: t.muted }]}>or</Text>
            <View style={[styles.rule, { backgroundColor: t.border }]} />
          </View>
          <Button
            variant="secondary"
            title="Explore the sample wardrobe"
            onPress={() => {
              explore();
              router.replace("/studio");
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 32, gap: 28, flexGrow: 1 },
  segment: { flexDirection: "row", padding: 4, borderRadius: radius.md },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm },
  pill: { position: "absolute", top: 4, bottom: 4, left: 4, borderRadius: radius.sm },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    fontFamily: font.regular,
    fontSize: 16,
  },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
});
