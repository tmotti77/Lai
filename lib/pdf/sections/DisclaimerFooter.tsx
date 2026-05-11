import React from "react";
import { Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import { he } from "@/lib/i18n/he";

const footerStyles = StyleSheet.create({
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 8,
    color: colors.muted,
  },
});

export function DisclaimerFooter() {
  return <Text style={footerStyles.footer} fixed>{he.report.disclaimer.footer}</Text>;
}
