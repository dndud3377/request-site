import type { TFunction } from 'i18next';
import {
  NOC_NEW, NOC_BORROW, NOC_REGISTERED, NOC_LAYER_DELETE, NOC_NOT_PROCEEDING, MAP_TYPE_DELETE_REQ,
} from '../pages/RequestPage/constants';

/**
 * DB 에 한글 그대로 저장되는 선택값(요청 목적·기타 목적·요청 기준·라인) → `request.opt.*` 키 접미사.
 *
 * 저장값·비교 로직은 그대로 두고 **화면에 보이는 문구만** 번역하기 위한 표다.
 * 여기 없는 값(마스터 데이터에서 온 라인 이름 등)은 `optionLabel` 이 원문을 그대로 돌려준다.
 */
const OPTION_KEY_SUFFIX: Readonly<Record<string, string>> = {
  '신규+차용': 'purpose_new_borrow',
  'Only MAP': 'purpose_only_map',
  'MAP 삭제': 'purpose_map_delete',
  'ADI CD 변경': 'purpose_adi_cd_change',
  'P 변경': 'purpose_p_change',
  '기타': 'purpose_etc',
  'Layer 추가/삭제': 'other_layer_add_delete',
  'STEPSEQ 변경': 'other_stepseq_change',
  '공법 추가/변경': 'other_process_add_change',
  'Overlay 변경': 'other_overlay_change',
  'FirstA 변경': 'other_firsta_change',
  'B 변경': 'other_b_change',
  '연구소 제품': 'other_lab_product',
  '라인1': 'line_1',
  '라인2': 'line_2',
  '라인3': 'line_3',
  '라인4': 'line_4',
  '라인5': 'line_5',
  nv: 'line_nv',
  '미사용': 'unused',
};

/** '신규'·'차용' 은 요청 목적과 요청 기준(new_or_copy) 양쪽에 쓰이므로 종류별로 따로 둔다. */
const PURPOSE_ONLY_SUFFIX: Readonly<Record<string, string>> = {
  '신규': 'purpose_new',
  '차용': 'purpose_borrow',
};

const NOC_SUFFIX: Readonly<Record<string, string>> = {
  [NOC_NEW]: 'noc_new',
  [NOC_BORROW]: 'noc_borrow',
  [NOC_REGISTERED]: 'noc_registered',
  [NOC_LAYER_DELETE]: 'noc_layer_delete',
  [NOC_NOT_PROCEEDING]: 'noc_not_proceeding',
};

/** 선택값이 어느 항목의 값인지 — '신규'·'차용' 처럼 같은 글자가 다른 뜻으로 쓰이는 경우를 가른다. */
export type OptionKind = 'purpose' | 'noc' | 'other';

const translate = (t: TFunction, suffix: string | undefined, value: string): string =>
  suffix ? t(`request.opt.${suffix}` as never) : value;

/**
 * 저장된 한글 선택값을 현재 언어의 표시 문구로 바꾼다. 모르는 값·빈 값은 원문 그대로 돌려준다.
 * 저장·전송·비교에는 쓰지 말고 **표시에만** 쓴다.
 */
export const optionLabel = (t: TFunction, value: string, kind: OptionKind = 'other'): string => {
  if (!value) return value;
  if (kind === 'noc') return translate(t, NOC_SUFFIX[value], value);
  if (kind === 'purpose') return translate(t, PURPOSE_ONLY_SUFFIX[value] ?? OPTION_KEY_SUFFIX[value], value);
  return translate(t, OPTION_KEY_SUFFIX[value], value);
};

/** map_type 저장값 표시 문구. NEW·CLONE·EXISTING 은 영문 코드 그대로 보이고, 한글로 저장되는 '삭제' 만 번역한다. */
export const mapTypeLabel = (t: TFunction, value: string): string =>
  value === MAP_TYPE_DELETE_REQ ? t('request.map_type_delete_req') : value;
