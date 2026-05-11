import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";

const labels = he.report.sections.followUps;

const localStyles = StyleSheet.create({
  item: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  bullet: {
    width: 16,
    fontSize: 11,
    color: colors.accent,
    fontWeight: "bold",
    textAlign: "center",
  },
  body: {
    flex: 1,
    fontSize: 11,
    textAlign: "right",
    lineHeight: 1.5,
  },
});

export function FollowUps() {
  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>
      {labels.items.map((item, i) => (
        <View key={i} style={localStyles.item}>
          <Text style={localStyles.bullet}>{i + 1}.</Text>
          <Text style={localStyles.body}>{item}</Text>
        </View>
      ))}
    </View>
  );
}
