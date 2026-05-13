import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { MobileClientProvider } from "@/client/MobileClientProvider";

export default function RootLayout() {
  return (
    <MobileClientProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </MobileClientProvider>
  );
}
