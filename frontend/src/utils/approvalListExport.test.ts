import { filterDocsForExport, EXPORT_TEAMS } from './approvalListExport';
import { OPTION_LINE } from '../pages/RequestPage/constants';
import { ApprovalStepFrontend, RequestDocument } from '../types';

const makeDoc = (id: number, line: string, status: string, pendingAgent?: ApprovalStepFrontend['agent']): RequestDocument => ({
  id,
  title: `doc${id}`,
  requester_name: '요청자',
  requester_email: 'req@c.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { line } }),
  status,
  production_date: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  submitted_at: '2026-09-01T00:00:00Z',
  approval_steps: pendingAgent
    ? [{ id: id * 10, agent: pendingAgent, action: 'pending', acted_at: null, round: 1 }]
    : [],
} as RequestDocument);

const docs = [
  makeDoc(1, '라인1', 'under_review', 'R'),
  makeDoc(2, '라인2', 'under_review', 'P'),
  makeDoc(3, '라인1', 'draft'),
  makeDoc(4, '', 'under_review', 'PL'),
  makeDoc(5, '라인3', 'rejected'),
];
const ids = (list: RequestDocument[]) => list.map((d) => d.id);

describe('filterDocsForExport', () => {
  it('전체 선택이면 임시저장만 빼고 라인 없음·팀 단계 밖 문서까지 모두 포함한다', () => {
    expect(ids(filterDocsForExport(docs, [...OPTION_LINE], OPTION_LINE, [...EXPORT_TEAMS]))).toEqual([1, 2, 4, 5]);
  });

  it('라인을 일부만 고르면 그 라인 문서만 남는다', () => {
    expect(ids(filterDocsForExport(docs, ['라인1', '라인3'], OPTION_LINE, [...EXPORT_TEAMS]))).toEqual([1, 5]);
  });

  it('팀을 일부만 고르면 그 팀 단계가 진행 중인 문서만 남는다', () => {
    expect(ids(filterDocsForExport(docs, [...OPTION_LINE], OPTION_LINE, ['P']))).toEqual([2]);
  });

  it('라인·팀 조합이 모두 맞아야 남는다', () => {
    expect(ids(filterDocsForExport(docs, ['라인1'], OPTION_LINE, ['P']))).toEqual([]);
    expect(ids(filterDocsForExport(docs, ['라인1'], OPTION_LINE, ['R', 'P']))).toEqual([1]);
  });
});
