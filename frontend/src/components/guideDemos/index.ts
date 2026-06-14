import React from 'react';
import { GuideFeatureKey } from '../../types';
import Step1LineProcessDemo from './Step1LineProcessDemo';
import Step3JayerTableDemo from './Step3JayerTableDemo';
import Step3JayerFilterDemo from './Step3JayerFilterDemo';
import Step4OayerTableDemo from './Step4OayerTableDemo';
import Step5BbAutofillDemo from './Step5BbAutofillDemo';
import Step5BbMappingDemo from './Step5BbMappingDemo';
import Step2MapTypeDemo from './Step2MapTypeDemo';
import Step2CfamilyDemo from './Step2CfamilyDemo';

/** feature_key → 빌트인 애니메이션 데모 컴포넌트 매핑 */
export const GUIDE_DEMOS: Partial<Record<GuideFeatureKey, React.FC>> = {
  step1_line_process: Step1LineProcessDemo,
  step2_map_type: Step2MapTypeDemo,
  step2_cfamily: Step2CfamilyDemo,
  step3_jayer_table: Step3JayerTableDemo,
  step3_jayer_filter: Step3JayerFilterDemo,
  step4_oayer_table: Step4OayerTableDemo,
  step5_bb_autofill: Step5BbAutofillDemo,
  step5_bb_mapping: Step5BbMappingDemo,
};

/** 빌트인 데모가 존재하는 feature_key 목록 (가이드 배지 노출용) */
export const GUIDE_DEMO_KEYS = Object.keys(GUIDE_DEMOS) as GuideFeatureKey[];
