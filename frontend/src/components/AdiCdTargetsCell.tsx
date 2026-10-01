import React from 'react';
import { useTranslation } from 'react-i18next';
import { AdiCdTargetSummary } from '../types';
import { groupAdiTargetsByProcessId } from '../utils/approvalTable';

/** '동일 변경 N건' 배지는 대상이 이 개수 이상일 때만 보인다(1건이면 숨김) */
const MIN_COUNT_FOR_BADGE = 2;

export interface AdiCdTargetsCellProps {
  /** 조합법 — 문서당 1개로 고정이라 머리 태그에 한 번만 쓴다 */
  combo: string;
  /** 첫 대상 + 추가 대상 전체 */
  targets: AdiCdTargetSummary[];
}

/**
 * ADI CD 변경 '동일 변경 적용 대상' 표시 — 결재 현황·홈 목록 칸과 상세 모달 카드가 함께 쓴다.
 *
 *   TLC [동일 변경 4건]                         ← 머리 줄: 조합법 + (2건 이상일 때) 건수 배지
 *   [PRC_A001] (AB12CD34-01A) (AB12CD34-02B)    ← 조리법별 묶음: 조리법 태그 + 제품 이름 칩
 *
 * 대상이 1건이어도 같은 2줄 형태를 쓴다(배지만 숨긴다). 안쪽은 button 안에 들어갈 수 있도록 span 만 쓴다.
 */
const AdiCdTargetsCell: React.FC<AdiCdTargetsCellProps> = ({ combo, targets }) => {
  const { t } = useTranslation();
  const groups = groupAdiTargetsByProcessId(targets);

  return (
    <span className="adi-targets">
      <span className="adi-targets-head">
        <span className="adi-targets-combo">{combo}</span>
        {targets.length >= MIN_COUNT_FOR_BADGE && (
          <span className="adi-targets-count">{t('approval.adi_targets_count', { count: targets.length })}</span>
        )}
      </span>
      {groups.map((group) => (
        <span key={group.processId} className="adi-targets-group">
          <span className="adi-targets-process">{group.processId}</span>
          <span className="adi-targets-products">
            {group.products.map((product, i) => (
              <span key={`${product}-${i}`} className="adi-targets-product">{product}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
};

export default AdiCdTargetsCell;
