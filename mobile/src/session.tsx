import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { request } from "./api";

// The JWT lives in the device keychain/keystore, never in plain storage.
const TOKEN_KEY = "outfitly.token";

type Session = {
  ready: boolean;
  token: string | null;
  /** Browsing the sample wardrobe without an account. */
  demo: boolean;
  signIn: (mode: "login" | "register", email: string, password: string) => Promise<void>;
  explore: () => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then(setToken)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (mode: "login" | "register", email: string, password: string) => {
    const result = await request<{ token: string }>(`/auth/${mode}`, {
      method: "POST",
      body: { email: email.trim(), password },
    });
    await SecureStore.setItemAsync(TOKEN_KEY, result.token);
    setDemo(false);
    setToken(result.token);
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setDemo(false);
  }, []);

  const value = useMemo(
    () => ({ ready, token, demo, signIn, signOut, explore: () => setDemo(true) }),
    [ready, token, demo, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
