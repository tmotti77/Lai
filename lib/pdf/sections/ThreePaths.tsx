import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";
import type { Paths, Occupation, Ranking } from "@/lib/matching/types";

const labels = he.report.sections.threePaths;

const localStyles = StyleSheet.create({
  pathCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  pathLabel: { fontSize: 10, fontWeight: "bold", color: colors.accent, marginBottom: 4, textAlign: "right" },
  title: { fontSize: 14, fontWeight: 600, marginBottom: 6, textAlign: "right" },
  prose: { fontSize: 10, lineHeight: 1.5, textAlign: "right", color: colors.text },
  noOption: { fontSize: 10, color: colors.muted, textAlign: "right" },
});

const PATH_COLORS: Record<keyof Paths, string> = {
  safe: colors.pathSafeAccent,
  growth: colors.pathGrowthAccent,
  wildcard: colors.pathWildcardAccent,
};

export function ThreePaths({
  paths,
  rankings,
  occupations,
  prose,
}: {
  paths: Paths;
  rankings: Ranking[];
  occupations: Occupation[];
  prose: Record<string, string>;
}) {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const slots: { key: keyof Paths; label: string; id: string | null }[] = [
    { key: "safe", label: labels.safe, id: paths.safe },
    { key: "growth", label: labels.growth, id: paths.growth },
    { key: "wildcard", label: labels.wildcard, id: paths.wildcard },
  ];

  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>
      {slots.map(({ key, label, id }) => {
        if (!id) {
          return (
            <View key={key} style={[localStyles.pathCard, { borderStyle: "dashed" }]}>
              <Text style={[localStyles.pathLabel, { color: PATH_COLORS[key] }]}>{label}</Text>
              <Text style={localStyles.noOption}>{labels.noPathOption}</Text>
            </View>
          );
        }
        const occ = occMap.get(id);
        if (!occ) return null;
        return (
          <View key={key} style={localStyles.pathCard}>
            <Text style={[localStyles.pathLabel, { color: PATH_COLORS[key] }]}>{label}</Text>
            <Text style={localStyles.title}>{occ.title_he}</Text>
            {prose[id] && <Text style={localStyles.prose}>{prose[id]}</Text>}
          </View>
        );
      })}
    </View>
  );
}
