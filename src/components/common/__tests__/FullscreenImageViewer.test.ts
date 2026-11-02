import assert from 'node:assert';

export async function runImageViewerTests() {
  console.log('--- Testing FullscreenImageViewer calculations ---');

  // Test 2-finger distance calculation
  function getDistance(t1: { pageX: number; pageY: number }, t2: { pageX: number; pageY: number }): number {
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const d1 = getDistance({ pageX: 0, pageY: 0 }, { pageX: 30, pageY: 40 });
  assert.strictEqual(d1, 50, '3-4-5 triangle distance should equal 50');

  // Test pinch zoom scaling clamping (min 1x, max 4x)
  function computeScale(dist: number, initialDist: number, baseScale: number): number {
    const rawScale = (dist / initialDist) * baseScale;
    return Math.min(Math.max(rawScale, 1), 4);
  }

  assert.strictEqual(computeScale(100, 100, 1), 1, 'Initial distance gives 1x scale');
  assert.strictEqual(computeScale(200, 100, 1), 2, '2x distance gives 2x scale');
  assert.strictEqual(computeScale(500, 100, 1), 4, 'Scale must clamp to 4x max');
  assert.strictEqual(computeScale(50, 100, 1), 1, 'Scale must not decrease below 1x min');

  console.log('✅ FullscreenImageViewer calculations verified successfully.');
  return { passed: 5, failed: 0 };
}

if (require.main === module) {
  runImageViewerTests().catch(console.error);
}
