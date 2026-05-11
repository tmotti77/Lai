import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "./styles";
import { Cover } from "./sections/Cover";
import { ProfileMirror } from "./sections/ProfileMirror";
import { ThreePaths } from "./sections/ThreePaths";
import { RankingsTable } from "./sections/RankingsTable";
import { FollowUps } from "./sections/FollowUps";
import { DisclaimerFooter } from "./sections/DisclaimerFooter";
import type { ReportData } from "./types";

export function ReportDocument({ data }: { data: ReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Cover userDisplayName={data.userDisplayName} generatedAt={data.generatedAt} />
      </Page>

      <Page size="A4" style={styles.page}>
        <ProfileMirror profile={data.profile} summaryHe={data.profileSummaryHe} />
        <View style={styles.divider} />
        <ThreePaths
          paths={data.paths}
          rankings={data.rankings}
          occupations={data.occupations}
          prose={data.prose}
        />
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        <DisclaimerFooter />
      </Page>

      <Page size="A4" style={styles.page}>
        <RankingsTable rankings={data.rankings} occupations={data.occupations} />
        <View style={styles.divider} />
        <FollowUps />
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        <DisclaimerFooter />
      </Page>
    </Document>
  );
}
