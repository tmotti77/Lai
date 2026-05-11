import { StyleSheet } from "@react-pdf/renderer";

export const colors = {
  text: "#0f172a",
  muted: "#64748b",
  accent: "#3b82f6",
  border: "#e2e8f0",
  cardBg: "#f8fafc",
  scoreBarBg: "#e2e8f0",
  scoreBarFill: "#3b82f6",
  pathSafeAccent: "#10b981",
  pathGrowthAccent: "#3b82f6",
  pathWildcardAccent: "#8b5cf6",
};

export const styles = StyleSheet.create({
  page: {
    fontFamily: "Heebo",
    direction: "rtl",
    padding: 48,
    fontSize: 11,
    color: colors.text,
    lineHeight: 1.5,
  },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 9,
    color: colors.muted,
  },
  h1: { fontSize: 22, fontWeight: "bold", textAlign: "right", marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: "bold", textAlign: "right", marginTop: 16, marginBottom: 8 },
  h3: { fontSize: 13, fontWeight: 600, textAlign: "right", marginBottom: 6 },
  body: { fontSize: 11, textAlign: "right", marginBottom: 6 },
  small: { fontSize: 9, textAlign: "right", color: colors.muted },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginVertical: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBg,
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  scoreLabel: {
    fontSize: 10,
    width: 80,
    textAlign: "right",
    marginEnd: 8,
  },
  scoreBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: colors.scoreBarBg,
    borderRadius: 2,
  },
  scoreBarFill: {
    height: 4,
    backgroundColor: colors.scoreBarFill,
    borderRadius: 2,
  },
  scoreValue: {
    width: 28,
    fontSize: 9,
    textAlign: "left",
    marginStart: 6,
  },
});
