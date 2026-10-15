/**
 * PPEye Files Repository Unit Tests (Mocked)
 *
 * Verifies:
 * - createFileRecord (persists all schema fields, validates inputs, handles duplicate key 23505 via constraints)
 * - getFileRecord (existing row, missing row -> null, database failure handling)
 * - getFileByProviderId (provider + ID lookup, missing row -> null)
 * - getFilesByIds (batch fetching, sanitization of IDs)
 * - isFileReferenced (reference checks against users, ppe_images, other_images)
 * - deleteFileRecord (referential integrity protection, force deletion, database failure handling)
 */

import {
  createFileRecord,
  deleteFileRecord,
  getFileByProviderId,
  getFileRecord,
  getFilesByIds,
  isFileReferenced,
  setFilesRepoClientOverride,
} from '../files.repository';
import { StorageErrorCode } from '../../storage/storage.errors';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function assertAsyncThrows(
  promiseFn: () => Promise<any>,
  expectedCode?: string,
  message?: string
): Promise<void> {
  let threw = false;
  try {
    await promiseFn();
  } catch (err: any) {
    threw = true;
    if (expectedCode) {
      assert(
        err?.code === expectedCode,
        `Expected error code '${expectedCode}', received '${err?.code}' (${err?.message}): ${message}`
      );
    }
  }
  assert(threw, `Expected async function to throw, but it succeeded: ${message}`);
}

interface MockFileRow {
  id: number;
  storage_provider: 'GOOGLE_DRIVE' | 'SUPABASE';
  provider_file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_by: number | null;
  created_at: string;
}

export async function runFilesRepositoryTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`     Error: ${err?.message ?? err}`);
      failed++;
    }
  }

  console.log('\n--- PPEye Files Repository Test Suite ---\n');

  // In-memory mock database state
  let mockFilesTable: MockFileRow[] = [];
  let mockUsersTable: Array<{ id: number; profile_picture_file_id: number | null }> = [];
  let mockPPEImagesTable: Array<{ id: number; file_id: number }> = [];
  let mockOtherImagesTable: Array<{ id: number; file_id: number }> = [];
  let nextId = 1;
  let simulateDatabaseFailure = false;

  // Build lightweight mock Supabase client
  const mockSupabaseClient: any = {
    from: (table: string) => {
      let selectedCols = '*';
      let countExact = false;
      let filterCol: string | null = null;
      let filterVal: any = null;
      let inCol: string | null = null;
      let inVals: any[] = [];
      let secondaryCol: string | null = null;
      let secondaryVal: any = null;

      const builder: any = {
        select: (cols: string = '*', options?: any) => {
          selectedCols = cols;
          if (options?.count === 'exact') {
            countExact = true;
          }
          return builder;
        },
        eq: (col: string, val: any) => {
          if (!filterCol) {
            filterCol = col;
            filterVal = val;
          } else {
            secondaryCol = col;
            secondaryVal = val;
          }
          return builder;
        },
        in: (col: string, vals: any[]) => {
          inCol = col;
          inVals = vals;
          return builder;
        },
        maybeSingle: async () => {
          if (simulateDatabaseFailure) {
            return { data: null, error: { message: 'Database connection failed', code: '500' } };
          }

          let items = [...mockFilesTable];
          if (filterCol) {
            items = items.filter((row: any) => row[filterCol!] === filterVal);
          }
          if (secondaryCol) {
            items = items.filter((row: any) => row[secondaryCol!] === secondaryVal);
          }

          return { data: items[0] ?? null, error: null };
        },
        single: async () => {
          if (simulateDatabaseFailure) {
            return { data: null, error: { message: 'Database connection failed', code: '500' } };
          }
          let items = [...mockFilesTable];
          if (filterCol) {
            items = items.filter((row: any) => row[filterCol!] === filterVal);
          }
          if (items.length === 0) {
            return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
          }
          return { data: items[0], error: null };
        },
        insert: (payload: any) => {
          return {
            select: () => ({
              single: async () => {
                if (simulateDatabaseFailure) {
                  return { data: null, error: { message: 'Database insert failed', code: '500' } };
                }

                // Check unique constraint: (storage_provider, provider_file_id)
                const existing = mockFilesTable.find(
                  (f) =>
                    f.storage_provider === payload.storage_provider &&
                    f.provider_file_id === payload.provider_file_id
                );
                if (existing) {
                  return {
                    data: null,
                    error: {
                      message: 'duplicate key value violates unique constraint "idx_files_provider_file"',
                      code: '23505',
                    },
                  };
                }

                const newRow: MockFileRow = {
                  id: nextId++,
                  storage_provider: payload.storage_provider ?? 'GOOGLE_DRIVE',
                  provider_file_id: payload.provider_file_id,
                  file_name: payload.file_name,
                  mime_type: payload.mime_type ?? 'image/jpeg',
                  size_bytes: payload.size_bytes ?? null,
                  created_by: payload.created_by ?? null,
                  created_at: new Date().toISOString(),
                };
                mockFilesTable.push(newRow);
                return { data: newRow, error: null };
              },
            }),
          };
        },
        upsert: (payload: any) => {
          return {
            select: () => ({
              single: async () => {
                if (simulateDatabaseFailure) {
                  return { data: null, error: { message: 'Database upsert failed', code: '500' } };
                }

                const idx = mockFilesTable.findIndex(
                  (f) =>
                    f.storage_provider === payload.storage_provider &&
                    f.provider_file_id === payload.provider_file_id
                );

                if (idx >= 0) {
                  mockFilesTable[idx] = {
                    ...mockFilesTable[idx],
                    file_name: payload.file_name ?? mockFilesTable[idx].file_name,
                    mime_type: payload.mime_type ?? mockFilesTable[idx].mime_type,
                    size_bytes: payload.size_bytes ?? mockFilesTable[idx].size_bytes,
                  };
                  return { data: mockFilesTable[idx], error: null };
                }

                const newRow: MockFileRow = {
                  id: nextId++,
                  storage_provider: payload.storage_provider ?? 'GOOGLE_DRIVE',
                  provider_file_id: payload.provider_file_id,
                  file_name: payload.file_name,
                  mime_type: payload.mime_type ?? 'image/jpeg',
                  size_bytes: payload.size_bytes ?? null,
                  created_by: payload.created_by ?? null,
                  created_at: new Date().toISOString(),
                };
                mockFilesTable.push(newRow);
                return { data: newRow, error: null };
              },
            }),
          };
        },
        delete: () => ({
          eq: async (col: string, val: any) => {
            if (simulateDatabaseFailure) {
              return { data: null, error: { message: 'Database delete failed', code: '500' } };
            }
            const before = mockFilesTable.length;
            mockFilesTable = mockFilesTable.filter((f: any) => f[col] !== val);
            return { data: null, error: null, count: before - mockFilesTable.length };
          },
        }),
      };

      // Handle count queries for reference checking
      if (['users', 'ppe_images', 'other_images'].includes(table)) {
        return {
          select: (_cols: string, opts?: any) => ({
            eq: async (col: string, val: any) => {
              if (simulateDatabaseFailure) {
                return { count: 0, error: { message: 'Count query failed', code: '500' } };
              }

              let tableData: any[] = [];
              if (table === 'users') tableData = mockUsersTable;
              if (table === 'ppe_images') tableData = mockPPEImagesTable;
              if (table === 'other_images') tableData = mockOtherImagesTable;

              const matched = tableData.filter((r) => r[col] === val);
              return { count: matched.length, error: null };
            },
          }),
        };
      }

      // Handle batch fetch: in('id', [...])
      builder.then = async (resolve: any) => {
        if (simulateDatabaseFailure) {
          resolve({ data: null, error: { message: 'Batch query failed', code: '500' } });
          return;
        }

        let items = [...mockFilesTable];
        if (inCol && inVals.length > 0) {
          items = items.filter((row: any) => inVals.includes(row[inCol!]));
        }
        resolve({ data: items, error: null });
      };

      return builder;
    },
  };

  setFilesRepoClientOverride(mockSupabaseClient);

  // Suite 1: createFileRecord & Validation
  console.log('• Suite: createFileRecord');

  await test('createFileRecord rejects empty provider_file_id', async () => {
    await assertAsyncThrows(
      () => createFileRecord({ provider_file_id: '', file_name: 'test.jpg' }),
      StorageErrorCode.INVALID_INPUT,
      'Empty provider_file_id should reject'
    );
  });

  await test('createFileRecord rejects empty file_name', async () => {
    await assertAsyncThrows(
      () => createFileRecord({ provider_file_id: 'drive-123', file_name: '   ' }),
      StorageErrorCode.INVALID_INPUT,
      'Empty file_name should reject'
    );
  });

  await test('createFileRecord rejects negative size_bytes', async () => {
    await assertAsyncThrows(
      () =>
        createFileRecord({
          provider_file_id: 'drive-123',
          file_name: 'test.jpg',
          size_bytes: -10,
        }),
      StorageErrorCode.INVALID_INPUT,
      'Negative size_bytes should reject'
    );
  });

  await test('createFileRecord persists all schema fields with GOOGLE_DRIVE provider', async () => {
    mockFilesTable = [];
    nextId = 1;

    const record = await createFileRecord({
      storage_provider: 'GOOGLE_DRIVE',
      provider_file_id: 'drive-file-abc-123',
      file_name: 'site_worker_front.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 4096,
      created_by: 42,
    });

    assert(record.id === 1, 'Assigned ID should be 1');
    assert(record.storage_provider === 'GOOGLE_DRIVE', 'Storage provider should be GOOGLE_DRIVE');
    assert(record.provider_file_id === 'drive-file-abc-123', 'Provider file ID should match');
    assert(record.file_name === 'site_worker_front.jpg', 'File name should match');
    assert(record.size_bytes === 4096, 'Size in bytes should match');
    assert(record.created_by === 42, 'Created by user ID should match');
    assert(Boolean(record.created_at), 'created_at timestamp should exist');
  });

  // Suite 2: Duplicate Prevention & Constraints
  console.log('\n• Suite: Duplicate Prevention');

  await test('createFileRecord prevents duplicate records and returns existing on 23505', async () => {
    // Attempt inserting exact duplicate (storage_provider: GOOGLE_DRIVE, provider_file_id: drive-file-abc-123)
    const duplicateCall = await createFileRecord({
      storage_provider: 'GOOGLE_DRIVE',
      provider_file_id: 'drive-file-abc-123',
      file_name: 'duplicate_attempt.jpg',
    });

    // Should return existing record with original ID 1 and original file name
    assert(duplicateCall.id === 1, 'Should return existing record with ID 1');
    assert(duplicateCall.file_name === 'site_worker_front.jpg', 'Should preserve existing metadata');
    assert(mockFilesTable.length === 1, 'Must not create a duplicate row in the table');
  });

  await test('createFileRecord throws INVALID_INPUT when onConflict is "error"', async () => {
    await assertAsyncThrows(
      () =>
        createFileRecord(
          {
            storage_provider: 'GOOGLE_DRIVE',
            provider_file_id: 'drive-file-abc-123',
            file_name: 'duplicate_error.jpg',
          },
          { onConflict: 'error' }
        ),
      StorageErrorCode.INVALID_INPUT,
      'Duplicate onConflict=error should throw INVALID_INPUT'
    );
  });

  await test('createFileRecord updates metadata when onConflict is "update"', async () => {
    const updated = await createFileRecord(
      {
        storage_provider: 'GOOGLE_DRIVE',
        provider_file_id: 'drive-file-abc-123',
        file_name: 'updated_name.jpg',
        size_bytes: 8192,
      },
      { onConflict: 'update' }
    );

    assert(updated.id === 1, 'ID should remain 1');
    assert(updated.file_name === 'updated_name.jpg', 'File name should be updated');
    assert(updated.size_bytes === 8192, 'Size should be updated');
  });

  // Suite 3: getFileRecord & getFileByProviderId
  console.log('\n• Suite: getFileRecord & getFileByProviderId');

  await test('getFileRecord returns matching record by ID', async () => {
    const record = await getFileRecord(1);
    assert(record !== null, 'Record should exist');
    assert(record?.id === 1, 'Record ID should match');
  });

  await test('getFileRecord returns null for missing row', async () => {
    const record = await getFileRecord(9999);
    assert(record === null, 'Missing ID should return null');
  });

  await test('getFileRecord throws INVALID_INPUT for invalid IDs', async () => {
    await assertAsyncThrows(
      () => getFileRecord(-5),
      StorageErrorCode.INVALID_INPUT,
      'Negative ID should throw INVALID_INPUT'
    );
    await assertAsyncThrows(
      () => getFileRecord(0),
      StorageErrorCode.INVALID_INPUT,
      '0 ID should throw INVALID_INPUT'
    );
  });

  await test('getFileByProviderId returns matching record', async () => {
    const record = await getFileByProviderId('drive-file-abc-123', 'GOOGLE_DRIVE');
    assert(record !== null, 'Record should exist');
    assert(record?.provider_file_id === 'drive-file-abc-123', 'Provider ID should match');
  });

  await test('getFileByProviderId returns null for non-existent provider ID', async () => {
    const record = await getFileByProviderId('completely-missing-drive-id');
    assert(record === null, 'Missing provider ID should return null');
  });

  // Suite 4: getFilesByIds (Batch)
  console.log('\n• Suite: getFilesByIds (Batch)');

  await test('getFilesByIds returns array of matching records', async () => {
    // Add second file
    const second = await createFileRecord({
      provider_file_id: 'drive-file-second-456',
      file_name: 'second_photo.jpg',
    });

    const results = await getFilesByIds([1, second.id, 9999]);
    assert(results.length === 2, 'Should return exactly 2 existing records');
    assert(results.some((r) => r.id === 1), 'Record 1 must be present');
    assert(results.some((r) => r.id === second.id), 'Record 2 must be present');
  });

  await test('getFilesByIds returns empty array for empty or invalid inputs', async () => {
    const empty1 = await getFilesByIds([]);
    assert(empty1.length === 0, 'Empty array should return empty array');

    const empty2 = await getFilesByIds([-1, -2]);
    assert(empty2.length === 0, 'Invalid IDs should return empty array');
  });

  // Suite 5: isFileReferenced
  console.log('\n• Suite: isFileReferenced');

  await test('isFileReferenced returns false when unreferenced', async () => {
    mockUsersTable = [];
    mockPPEImagesTable = [];
    mockOtherImagesTable = [];

    const referenced = await isFileReferenced(1);
    assert(referenced === false, 'Unreferenced file should return false');
  });

  await test('isFileReferenced detects reference in users (profile_picture_file_id)', async () => {
    mockUsersTable = [{ id: 10, profile_picture_file_id: 1 }];
    const referenced = await isFileReferenced(1);
    assert(referenced === true, 'File referenced by user avatar should return true');
    mockUsersTable = [];
  });

  await test('isFileReferenced detects reference in ppe_images (file_id)', async () => {
    mockPPEImagesTable = [{ id: 20, file_id: 1 }];
    const referenced = await isFileReferenced(1);
    assert(referenced === true, 'File referenced by ppe_images should return true');
    mockPPEImagesTable = [];
  });

  await test('isFileReferenced detects reference in other_images (file_id)', async () => {
    mockOtherImagesTable = [{ id: 30, file_id: 1 }];
    const referenced = await isFileReferenced(1);
    assert(referenced === true, 'File referenced by other_images should return true');
    mockOtherImagesTable = [];
  });

  // Suite 6: deleteFileRecord & Referential Safety
  console.log('\n• Suite: deleteFileRecord');

  await test('deleteFileRecord rejects deletion when file is referenced', async () => {
    mockPPEImagesTable = [{ id: 20, file_id: 1 }];

    await assertAsyncThrows(
      () => deleteFileRecord(1),
      StorageErrorCode.DELETE_FAILED,
      'Referenced file deletion should throw DELETE_FAILED'
    );
    mockPPEImagesTable = [];
  });

  await test('deleteFileRecord allows deletion when force is true', async () => {
    mockPPEImagesTable = [{ id: 20, file_id: 1 }];

    const deleted = await deleteFileRecord(1, { force: true });
    assert(deleted === true, 'Force deletion should succeed');
    assert(mockFilesTable.find((f) => f.id === 1) === undefined, 'Row should be removed');
    mockPPEImagesTable = [];
  });

  await test('deleteFileRecord deletes unreferenced file cleanly', async () => {
    // Add file #3
    const file3 = await createFileRecord({
      provider_file_id: 'drive-to-delete-789',
      file_name: 'delete_me.jpg',
    });

    const deleted = await deleteFileRecord(file3.id);
    assert(deleted === true, 'Unreferenced deletion should succeed');
    assert(mockFilesTable.find((f) => f.id === file3.id) === undefined, 'Row should be deleted');
  });

  // Suite 7: Database Failures
  console.log('\n• Suite: Database Failures');

  await test('throws StorageError(PROVIDER_ERROR) on database failures', async () => {
    simulateDatabaseFailure = true;

    await assertAsyncThrows(
      () => getFileRecord(1),
      StorageErrorCode.PROVIDER_ERROR,
      'DB failure on getFileRecord should throw PROVIDER_ERROR'
    );

    await assertAsyncThrows(
      () => createFileRecord({ provider_file_id: 'any', file_name: 'any.jpg' }),
      StorageErrorCode.PROVIDER_ERROR,
      'DB failure on createFileRecord should throw PROVIDER_ERROR'
    );

    await assertAsyncThrows(
      () => isFileReferenced(1),
      StorageErrorCode.PROVIDER_ERROR,
      'DB failure on isFileReferenced should throw PROVIDER_ERROR'
    );

    simulateDatabaseFailure = false;
  });

  console.log('\n========================================');
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  // Clean up
  setFilesRepoClientOverride(null);

  return { passed, failed };
}
