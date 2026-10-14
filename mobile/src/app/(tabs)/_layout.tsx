import type { ColorValue } from "react-native";
import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSession } from "@/session";
import { useWardrobe } from "@/wardrobe";
import { font, useTheme } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;
function icon(active: IconName, idle: IconName) {
  return function TabIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? active : idle} color={color as string} size={size} />;
  };
}

export default function TabsLayout() {
  const t = useTheme();
  const { token, demo } = useSession();
  const { saved } = useWardrobe();
  // Signing out (or an expired session) returns to the welcome screen.
  if (!token && !demo) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.text,
        tabBarInactiveTintColor: t.faint,
        tabBarStyle: { backgroundColor: t.page, borderTopColor: t.border },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: t.page },
      }}
    >
      <Tabs.Screen name="studio" options={{ title: "Studio", tabBarIcon: icon("sparkles", "sparkles-outline") }} />
      <Tabs.Screen name="wardrobe" options={{ title: "Wardrobe", tabBarIcon: icon("shirt", "shirt-outline") }} />
      <Tabs.Screen
        name="saved"
        options={{
          title: "Saved",
          tabBarIcon: icon("bookmark", "bookmark-outline"),
          tabBarBadge: saved.length || undefined,
          // The badge is one of coral's few roles: a small mark, ink text for contrast.
          tabBarBadgeStyle: { backgroundColor: t.accent, color: "#1E221D", fontFamily: font.semibold },
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: "Account", tabBarIcon: icon("person-circle", "person-circle-outline") }}
      />
    </Tabs>
  );
}
