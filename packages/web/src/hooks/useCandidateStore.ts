import { create } from 'zustand';
import { Candidate, ReferralSheet } from '../lib/types';
import { api } from '../lib/api';

// A mutation used to exit silently when the candidate was missing from the
// loaded array (`if (!candidate) return;`): no error, no effect. That is what
// made qualify / junk / edit fail invisibly on every surface that does not call
// fetchData itself — and it would have become the norm under server pagination.
const CANDIDATE_NOT_LOADED =
    'تعذّر العثور على الاسم المقترح ضمن القائمة المحمَّلة — أعد تحميل الصفحة ثم أعد المحاولة.';

interface CandidateState {
    candidates: Candidate[];
    referralSheets: ReferralSheet[];
    // Last branch the page scoped to; post-mutation refetches reuse it so a
    // GLOBAL viewer's branch narrowing survives add/qualify/etc.
    _lastBranchId: number | null;

    fetchData: (branchId?: number | null) => Promise<void>;
    /** Referral sheets only — the cheap half of fetchData, used after every mutation. */
    fetchReferralSheets: (branchId?: number | null) => Promise<void>;
    /**
     * The records page publishes the page it is showing. `candidates` therefore
     * means "the rows currently loaded", not "every row in the system": a mutation
     * can only ever target a row the user can see, and every consumer that needs
     * other rows fetches them itself (api.candidates.listPaged with ids/sheet).
     */
    setLoadedCandidates: (items: Candidate[]) => void;

    addReferralSheet: (sheet: Omit<ReferralSheet, 'id' | 'createdAt' | 'stats' | 'ownerUserId' | 'createdBy'> & { ownerUserId?: number; createdBy?: number }) => Promise<number>;
    closeReferralSheet: (sheetId: number) => Promise<void>;

    addCandidate: (candidate: Omit<Candidate, 'id' | 'createdAt' | 'duplicateFlag' | 'duplicateType' | 'duplicateReferenceId' | 'status' | 'referralConfirmationStatus' | 'convertedToLeadId' | 'referralSheetId' | 'ownershipType'> & {
        referralSheetId: number | null;
        ownershipType?: 'PERSONAL' | 'BRANCH';
        responsibleUserId?: number | null;
        assignmentUserIds?: number[];
    }) => Promise<Candidate>;
    qualifyCandidate: (candidateId: number, clientData?: any) => Promise<void>;
    linkCandidateToClient: (candidateId: number, clientId: number) => Promise<void>;
    markJunk: (candidateId: number) => Promise<void>;
    markForFollowUp: (candidateId: number) => Promise<void>;
    updateCandidate: (candidateId: number, data: Partial<Candidate>) => Promise<void>;
}

export const useCandidateStore = create<CandidateState>((set, get) => ({
    candidates: [],
    referralSheets: [],
    _lastBranchId: null,

    fetchData: async (branchId?: number | null) => {
        // branchId narrows a GLOBAL viewer to one branch; for BRANCH/ASSIGNED the
        // server scopes regardless, so the page passes it only when GLOBAL.
        // `undefined` (internal post-mutation refetches) reuses the last branch.
        const effectiveBranch = branchId !== undefined ? branchId : get()._lastBranchId;
        set({ _lastBranchId: effectiveBranch });
        const [candidatesResult, referralSheetsResult] = await Promise.allSettled([
            api.candidates.list(effectiveBranch),
            api.referralSheets.list(effectiveBranch)
        ]);

        if (candidatesResult.status === 'rejected') {
            throw candidatesResult.reason;
        }

        set({
            candidates: candidatesResult.value,
            referralSheets: referralSheetsResult.status === 'fulfilled' ? referralSheetsResult.value : []
        });
    },

    fetchReferralSheets: async (branchId?: number | null) => {
        const effectiveBranch = branchId !== undefined ? branchId : get()._lastBranchId;
        set({ _lastBranchId: effectiveBranch });
        set({ referralSheets: await api.referralSheets.list(effectiveBranch) });
    },

    setLoadedCandidates: (items) => set({ candidates: items }),

    addReferralSheet: async (sheetData) => {
        const state = get();
        const existingSheet = state.referralSheets.find(s =>
            s.ownerUserId === sheetData.ownerUserId &&
            s.referralNameSnapshot === sheetData.referralNameSnapshot &&
            s.referralDate.split('T')[0] === sheetData.referralDate.split('T')[0]
        );

        if (existingSheet) {
            throw new Error('يوجد لائحة أسماء مطابقة لنفس الوسيط والتاريخ والمشرفة!');
        }

        const newSheet = await api.referralSheets.create({
            ...sheetData,
            stats: {
                totalCandidates: 0,
                qualityPercentage: 0,
                conversionPercentage: 0
            }
        });
        await get().fetchReferralSheets();
        return newSheet.id;
    },

    closeReferralSheet: async (sheetId) => {
        await api.referralSheets.update(sheetId, { status: 'Completed' });
        await get().fetchReferralSheets();
    },

    // Sheet statistics are no longer derived here. Every candidate mutation
    // (create / edit / link / qualify / delete) recomputes them on the server
    // from the relation itself, so the numbers no longer depend on the page
    // holding every candidate in memory — and a delete now updates them too.

    addCandidate: async (candidateData) => {
        if (!candidateData.referralDate || !candidateData.referralReason) {
            throw new Error('بيانات الاستقطاب (التاريخ والسبب) إلزامية ولا يمكن الحفظ بدونها.');
        }

        // Same-context duplicate guards. These used to scan the in-memory array,
        // which only worked while the page held every candidate; they now ask the
        // server for the one matching row, so the verdict no longer depends on
        // what the browser happens to have loaded.
        const day = candidateData.referralDate.split('T')[0];
        const dupeProbe = candidateData.referralSheetId
            ? await api.candidates.listPaged({
                referralSheetId: candidateData.referralSheetId,
                search: candidateData.mobile,
                limit: 1,
            })
            : await api.candidates.listPaged({
                source: 'direct',
                search: candidateData.mobile,
                dateFrom: day,
                dateTo: day,
                ...(candidateData.ownerUserId ? { responsibleUserId: candidateData.ownerUserId } : {}),
                limit: 1,
            });

        const exactMatch = (dupeProbe.items as Candidate[]).some(c => c.mobile === candidateData.mobile);
        if (exactMatch) {
            throw new Error(
                candidateData.referralSheetId
                    ? `رقم الهاتف ${candidateData.mobile} موجود مسبقاً في نفس الجلسة!`
                    : `رقم الهاتف ${candidateData.mobile} أدخل مسبقاً اليوم لك كاستقطاب مباشر!`,
            );
        }

        // Duplicate detection is the server's job (candidates.md BR-2). It used
        // to run here against the clients list endpoint — the entire clients table
        // pulled into the browser to compare one phone number, which also made
        // the verdict depend on what the caller's scope could load.
        const newCandidate = await api.candidates.create({
            ...candidateData,
            status: 'Suggested',
            referralConfirmationStatus: 'Pending',
            convertedToLeadId: null
        });

        await get().fetchReferralSheets();

        return newCandidate;
    },

    qualifyCandidate: async (candidateId, clientData) => {
        const state = get();
        const candidate = state.candidates.find(c => c.id === candidateId);
        if (!candidate) throw new Error(CANDIDATE_NOT_LOADED);

        if (!candidate.referralDate || !candidate.referralType) {
            throw new Error('خطأ خطير: لا يمكن تحويل مرشح يفتقر إلى بيانات وتاريخ الاستقطاب الأساسية.');
        }

        // POST /clients is the authority on a duplicate primary phone: it takes
        // an advisory lock and rejects with 409 DUPLICATE_CLIENT_PHONE inside the
        // transaction. The old pre-check here compared against the whole clients
        // table fetched into the browser, which was both slower and weaker (it
        // only saw the rows the caller's scope could load).
        const createClientForConversion = async (payload: any) => {
            try {
                await api.clients.create(payload);
            } catch (err: any) {
                const isDuplicatePhone =
                    err?.status === 409 &&
                    (err?.payload?.error === 'DUPLICATE_CLIENT_PHONE' || err?.message === 'DUPLICATE_CLIENT_PHONE');
                if (isDuplicatePhone) {
                    throw new Error('الرقم موجود بالفعل في قائمة الزبائن. يرجى المراجعة.');
                }
                throw err;
            }
        };

        if (clientData) {
            const conversionClientData = { ...clientData };
            delete conversionClientData.assignmentUserIds;
            await createClientForConversion({
                ...conversionClientData,
                branchId: clientData.branchId ?? candidate.branchId ?? undefined,
                sourceCandidateId: candidate.id,
                isCandidate: false,
                candidateStatus: 'Suggested'
            });
        } else {
            await createClientForConversion({
                firstName: candidate.firstName || '',
                fatherName: '',
                lastName: candidate.lastName || '',
                nickname: candidate.nickname || undefined,
                name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.nickname || 'بدون اسم',
                mobile: candidate.mobile,
                contacts: candidate.contacts || [{
                    id: Date.now().toString(),
                    type: 'mobile',
                    number: candidate.mobile,
                    label: 'الرقم الأساسي',
                    hasWhatsApp: true,
                    isPrimary: true,
                    status: 'active'
                }],
                // Geo fields are structured (INTEGER geo_unit ids). The candidate
                // only has free text, so leave geo empty and keep the text in
                // detailedAddress — the structured address is completed later from
                // the client profile (scoped geo picker, §5.1).
                governorate: undefined,
                district: undefined,
                neighborhood: undefined,
                detailedAddress: candidate.addressText,
                sourceChannel: candidate.referralOriginChannel,
                referrerType: candidate.referralType,
                referrerName: candidate.referralNameSnapshot,
                referralEntityId: candidate.referralEntityId,
                referralDate: candidate.referralDate,
                referralReason: candidate.referralReason,
                referralSheetId: candidate.referralSheetId,
                referralAddressText: candidate.addressText,
                branchId: candidate.branchId ?? undefined,
                sourceCandidateId: candidate.id,
                isCandidate: false,
                candidateStatus: 'Suggested'
            });
        }

        // clients.create receives sourceCandidateId; the server creates the
        // client, transfers ownership and marks the candidate Qualified in one
        // transaction. No second candidate update is allowed here.

        await get().fetchReferralSheets();
    },

    linkCandidateToClient: async (candidateId, clientId) => {
        await api.candidates.linkToClient(candidateId, clientId);

        await get().fetchReferralSheets();
    },

    markJunk: async (candidateId) => {
        const state = get();
        const candidate = state.candidates.find(c => c.id === candidateId);
        if (!candidate) throw new Error(CANDIDATE_NOT_LOADED);

        await api.candidates.update(candidateId, {
            ...candidate,
            status: 'Junk'
        });

        await get().fetchReferralSheets();
    },

    markForFollowUp: async (candidateId) => {
        const state = get();
        const candidate = state.candidates.find(c => c.id === candidateId);
        if (!candidate) throw new Error(CANDIDATE_NOT_LOADED);

        await api.candidates.update(candidateId, {
            ...candidate,
            status: 'FollowUp'
        });

        await get().fetchReferralSheets();
    },

    updateCandidate: async (candidateId, data) => {
        const state = get();
        const candidate = state.candidates.find(c => c.id === candidateId);
        if (!candidate) throw new Error(CANDIDATE_NOT_LOADED);
        if (candidate.status === 'Qualified' || candidate.status === 'Junk' || candidate.convertedToLeadId != null) {
            throw new Error('لا يمكن تعديل الاسم المقترح بعد الربط أو الرفض أو التحويل');
        }

        // Duplicate flags are recomputed by the server on every edit (BR-2), so
        // nothing is sent from here — and no clients table is fetched to do it.
        const updatedData = { ...candidate, ...data };

        await api.candidates.update(candidateId, updatedData);
        await get().fetchReferralSheets();
    }
}));
