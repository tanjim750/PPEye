import assert from 'node:assert';
import {
  buildExcelWorkbookBase64,
  formatDateYMD,
  OrgReportSection,
} from '../report.service';
import * as XLSX from 'xlsx-js-style';

export async function runReportServiceTests() {
  console.log('\n--- PPEye Excel Report Export Test Suite ---');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      passed++;
      console.log(`  ✔ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✖ [FAIL] ${name}:`, err.message);
    }
  }

  test('formatDateYMD formats dates correctly as YYYY-MM-DD', () => {
    const d = new Date(2026, 10, 4); // month is 0-indexed (10 = November)
    assert.strictEqual(formatDateYMD(d), '2026-11-04');
  });

  test('buildExcelWorkbookBase64 generates single master header, partitions active before inactive orgs, and formats empty-state KPIs', () => {
    // Mixed input order: Active (ABC Telecom) -> Inactive (Apex Power) -> Active (XYZ Networks) -> Inactive (Delta Comms)
    const mockSections: OrgReportSection[] = [
      {
        organizationName: 'ABC Telecom',
        rows: [
          {
            date: '2026-11-04',
            workers: 2,
            sites: 'Site-01',
            status: 'Safe',
            reason: '-',
          },
          {
            date: '2026-11-03',
            workers: 1,
            sites: 'Site-02',
            status: 'Unsafe',
            reason: 'Missing Helmet, Vest',
          },
        ],
        totalSubmissions: 2,
        totalSafe: 1,
        totalUnsafe: 1,
        performancePercent: 50,
      },
      {
        organizationName: 'Apex Power',
        rows: [],
        totalSubmissions: 0,
        totalSafe: 0,
        totalUnsafe: 0,
        performancePercent: 0,
      },
      {
        organizationName: 'XYZ Networks',
        rows: [
          {
            date: '2026-11-02',
            workers: 3,
            sites: 'Site-03',
            status: 'Safe',
            reason: '-',
          },
        ],
        totalSubmissions: 1,
        totalSafe: 1,
        totalUnsafe: 0,
        performancePercent: 100,
      },
      {
        organizationName: 'Delta Comms',
        rows: [],
        totalSubmissions: 0,
        totalSafe: 0,
        totalUnsafe: 0,
        performancePercent: 0,
      },
    ];

    const base64 = buildExcelWorkbookBase64(mockSections);
    assert.ok(base64 && base64.length > 500, 'Base64 string should be non-empty and valid size');

    // Parse back using XLSX to verify internal structure
    const workbook = XLSX.read(base64, { type: 'base64', cellStyles: true });
    assert.ok(workbook.SheetNames.includes('PPE Report'), 'Workbook should contain "PPE Report" sheet');

    const sheet = workbook.Sheets['PPE Report'];
    const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true }) as (string | number)[][];

    // 1. Single Master Top Header strictly once at Row 1 (A1:E1), followed immediately at Row 2 (A2:E2) by Verification Standard
    assert.strictEqual(
      String(sheetData[0][0]),
      'PPEye SAFETY AUDIT REPORT',
      'Row 1 (A1:E1) should display PPEye SAFETY AUDIT REPORT'
    );
    assert.strictEqual(
      String(sheetData[1][0]),
      '✦ PPEye Safety Verification Standard ✦',
      'Row 2 (A2:E2) directly beneath Master Title should display ✦ PPEye Safety Verification Standard ✦'
    );
    const masterTitleOccurrences = sheetData.filter(
      (row) => row && String(row[0] ?? '') === 'PPEye SAFETY AUDIT REPORT'
    ).length;
    assert.strictEqual(
      masterTitleOccurrences,
      1,
      'PPEye SAFETY AUDIT REPORT must appear strictly once in the worksheet'
    );

    // 2. Smart Vendor Partitioning: Active orgs (ABC TELECOM, XYZ NETWORKS) strictly before Inactive orgs (APEX POWER, DELTA COMMS)
    const idxAbc = sheetData.findIndex((r) => r && String(r[0]) === 'ORGANIZATION: ABC TELECOM');
    const idxXyz = sheetData.findIndex((r) => r && String(r[0]) === 'ORGANIZATION: XYZ NETWORKS');
    const idxApex = sheetData.findIndex((r) => r && String(r[0]) === 'ORGANIZATION: APEX POWER');
    const idxDelta = sheetData.findIndex((r) => r && String(r[0]) === 'ORGANIZATION: DELTA COMMS');

    assert.strictEqual(idxAbc, 2, 'First organization banner should start directly at Row 3 (index 2)');
    assert.ok(idxXyz > idxAbc, 'Active XYZ Networks should follow Active ABC Telecom');
    assert.ok(idxApex > idxXyz, 'Inactive Apex Power must appear strictly after all active organizations');
    assert.ok(idxDelta > idxApex, 'Inactive Delta Comms must appear at the bottom after Apex Power');

    // 3. Active Organization 1 (ABC Telecom) structure: ZERO gap between ORGANIZATION row and Date | Total Workers row
    assert.deepStrictEqual(sheetData[idxAbc + 1], [
      'Date',
      'Total Workers',
      'Site Location',
      'Review Status',
      'Safety Remarks / Reason',
    ]);
    assert.strictEqual(sheetData[idxAbc + 2][0], '04-11-2026');
    assert.strictEqual(sheetData[idxAbc + 2][1], 2);
    assert.strictEqual(sheetData[idxAbc + 2][2], 'Site-01');
    assert.strictEqual(sheetData[idxAbc + 2][3], 'Safe');
    assert.strictEqual(sheetData[idxAbc + 2][4], '-');

    assert.strictEqual(sheetData[idxAbc + 3][0], '03-11-2026');
    assert.strictEqual(sheetData[idxAbc + 3][1], 1);
    assert.strictEqual(sheetData[idxAbc + 3][2], 'Site-02');
    assert.strictEqual(sheetData[idxAbc + 3][3], 'Unsafe');
    assert.strictEqual(sheetData[idxAbc + 3][4], 'Missing Helmet, Vest');

    assert.strictEqual(
      String(sheetData[idxAbc + 4][0]),
      'PPEye Certified Audit',
      'Active org should display PPEye Certified Audit ribbon after data rows'
    );
    assert.strictEqual(sheetData[idxAbc + 5][0], 'Total Submissions');
    assert.strictEqual(sheetData[idxAbc + 5][1], 'Safe Submissions');
    assert.strictEqual(sheetData[idxAbc + 5][2], 'Unsafe Submissions');
    assert.strictEqual(sheetData[idxAbc + 5][3], 'Safety Compliance Rate (%)');

    assert.strictEqual(sheetData[idxAbc + 6][0], 2);
    assert.strictEqual(sheetData[idxAbc + 6][1], 1);
    assert.strictEqual(sheetData[idxAbc + 6][2], 1);
    assert.strictEqual(sheetData[idxAbc + 6][3], '50%');

    // Verify 2 empty spacer rows between ABC Telecom's KPI Values row and XYZ Networks' Organization banner
    assert.strictEqual(idxXyz - (idxAbc + 6), 3, 'Exactly 2 empty spacer rows must separate organization blocks');

    // 4. Inactive Organization (Apex Power) structure: NO table headers, immediate empty-state notice, PPEye Certified Audit, 0 / 0 / 0 / N/A KPIs
    assert.strictEqual(
      String(sheetData[idxApex + 1][0]),
      'No submission or review records found for this period',
      'Inactive vendor should display empty-state notice immediately below organization banner'
    );
    // Ensure table sub-headers are NOT rendered in inactive vendor blocks
    const inactiveSlice = sheetData.slice(idxApex);
    const hasTableHeadersInInactive = inactiveSlice.some(
      (row) => row && String(row[0] ?? '') === 'Date' && String(row[1] ?? '') === 'Total Workers'
    );
    assert.strictEqual(
      hasTableHeadersInInactive,
      false,
      'Inactive organization blocks must NOT render table column headers'
    );

    // PPEye Certified Audit at idxApex + 2 (present for EVERY report!), then KPI Titles at idxApex + 3, KPI Values at idxApex + 4
    assert.strictEqual(
      String(sheetData[idxApex + 2][0]),
      'PPEye Certified Audit',
      'Inactive org report must also display PPEye Certified Audit ribbon before KPIs'
    );
    assert.strictEqual(sheetData[idxApex + 3][0], 'Total Submissions');
    assert.strictEqual(sheetData[idxApex + 4][0], 0);
    assert.strictEqual(sheetData[idxApex + 4][1], 0);
    assert.strictEqual(sheetData[idxApex + 4][2], 0);
    assert.strictEqual(sheetData[idxApex + 4][3], 'N/A');

    // Also check second inactive vendor (Delta Comms) + total PPEye Certified Audit count === 4 (all 4 orgs)
    assert.strictEqual(
      String(sheetData[idxDelta + 1][0]),
      'No submission or review records found for this period'
    );
    assert.strictEqual(String(sheetData[idxDelta + 2][0]), 'PPEye Certified Audit');
    assert.strictEqual(sheetData[idxDelta + 4][0], 0);
    assert.strictEqual(sheetData[idxDelta + 4][3], 'N/A');

    const certifiedOccurrences = sheetData.filter(
      (row) => row && String(row[0] ?? '') === 'PPEye Certified Audit'
    ).length;
    assert.strictEqual(
      certifiedOccurrences,
      mockSections.length,
      'Every organization section (active and inactive) must display PPEye Certified Audit'
    );

    // Check cell structure, merges (A1:E1 and org banners), and columns
    assert.ok(sheet['A1'], 'Master title cell A1 should exist');
    assert.ok(
      sheet['!merges']?.some((m: any) => m.s.r === 0 && m.s.c === 0 && m.e.r === 0 && m.e.c === 4),
      'A1:E1 should be merged'
    );
    assert.ok(
      sheet['!merges']?.some(
        (m: any) => m.s.r === idxApex + 1 && m.s.c === 0 && m.e.r === idxApex + 1 && m.e.c === 4
      ),
      'Inactive empty-state notice row should be merged across A:E'
    );
    assert.strictEqual(sheet['!cols']?.length, 5, 'Sheet should define 5 formatted column widths');

    // Confirm valid zip/xlsx archive and 100% clean background (no watermark media or OOXML drawing overlays)
    assert.ok(base64.startsWith('UEsDB'), 'Base64 must be a valid zip/xlsx archive');
    const cfb = (XLSX as any).CFB.read(base64, { type: 'base64' });
    assert.strictEqual(
      (XLSX as any).CFB.find(cfb, '/xl/media/ppeye_watermark.png'),
      null,
      'No watermark image should exist in workbook'
    );
    assert.strictEqual(
      (XLSX as any).CFB.find(cfb, '/xl/drawings/drawing1.xml'),
      null,
      'No OOXML drawing overlay should exist in workbook'
    );
  });

  test('formatSafetyViolationReasons cleans and formats Other custom notes with parentheses', () => {
    const { formatSafetyViolationReasons } = require('../report.service');
    // Case 1: Standard reason + other with custom note
    const res1 = formatSafetyViolationReasons(['Helmet', 'other'], ['Jjhhn']);
    assert.strictEqual(res1, 'Helmet, Other Safety Violation (Jjhhn)');

    // Case 2: Full-body harness + shoes + other with multiple notes
    const res2 = formatSafetyViolationReasons(['harness', 'shoes', 'Other safety violation'], ['Broken buckle', 'No strap']);
    assert.strictEqual(res2, 'Full-body harness, Safety shoes, Other Safety Violation (Broken buckle; No strap)');

    // Case 3: Only standard violations
    const res3 = formatSafetyViolationReasons(['helmet', 'lanyard']);
    assert.strictEqual(res3, 'Helmet, Lanyard');

    // Case 4: Empty violations
    const res4 = formatSafetyViolationReasons([]);
    assert.strictEqual(res4, '-');

    // Case 5: Deduplicates worker-level + submission-level Other notes (e.g. "ihivivugv" + "Worker 1: ihivivugv")
    const res5 = formatSafetyViolationReasons(
      ['other', 'Other safety violation'],
      ['ihivivugv', 'Worker 1: ihivivugv']
    );
    assert.strictEqual(res5, 'Other Safety Violation (ihivivugv)');

    // Case 6: Deduplicates DB labels ("Helmet violation", "Safety shoes violation") + UI codes ("helmet", "shoes") + multi-worker identical notes
    const res6 = formatSafetyViolationReasons(
      ['Helmet violation', 'helmet', 'Lanyard violation', 'lanyard', 'Safety shoes violation', 'shoes', 'OTHER'],
      ['IHIVIVUGV', 'Worker 1: ihivivugv; Worker #2: ihivivugv', 'ihivivugv ihivivugv']
    );
    assert.strictEqual(res6, 'Helmet, Lanyard, Safety shoes, Other Safety Violation (IHIVIVUGV)');
  });

  console.log(`========================================`);
  console.log(`Report Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed };
}
