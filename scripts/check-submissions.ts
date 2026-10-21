import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ucqtzwaanzrtgalgwumz.supabase.co';
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY || 'sb_publishable_LXCdYYQ8GbYArdZYyG5SLQ_-U0JgS-l';

const supabase = createClient(supabaseUrl, supabaseKey);

async function printSubmissions(limit = 3) {
  const { data: submissions, error } = await supabase
    .from('ppe_submissions')
    .select(`
      id,
      vendor_profile_id,
      site_name,
      status,
      submitted_at,
      created_at,
      ppe_worker_instances (
        id,
        sequence_no,
        ppe_images (
          id,
          side,
          file_id,
          files (
            id,
            storage_provider,
            file_name,
            provider_file_id,
            size_bytes,
            created_at
          )
        )
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ Supabase থেকে ডাটা ফেচ করতে সমস্যা:', error.message);
    return;
  }

  if (!submissions || submissions.length === 0) {
    console.log('ℹ️ ডাটাবেজে এখনো কোনো Submission রেকর্ড পাওয়া যায়নি।\n');
    return;
  }

  console.log(`\n======================================================`);
  console.log(` 📋 সর্বশেষ ${submissions.length} টি PPE Submission (Supabase Live DB)`);
  console.log(`======================================================\n`);

  for (const sub of submissions) {
    console.log(`📦 [Submission #${sub.id}]`);
    console.log(`   • স্ট্যাটাস:      ${sub.status}`);
    console.log(`   • সাইট নাম:      ${sub.site_name || 'N/A'}`);
    console.log(`   • সাবমিট সময়:    ${sub.submitted_at || sub.created_at}`);
    console.log(`   • ভেন্ডর আইডি:   ${sub.vendor_profile_id}`);

    const workers = (sub as any).ppe_worker_instances || [];
    console.log(`   • ওয়ার্কার সংখ্যা: ${workers.length}`);

    for (const w of workers) {
      console.log(`\n   👷 Worker #${w.sequence_no} (Instance ID: ${w.id}):`);
      const images = w.ppe_images || [];
      if (images.length === 0) {
        console.log(`      ⚠️ কোনো ছবি যুক্ত করা হয়নি।`);
      }

      for (const img of images) {
        const file = img.files;
        console.log(`      📷 সাইড: [${img.side}]`);
        if (file) {
          const driveId = file.provider_file_id;
          console.log(`         - Drive ID:        ${driveId}`);
          console.log(`         - ফাইলের নাম:      ${file.file_name}`);
          console.log(`         - ফাইলের সাইজ:     ${file.size_bytes ? (file.size_bytes / 1024).toFixed(1) + ' KB' : 'Unknown'}`);
          console.log(`         - Google Drive লিংক: https://drive.google.com/file/d/${driveId}/view`);
        } else {
          console.log(`         - ফাইল রেকর্ড আইডি: ${img.file_id}`);
        }
      }
    }
    console.log(`------------------------------------------------------\n`);
  }
}

async function startWatch() {
  console.log('\n======================================================');
  console.log(' 📡 Supabase Realtime Listener চালু হয়েছে...');
  console.log(' 📱 আপনার ফোন থেকে ছবি তুলে Submit করলে এখানে নোটিফিকেশন আসবে!');
  console.log(' (বন্ধ করতে কিবোর্ডে Ctrl + C চাপুন)');
  console.log('======================================================\n');

  const channel = supabase
    .channel('terminal-submission-watcher')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'ppe_submissions',
      },
      async (payload) => {
        console.log(`\n🔔 [REALTIME EVENT] নতুন পরিবর্তন এসেছে: ${payload.eventType}`);
        console.log(`   ID: #${payload.new && (payload.new as any).id}`);
        console.log(`   Status: ${payload.new && (payload.new as any).status}`);
        console.log('   নতুন ডাটা লোড করা হচ্ছে...\n');
        await printSubmissions(1);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime সংযোগ সফল! ফোন থেকে সাবমিশনের অপেক্ষায়...\n');
      }
    });

  // Keep alive
  await new Promise(() => {});
}

async function main() {
  const isWatch = process.argv.includes('--watch') || process.argv.includes('-w');
  if (isWatch) {
    await startWatch();
  } else {
    await printSubmissions(3);
    console.log('💡 টিপ: রিয়েলটাইমে লাইভ দেখতে নিচের কমান্ডটি রান করতে পারেন:');
    console.log('   npm run check:submissions -- --watch\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('❌ এরর:', err);
  process.exit(1);
});
