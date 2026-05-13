import React from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, EmptyState, Header, LoadingState, Screen } from "@/ui/Screen";

export default function Index() {
  const client = useMobileClient();

  React.useEffect(() => {
    if (client.status === "online") router.replace("/projects");
    if (client.status === "unpaired") router.replace("/pair");
  }, [client.status]);

  if (client.status === "error") {
    return (
      <Screen>
        <Header title="CrewAI Mobile" />
        <EmptyState title="Connection failed" body={client.error} />
        <View style={{ padding: 18, gap: 10 }}>
          <Button label="Reconnect" onPress={client.reconnect} />
          <Button label="Pair again" variant="secondary" onPress={() => router.replace("/pair")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="CrewAI Mobile" />
      <LoadingState label={client.status === "connecting" ? "Connecting to desktop..." : "Loading pairing..."} />
    </Screen>
  );
}
