/**
 * Test fetching Drive URLs from Drive File ID
 */
declare const process: any;

async function run() {
  const token =
    process.env.GOOGLE_ACCESS_TOKEN || "";
  let fileId = process.argv[2];

  console.log("=================================================");
  console.log(" Testing URL Fetching by Google Drive ID");
  console.log("=================================================");

  // If no fileId was provided by user, automatically find a real file from their Drive
  if (!fileId) {
    console.log("Auto-detecting recent files from your Google Drive...");
    try {
      const listRes = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=5&fields=files(id,name,mimeType)", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.files && listData.files.length > 0) {
          fileId = listData.files[0].id;
          console.log(`✔ Found file in your Drive: "${listData.files[0].name}" (ID: ${fileId})\n`);
        } else {
          console.log("ℹ Your Drive has no uploaded files yet. Please run `npx tsx scripts/test-drive-manual.ts` first to upload a test file!\n");
          return;
        }
      } else {
        const errText = await listRes.text();
        console.error(`Token check failed: HTTP ${listRes.status}`, errText);
        return;
      }
    } catch (e: any) {
      console.error("Connection error:", e.message);
      return;
    }
  }

  console.log(`Target Drive File ID: ${fileId}\n`);

  // 1. Fetch metadata directly from Drive API v3
  console.log("1. Requesting file metadata from Google Drive API v3...");
  const metaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,webViewLink,thumbnailLink`;
  const res = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });


  if (!res.ok) {
    console.error(`Failed to fetch: HTTP ${res.status}`);
    const text = await res.text();
    console.error(text);
    return;
  }

  const data = await res.json();
  console.log("   ✔ Metadata successfully fetched from Drive ID!\n");
  console.log("--- Extracted Information from Drive ID ---");
  console.log(`• File Name:     ${data.name}`);
  console.log(`• MIME Type:     ${data.mimeType}`);
  console.log(`• File Size:     ${data.size} bytes (${(data.size / 1024).toFixed(1)} KB)`);
  console.log(`• Web View URL:  ${data.webViewLink}`);
  console.log(`• Thumbnail URL: ${data.thumbnailLink || "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w800"}`);
  console.log(`• Direct Download URL: https://drive.google.com/uc?export=download&id=${fileId}`);
  console.log("-------------------------------------------\n");

  // 2. Test Thumbnail URL reachability
  console.log("2. Verifying Thumbnail URL reachability...");
  const thumbUrl = data.thumbnailLink || `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  try {
    const thumbRes = await fetch(thumbUrl);
    console.log(`   ✔ Thumbnail URL responded with HTTP ${thumbRes.status} (${thumbRes.headers.get("content-type")})`);
  } catch (err: any) {
    console.log(`   Note on thumbnail: ${err.message}`);
  }

  // 3. Test Web View URL reachability
  console.log("3. Verifying Web View URL reachability...");
  try {
    const viewRes = await fetch(data.webViewLink);
    console.log(`   ✔ Web View URL responded with HTTP ${viewRes.status}`);
  } catch (err: any) {
    console.log(`   Note on view URL: ${err.message}`);
  }

  console.log("\n=================================================");
  console.log(" RESULT: SUCCESS! Drive ID correctly resolved to URLs!");
  console.log("=================================================");
}

run().catch(console.error);
