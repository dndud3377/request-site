/**
 * 뼈찜(Backbone) 외부 데이터 탭별 배경색.
 * 탭이 2개 이상일 때 탭 버튼과 결과표의 Ref.PART ID 셀을 같은 색으로 구분한다.
 * (작성 화면 Step4 · 결재 상세보기/이력조회 PagedDetailView 공용)
 * 기존 셀 색들과 조화되는 연한 파스텔 톤. 탭 수가 색 개수를 넘으면 순환한다.
 */
export const BB_TAB_COLORS: string[] = [
  '#E3F2FD', // 연한 파랑
  '#E8F5E9', // 연한 초록
  '#FFF3E0', // 연한 주황
  '#F3E5F5', // 연한 보라
  '#FCE4EC', // 연한 분홍
  '#E0F7FA', // 연한 청록
  '#FFFDE7', // 연한 노랑
  '#EDE7F6', // 연한 자주
];

/** 탭 인덱스로 색을 구한다(순환). */
export const bbTabColor = (entryIdx: number): string =>
  BB_TAB_COLORS[((entryIdx % BB_TAB_COLORS.length) + BB_TAB_COLORS.length) % BB_TAB_COLORS.length];
