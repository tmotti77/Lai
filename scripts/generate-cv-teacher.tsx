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
      <Text style={styles.name}>נועה פרידמן</Text>
      <Text style={styles.contact}>
        מורה לאנגלית · ירושלים · noa.f.teacher@example.com · 054-9988776
      </Text>

      <Text style={styles.sectionTitle}>ניסיון תעסוקתי</Text>

      <Text style={styles.roleTitle}>מורה לאנגלית · בית ספר יסודי "השרון"</Text>
      <Text style={styles.roleMeta}>ספטמבר 2020 – עכשיו · 5 שנים</Text>
      <Text style={styles.bullet}>
        • הוראת אנגלית לכיתות ג'-ו'. אחראית על תכנון שיעורים, ניהול כיתות של עד 32
        תלמידים, ובניית חומרי לימוד מותאמים לרמות שונות.
      </Text>
      <Text style={styles.bullet}>
        • ליווי 4 תלמידים עם לקויות למידה במסגרת תוכנית הכלה — בנייה של מערכי שיעור
        אישיים בשיתוף יועצת חינוכית.
      </Text>
      <Text style={styles.bullet}>
        • רכזת מקצוע האנגלית בשנתיים האחרונות — תיאום בין 6 מורות, הובלת ישיבות צוות
        שבועיות, וקשר שוטף עם הורים על התקדמות תלמידים.
      </Text>
      <Text style={styles.bullet}>
        • הובלת פרויקט "אנגלית בקהילה" — תלמידי כיתה ו' מלמדים יסודות אנגלית לעולים
        חדשים בשכונה. הפרויקט הוצג ככלי לימודי מומלץ ע"י מפקחת המחוז.
      </Text>

      <Text style={styles.roleTitle}>מורה פרטית לאנגלית · עצמאית</Text>
      <Text style={styles.roleMeta}>2019 – עכשיו · במקביל</Text>
      <Text style={styles.bullet}>
        • הוראה פרטית של אנגלית לתלמידי כיתות ז'-יב' בהיקף של 8-10 שעות שבועיות.
      </Text>
      <Text style={styles.bullet}>
        • הכנה לבחינות פסיכומטרי ולבגרות 5 יח"ל. אחוז הצלחה גבוה — רוב התלמידים שיפרו
        ציון בשתי רמות.
      </Text>

      <Text style={styles.sectionTitle}>השכלה</Text>

      <Text style={styles.roleTitle}>תואר ראשון · ב.אד. בהוראת אנגלית</Text>
      <Text style={styles.roleMeta}>מכללת דוד ילין, ירושלים · 2016-2020</Text>
      <Text style={styles.bullet}>
        • התמחות בספרות אנגלית ולשון. עבודת סיום בהוראת אנגלית כשפה שנייה לדוברי
        עברית. ממוצע ציונים 89.
      </Text>

      <Text style={styles.roleTitle}>תיכון "ליאו באק" · חיפה</Text>
      <Text style={styles.roleMeta}>תעודת בגרות מלאה · 2013</Text>
      <Text style={styles.bullet}>
        • מגמת אנגלית מורחב 5 יח"ל (ציון 96). מגמת ספרות 5 יח"ל. אנגלית מ-13 חודשי
        חילופי תלמידים בארה"ב.
      </Text>

      <Text style={styles.sectionTitle}>השתלמויות</Text>
      <Text style={styles.bullet}>
        • הכלת ילדים עם לקויות למידה (משרד החינוך, 2022, 60 שעות).
      </Text>
      <Text style={styles.bullet}>
        • שילוב טכנולוגיה בכיתה — Kahoot, Padlet, Google Classroom (2021).
      </Text>

      <Text style={styles.sectionTitle}>שפות</Text>
      <Text style={styles.bullet}>
        עברית (שפת אם) · אנגלית (שפת אם שנייה — ילדות בארה"ב) · ערבית מדוברת (בסיסית)
      </Text>

      <Text style={styles.sectionTitle}>פעילות התנדבותית</Text>
      <Text style={styles.bullet}>
        • מנחה בסניף בני עקיבא בירושלים. עבדה עם נוער בסיכון, 4 שעות שבועיות לאורך
        7 שנים.
      </Text>
      <Text style={styles.bullet}>
        • התנדבות בבית התמחות "בית הנערה" — ליווי וחונכות לנערות בנות 16-18, פעם בשבוע.
      </Text>
    </Page>
  </Document>
);

async function main() {
  const buffer = await renderToBuffer(cv);
  const outPath = join(process.cwd(), "scripts", "test-cv-teacher.pdf");
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
