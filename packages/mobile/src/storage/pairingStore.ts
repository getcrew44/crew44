import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { PairedProfile } from "@/remote/client";

const PROFILE_KEY = "crewai.mobile.profile";
const PRIVATE_KEY = "crewai.mobile.devicePrivateKey";

export async function loadPairing(): Promise<{ profile: PairedProfile; privateKey: string } | null> {
  const [profileText, privateKey] = await Promise.all([
    AsyncStorage.getItem(PROFILE_KEY),
    SecureStore.getItemAsync(PRIVATE_KEY)
  ]);
  if (!profileText || !privateKey) return null;
  return {
    profile: JSON.parse(profileText) as PairedProfile,
    privateKey
  };
}

export async function savePairing(profile: PairedProfile, privateKey: string): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile)),
    SecureStore.setItemAsync(PRIVATE_KEY, privateKey)
  ]);
}

export async function clearPairing(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(PROFILE_KEY),
    SecureStore.deleteItemAsync(PRIVATE_KEY)
  ]);
}
