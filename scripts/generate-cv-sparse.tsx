import { renderToBuffer, Document, Page, Text, StyleSheet, Font } from "@react-pdf/renderer";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ttf = join(process.cwd(), "public", "fonts", "Heebo-VF.ttf");
Font.register({
  family: "Heebo",
  fonts: [
    { src: ttf, fontWeight: "normal" },
    { src: ttf, fontWeight: 600 },
    { src: ttf, fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    fontFamily: "Heebo",
    direction: "rtl",
    padding: 40,
    fontSize: 11,
    lineHeight: 1.5,
  },
  name: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  contact: { fontSize: 9, color: "#666", marginBottom: 14 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "bold",
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
    paddingBottom: 2,
  },
  roleTitle: { fontSize: 11, fontWeight: 600, marginTop: 6 },
  roleMeta: { fontSize: 9, color: "#666", marginBottom: 3 },
  bullet: { marginBottom: 2 },
});

const cv = (
  <Document>
    <Page size="A4" style={styles.page}>
      <Text style={styles.name}>תומר לוי</Text>
      <Text style={styles.contact}>
        בן 22 · פתח תקווה · tomer.levy@example.com · 053-7654321
      </Text>

      <Text style={styles.sectionTitle}>שירות צבאי</Text>

      <Text style={styles.roleTitle}>לוחם וסמל מבצעי · גדוד 932, חטיבת הנח"ל</Text>
      <Text style={styles.roleMeta}>נובמבר 2020 – אוקטובר 2023 · 3 שנים</Text>
      <Text style={styles.bullet}>
        • סיים מסלול חי"ר מתקדם וקורס מ"כים. שירת בפלוגת לוחמים בגבול הצפון
        ובגזרת איו"ש.
      </Text>
      <Text style={styles.bullet}>
        • בשנה האחרונה אחראי על צוות בן 8 חיילים — הכשרה מבצעית, סבבים, ולוגיסטיקה
        בשטח.
      </Text>
      <Text style={styles.bullet}>
        • ציון מצטיין מח"ט בסוף השירות.
      </Text>

      <Text style={styles.sectionTitle}>השכלה</Text>

      <Text style={styles.roleTitle}>תיכון "אורט" · פתח תקווה</Text>
      <Text style={styles.roleMeta}>תעודת בגרות חלקית · 2020</Text>
      <Text style={styles.bullet}>
        • מגמת מדעים. מתמטיקה 4 יח"ל. אנגלית 3 יח"ל. השלים השלמת בגרות בעברית
        אחרי השחרור.
      </Text>

      <Text style={styles.sectionTitle}>שפות</Text>
      <Text style={styles.bullet}>
        עברית (שפת אם) · אנגלית (בסיסית — שיחה פשוטה בלבד)
      </Text>

      <Text style={styles.sectionTitle}>תחביבים ופעילות</Text>
      <Text style={styles.bullet}>
        • טיולים ארוכים בטבע, מסלולי שביל ישראל. חבר במועדון מטיילים.
      </Text>
      <Text style={styles.bullet}>
        • אימוני כושר וקרוספיט באופן קבוע, פעמיים בשבוע.
      </Text>
    </Page>
  </Document>
);

async function main() {
  const buffer = await renderToBuffer(cv);
  const outPath = join(process.cwd(), "scripts", "test-cv-sparse.pdf");
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
