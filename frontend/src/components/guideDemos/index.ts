import React from 'react';
import { GuideFeatureKey } from '../../types';
import Step1LineProcessDemo from './Step1LineProcessDemo';
import Step3JayerTableDemo from './Step3JayerTableDemo';
import Step3JayerFilterDemo from './Step3JayerFilterDemo';
import Step4OayerTableDemo from './Step4OayerTableDemo';

/** feature_key → 빌트인 애니메이션 데모 컴포넌트 매핑 */
export const GUIDE_DEMOS: Partial<Record<GuideFeatureKey, React.FC>> = {
  step1_line_process: Step1LineProcessDemo,
  step3_jayer_table: Step3JayerTableDemo,
  step3_jayer_filter: Step3JayerFilterDemo,
  step4_oayer_table: Step4OayerTableDemo,
};

/** 빌트인 데모가 존재하는 feature_key 목록 (가이드 배지 노출용) */
export const GUIDE_DEMO_KEYS = Object.keys(GUIDE_DEMOS) as GuideFeatureKey[];
