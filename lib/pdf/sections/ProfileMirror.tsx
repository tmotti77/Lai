import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";
import type { MatchingProfile } from "@/lib/matching/types";

const labels = he.report.sections.profileMirror;

const localStyles = StyleSheet.create({
  block: { marginBottom: 8 },
  label: { fontSize: 10, fontWeight: 600, color: colors.muted, marginBottom: 2 },
  value: { fontSize: 11, textAlign: "right" },
  bullet: { fontSize: 11, marginBottom: 2, textAlign: "right" },
});

export function ProfileMirror({
  profile,
  summaryHe,
}: {
  profile: MatchingProfile;
  summaryHe: string | null;
}) {
  const hasAnything = profile.interests || profile.skills || profile.values || profile.constraints;

  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>

      {!hasAnything && !summaryHe && (
        <Text style={styles.body}>{labels.introNoData}</Text>
      )}

      {summaryHe && (
        <Text style={[styles.body, { marginBottom: 12 }]}>{summaryHe}</Text>
      )}

      {profile.interests && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.interestsLabel}</Text>
          <Text style={localStyles.value}>{topRiasecLabel(profile.interests)}</Text>
        </View>
      )}

      {profile.values && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.valuesLabel}</Text>
          <Text style={localStyles.value}>{profile.values.topThree.join(" · ")}</Text>
        </View>
      )}

      {profile.skills && profile.skills.length > 0 && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.skillsLabel}</Text>
          <Text style={localStyles.value}>
            {profile.skills.slice(0, 8).map((s) => s.id).join(" · ")}
          </Text>
        </View>
      )}

      {profile.constraints && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.constraintsLabel}</Text>
          <Text style={localStyles.value}>{constraintsSummary(profile.constraints)}</Text>
        </View>
      )}
    </View>
  );
}

function topRiasecLabel(interests: NonNullable<MatchingProfile["interests"]>): string {
  const names = labels.riasecNames;
  const entries: [string, number][] = (Object.keys(interests) as (keyof typeof interests)[])
    .map((k) => [k as string, interests[k] as number]);
  const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.map(([k]) => names[k as keyof typeof names] ?? k).join(" · ");
}

function constraintsSummary(c: NonNullable<MatchingProfile["constraints"]>): string {
  const f = labels.constraintsFragments;
  const parts: string[] = [];
  if (c.location_he) parts.push(c.location_he);
  if (c.time_per_week_hours !== undefined) {
    parts.push(f.hoursPerWeek.replace("{hours}", String(c.time_per_week_hours)));
  }
  if (c.training_budget_nis !== undefined) {
    parts.push(f.trainingBudget.replace("{amount}", c.training_budget_nis.toLocaleString("he-IL")));
  }
  if (c.english_level) {
    parts.push(f.english.replace("{level}", c.english_level));
  }
  return parts.join(" · ");
}
