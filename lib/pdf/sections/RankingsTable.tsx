import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";
import type { Ranking, Occupation, ScoreBreakdown } from "@/lib/matching/types";

const labels = he.report.sections.rankings;
const breakdownLabels = labels.breakdown;

const localStyles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  title: { fontSize: 13, fontWeight: 600 },
  totalScore: { fontSize: 11, fontWeight: 600, color: colors.accent },
  totalLabel: { fontSize: 9, color: colors.muted },
  description: { fontSize: 10, color: colors.muted, marginBottom: 6, textAlign: "right" },
});

const ROW_ORDER: (keyof ScoreBreakdown)[] = ["interests", "skills", "values", "big5", "constraints", "market"];

export function RankingsTable({
  rankings,
  occupations,
}: {
  rankings: Ranking[];
  occupations: Occupation[];
}) {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const top = rankings.slice(0, 5);

  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>
      {top.map((r) => {
        const occ = occMap.get(r.occupation_id);
        if (!occ) return null;
        return (
          <View key={r.occupation_id} style={localStyles.row} wrap={false}>
            <View style={localStyles.header}>
              <Text style={localStyles.title}>{occ.title_he}</Text>
              <View>
                <Text style={localStyles.totalLabel}>{labels.scoreLabel}</Text>
                <Text style={localStyles.totalScore}>{r.total_score}</Text>
              </View>
            </View>
            <Text style={localStyles.description}>{occ.description_he}</Text>
            <View>
              {ROW_ORDER.map((key) => {
                const v = r.breakdown[key];
                if (v === null) return null;
                return (
                  <View key={key} style={styles.scoreRow}>
                    <Text style={styles.scoreLabel}>{breakdownLabels[key]}</Text>
                    <View style={styles.scoreBarBg}>
                      <View style={[styles.scoreBarFill, { width: `${v}%` }]} />
                    </View>
                    <Text style={styles.scoreValue}>{v}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
