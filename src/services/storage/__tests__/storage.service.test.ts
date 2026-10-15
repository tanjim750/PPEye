import {
  StorageError,
  StorageErrorCode,
  isStorageError,
} from '../storage.errors';
import { StorageService } from '../storage.service';

type TestCase = {
  name: string;
  fn: () => void | Promise<void>;
};

type Suite = {
  name: string;
  tests: TestCase[];
};

const suites: Suite[] = [];
let currentSuite: Suite | null = null;

export function describe(name: string, fn: () => void) {
  const suite: Suite = { name, tests: [] };
  suites.push(suite);
  currentSuite = suite;
  fn();
  currentSuite = null;
}

export function it(name: string, fn: () => void | Promise<void>) {
  if (currentSuite) {
    currentSuite.tests.push({ name, fn });
  }
}

export const assert = {
  strictEqual(actual: unknown, expected: unknown, message?: string) {
    if (actual !== expected) {
      throw new Error(
        message ??
          `Assertion failed: Expected ${JSON.stringify(actual)} to strictly equal ${JSON.stringify(expected)}`
      );
    }
  },

  deepStrictEqual(actual: unknown, expected: unknown, message?: string) {
    const actStr = JSON.stringify(actual);
    const expStr = JSON.stringify(expected);
    if (actStr !== expStr) {
      throw new Error(
        message ??
          `Assertion failed: Expected ${actStr} to deep equal ${expStr}`
      );
    }
  },

  async rejects(
    block: () => Promise<unknown>,
    check?: (err: unknown) => boolean
  ) {
    let threw = false;
    try {
      await block();
    } catch (err) {
      threw = true;
      if (check && !check(err)) {
        throw new Error(
          `Assertion failed: Error check returned false for ${String(err)}`
        );
      }
    }
    if (!threw) {
      throw new Error('Assertion failed: Expected block to reject, but it resolved.');
    }
  },
};

// ============================================================================
// Test Definitions
// ============================================================================

describe('StorageError & StorageErrorCode', () => {
  it('creates StorageError with correct code and default provider', () => {
    const error = new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'Invalid input provided'
    );

    assert.strictEqual(error.name, 'StorageError');
    assert.strictEqual(error.code, StorageErrorCode.INVALID_INPUT);
    assert.strictEqual(error.provider, 'GOOGLE_DRIVE');
    assert.strictEqual(error.message, 'Invalid input provided');
    assert.strictEqual(isStorageError(error), true);
  });

  it('preserves error details and custom provider', () => {
    const details = { field: 'fileName', reason: 'empty' };
    const error = new StorageError(
      StorageErrorCode.UPLOAD_FAILED,
      'Upload failed',
      { provider: 'SUPABASE', details }
    );

    assert.strictEqual(error.code, StorageErrorCode.UPLOAD_FAILED);
    assert.strictEqual(error.provider, 'SUPABASE');
    assert.deepStrictEqual(error.details, details);
  });

  it('isStorageError correctly distinguishes Error types', () => {
    const standardError = new Error('Regular error');
    const customError = new StorageError(
      StorageErrorCode.NETWORK_ERROR,
      'Network error'
    );

    assert.strictEqual(isStorageError(standardError), false);
    assert.strictEqual(isStorageError(customError), true);
    assert.strictEqual(isStorageError(null), false);
    assert.strictEqual(isStorageError(undefined), false);
    assert.strictEqual(isStorageError({ code: 'NETWORK_ERROR' }), false);
  });
});

describe('StorageService Validation & Error Handling', () => {
  function createMockService(options?: {
    uploadResult?: { fileId: string; fileName: string; mimeType: string };
    uploadError?: Error;
  }) {
    const mockSupabase: any = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 101, created_at: '2026-10-15T12:00:00Z' },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
        delete: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
      }),
    };

    const mockDriveUpload = async (opts: any) => {
      if (options?.uploadError) {
        throw options.uploadError;
      }
      return (
        options?.uploadResult ?? {
          fileId: 'mock_drive_file_123',
          fileName: opts.fileName,
          mimeType: opts.mimeType,
        }
      );
    };

    const mockTokenGetter = async () => 'mock_token_abc';

    return new StorageService(mockSupabase, mockDriveUpload, mockTokenGetter);
  }

  it('rejects empty localUri with INVALID_INPUT error', async () => {
    const service = createMockService();
    await assert.rejects(
      async () => {
        await service.upload({
          localUri: '',
          fileName: 'test.jpg',
          category: 'PPE',
        });
      },
      (err: any) => {
        assert.strictEqual(isStorageError(err), true);
        assert.strictEqual(err.code, StorageErrorCode.INVALID_INPUT);
        return true;
      }
    );
  });

  it('rejects empty fileName with INVALID_INPUT error', async () => {
    const service = createMockService();
    await assert.rejects(
      async () => {
        await service.upload({
          localUri: 'file:///data/img.jpg',
          fileName: '   ',
          category: 'PPE',
        });
      },
      (err: any) => {
        assert.strictEqual(isStorageError(err), true);
        assert.strictEqual(err.code, StorageErrorCode.INVALID_INPUT);
        return true;
      }
    );
  });

  it('rejects empty providerFileId in getDownloadUrl', async () => {
    const service = createMockService();
    await assert.rejects(
      async () => {
        await service.getDownloadUrl('');
      },
      (err: any) => {
        assert.strictEqual(isStorageError(err), true);
        assert.strictEqual(err.code, StorageErrorCode.INVALID_INPUT);
        return true;
      }
    );
  });

  it('wraps provider upload failures into StorageError(UPLOAD_FAILED)', async () => {
    const service = createMockService({
      uploadError: new Error('Network timeout'),
    });

    await assert.rejects(
      async () => {
        await service.upload({
          localUri: 'file:///path/photo.jpg',
          fileName: 'photo.jpg',
          category: 'PPE',
        });
      },
      (err: any) => {
        assert.strictEqual(isStorageError(err), true);
        assert.strictEqual(err.code, StorageErrorCode.UPLOAD_FAILED);
        return true;
      }
    );
  });
});

describe('StorageService Category Specializations', () => {
  it('uploadPPEImage formats fileName and category correctly', async () => {
    let capturedFileName = '';

    const mockSupabase: any = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 201, created_at: '2026-10-15T12:00:00Z' },
              error: null,
            }),
          }),
        }),
      }),
    };

    const mockDriveUpload = async (opts: any) => {
      capturedFileName = opts.fileName;
      return {
        fileId: 'drive_ppe_01',
        fileName: opts.fileName,
        mimeType: opts.mimeType,
      };
    };

    const service = new StorageService(
      mockSupabase,
      mockDriveUpload,
      async () => 'token'
    );

    const result = await service.uploadPPEImage(
      'file:///tmp/worker_front.jpg',
      1,
      'FRONT',
      'Gazipur-ER-102',
      5
    );

    assert.strictEqual(capturedFileName, 'Gazipur-ER-102_w1_front.jpg');
    assert.strictEqual(result.category, 'PPE');
    assert.strictEqual(result.providerFileId, 'drive_ppe_01');
    assert.strictEqual(result.id, 201);
    assert.strictEqual(result.storageProvider, 'GOOGLE_DRIVE');
    assert.strictEqual(
      result.downloadUrl,
      'https://drive.google.com/uc?export=download&id=drive_ppe_01'
    );
  });

  it('uploadOtherImage formats fileName and category correctly', async () => {
    let capturedFileName = '';

    const mockSupabase: any = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 202, created_at: '2026-10-15T12:00:00Z' },
              error: null,
            }),
          }),
        }),
      }),
    };

    const mockDriveUpload = async (opts: any) => {
      capturedFileName = opts.fileName;
      return {
        fileId: 'drive_other_02',
        fileName: opts.fileName,
        mimeType: opts.mimeType,
      };
    };

    const service = new StorageService(
      mockSupabase,
      mockDriveUpload,
      async () => 'token'
    );

    const result = await service.uploadOtherImage(
      'file:///tmp/tower_base.jpg',
      2,
      'Site Alpha 99'
    );

    assert.strictEqual(capturedFileName, 'Site_Alpha_99_other_2.jpg');
    assert.strictEqual(result.category, 'OTHERS');
    assert.strictEqual(result.providerFileId, 'drive_other_02');
  });

  it('uploadProfilePicture formats fileName and links user avatar', async () => {
    let capturedFileName = '';
    let updatedUserId: any = null;
    let updatedFileId: any = null;

    const mockSupabase: any = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 505, created_at: '2026-10-15T12:00:00Z' },
              error: null,
            }),
          }),
        }),
        update: (fields: any) => {
          updatedFileId = fields.profile_picture_file_id;
          return {
            eq: (_col: string, val: any) => {
              updatedUserId = val;
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      }),
    };

    const mockDriveUpload = async (opts: any) => {
      capturedFileName = opts.fileName;
      return {
        fileId: 'drive_avatar_505',
        fileName: opts.fileName,
        mimeType: opts.mimeType,
      };
    };

    const service = new StorageService(
      mockSupabase,
      mockDriveUpload,
      async () => 'token'
    );

    const result = await service.uploadProfilePicture(
      'file:///tmp/avatar.jpg',
      42
    );

    assert.strictEqual(capturedFileName, 'user_42_avatar.jpg');
    assert.strictEqual(result.category, 'PROFILE_PICTURE');
    assert.strictEqual(result.createdBy, 42);
    assert.strictEqual(updatedUserId, 42);
    assert.strictEqual(updatedFileId, 505);
  });

  it('deleteFile executes deletion and removes metadata', async () => {
    let deletedFromDb = false;

    const mockSupabase: any = {
      from: () => ({
        delete: () => ({
          eq: () => {
            deletedFromDb = true;
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };

    const service = new StorageService(
      mockSupabase,
      async () => ({ fileId: '1', fileName: '1', mimeType: 'img' }),
      async () => null
    );

    const success = await service.deleteFile('drive_target_999', 301);
    assert.strictEqual(success, true);
    assert.strictEqual(deletedFromDb, true);
  });
});

/**
 * Runner function that executes all suites and reports results.
 */
export async function runStorageTests(): Promise<{
  passed: number;
  failed: number;
  total: number;
}> {
  let passed = 0;
  let failed = 0;
  console.log('\n--- PPEye Storage Foundation Test Suite ---');

  for (const suite of suites) {
    console.log(`\n• Suite: ${suite.name}`);
    for (const testCase of suite.tests) {
      try {
        await testCase.fn();
        passed++;
        console.log(`  ✔ [PASS] ${testCase.name}`);
      } catch (err: any) {
        failed++;
        console.error(`  ✖ [FAIL] ${testCase.name}`);
        console.error(`    ${err?.message ?? err}`);
      }
    }
  }

  const total = passed + failed;
  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${total} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total };
}
