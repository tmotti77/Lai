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
    fontSize: 10,
    lineHeight: 1.5,
  },
  name: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  contact: { fontSize: 9, color: "#666", marginBottom: 12 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "bold",
    marginTop: 12,
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
      <Text style={styles.name}>יעל כהן</Text>
      <Text style={styles.contact}>
        מפתחת ג'וניור · תל אביב · yael.cohen@example.com · 052-1234567
      </Text>

      <Text style={styles.sectionTitle}>ניסיון תעסוקתי</Text>

      <Text style={styles.roleTitle}>מפתחת ג'וניור · SmartTech Solutions Ltd.</Text>
      <Text style={styles.roleMeta}>אוקטובר 2024 – עכשיו</Text>
      <Text style={styles.bullet}>
        • פיתוח מערכת ניהול לקוחות פנימית בסביבת Python ו-Django עם בסיס נתונים PostgreSQL.
      </Text>
      <Text style={styles.bullet}>
        • בניית דשבורד אנליטי לצוות המכירות בעזרת שאילתות SQL ו-Metabase. הדשבורד משמש מנהלי
        מכירות לקבל החלטות יומיות על תיעדוף לידים.
      </Text>
      <Text style={styles.bullet}>
        • אוטומציה של דוחות יומיים בעזרת cron jobs ו-Python scripts. חסך כ-4 שעות עבודה
        ידנית לצוות בכל יום.
      </Text>
      <Text style={styles.bullet}>
        • שיתוף פעולה הדוק עם מנהל מוצר ומעצבת UX להגדרת features חדשים והתאמתם לצורכי המשתמש.
      </Text>

      <Text style={styles.roleTitle}>מפקדת צוות טכני · יחידת 8200, צה"ל</Text>
      <Text style={styles.roleMeta}>2020 – 2023</Text>
      <Text style={styles.bullet}>
        • פיקוד על צוות של 5 חיילים בתפקיד טכני. אחריות על הכשרה מקצועית ופיתוח עובדים.
      </Text>
      <Text style={styles.bullet}>
        • ניתוח כמויות גדולות של נתונים בעזרת SQL ו-Python. תרגום ממצאים לדוחות שמועברים לדרגי
        פיקוד גבוהים.
      </Text>
      <Text style={styles.bullet}>
        • בניית כלי ניטור פנימי שמהווה עד היום חלק מהמערך התפעולי של היחידה.
      </Text>
      <Text style={styles.bullet}>
        • הצטיינות ראש החטיבה. אחריות על תהליכי קליטה והדרכה של חיילים חדשים בצוות.
      </Text>

      <Text style={styles.sectionTitle}>השכלה</Text>

      <Text style={styles.roleTitle}>תיכון עירוני א' · תל אביב</Text>
      <Text style={styles.roleMeta}>תעודת בגרות מלאה · 2017</Text>
      <Text style={styles.bullet}>
        • מגמה: מתמטיקה ופיזיקה. מתמטיקה 5 יח"ל (ציון 95), אנגלית 5 יח"ל (ציון 91).
      </Text>

      <Text style={styles.roleTitle}>קורס Python מתקדם · קמפוס IL</Text>
      <Text style={styles.roleMeta}>2023</Text>
      <Text style={styles.bullet}>
        • כיסוי Python OOP, אלגוריתמים, ובסיסי DevOps. פרויקט גמר: בניית API REST קטן עם
        Flask ו-Docker.
      </Text>

      <Text style={styles.sectionTitle}>כישורים טכניים</Text>
      <Text style={styles.bullet}>
        Python · SQL · Git · Linux / שורת פקודה · REST APIs · Django · PostgreSQL · Docker
        בסיסי
      </Text>

      <Text style={styles.sectionTitle}>שפות</Text>
      <Text style={styles.bullet}>
        עברית (שפת אם) · אנגלית (שוטפת — קריאה, כתיבה, דיבור) · ערבית (בסיסית)
      </Text>

      <Text style={styles.sectionTitle}>פעילות נוספת</Text>
      <Text style={styles.bullet}>
        • מתנדבת באגודת הסטודנטים: עזרה בלימודי Python למתחילים, שעתיים בשבוע.
      </Text>
      <Text style={styles.bullet}>
        • תחביבים: טיולים בטבע, צילום, קריאה. מתעניינת באולימפיאדות מתמטיקה ובעיות לוגיות.
      </Text>
    </Page>
  </Document>
);

async function main() {
  const buffer = await renderToBuffer(cv);
  const outPath = join(process.cwd(), "scripts", "test-cv.pdf");
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
