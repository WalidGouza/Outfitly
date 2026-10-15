import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useSession } from "@/session";
import { useWardrobe } from "@/wardrobe";
import { font, useTheme } from "@/theme";

/**
 * System tab bar: Liquid Glass on iOS 26 (it shrinks while scrolling down), the standard
 * translucent bar on earlier iOS, and Material bottom navigation on Android.
 * Icons are SF Symbols on iOS and Material Symbols on Android.
 */
export default function TabsLayout() {
  const t = useTheme();
  const { token, demo } = useSession();
  const { saved } = useWardrobe();
  // Signing out (or an expired session) returns to the welcome screen.
  if (!token && !demo) return <Redirect href="/welcome" />;

  return (
    <NativeTabs
      tintColor={t.text}
      iconColor={{ default: t.faint, selected: t.text }}
      labelStyle={{ fontFamily: font.medium, fontSize: 11 }}
      minimizeBehavior="onScrollDown"
      // Coral badge with ink text (4.9:1): one of coral's few roles.
      badgeBackgroundColor={t.accent}
      badgeTextColor="#1E221D"
      // Android: the bar sits on the page colour with a soft selection indicator.
      backgroundColor={t.page}
      indicatorColor={t.soft}
    >
      <NativeTabs.Trigger name="studio">
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>Studio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wardrobe">
        <NativeTabs.Trigger.Icon sf={{ default: "tshirt", selected: "tshirt.fill" }} md="checkroom" />
        <NativeTabs.Trigger.Label>Wardrobe</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Icon sf={{ default: "bookmark", selected: "bookmark.fill" }} md="bookmark" />
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={!saved.length}>{String(saved.length)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
          md="account_circle"
        />
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
