export type PersistableWorkerVerdict = {
  sequenceNo: number;
  status: 'safe' | 'unsafe';
  unsafeReasons?: string[];
  otherReasonText?: string;
  frontDriveId?: string | null;
  backDriveId?: string | null;
};

export type PersistenceResult = { success: boolean; error?: string };

export async function persistReviewerDraft(
  db: any,
  submissionId: number,
  reviewerId: number,
  workerVerdicts: PersistableWorkerVerdict[],
): Promise<PersistenceResult> {
  try {
    const { data: current, error: readError } = await db
      .from('ppe_submissions')
      .select('status, metadata')
      .eq('id', submissionId)
      .maybeSingle();
    if (readError || !current) throw new Error(readError?.message || 'Submission not found.');
    if (current.status !== 'SUBMITTED' && current.status !== 'UNDER_REVIEW') {
      throw new Error('This submission is no longer available for reviewer drafts.');
    }
    const existingOwner = Number(current.metadata?.reviewDraft?.reviewerId);
    const draftUpdatedAt = current.metadata?.reviewDraft?.updatedAt
      ? new Date(current.metadata.reviewDraft.updatedAt).getTime()
      : 0;
    const isStaleDraft = Date.now() - draftUpdatedAt > 15 * 60 * 1000;
    if (Number.isFinite(existingOwner) && existingOwner > 0 && existingOwner !== reviewerId && !isStaleDraft) {
      throw new Error('This review draft belongs to another reviewer.');
    }

    const metadata = {
      ...(current.metadata || {}),
      reviewDraft: { reviewerId, workerReviews: workerVerdicts, updatedAt: new Date().toISOString() },
    };
    const { data: saved, error: saveError } = await db
      .from('ppe_submissions')
      .update({ status: 'UNDER_REVIEW', metadata, updated_at: new Date().toISOString() })
      .eq('id', submissionId)
      .select('id')
      .maybeSingle();
    if (saveError || !saved) throw new Error(saveError?.message || 'Submission draft was not updated.');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not save reviewer draft.' };
  }
}

export async function persistCompletedSubmissionReview(
  db: any,
  submissionId: number,
  reviewerId: number,
  workerVerdicts: PersistableWorkerVerdict[],
): Promise<PersistenceResult> {
  try {
    const { data: submission, error: submissionError } = await db
      .from('ppe_submissions')
      .select('status, metadata, ppe_worker_instances(id, sequence_no)')
      .eq('id', submissionId)
      .single();
    if (submissionError || !submission) throw new Error(submissionError?.message || 'Could not load submission workers.');
    if (submission.status !== 'SUBMITTED' && submission.status !== 'UNDER_REVIEW') {
      throw new Error('This submission is no longer available for review.');
    }
    const draftOwner = Number(submission.metadata?.reviewDraft?.reviewerId);
    const draftUpdatedAt = submission.metadata?.reviewDraft?.updatedAt
      ? new Date(submission.metadata.reviewDraft.updatedAt).getTime()
      : 0;
    const isStaleDraft = Date.now() - draftUpdatedAt > 15 * 60 * 1000;
    if (Number.isFinite(draftOwner) && draftOwner > 0 && draftOwner !== reviewerId && !isStaleDraft) {
      throw new Error('This review draft belongs to another reviewer.');
    }
    let workers = submission.ppe_worker_instances || [];
    if (workers.length === 0 && workerVerdicts.length > 0) {
      for (const verdict of workerVerdicts) {
        try {
          const { data: newInst } = await db
            .from('ppe_worker_instances')
            .insert({ submission_id: submissionId, sequence_no: verdict.sequenceNo })
            .select('id, sequence_no')
            .maybeSingle();
          if (newInst) workers.push(newInst);
        } catch {}
      }
    }
    const bySequence = new Map<number, number>(workers.map((worker: any) => [Number(worker.sequence_no), Number(worker.id)]));
    const uniqueSequences = new Set(workerVerdicts.map((verdict) => verdict.sequenceNo));
    if (workerVerdicts.length !== workers.length || uniqueSequences.size !== workers.length || workerVerdicts.some((verdict) => !bySequence.has(verdict.sequenceNo))) {
      throw new Error('The review must include exactly one decision for every current worker.');
    }

    const { data: reasons, error: reasonError } = await db
      .from('unsafe_reasons')
      .select('id, code')
      .eq('is_active', true);

    let activeReasons = reasons || [];
    if (reasonError || activeReasons.length === 0) {
      const defaultReasons = [
        { code: 'HELMET', label: 'Helmet violation', is_active: true },
        { code: 'FULL_BODY_HARNESS', label: 'Full-body harness violation', is_active: true },
        { code: 'LANYARD', label: 'Lanyard violation', is_active: true },
        { code: 'ANCHORAGE', label: 'Anchorage / connection point', is_active: true },
        { code: 'SAFETY_SHOES', label: 'Safety shoes violation', is_active: true },
        { code: 'OTHER', label: 'Other safety violation', is_active: true },
      ];
      try {
        const { data: seeded } = await db.from('unsafe_reasons').insert(defaultReasons).select('id, code');
        if (seeded && seeded.length > 0) activeReasons = seeded;
      } catch {}
    }

    const reasonByCode = new Map<string, number>();
    for (const reason of activeReasons) {
      const code = String(reason.code).toLowerCase();
      reasonByCode.set(code, Number(reason.id));
      if (code === 'full_body_harness' || code === 'no_harness') reasonByCode.set('harness', Number(reason.id));
      if (code === 'safety_shoes' || code === 'no_shoes') reasonByCode.set('shoes', Number(reason.id));
      if (code === 'no_chin_strap' || code === 'no_helmet') reasonByCode.set('helmet', Number(reason.id));
      if (code === 'lanyard') reasonByCode.set('lanyard', Number(reason.id));
      if (code === 'anchorage') reasonByCode.set('anchorage', Number(reason.id));
      if (code === 'other') reasonByCode.set('other', Number(reason.id));
    }

    const hasUnsafe = workerVerdicts.some((verdict) => verdict.status === 'unsafe');
    const allUnsafeReasons = Array.from(new Set(workerVerdicts.flatMap((verdict) => verdict.unsafeReasons || [])));
    const persisted: Array<PersistableWorkerVerdict & { reviewedAt: number }> = [];
    for (const verdict of [...workerVerdicts].sort((a, b) => a.sequenceNo - b.sequenceNo)) {
      const workerInstanceId = bySequence.get(verdict.sequenceNo);
      const { data: existingReview, error: existingReviewError } = await db
        .from('ppe_reviews')
        .select('id')
        .eq('worker_instance_id', workerInstanceId)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingReviewError) throw new Error(`Could not look up Worker ${verdict.sequenceNo}'s existing verdict: ${existingReviewError.message}`);

      const reviewValues = {
        worker_instance_id: workerInstanceId,
        reviewer_id: reviewerId,
        verdict: verdict.status === 'safe' ? 'SAFE' : 'UNSAFE',
        reviewed_at: new Date().toISOString(),
      };
      const { data: review, error: reviewError } = existingReview
        ? await db
          .from('ppe_reviews')
          .update(reviewValues)
          .eq('id', existingReview.id)
          .select('id')
          .maybeSingle()
        : await db
          .from('ppe_reviews')
          .insert(reviewValues)
          .select('id')
          .single();
      if (reviewError || !review) throw new Error(`Could not save Worker ${verdict.sequenceNo}'s verdict: ${reviewError?.message || 'no review row returned'}`);

      const { data: existingReasons, error: existingReasonsError } = await db
        .from('ppe_review_reasons')
        .select('id, unsafe_reason_id')
        .eq('ppe_review_id', review.id);
      if (existingReasonsError) throw new Error(`Could not load Worker ${verdict.sequenceNo}'s existing reasons: ${existingReasonsError.message}`);

      const desiredReasons = verdict.status === 'unsafe'
        ? [...new Set(verdict.unsafeReasons || [])].map((code) => {
          let reasonId = reasonByCode.get(code.toLowerCase());
          if (!reasonId) {
            reasonId = reasonByCode.get('other') || reasonByCode.values().next().value || 1;
          }
          return {
            unsafe_reason_id: reasonId,
            note: code.toLowerCase() === 'other' ? verdict.otherReasonText?.trim() || null : null,
          };
        })
        : [];
      const desiredByReasonId = new Map(desiredReasons.map((reason) => [reason.unsafe_reason_id, reason]));
      const existingByReasonId = new Map<number, any>();
      for (const existingReason of existingReasons || []) {
        const reasonId = Number(existingReason.unsafe_reason_id);
        if (!desiredByReasonId.has(reasonId) || existingByReasonId.has(reasonId)) {
          const { error: deleteError } = await db.from('ppe_review_reasons').delete().eq('id', existingReason.id);
          if (deleteError) throw new Error(`Could not remove an outdated Worker ${verdict.sequenceNo} reason: ${deleteError.message}`);
        } else {
          existingByReasonId.set(reasonId, existingReason);
        }
      }

      for (const desiredReason of desiredReasons) {
        const existingReason = existingByReasonId.get(desiredReason.unsafe_reason_id);
        if (existingReason) {
          const { error: updateReasonError } = await db
            .from('ppe_review_reasons')
            .update({ note: desiredReason.note })
            .eq('id', existingReason.id);
          if (updateReasonError) throw new Error(`Could not update Worker ${verdict.sequenceNo}'s unsafe reason: ${updateReasonError.message}`);
        } else {
          const { error: insertReasonError } = await db.from('ppe_review_reasons').insert({
            ppe_review_id: review.id,
            ...desiredReason,
          });
          if (insertReasonError) throw new Error(`Could not save Worker ${verdict.sequenceNo}'s unsafe reason: ${insertReasonError.message}`);
        }
      }

      persisted.push({ ...verdict, reviewedAt: Date.now() });
    }

    const overallReason = workerVerdicts
      .filter((verdict) => verdict.status === 'unsafe')
      .map((verdict) => `Worker ${verdict.sequenceNo}: ${(verdict.unsafeReasons || []).join(', ')}${verdict.otherReasonText ? ` — ${verdict.otherReasonText}` : ''}`)
      .join('; ');
    const overallValues = {
      submission_id: submissionId,
      reviewer_id: reviewerId,
      verdict: hasUnsafe ? 'UNSAFE' : 'SAFE',
      reason: overallReason || null,
      reviewed_at: new Date().toISOString(),
    };
    const { data: existingOverall, error: existingOverallError } = await db
      .from('submission_reviews')
      .select('id')
      .eq('submission_id', submissionId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingOverallError) throw new Error(`Could not look up the existing submission verdict: ${existingOverallError.message}`);
    const { error: overallError } = existingOverall
      ? await db.from('submission_reviews').update(overallValues).eq('id', existingOverall.id)
      : await db.from('submission_reviews').insert(overallValues);
    if (overallError) throw new Error(`Could not save the overall submission verdict: ${overallError.message}`);

    const { data: current, error: metadataReadError } = await db
      .from('ppe_submissions')
      .select('metadata')
      .eq('id', submissionId)
      .maybeSingle();
    if (metadataReadError || !current) throw new Error(`Review rows were saved, but metadata could not be loaded: ${metadataReadError?.message || 'submission not found'}`);
    const metadata = {
      ...(current.metadata || {}),
      reviewResult: hasUnsafe ? 'unsafe' : 'safe',
      hasUnsafe,
      workerReviews: persisted,
      unsafeReasons: allUnsafeReasons,
      allUnsafeReasons,
      otherReasonText: workerVerdicts.filter((verdict) => verdict.status === 'unsafe' && verdict.otherReasonText).map((verdict) => `Worker ${verdict.sequenceNo}: ${verdict.otherReasonText}`).join('; '),
      combinedNotes: workerVerdicts.filter((verdict) => verdict.status === 'unsafe' && verdict.otherReasonText).map((verdict) => `Worker ${verdict.sequenceNo}: ${verdict.otherReasonText}`).join('; '),
      reviewDraft: null,
    };
    const { data: completed, error: updateError } = await db
      .from('ppe_submissions')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString(), metadata, updated_at: new Date().toISOString() })
      .eq('id', submissionId)
      .select('id')
      .maybeSingle();
    if (updateError || !completed) throw new Error(`Verdicts were saved, but the submission could not be marked complete: ${updateError?.message || 'submission was not updated'}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not save the review.' };
  }
}
