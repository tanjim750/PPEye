import * as XLSX from 'xlsx-js-style';

function getSupabaseClient() {
  try {
    return require('@/services/supabase/client').supabase;
  } catch {
    return null;
  }
}

export type OrganizationItem = {
  id: number | string;
  name: string;
};

export type ReportRow = {
  date: string;
  workers: number;
  sites: string;
  status: 'Safe' | 'Unsafe';
  reason: string;
};

export type OrgReportSection = {
  organizationName: string;
  rows: ReportRow[];
  totalSubmissions: number;
  totalSafe: number;
  totalUnsafe: number;
  performancePercent: number;
};

function extractNormalizedNotes(rawInput: string, notesMap: Map<string, string>): void {
  const segments = rawInput.split(/[;\r\n]+/);
  for (const seg of segments) {
    let cleaned = seg
      .trim()
      .replace(/^(?:worker\s*#?\s*\d+\s*[:\-—]\s*)+/i, '')
      .replace(/^(?:other(?:\s+safety\s+violation)?\s*[:\-—]\s*)+/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) continue;

    // Collapse accidental consecutive duplicate words (e.g. "ihivivugv ihivivugv")
    cleaned = cleaned.replace(/\b(\S+)(?:\s+\1\b)+/gi, '$1');

    // Collapse comma-repeated identical tokens (e.g. "ihivivugv, ihivivugv")
    if (cleaned.includes(',')) {
      const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
      const uniqueParts = Array.from(new Map(parts.map((p) => [p.toLowerCase(), p])).values());
      cleaned = uniqueParts.join(', ');
    }

    const norm = cleaned.toLowerCase();
    if (!norm || norm === 'other' || norm === 'other safety violation') continue;
    if (!notesMap.has(norm)) {
      notesMap.set(norm, cleaned);
    }
  }
}

/**
 * Helper to cleanly format safety violation reasons.
 * Deduplicates standard PPE violations and formats unique 'Other' notes once in parentheses.
 */
export function formatSafetyViolationReasons(
  reasonsList: string[],
  otherNotesList: string[] = []
): string {
  const notesMap = new Map<string, string>();
  for (const n of otherNotesList) {
    if (typeof n === 'string' && n.trim()) {
      extractNormalizedNotes(n, notesMap);
    }
  }

  const seenReasonKeys = new Set<string>();
  const cleanReasons: string[] = [];
  let hasOtherReason = false;

  const pushUniqueReason = (label: string) => {
    const key = label.trim().toLowerCase();
    if (!key || seenReasonKeys.has(key)) return;
    seenReasonKeys.add(key);
    cleanReasons.push(label.trim());
  };

  for (const raw of reasonsList) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    const inlineOtherMatch = trimmed.match(/^other(?:\s+safety\s+violation)?\s*\((.+)\)$/i);
    if (inlineOtherMatch) {
      hasOtherReason = true;
      extractNormalizedNotes(inlineOtherMatch[1], notesMap);
      continue;
    }

    const isOtherCode =
      lower === 'other' ||
      lower === 'other safety violation' ||
      lower.startsWith('other safety violation');

    if (isOtherCode) {
      hasOtherReason = true;
      const trailing = trimmed.replace(/^other(?:\s+safety\s+violation)?[\s:\-—]*/i, '').trim();
      if (trailing) extractNormalizedNotes(trailing, notesMap);
      continue;
    }

    const strippedNoteCandidate = trimmed.replace(/^worker\s*#?\s*\d+\s*[:\-—]\s*/i, '').trim().toLowerCase();
    if (notesMap.has(lower) || notesMap.has(strippedNoteCandidate)) {
      continue;
    }

    // Normalize DB labels ("Helmet violation", "SAFETY_SHOES") & UI codes ("helmet", "shoes") to canonical names
    const base = lower.replace(/[_-]+/g, ' ').replace(/\s+violation$/, '').trim();
    if (base === 'helmet' || base === 'safety helmet' || base === 'hard hat') {
      pushUniqueReason('Helmet');
    } else if (base === 'harness' || base === 'full body harness' || lower.includes('full-body')) {
      pushUniqueReason('Full-body harness');
    } else if (base === 'lanyard' || base === 'safety lanyard') {
      pushUniqueReason('Lanyard');
    } else if (base === 'anchorage' || base.startsWith('anchorage') || lower.includes('connection')) {
      pushUniqueReason('Anchorage / connection');
    } else if (base === 'shoes' || base === 'safety shoes' || lower.includes('safety shoes') || lower.includes('boots')) {
      pushUniqueReason('Safety shoes');
    } else {
      pushUniqueReason(trimmed);
    }
  }

  const allNotes = Array.from(notesMap.values());
  if (hasOtherReason || allNotes.length > 0) {
    if (allNotes.length > 0) {
      pushUniqueReason(`Other Safety Violation (${allNotes.join('; ')})`);
    } else {
      pushUniqueReason('Other Safety Violation');
    }
  }

  return cleanReasons.length > 0 ? cleanReasons.join(', ') : '-';
}

/**
 * Fetch available organizations from DB with sensible fallbacks.
 */
export async function fetchOrganizations(): Promise<OrganizationItem[]> {
  const fallbackList: OrganizationItem[] = [
    { id: 1, name: 'ABC Telecom' },
    { id: 2, name: 'XYZ Networks' },
    { id: 3, name: 'Apex Power' },
    { id: 4, name: 'Delta Comms' },
    { id: 5, name: 'Sigma Tech' },
  ];

  try {
    const supabase = getSupabaseClient();
    if (!supabase) return fallbackList;

    const { data, error } = await supabase
      .from('vendor_profiles')
      .select('id, vendor_name')
      .order('vendor_name', { ascending: true });

    if (!error && data && data.length > 0) {
      const orgs: OrganizationItem[] = [];
      const seenNames = new Set<string>();

      for (const item of data) {
        const name = (item.vendor_name || '').trim();
        const norm = name.toLowerCase();
        if (name && !seenNames.has(norm)) {
          seenNames.add(norm);
          orgs.push({
            id: item.id,
            name,
          });
        }
      }

      if (orgs.length > 0) {
        return orgs;
      }
    }
  } catch (err) {
    console.warn('[report.service] fetchOrganizations fallback:', err);
  }

  return fallbackList;
}

/**
 * Format Date to YYYY-MM-DD
 */
export function formatDateYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Fetch submission data for selected organizations and date range
 */
export async function fetchReportData(
  selectedOrgs: OrganizationItem[],
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<OrgReportSection[]> {
  const orgNames = selectedOrgs.map((o) => o.name);
  const orgIds = selectedOrgs
    .map((o) => o.id)
    .filter((id) => typeof id === 'number');

  // Query submissions in date range (start of day to end of day)
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = `${endDate}T23:59:59.999Z`;

  let submissionsData: any[] = [];

  try {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable');

    let query = supabase
      .from('ppe_submissions')
      .select(`
        id,
        vendor_profile_id,
        site_name,
        status,
        metadata,
        submitted_at,
        created_at,
        vendor_profiles (
          id,
          vendor_name,
          project_name
        ),
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews (
            id,
            verdict,
            reviewed_at,
            ppe_review_reasons (
              note,
              unsafe_reasons (code, label)
            )
          ),
          ppe_images (side, created_at)
        )
      `)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false });

    if (orgIds.length > 0) {
      query = query.in('vendor_profile_id', orgIds);
    }

    const { data, error } = await query;
    if (!error && data) {
      submissionsData = data;
    }
  } catch (err) {
    console.warn('[report.service] Error fetching from supabase:', err);
  }

  // Fallback to local memory reviews if DB returned empty or network unavailable
  if (submissionsData.length === 0) {
    const { getAllReviews } = require('@/features/reviews/services/reviews.service');
    const localReviews = getAllReviews();
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    const filtered = localReviews.filter((r: any) => {
      const inDate = r.timestamp >= startMs && r.timestamp <= endMs;
      const inOrg = orgNames.some(
        (name) => name.toLowerCase() === (r.vendor || '').trim().toLowerCase()
      );
      return inDate && inOrg && !r.isDraft && r.status !== 'waiting';
    });

    // Map local reviews to OrgReportSection (including selected organizations with 0 submissions)
    const sections: OrgReportSection[] = [];
    for (const org of selectedOrgs) {
      const orgReviews = filtered.filter(
        (r: any) => (r.vendor || '').trim().toLowerCase() === org.name.toLowerCase()
      );

      const rows: ReportRow[] = orgReviews.map((r: any) => {
        const d = new Date(r.timestamp);
        const dateStr = formatDateYMD(d);
        const isUnsafe =
          r.status === 'unsafe' ||
          (r.workerReviews && r.workerReviews.some((w: any) => w.status === 'unsafe'));
        const reasonsList: string[] = [];
        const notesList: string[] = [];
        if (r.unsafeReasons) reasonsList.push(...r.unsafeReasons);
        if (r.otherReasonText) notesList.push(r.otherReasonText);
        if (r.workerReviews) {
          r.workerReviews.forEach((w: any) => {
            if (w.status && w.status !== 'unsafe') return;
            if (w.unsafeReasons) reasonsList.push(...w.unsafeReasons);
            if (w.otherReasonText) notesList.push(w.otherReasonText);
          });
        }
        const formattedReason = isUnsafe
          ? formatSafetyViolationReasons(reasonsList, notesList)
          : '-';

        return {
          date: dateStr,
          workers: r.workers || 1,
          sites: r.location || 'Site',
          status: isUnsafe ? 'Unsafe' : 'Safe',
          reason: formattedReason,
        };
      });

      const totalSubmissions = rows.length;
      const totalSafe = rows.filter((r) => r.status === 'Safe').length;
      const totalUnsafe = rows.filter((r) => r.status === 'Unsafe').length;
      const performancePercent =
        totalSubmissions > 0 ? Math.round((totalSafe / totalSubmissions) * 100) : 0;

      sections.push({
        organizationName: org.name,
        rows,
        totalSubmissions,
        totalSafe,
        totalUnsafe,
        performancePercent,
      });
    }

    const activeLocalOrgs = sections.filter((s) => s.rows.length > 0);
    const emptyLocalOrgs = sections.filter((s) => s.rows.length === 0);
    return [...activeLocalOrgs, ...emptyLocalOrgs];
  }

  // Parse DB submissions into report sections per organization (preserving zero-submission orgs)
  const sections: OrgReportSection[] = [];

  for (const org of selectedOrgs) {
    const orgSubmissions = submissionsData.filter((sub) => {
      const subOrgId = sub.vendor_profile_id;
      const subOrgName = (sub.vendor_profiles?.vendor_name || '').trim().toLowerCase();
      return subOrgId === org.id || subOrgName === org.name.toLowerCase();
    });

    const rows: ReportRow[] = [];

    for (const sub of orgSubmissions) {
      const d = new Date(sub.submitted_at || sub.created_at);
      const dateStr = formatDateYMD(d);
      const workers = sub.ppe_worker_instances || [];
      const workerCount = workers.length || Number(sub.metadata?.totalWorkers) || 1;
      const site = sub.site_name || 'Site';

      // Check worker verdicts
      const reasons: string[] = [];
      const notes: string[] = [];
      let isUnsafe = false;

      for (const w of workers) {
        const reviews = w.ppe_reviews || [];
        const latestReview = reviews.sort(
          (a: any, b: any) =>
            new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime()
        )[0];
        if (latestReview?.verdict === 'UNSAFE') {
          isUnsafe = true;
          for (const rr of latestReview.ppe_review_reasons || []) {
            const label = rr.unsafe_reasons?.label || rr.unsafe_reasons?.code;
            if (label) reasons.push(label);
            if (rr.note) notes.push(rr.note);
          }
        }
      }

      if (sub.metadata?.workerReviews) {
        for (const wr of sub.metadata.workerReviews) {
          if (wr.status === 'unsafe') {
            isUnsafe = true;
            if (wr.unsafeReasons) reasons.push(...wr.unsafeReasons);
            if (wr.otherReasonText) notes.push(wr.otherReasonText);
          }
        }
      }

      if (sub.metadata?.otherReasonText) {
        notes.push(sub.metadata.otherReasonText);
      }

      const formattedReason = isUnsafe
        ? formatSafetyViolationReasons(reasons, notes)
        : '-';

      rows.push({
        date: dateStr,
        workers: workerCount,
        sites: site,
        status: isUnsafe ? 'Unsafe' : 'Safe',
        reason: formattedReason,
      });
    }

    const totalSubmissions = rows.length;
    const totalSafe = rows.filter((r) => r.status === 'Safe').length;
    const totalUnsafe = rows.filter((r) => r.status === 'Unsafe').length;
    const performancePercent =
      totalSubmissions > 0 ? Math.round((totalSafe / totalSubmissions) * 100) : 0;

    sections.push({
      organizationName: org.name,
      rows,
      totalSubmissions,
      totalSafe,
      totalUnsafe,
      performancePercent,
    });
  }

  const activeOrgs = sections.filter((s) => s.rows.length > 0);
  const emptyOrgs = sections.filter((s) => s.rows.length === 0);
  return [...activeOrgs, ...emptyOrgs];
}

/**
 * Builds the beautifully styled corporate SheetJS workbook and returns base64 content
 */
export function buildExcelWorkbookBase64(sections: OrgReportSection[]): string {
  const wb = XLSX.utils.book_new();
  const ws: any = {};
  const merges: any[] = [];
  const rowHeights: Array<{ hpt: number }> = [];

  // Theme Colors
  const COLOR_MASTER_TITLE_BG = '1E293B'; // Dark Corporate Navy (Single Master Top Header A1:E1)
  const COLOR_BANNER_ORG_BG = '334155'; // Slate / Navy Accent (Per-Organization Banner)
  const COLOR_HEADER_BG = '334155'; // Slate Blue / Dark Gray
  const COLOR_WHITE = 'FFFFFF';
  const COLOR_TEXT_DARK = '1E293B';
  const COLOR_MUTED_SLATE = '64748B';
  const COLOR_BORDER = 'CBD5E1'; // Thin light gray border
  const COLOR_ZEBRA_LIGHT = 'F8FAFC'; // Soft gray
  const COLOR_STATUS_SAFE_BG = 'DCFCE7'; // Soft green
  const COLOR_STATUS_SAFE_TXT = '166534'; // Dark green
  const COLOR_STATUS_UNSAFE_BG = 'FEE2E2'; // Soft red/rose
  const COLOR_STATUS_UNSAFE_TXT = '991B1B'; // Dark red
  const COLOR_KPI_TOTAL_BG = 'F1F5F9'; // Light slate
  const COLOR_KPI_TOTAL_TXT = '0F172A';
  const COLOR_KPI_RATE_BG = 'E0F2FE'; // Sky blue highlight
  const COLOR_KPI_RATE_TXT = '0369A1';

  // Standard Border Object
  const cellBorder = {
    top: { style: 'thin', color: { rgb: COLOR_BORDER } },
    bottom: { style: 'thin', color: { rgb: COLOR_BORDER } },
    left: { style: 'thin', color: { rgb: COLOR_BORDER } },
    right: { style: 'thin', color: { rgb: COLOR_BORDER } },
  };

  let currentRow = 0; // 0-indexed row for SheetJS

  function setCell(r: number, c: number, value: string | number, style?: any) {
    const cellRef = XLSX.utils.encode_cell({ r, c });
    const isNum = typeof value === 'number';
    ws[cellRef] = {
      v: value,
      t: isNum ? 'n' : 's',
      s: style || {},
    };
  }

  // 1. Single Master Top Header (Strictly once at Worksheet Row 1 / A1:E1)
  const masterTitleRow = currentRow;
  rowHeights[masterTitleRow] = { hpt: 30 };
  merges.push({ s: { r: masterTitleRow, c: 0 }, e: { r: masterTitleRow, c: 4 } });

  const masterTitleStyle = {
    fill: { fgColor: { rgb: COLOR_MASTER_TITLE_BG } },
    font: { name: 'Arial', sz: 14, bold: true, color: { rgb: COLOR_WHITE } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  for (let c = 0; c <= 4; c++) {
    setCell(masterTitleRow, c, c === 0 ? 'PPEye SAFETY AUDIT REPORT' : '', masterTitleStyle);
  }
  currentRow++;

  // Top verification standard ribbon directly beneath Master Title (Row 2 / A2:E2)
  rowHeights[currentRow] = { hpt: 18 };
  setCell(currentRow, 0, '✦ PPEye Safety Verification Standard ✦', {
    font: { name: 'Arial', sz: 8.5, italic: true, color: { rgb: '94A3B8' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  });
  for (let c = 1; c <= 4; c++) {
    setCell(currentRow, c, '');
  }
  merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 4 } });
  currentRow++;

  // 2. Smart Vendor Partitioning: Active vendors first, Inactive (0 submissions) strictly at the end
  const activeOrgs = sections.filter((sec) => (sec.rows?.length ?? 0) > 0);
  const emptyOrgs = sections.filter((sec) => (sec.rows?.length ?? 0) === 0);
  const orderedSections = [...activeOrgs, ...emptyOrgs];

  for (let sIdx = 0; sIdx < orderedSections.length; sIdx++) {
    const sec = orderedSections[sIdx];
    const isInactiveOrg = (sec.rows?.length ?? 0) === 0;

    // Multi-Organization Separator: 2 empty spacer rows between distinct organization blocks
    if (sIdx > 0) {
      rowHeights[currentRow] = { hpt: 16 };
      currentRow++;
      rowHeights[currentRow] = { hpt: 16 };
      currentRow++;
    }

    // Organization Banner: ORGANIZATION: {Organization Name} (Merged A:E, #334155, 12pt Bold White, ~24pt)
    const bannerOrgRow = currentRow;
    rowHeights[bannerOrgRow] = { hpt: 24 };
    merges.push({ s: { r: bannerOrgRow, c: 0 }, e: { r: bannerOrgRow, c: 4 } });

    const bannerOrgText = `ORGANIZATION: ${sec.organizationName.toUpperCase()}`;
    const bannerOrgStyle = {
      fill: { fgColor: { rgb: COLOR_BANNER_ORG_BG } },
      font: { name: 'Arial', sz: 12, bold: true, color: { rgb: COLOR_WHITE } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };

    for (let c = 0; c <= 4; c++) {
      setCell(bannerOrgRow, c, c === 0 ? bannerOrgText : '', bannerOrgStyle);
    }
    currentRow++;

    if (isInactiveOrg) {
      // 4. Inactive / New Vendor Layout (submissions.length === 0)
      // Immediately below the banner, single prominent merged row across Columns A to E
      const emptyNoticeRow = currentRow;
      rowHeights[emptyNoticeRow] = { hpt: 30 };
      merges.push({ s: { r: emptyNoticeRow, c: 0 }, e: { r: emptyNoticeRow, c: 4 } });

      const emptyNoticeStyle = {
        fill: { fgColor: { rgb: COLOR_ZEBRA_LIGHT } },
        font: {
          name: 'Arial',
          sz: 11,
          bold: true,
          italic: true,
          color: { rgb: COLOR_MUTED_SLATE },
        },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: cellBorder,
      };
      for (let c = 0; c <= 4; c++) {
        setCell(
          emptyNoticeRow,
          c,
          c === 0 ? 'No submission or review records found for this period' : '',
          emptyNoticeStyle
        );
      }
      currentRow++;
    } else {
      // 3. Active Organization Layout (submissions.length > 0)
      // Table Column Headers directly beneath Organization Banner (zero gap)
      const headerRow = currentRow;
      rowHeights[headerRow] = { hpt: 26 };
      const headers = [
        { text: 'Date', align: 'center' },
        { text: 'Total Workers', align: 'center' },
        { text: 'Site Location', align: 'center' },
        { text: 'Review Status', align: 'center' },
        { text: 'Safety Remarks / Reason', align: 'center' },
      ];

      headers.forEach((h, cIdx) => {
        setCell(headerRow, cIdx, h.text, {
          fill: { fgColor: { rgb: COLOR_HEADER_BG } },
          font: { name: 'Arial', sz: 11, bold: true, color: { rgb: COLOR_WHITE } },
          alignment: { horizontal: h.align, vertical: 'center' },
          border: cellBorder,
        });
      });
      currentRow++;

      // Data Rows & Cell Formatting
      sec.rows.forEach((rowItem, rIdx) => {
        const dataRow = currentRow;
        rowHeights[dataRow] = { hpt: 22 };
        const isZebra = rIdx % 2 === 1;
        const bgRgb = isZebra ? COLOR_ZEBRA_LIGHT : COLOR_WHITE;

        const baseStyle = {
          fill: { fgColor: { rgb: bgRgb } },
          font: { name: 'Arial', sz: 10, color: { rgb: COLOR_TEXT_DARK } },
          border: cellBorder,
        };

        // Col A: Date (DD-MM-YYYY Centered)
        let formattedDate = rowItem.date;
        if (formattedDate && formattedDate.includes('-')) {
          const parts = formattedDate.split('-');
          if (parts.length === 3 && parts[0].length === 4) {
            formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD -> DD-MM-YYYY
          }
        }
        setCell(dataRow, 0, formattedDate, {
          ...baseStyle,
          alignment: { horizontal: 'center', vertical: 'center' },
        });

        // Col B: Total Workers (Integer Centered)
        setCell(dataRow, 1, rowItem.workers, {
          ...baseStyle,
          alignment: { horizontal: 'center', vertical: 'center' },
        });

        // Col C: Site Location (Centered)
        setCell(dataRow, 2, rowItem.sites, {
          ...baseStyle,
          alignment: { horizontal: 'center', vertical: 'center' },
        });

        // Col D: Review Status (Conditional Fill Badge)
        const isSafe = rowItem.status === 'Safe';
        const statusStyle = {
          fill: { fgColor: { rgb: isSafe ? COLOR_STATUS_SAFE_BG : COLOR_STATUS_UNSAFE_BG } },
          font: {
            name: 'Arial',
            sz: 10,
            bold: true,
            color: { rgb: isSafe ? COLOR_STATUS_SAFE_TXT : COLOR_STATUS_UNSAFE_TXT },
          },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: cellBorder,
        };
        setCell(dataRow, 3, rowItem.status, statusStyle);

        // Col E: Safety Remarks / Reason (Centered with wrapText: true)
        setCell(dataRow, 4, rowItem.reason || '-', {
          ...baseStyle,
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        });

        currentRow++;
      });
    }

    // Certified audit ribbon row before KPI Summary Card for EVERY organization (active & inactive)
    rowHeights[currentRow] = { hpt: 16 };
    setCell(currentRow, 0, 'PPEye Certified Audit', {
      font: { name: 'Arial', sz: 8.5, italic: true, color: { rgb: 'CBD5E1' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    });
    for (let c = 1; c <= 4; c++) {
      setCell(currentRow, c, '');
    }
    merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 4 } });
    currentRow++;

    // 5. Executive Summary / KPI Card (Bottom of organization)
    // Row 1: KPI Titles
    const kpiTitleRow = currentRow;
    rowHeights[kpiTitleRow] = { hpt: 20 };
    setCell(kpiTitleRow, 0, 'Total Submissions', {
      fill: { fgColor: { rgb: COLOR_KPI_TOTAL_BG } },
      font: { name: 'Arial', sz: 9, bold: true, color: { rgb: '475569' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    setCell(kpiTitleRow, 1, 'Safe Submissions', {
      fill: { fgColor: { rgb: 'ECFDF5' } },
      font: { name: 'Arial', sz: 9, bold: true, color: { rgb: '047857' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    setCell(kpiTitleRow, 2, 'Unsafe Submissions', {
      fill: { fgColor: { rgb: 'FEF2F2' } },
      font: { name: 'Arial', sz: 9, bold: true, color: { rgb: 'B91C1C' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    setCell(kpiTitleRow, 3, 'Safety Compliance Rate (%)', {
      fill: { fgColor: { rgb: COLOR_KPI_RATE_BG } },
      font: { name: 'Arial', sz: 9, bold: true, color: { rgb: COLOR_KPI_RATE_TXT } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    // Fill remaining column E for visual symmetry
    setCell(kpiTitleRow, 4, '', {
      fill: { fgColor: { rgb: COLOR_KPI_RATE_BG } },
      border: cellBorder,
    });
    merges.push({ s: { r: kpiTitleRow, c: 3 }, e: { r: kpiTitleRow, c: 4 } });
    currentRow++;

    // Row 2: KPI Values (0 / 0 / 0 / N/A for inactive orgs)
    const kpiValRow = currentRow;
    rowHeights[kpiValRow] = { hpt: 28 };
    const totalSubsVal = isInactiveOrg ? 0 : sec.totalSubmissions;
    const totalSafeVal = isInactiveOrg ? 0 : sec.totalSafe;
    const totalUnsafeVal = isInactiveOrg ? 0 : sec.totalUnsafe;
    const complianceText = isInactiveOrg ? 'N/A' : `${sec.performancePercent}%`;

    setCell(kpiValRow, 0, totalSubsVal, {
      fill: { fgColor: { rgb: COLOR_KPI_TOTAL_BG } },
      font: { name: 'Arial', sz: 13, bold: true, color: { rgb: COLOR_KPI_TOTAL_TXT } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    setCell(kpiValRow, 1, totalSafeVal, {
      fill: { fgColor: { rgb: 'ECFDF5' } },
      font: { name: 'Arial', sz: 13, bold: true, color: { rgb: '059669' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    setCell(kpiValRow, 2, totalUnsafeVal, {
      fill: { fgColor: { rgb: 'FEF2F2' } },
      font: { name: 'Arial', sz: 13, bold: true, color: { rgb: 'DC2626' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    setCell(kpiValRow, 3, complianceText, {
      fill: { fgColor: { rgb: COLOR_KPI_RATE_BG } },
      font: {
        name: 'Arial',
        sz: 14,
        bold: true,
        color: { rgb: isInactiveOrg ? COLOR_MUTED_SLATE : COLOR_KPI_RATE_TXT },
      },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: cellBorder,
    });
    setCell(kpiValRow, 4, '', {
      fill: { fgColor: { rgb: COLOR_KPI_RATE_BG } },
      border: cellBorder,
    });
    merges.push({ s: { r: kpiValRow, c: 3 }, e: { r: kpiValRow, c: 4 } });
    currentRow++;
  }

  // 4. Column Auto-Width & Text Wrapping:
  // Date: 16, Total Workers: 16, Site Location: 24, Review Status: 18, Safety Remarks / Reason: 45
  ws['!cols'] = [
    { wch: 16 }, // Date
    { wch: 16 }, // Total Workers
    { wch: 24 }, // Site Location
    { wch: 18 }, // Review Status
    { wch: 45 }, // Safety Remarks / Reason
  ];

  ws['!rows'] = rowHeights;
  ws['!merges'] = merges;
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(currentRow - 1, 0), c: 4 },
  });

  ws['!pageSetup'] = {
    orientation: 'portrait',
    paperSize: 9, // A4
    fitToWidth: 1,
    fitToHeight: 0,
  };

  XLSX.utils.book_append_sheet(wb, ws, 'PPE Report');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

/**
 * Exports Excel file to device document directory and invokes native share dialog
 */
export async function exportAndShareExcelReport(
  sections: OrgReportSection[],
  filenamePrefix = 'PPE_Review_Report'
): Promise<string> {
  const base64Data = buildExcelWorkbookBase64(sections);
  const timestamp = formatDateYMD(new Date()).replace(/-/g, '');
  const filename = `${filenamePrefix}_${timestamp}.xlsx`;

  // Use expo-file-system legacy
  const FileSystem = require('expo-file-system/legacy');
  const targetUri = `${FileSystem.documentDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(targetUri, base64Data, {
    encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
  });

  // Share via expo-sharing if available
  try {
    const Sharing = require('expo-sharing');
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(targetUri, {
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Export PPE Report',
        UTI: 'com.microsoft.excel.xlsx',
      });
    }
  } catch (err) {
    console.warn('[report.service] Sharing failed or cancelled:', err);
  }

  return targetUri;
}
