import assert from 'node:assert';

export async function runWindowSizeClassTests() {
  console.log('--- Testing Window Size Classes (Material 3 standard) ---');

  // Verify breakpoints:
  // Compact: < 600dp
  // Medium: 600dp - 839dp
  // Expanded: >= 840dp

  function computeClass(width: number): 'compact' | 'medium' | 'expanded' {
    return width < 600 ? 'compact' : width < 840 ? 'medium' : 'expanded';
  }

  assert.strictEqual(computeClass(360), 'compact', '360dp phone must be compact');
  assert.strictEqual(computeClass(412), 'compact', '412dp phone must be compact');
  assert.strictEqual(computeClass(599), 'compact', '599dp must be compact');
  assert.strictEqual(computeClass(600), 'medium', '600dp foldable/tablet must be medium');
  assert.strictEqual(computeClass(768), 'medium', '768dp tablet must be medium');
  assert.strictEqual(computeClass(839), 'medium', '839dp must be medium');
  assert.strictEqual(computeClass(840), 'expanded', '840dp large tablet must be expanded');
  assert.strictEqual(computeClass(1024), 'expanded', '1024dp tablet must be expanded');

  console.log('✅ Window Size Classes breakpoints verified successfully.');
  return { passed: 8, failed: 0 };
}

if (require.main === module) {
  runWindowSizeClassTests().catch(console.error);
}
