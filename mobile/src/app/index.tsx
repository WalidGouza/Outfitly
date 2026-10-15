import { Redirect } from "expo-router";
import { useSession } from "@/session";

/** Entry: signed in or exploring → the studio; otherwise the welcome screen. */
export default function Index() {
  const { token, demo } = useSession();
  return <Redirect href={token || demo ? "/studio" : "/welcome"} />;
}
