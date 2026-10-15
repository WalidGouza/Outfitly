import { useEffect } from "react";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { SessionProvider, useSession } from "@/session";
import { WardrobeProvider } from "@/wardrobe";
import { font, useTheme } from "@/theme";

void SplashScreen.preventAutoHideAsync();

function Navigation() {
  const t = useTheme();
  const { ready } = useSession();
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  // Keep the branded splash until the stored session and Inter are ready: no flash of system font.
  useEffect(() => {
    if (ready && fontsLoaded) void SplashScreen.hideAsync();
  }, [ready, fontsLoaded]);
  if (!ready || !fontsLoaded) return null;

  const base = t.scheme === "dark" ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: t.text,
          background: t.page,
          card: t.page,
          text: t.text,
          border: t.border,
          notification: t.accent,
        },
      }}
    >
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.page },
          headerTitleStyle: { fontFamily: font.semibold },
          headerTintColor: t.text,
          headerStyle: { backgroundColor: t.page },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        {/* Modal tasks slide up from the bottom and dismiss the same way. */}
        <Stack.Screen
          name="add-piece"
          options={{ presentation: "modal", headerShown: true, title: "Add a piece" }}
        />
        <Stack.Screen
          name="wardrobes"
          options={{ presentation: "modal", headerShown: true, title: "Wardrobes" }}
        />
      </Stack>
    </ThemeProvider>
  );
}

/** A new session (sign-in, sign-out, demo) remounts the wardrobe store with clean state. */
function SessionScoped() {
  const { token, demo } = useSession();
  return (
    <WardrobeProvider key={demo ? "demo" : (token ?? "signed-out")}>
      <Navigation />
    </WardrobeProvider>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <SessionScoped />
    </SessionProvider>
  );
}
