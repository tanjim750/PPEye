import assert from 'node:assert';
import {
  isEmail,
  isValidName,
  isValidPassword,
  isValidPhone,
  isValidVendorName,
} from '../validation';

export async function runValidationTests() {
  console.log('--- Running Validation Tests ---');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✗ ${name}: ${err?.message}`);
    }
  }

  test('isValidName accepts valid English and Bengali names', () => {
    assert.strictEqual(isValidName('Abir Mahmud'), true);
    assert.strictEqual(isValidName('রহিম মিয়া'), true);
    assert.strictEqual(isValidName('John O\'Connor'), true);
    assert.strictEqual(isValidName('A'), false); // Too short
    assert.strictEqual(isValidName('12345'), false); // No letters
    assert.strictEqual(isValidName('!@#$%'), false); // Special chars only
  });

  test('isValidPhone accepts standard BD numbers and rejects invalid', () => {
    assert.strictEqual(isValidPhone('01712345678'), true);
    assert.strictEqual(isValidPhone('1603759643'), true); // 10-digit after +880
    assert.strictEqual(isValidPhone('1712345678'), true); // 10-digit after +880
    assert.strictEqual(isValidPhone('+8801712345678'), true);
    assert.strictEqual(isValidPhone('+880 1812 345678'), true);
    assert.strictEqual(isValidPhone('01212345678'), false); // Invalid BD prefix (012)
    assert.strictEqual(isValidPhone('12345'), false); // Too short
    assert.strictEqual(isValidPhone('abcdefghijk'), false); // Non-numeric
  });

  test('isEmail validates email structure correctly', () => {
    assert.strictEqual(isEmail('user@example.com'), true);
    assert.strictEqual(isEmail('john.doe@company.org.bd'), true);
    assert.strictEqual(isEmail('plainaddress'), false);
    assert.strictEqual(isEmail('@missinguser.com'), false);
    assert.strictEqual(isEmail('missingdomain@.com'), false);
  });

  test('isValidPassword requires at least 6 characters', () => {
    assert.strictEqual(isValidPassword('123456'), true);
    assert.strictEqual(isValidPassword('secretPass123'), true);
    assert.strictEqual(isValidPassword('12345'), false);
    assert.strictEqual(isValidPassword('   '), false);
  });

  test('isValidVendorName validates custom vendor name length', () => {
    assert.strictEqual(isValidVendorName('ABC Telecom Ltd'), true);
    assert.strictEqual(isValidVendorName('My Custom Co'), true);
    assert.strictEqual(isValidVendorName('A'), false);
    assert.strictEqual(isValidVendorName(''), false);
  });

  console.log(`Validation tests finished: ${passed} passed, ${failed} failed.\n`);
  return { passed, failed };
}

if (process.argv[1]?.endsWith('validation.test.ts')) {
  runValidationTests().then((res) => {
    if (res.failed > 0) process.exit(1);
  });
}
