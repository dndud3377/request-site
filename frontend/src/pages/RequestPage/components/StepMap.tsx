import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { DetailFormState, GuideFeatureKey } from '../../../types';
import { CRegion } from '../constants';
import ProdcRow from './ProdcRow';
import MshotImageUpload from './MshotImageUpload';

const SELECT_W = '300px';

interface StepMapProps {
  detail: DetailFormState;
  errors: Partial<Record<string, string>>;
  lineOptions: string[];
  processOptions: string[];
  sourcePartIdOptions: string[];
  topProductOptions: string[];
  middleProductOptions: string[];
  bottomProductOptions: string[];
  prodcCopyRegion: CRegion | null;
  revLayersSelected: string[];
  setRevLayersSelected: React.Dispatch<React.SetStateAction<string[]>>;
  revGds: string;
  setRevGds: React.Dispatch<React.SetStateAction<string>>;
  availableRevLayers: string[];
  isProdc: boolean;
  isMapRegistered: boolean;
  hasMapChange: boolean;
  hasEaChange: boolean;
  mshotDeleteMode: boolean;
  mshotEditAddMode: boolean;
  setDetail: React.Dispatch<React.SetStateAction<DetailFormState>>;
  handleReset: () => void;
  handleMapTypeSelect: (val: string) => void;
  handleDetailChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleDetailSet: (name: string, value: string) => void;
  handleProdcRegionSelect: (region: CRegion) => void;
  handleProdcProcessChange: (region: CRegion, value: string) => void;
  handleImagePaste: (e: React.ClipboardEvent<HTMLDivElement>, fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom') => void;
  GuideBadge: React.FC<{ fk: GuideFeatureKey; tk: string }>;
}

const StepMap: React.FC<StepMapProps> = ({
  detail,
  errors,
  lineOptions,
  processOptions,
  sourcePartIdOptions,
  topProductOptions,
  middleProductOptions,
  bottomProductOptions,
  prodcCopyRegion,
  revLayersSelected,
  setRevLayersSelected,
  revGds,
  setRevGds,
  availableRevLayers,
  isProdc,
  isMapRegistered,
  hasMapChange,
  hasEaChange,
  mshotDeleteMode,
  mshotEditAddMode,
  setDetail,
  handleReset,
  handleMapTypeSelect,
  handleDetailChange,
  handleDetailSet,
  handleProdcRegionSelect,
  handleProdcProcessChange,
  handleImagePaste,
  GuideBadge,
}) => {
  const { t } = useTranslation();
  return (
    <div className="form-section">
      <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>🗺️ {t('request.section_map')}</span>
        <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={handleReset}>
          🔄 {t('common.reset')}
        </button>
      </div>
      <div className="form-grid">

        {/* 요청 목적 (신규/차용/기등록) */}
        <div className="full-width">
          <label className="form-label">
            {t('request.map_type')} <span className="required">*</span>
            <GuideBadge fk="step2_map_type" tk={t('guide.feat.step2_map_type' as never)} />
          </label>
          <div style={{ display: 'flex', gap: '8px', marginTop: 4 }}>
            {(['NEW', 'CLONE', 'EXISTING'] as const).map((val) => {
              const labelKey = val === 'NEW' ? 'map_type_new' : val === 'CLONE' ? 'map_type_borrow' : 'map_type_registered';
              return (
                <button
                  key={val}
                  type="button"
                  className={`map-type-btn${detail.map_type === val ? ' active' : ''}`}
                  onClick={() => handleMapTypeSelect(val)}
                >
                  {t(`request.${labelKey}`)}
                </button>
              );
            })}
          </div>
          {errors.map_type && <span className="form-error">{errors.map_type}</span>}
        </div>

        {/* 원본 위치/Part ID (CLONE 전용) */}
        {detail.map_type === 'CLONE' && (
          <div className="full-width">
            <div className="conditional-group">
              <div className="flex-row">
                <div className="form-group flex-col">
                  <label className="form-label">
                    {t('request.source_line')}
                    <GuideBadge fk="step2_source_location" tk={t('guide.feat.step2_source_location' as never)} />
                  </label>
                  <select
                    className="form-control"
                    name="source_line"
                    value={detail.source_line}
                    onChange={handleDetailChange}
                  >
                    <option value="">{t('request.select_placeholder')}</option>
                    {lineOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <AutocompleteInput
                  label={t('request.source_partid_selection')}
                  value={detail.source_partid}
                  options={sourcePartIdOptions}
                  onChange={(v) => handleDetailSet('source_partid', v)}
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Only C가문 제품 */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group" style={{ width: SELECT_W, flexShrink: 0, marginBottom: 0 }}>
            <label className="form-label">{t('request.prodc_status')}<GuideBadge fk="step2_cfamily" tk={t('guide.feat.step2_cfamily' as never)} /></label>
            <select
              className="form-control"
              name="only_prodc"
              value={detail.only_prodc}
              onChange={(e) => {
                handleDetailChange(e);
                if (e.target.value === 'No') {
                  setDetail((prev) => ({ ...prev, rev_yn: '', rev_entries: [] }));
                  setRevLayersSelected([]);
                  setRevGds('');
                }
              }}
              disabled={isMapRegistered}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>
          {isProdc && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span className="form-label" style={{ marginBottom: 0 }}>{t('request.prodc_apply_region')}</span>
                {(['top', 'middle', 'bottom'] as CRegion[]).map((region) => (
                  <label key={region} className="radio-item" style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="prodc_copy_region"
                      checked={prodcCopyRegion === region}
                      onChange={() => handleProdcRegionSelect(region)}
                    />
                    <span className="radio-custom" />
                    {t(`request.prodc_${region}`)}
                  </label>
                ))}
              </div>
              <ProdcRow region="top"    detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={topProductOptions}    onProcessChange={handleProdcProcessChange} errors={errors} />
              <ProdcRow region="middle" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={middleProductOptions}  onProcessChange={handleProdcProcessChange} errors={errors} />
              <ProdcRow region="bottom" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={bottomProductOptions}  onProcessChange={handleProdcProcessChange} errors={errors} />

              {/* REV 여부 */}
              <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '14px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>REV 여부<GuideBadge fk="step2_rev" tk={t('guide.feat.step2_rev' as never)} /></label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['YES', 'NO'] as const).map((val) => (
                    <button
                      key={val}
                      type="button"
                      className={`map-type-btn${detail.rev_yn === val ? ' active' : ''}`}
                      onClick={() => {
                        if (val === 'NO') {
                          setDetail((prev) => ({ ...prev, rev_yn: val, rev_entries: [] }));
                          setRevLayersSelected([]);
                          setRevGds('');
                        } else {
                          setDetail((prev) => ({ ...prev, rev_yn: val }));
                        }
                      }}
                      disabled={isMapRegistered}
                    >
                      {val}
                    </button>
                  ))}
                </div>

                {detail.rev_yn === 'YES' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* 입력 행: Layer 버튼 + GDS version + 추가 버튼 */}
                    <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>Layer</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxWidth: '480px' }}>
                          {availableRevLayers.length > 0 ? availableRevLayers.map((layer) => {
                            const isSelected = revLayersSelected.includes(layer);
                            return (
                              <button
                                key={layer}
                                type="button"
                                onClick={() =>
                                  setRevLayersSelected((prev) =>
                                    isSelected ? prev.filter((l) => l !== layer) : [...prev, layer]
                                  )
                                }
                                style={{
                                  padding: '5px 13px',
                                  borderRadius: '4px',
                                  border: `1.5px solid ${isSelected ? 'var(--accent, #1976D2)' : '#ccc'}`,
                                  backgroundColor: isSelected ? 'var(--accent, #1976D2)' : '#fff',
                                  color: isSelected ? '#fff' : '#333',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  fontWeight: isSelected ? 600 : 400,
                                  transition: 'all 0.15s',
                                }}
                              >
                                {layer}
                              </button>
                            );
                          }) : (
                            <span style={{ fontSize: '13px', color: '#999' }}>
                              {(detail.rev_entries ?? []).length > 0
                                ? '모든 Layer가 추가되었습니다.'
                                : t('request.jayer_no_layer_data')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label className="form-label" style={{ marginBottom: 0 }}>GDS version</label>
                        <input
                          className="form-control"
                          style={{ width: '360px' }}
                          value={revGds}
                          onChange={(e) => setRevGds(e.target.value)}
                          placeholder="GDS version 입력"
                        />
                      </div>

                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ whiteSpace: 'nowrap' }}
                        disabled={revLayersSelected.length === 0 || !revGds.trim()}
                        onClick={() => {
                          if (revLayersSelected.length === 0 || !revGds.trim()) return;
                          setDetail((prev) => ({
                            ...prev,
                            rev_entries: [...(prev.rev_entries ?? []), { layers: revLayersSelected, gds: revGds.trim() }],
                          }));
                          setRevLayersSelected([]);
                          setRevGds('');
                        }}
                      >
                        + 추가
                      </button>
                    </div>

                    {/* 추가된 항목 목록 */}
                    {(detail.rev_entries ?? []).length > 0 && (
                      <table style={{ borderCollapse: 'collapse', width: 'fit-content', marginTop: '4px', fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>Layer</th>
                            <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>GDS version</th>
                            <th style={{ border: '1px solid #ddd', padding: '4px 6px', background: '#f5f5f5' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.rev_entries ?? []).map((entry, idx) => (
                            <tr key={idx}>
                              <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'nowrap' }}>{entry.layers.join(', ')}</td>
                              <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'nowrap' }}>{entry.gds}</td>
                              <td style={{ border: '1px solid #ddd', padding: '4px 6px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  style={{ fontSize: '11px', padding: '2px 7px' }}
                                  onClick={() =>
                                    setDetail((prev) => ({
                                      ...prev,
                                      rev_entries: (prev.rev_entries ?? []).filter((_, i) => i !== idx),
                                    }))
                                  }
                                >
                                  삭제
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 지도 편차 */}
        {isProdc ? (
          <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label className="form-label">{t('request.map')}<GuideBadge fk="step2_map_deviation" tk={t('guide.feat.step2_map_deviation' as never)} /></label>
            {(['top', 'bottom'] as const).map((region) => (
              <div key={region} className="flex-row" style={{ alignItems: 'flex-start', gap: '12px' }}>
                <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
                  <label className="form-label" style={{ marginBottom: 4 }}>{t(`request.prodc_${region}`)}</label>
                  <select className="form-control" disabled value="변경 있음">
                    <option value="변경 있음">{t('request.map_has_change')}</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">{t('request.map_value_x')} <span className="required">*</span></label>
                  <input
                    className={`form-control${errors[`map_value_x_${region}`] ? ' error' : ''}`}
                    name={`map_value_x_${region}`}
                    value={detail[`map_value_x_${region}` as keyof DetailFormState] as string}
                    onChange={handleDetailChange}
                    disabled={isMapRegistered}
                  />
                  {errors[`map_value_x_${region}`] && <span className="form-error">{errors[`map_value_x_${region}`]}</span>}
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">{t('request.map_value_y')} <span className="required">*</span></label>
                  <input
                    className={`form-control${errors[`map_value_y_${region}`] ? ' error' : ''}`}
                    name={`map_value_y_${region}`}
                    value={detail[`map_value_y_${region}` as keyof DetailFormState] as string}
                    onChange={handleDetailChange}
                    disabled={isMapRegistered}
                  />
                  {errors[`map_value_y_${region}`] && <span className="form-error">{errors[`map_value_y_${region}`]}</span>}
                </div>
              </div>
            ))}
            <div className="form-group" style={{ flex: 3 }}>
              <label className="form-label">{t('request.map_reason')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_reason ? ' error' : ''}`} name="map_reason" value={detail.map_reason} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_reason && <span className="form-error">{errors.map_reason}</span>}
            </div>
          </div>
        ) : (
          <div className="full-width flex-row">
            <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
              <label className="form-label">{t('request.map')}<GuideBadge fk="step2_map_deviation" tk={t('guide.feat.step2_map_deviation' as never)} /></label>
              <select className="form-control" name="map_change" value={detail.map_change} onChange={handleDetailChange} disabled={isMapRegistered}>
                <option value="변경 없음">{t('request.map_no_change')}</option>
                <option value="변경 있음">{t('request.map_has_change')}</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_value_x')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_value_x ? ' error' : ''}`} name="map_value_x" value={detail.map_value_x} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_value_x && <span className="form-error">{errors.map_value_x}</span>}
            </div>
            <div className="form-group" style={{ flex: 1, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_value_y')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_value_y ? ' error' : ''}`} name="map_value_y" value={detail.map_value_y} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_value_y && <span className="form-error">{errors.map_value_y}</span>}
            </div>
            <div className="form-group" style={{ flex: 3, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_reason')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_reason ? ' error' : ''}`} name="map_reason" value={detail.map_reason} onChange={handleDetailChange} disabled={isMapRegistered} />
              {errors.map_reason && <span className="form-error">{errors.map_reason}</span>}
            </div>
          </div>
        )}

        {/* 예외 구역 */}
        <div className="full-width flex-row">
          <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
            <label className="form-label">{t('request.ea_change')}<GuideBadge fk="step2_exception_zone" tk={t('guide.feat.step2_exception_zone' as never)} /></label>
            <select className="form-control" name="ea_change" value={detail.ea_change} onChange={handleDetailChange} disabled={isMapRegistered}>
              <option value="변경 없음">{t('request.no_change')}</option>
              <option value="변경 있음">{t('request.has_change')}</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1.5, visibility: hasEaChange ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.ea_value')} <span className="required">*</span></label>
            <input className={`form-control${errors.ea_value ? ' error' : ''}`} name="ea_value" value={detail.ea_value} onChange={handleDetailChange} disabled={isMapRegistered} />
            {errors.ea_value && <span className="form-error">{errors.ea_value}</span>}
          </div>
          <div style={{ flex: 3.5 }} />
        </div>

        {/* X표시 변경 여부 */}
        <div className="form-group full-width">
          <label className="form-label">{t('request.mshot_change_status')}<GuideBadge fk="step2_xmark" tk={t('guide.feat.step2_xmark' as never)} /></label>
          <div style={{ width: SELECT_W }}>
            <select className="form-control" name="mshot_change" value={detail.mshot_change} onChange={handleDetailChange} disabled={isMapRegistered}>
              <option value="없음">{t('request.mshot_none')}</option>
              <option value="추가">{t('request.mshot_add')}</option>
              <option value="수정">{t('request.mshot_edit')}</option>
              <option value="삭제">{t('request.mshot_delete')}</option>
            </select>
          </div>
          {mshotDeleteMode && (
            <p style={{ color: 'red', fontWeight: 600, margin: '8px 0 0 0' }}>특정 제품 삭제 필요</p>
          )}
          {mshotEditAddMode && !isProdc && (
            <div className="form-group" style={{ width: '50%', marginTop: '8px' }}>
              <label className="form-label">{t('request.mshot_change_image_attach_area')} <span className="required">*</span></label>
              <MshotImageUpload
                fieldName="mshot_image_copy"
                value={detail.mshot_image_copy}
                error={errors.mshot_image_copy}
                disabled={isMapRegistered}
                onPaste={handleImagePaste}
              />
            </div>
          )}
          {mshotEditAddMode && isProdc && (
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label className="form-label">{t('request.mshot_change_image_attach_area')}</label>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div className="form-label" style={{ marginBottom: '6px' }}>{t('request.prodc_top')} <span className="required">*</span></div>
                  <MshotImageUpload
                    fieldName="mshot_image_copy_top"
                    value={detail.mshot_image_copy_top}
                    error={errors.mshot_image_copy_top}
                    disabled={isMapRegistered}
                    onPaste={handleImagePaste}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div className="form-label" style={{ marginBottom: '6px' }}>{t('request.prodc_bottom')} <span className="required">*</span></div>
                  <MshotImageUpload
                    fieldName="mshot_image_copy_bottom"
                    value={detail.mshot_image_copy_bottom}
                    error={errors.mshot_image_copy_bottom}
                    disabled={isMapRegistered}
                    onPaste={handleImagePaste}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Map Option 선택 토글 버튼 */}
        {(() => {
          const mapOptions = [
            { label: t('request.map_opt_photo_backside'), name: 'photo_backside' as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_eds_backside'),   name: 'eds_backside'   as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_inter'),          name: 'inter'          as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_tsv'),            name: 'tsv'            as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_rf'),             name: 'rf'             as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_fullchip'),       name: 'fullchip'       as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_split'),          name: 'split'          as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_st'),             name: 'st'             as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_ecc'),            name: 'ecc'            as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_labelsideshot'),  name: 'labelsideshot'  as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_hpkglabelheight'), name: 'hpkglabelheight' as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
          ];
          return (
            <div className="full-width">
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                {t('request.map_option_title')}
                <GuideBadge fk="step2_map_options" tk={t('guide.feat.step2_map_options' as never)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, max-content)', gap: '8px' }}>
                {mapOptions.map((opt) => {
                  const isActive = detail[opt.name] === opt.activeValue;
                  const isDisabled = isMapRegistered;
                  return (
                    <button
                      key={opt.name as string}
                      type="button"
                      className={`map-option-btn${isActive ? ' active' : ''}`}
                      disabled={isDisabled}
                      onClick={() => handleDetailSet(opt.name as string, isActive ? opt.defaultValue : opt.activeValue)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
};

export default StepMap;
