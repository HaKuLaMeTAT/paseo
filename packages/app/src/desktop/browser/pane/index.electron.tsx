import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useBrowserStore } from "@/desktop/browser/store";
import { openExternalUrl } from "@/utils/open-external-url";

interface BrowserPaneProps {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive?: boolean;
  onFocusPane?: () => void;
}

// Keep persisted browser tabs readable without recreating their guest processes.
export function BrowserPane({ browserId }: BrowserPaneProps) {
  const { t } = useTranslation();
  const url = useBrowserStore((state) => state.browsersById[browserId]?.url ?? null);
  const canOpen = url !== null && /^https?:\/\//i.test(url);
  const handleOpenExternal = useCallback(() => {
    if (canOpen) void openExternalUrl(url);
  }, [canOpen, url]);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("workspace.browser.unavailable.title")}</Text>
      {url ? (
        <Text selectable style={styles.url}>
          {url}
        </Text>
      ) : null}
      {canOpen ? (
        <Pressable accessibilityRole="button" onPress={handleOpenExternal}>
          <Text style={styles.action}>{t("serviceUrl.externalBrowser")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  url: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  action: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, padding: 12 },
}));
