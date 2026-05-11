import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";

const coverStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  brand: { fontSize: 36, fontWeight: "bold", marginBottom: 4, color: colors.accent },
  title: { fontSize: 22, fontWeight: 600, marginBottom: 12, textAlign: "center" },
  subtitle: { fontSize: 11, color: colors.muted, marginBottom: 32, maxWidth: 380, textAlign: "center", lineHeight: 1.5 },
  meta: { fontSize: 10, color: colors.muted, marginBottom: 8 },
  disclaimer: {
    marginTop: 80,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    fontSize: 10,
    color: colors.muted,
    textAlign: "right",
    maxWidth: 460,
    lineHeight: 1.5,
  },
});

export function Cover({
  userDisplayName,
  generatedAt,
}: {
  userDisplayName: string | null;
  generatedAt: string;
}) {
  const date = new Date(generatedAt).toLocaleDateString("he-IL", {
    day: "numeric", month: "long", year: "numeric",
  });
  const generatedLine = he.report.generatedOn.replace("{date}", date);

  return (
    <View style={coverStyles.container}>
      <Text style={coverStyles.brand}>{he.brand.name}</Text>
      <Text style={coverStyles.title}>{he.report.title}</Text>
      <Text style={coverStyles.subtitle}>{he.report.subtitle}</Text>
      {userDisplayName && (
        <Text style={coverStyles.meta}>{userDisplayName}</Text>
      )}
      <Text style={coverStyles.meta}>{generatedLine}</Text>
      <Text style={coverStyles.disclaimer}>{he.report.disclaimer.cover}</Text>
    </View>
  );
}
