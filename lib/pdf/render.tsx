import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import { ReportDocument } from "./ReportDocument";
import type { ReportData } from "./types";
import React from "react";

export async function renderReport(data: ReportData): Promise<Buffer> {
  ensureFontsRegistered();
  return renderToBuffer(<ReportDocument data={data} />);
}
