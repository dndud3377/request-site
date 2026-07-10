import React from 'react';
import { useTranslation } from 'react-i18next';
import FormSelect from '../../../components/FormSelect';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { DetailFormState } from '../../../types';
import { CRegion } from '../constants';

interface ProdcRowProps {
  region: CRegion;
  detail: DetailFormState;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSetValue: (name: string, value: string) => void;
  onLineChange: (region: CRegion, value: string) => void;
  lineOptions: string[];
  processOptions: string[];
  productOptions: string[];
  onProcessChange: (region: CRegion, value: string) => void;
  errors?: Partial<Record<string, string>>;
}

const REGION_LABEL_KEY = { top: 'prodc_top', middle: 'prodc_middle', bottom: 'prodc_bottom' } as const;

const ProdcRow: React.FC<ProdcRowProps> = ({ region, detail, onChange, onSetValue, onLineChange, lineOptions, processOptions, productOptions, onProcessChange, errors = {} }) => {
  const { t } = useTranslation();
  const showSelects = region !== 'middle' || detail.prodc_middle_use === '사용';
  return (
    <div className="flex-row" style={{ alignItems: 'flex-start' }}>
      <span style={{ width: '40px', paddingTop: '32px', fontWeight: 600 }}>
        {t(`request.${REGION_LABEL_KEY[region]}`)}
      </span>
      {region === 'middle' && (
        <FormSelect
          label={t('request.prodc_use')}
          name="prodc_middle_use"
          value={detail.prodc_middle_use}
          options={['사용', '미사용']}
          onChange={onChange}
          placeholder={t('request.select_placeholder')}
          className="flex-col"
        />
      )}
      {showSelects && (
        <>
          <div className="flex-col" style={{ flex: 1 }}>
            <label className="form-label">
              {t('request.prodc_line')}
              {region !== 'middle' && <span className="required"> *</span>}
            </label>
            <select
              className={`form-control${errors[`prodc_${region}_line`] ? ' error' : ''}`}
              name={`prodc_${region}_line`}
              value={detail[`prodc_${region}_line` as keyof DetailFormState] as string}
              onChange={(e) => onLineChange(region, e.target.value)}
            >
              <option value="">{t('request.select_placeholder')}</option>
              {lineOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {errors[`prodc_${region}_line`] && <span className="form-error">{errors[`prodc_${region}_line`]}</span>}
          </div>
          <div className="flex-col" style={{ flex: 1 }}>
            <AutocompleteInput
              label={`${t('request.prodc_process_selection')}${region !== 'middle' ? ' *' : ''}`}
              value={detail[`prodc_${region}_process` as keyof DetailFormState] as string}
              options={processOptions}
              onChange={(v) => { onSetValue(`prodc_${region}_process`, v); onProcessChange(region, v); }}
              error={errors[`prodc_${region}_process`]}
            />
          </div>
          <div className="flex-col" style={{ flex: 1 }}>
            <AutocompleteInput
              label={`${t('request.prodc_partid')}${region !== 'middle' ? ' *' : ''}`}
              value={detail[`prodc_${region}_product` as keyof DetailFormState] as string}
              options={productOptions}
              onChange={(v) => onSetValue(`prodc_${region}_product`, v)}
              error={errors[`prodc_${region}_product`]}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default ProdcRow;
