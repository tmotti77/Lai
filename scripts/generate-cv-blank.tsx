import { renderToBuffer, Document, Page, View, StyleSheet } from "@react-pdf/renderer";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Generates a PDF with zero <Text> nodes — just shape/View elements. From
 * pdf-parse's perspective this is equivalent to a scanned/image-only CV:
 * the content stream contains drawing operators but no text operators, so
 * extractText() returns an empty string, which triggers the "empty_text"
 * error path in app/api/cv/upload/route.ts.
 *
 * Use to verify the friendly Hebrew error renders end-to-end.
 */

const styles = StyleSheet.create({
  page: { padding: 40, backgroundColor: "#ffffff" },
  block: { backgroundColor: "#cccccc", height: 60, marginBottom: 16 },
  lineLong: { backgroundColor: "#dddddd", height: 10, marginBottom: 6, width: "90%" },
  lineMid: { backgroundColor: "#dddddd", height: 10, marginBottom: 6, width: "70%" },
  lineShort: { backgroundColor: "#dddddd", height: 10, marginBottom: 16, width: "50%" },
});

const doc = (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.block} />
      <View style={styles.lineLong} />
      <View style={styles.lineMid} />
      <View style={styles.lineShort} />
      <View style={styles.lineLong} />
      <View style={styles.lineMid} />
      <View style={styles.lineLong} />
      <View style={styles.lineShort} />
    </Page>
  </Document>
);

async function main() {
  const buffer = await renderToBuffer(doc);
  const outPath = join(process.cwd(), "scripts", "test-cv-blank.pdf");
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
