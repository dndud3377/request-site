import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { DetailFormState, GuideFeatureKey } from '../../../types';
import { CRegion, ProdcScope, PRODC_SCOPE_OPTIONS } from '../constants';
import { sanitizeSignedDecimal } from '../helpers';
import ProdcRow from './ProdcRow';
import MshotImageUpload from './MshotImageUpload';

const SELECT_W = '300px';

interface StepMapProps {
  detail: DetailFormState;
  errors: Partial<Record<string, string>>;
  lineOptions: string[];
  sourcePartIdOptions: string[];
  topProductOptions: string[];
  middleProductOptions: string[];
  bottomProductOptions: string[];
  topProcessOptions: string[];
  middleProcessOptions: string[];
  bottomProcessOptions: string[];
  handleProdcLineChange: (region: CRegion, value: string) => void;
  /** 제품 해당 위치 미선택(게이트) 여부 — false 면 C가문 하위 입력을 전부 잠근다 */
  prodcScopeSet: boolean;
  /** 리전 최종 잠금 판정(게이트 + ONLY 스코프 + CLONE/EXISTING) */
  prodcLocked: (region: CRegion) => boolean;
  /** ONLY 스코프에서 쓰지 않는 리전인가(필수 표기 제거용) */
  prodcRegionOff: (region: CRegion) => boolean;
  /** 리전 지도편차가 '변경 있음'으로 살아있는가 */
  regionHasMapChange: (region: 'top' | 'bottom') => boolean;
  anyRegionMapChange: boolean;
  handleProdcScopeSelect: (scope: ProdcScope) => void;
  handleRegionMapChangeChange: (region: 'top' | 'bottom', value: string) => void;
  revLayersSelected: string[];
  setRevLayersSelected: React.Dispatch<React.SetStateAction<string[]>>;
  revGds: string;
  setRevGds: React.Dispatch<React.SetStateAction<string>>;
  availableRevLayers: string[];
  isProdc: boolean;
  isMapRegistered: boolean;
  isMapChangeMode: boolean;
  hasMapChange: boolean;
  hasEaChange: boolean;
  mshotDeleteMode: boolean;
  mshotEditAddMode: boolean;
  setDetail: React.Dispatch<React.SetStateAction<DetailFormState>>;
  handleReset: () => void;
  handleMapTypeSelect: (val: string) => void;
  handleDetailChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleDetailSet: (name: string, value: string) => void;
  handleProdcProcessChange: (region: CRegion, value: string) => void;
  handleOnlyProdcChange: (value: string) => void;
  handleMapChangeChange: (value: string) => void;
  handleEaChangeChange: (value: string) => void;
  handleMshotChangeChange: (value: string) => void;
  handleImagePaste: (e: React.ClipboardEvent<HTMLDivElement>, fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom') => void;
  GuideBadge: React.FC<{ fk: GuideFeatureKey; tk: string }>;
}

const StepMap: React.FC<StepMapProps> = ({
  detail,
  errors,
  lineOptions,
  sourcePartIdOptions,
  topProductOptions,
  middleProductOptions,
  bottomProductOptions,
  topProcessOptions,
  middleProcessOptions,
  bottomProcessOptions,
  handleProdcLineChange,
  prodcScopeSet,
  prodcLocked,
  prodcRegionOff,
  regionHasMapChange,
  anyRegionMapChange,
  handleProdcScopeSelect,
  handleRegionMapChangeChange,
  revLayersSelected,
  setRevLayersSelected,
  revGds,
  setRevGds,
  availableRevLayers,
  isProdc,
  isMapRegistered,
  isMapChangeMode,
  hasMapChange,
  hasEaChange,
  mshotDeleteMode,
  mshotEditAddMode,
  setDetail,
  handleReset,
  handleMapTypeSelect,
  handleDetailChange,
  handleDetailSet,
  handleProdcProcessChange,
  handleOnlyProdcChange,
  handleMapChangeChange,
  handleEaChangeChange,
  handleMshotChangeChange,
  handleImagePaste,
  GuideBadge,
}) => {
  const { t } = useTranslation();

  // REV Layer 드래그 다중 선택: 버튼 위를 눌러 드래그하면 지나가는 layer 를 일괄 선택/해제한다.
  const revDrag = React.useRef<{ mode: 'add' | 'remove' } | null>(null);
  const applyRevLayer = (layer: string, mode: 'add' | 'remove') => {
    setRevLayersSelected((prev) => {
      const has = prev.includes(layer);
      if (mode === 'add') return has ? prev : [...prev, layer];
      return has ? prev.filter((l) => l !== layer) : prev;
    });
  };
  React.useEffect(() => {
    const end = () => { revDrag.current = null; };
    window.addEventListener('mouseup', end);
    return () => window.removeEventListener('mouseup', end);
  }, []);

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
        <div className="full-width" data-tour="map-purpose">
          <label className="form-label">
            {t('request.map_type')} <span className="required">*</span>
            <GuideBadge fk="step2_map_type" tk={t('guide.feat.step2_map_type' as never)} />
          </label>
          <div style={{ display: 'flex', gap: '8px', marginTop: 4 }}>
            {(['NEW', 'CLONE', 'EXISTING', 'EDIT', 'ADI'] as const).map((val) => {
              const labelKey = val === 'NEW' ? 'map_type_new' : val === 'CLONE' ? 'map_type_borrow' : val === 'EXISTING' ? 'map_type_registered' : val === 'EDIT' ? 'map_type_edit' : 'map_type_adi';
              // ADI 는 기타 목적 'ADI CD 변경' 전용 값 — Step1 버튼이 자동 고정하므로 여기서는 항상 잠금(표시 전용).
              // 고정돼 있는 동안은 EDIT 와 동일하게 나머지 4개도 전부 잠근다.
              const isAdiLocked = detail.map_type === 'ADI';
              const disabled = val === 'ADI' ? true : isAdiLocked ? true : val === 'EDIT' ? !isMapChangeMode : isMapChangeMode;
              return (
                <button
                  key={val}
                  type="button"
                  className={`map-type-btn${detail.map_type === val ? ' active' : ''}`}
                  onClick={() => handleMapTypeSelect(val)}
                  // EDIT 는 기타 목적 '완성된 MAP 변경' 전용 값이다.
                  // 그 모드에서만 EDIT 를 활성화하고, 반대로 그 모드에서는 나머지 3개를 잠근다.
                  disabled={disabled}
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
                    className={`form-control${errors.source_line ? ' error' : ''}`}
                    name="source_line"
                    value={detail.source_line}
                    onChange={handleDetailChange}
                  >
                    <option value="">{t('request.select_placeholder')}</option>
                    {lineOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {errors.source_line && <span className="form-error">{errors.source_line}</span>}
                </div>
                <AutocompleteInput
                  label={t('request.source_partid_selection')}
                  value={detail.source_partid}
                  options={sourcePartIdOptions}
                  onChange={(v) => handleDetailSet('source_partid', v)}
                  error={errors.source_partid}
                  style={{ flex: 1 }}
                  uppercase
                  maxLength={8}
                />
              </div>
            </div>
          </div>
        )}

        {/* REV 여부 — C가문(only_prodc)과 무관한 독립 항목. map_type 종류와 상관없이 항상 선택 가능하다.
            (CLONE/EXISTING 에서도 잠그지 않는다 — isMapRegistered 를 걸지 않는 이유) */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label className="form-label" style={{ marginBottom: 0 }}>{t('request.rev_yn_label')}<GuideBadge fk="step2_rev" tk={t('guide.feat.step2_rev' as never)} /></label>
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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxWidth: '480px', userSelect: 'none' }}>
                    {availableRevLayers.length > 0 ? availableRevLayers.map((layer) => {
                      const isSelected = revLayersSelected.includes(layer);
                      return (
                        <button
                          key={layer}
                          type="button"
                          className={`map-type-btn${isSelected ? ' active' : ''}`}
                          // 드래그 다중 선택: 첫 버튼에서 add/remove 모드를 정하고 지나가는 버튼에 적용
                          onMouseDown={() => {
                            const mode: 'add' | 'remove' = isSelected ? 'remove' : 'add';
                            revDrag.current = { mode };
                            applyRevLayer(layer, mode);
                          }}
                          onMouseEnter={() => {
                            if (revDrag.current) applyRevLayer(layer, revDrag.current.mode);
                          }}
                        >
                          {layer}
                        </button>
                      );
                    }) : (
                      <span style={{ fontSize: '13px', color: '#999' }}>
                        {(detail.rev_entries ?? []).length > 0
                          ? t('request.rev_all_added')
                          : t('request.jayer_no_layer_data')}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>{t('request.rev_gds')}</label>
                  <input
                    className="form-control"
                    style={{ width: '360px' }}
                    value={revGds}
                    onChange={(e) => setRevGds(e.target.value)}
                    placeholder={t('request.rev_gds_placeholder')}
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
                  {t('request.rev_add')}
                </button>
              </div>

              {/* 추가된 항목 목록 */}
              {(detail.rev_entries ?? []).length > 0 && (
                <div className="table-wrapper" style={{ maxWidth: '640px', marginTop: '4px' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: '55%' }}>{t('request.rev_layer')}</th>
                        <th style={{ width: '30%' }}>{t('request.rev_gds')}</th>
                        <th style={{ width: '15%', textAlign: 'center' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.rev_entries ?? []).map((entry, idx) => (
                        <tr key={idx}>
                          <td>{entry.layers.join(', ')}</td>
                          <td>{entry.gds}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() =>
                                setDetail((prev) => ({
                                  ...prev,
                                  rev_entries: (prev.rev_entries ?? []).filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              {t('common.delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Only C가문 제품 — Yes/No 선택 자체는 CLONE/EXISTING 에서도 열어두고,
            Yes 일 때 펼쳐지는 하위 입력(적용 위치·북/중/남 라인·조합법·제품)만 잠근다. */}
        <div className="full-width" data-tour="map-cfamily" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group" style={{ width: SELECT_W, flexShrink: 0, marginBottom: 0 }}>
            <label className="form-label">{t('request.prodc_status')}<GuideBadge fk="step2_cfamily" tk={t('guide.feat.step2_cfamily' as never)} /></label>
            <select
              className="form-control"
              name="only_prodc"
              value={detail.only_prodc}
              onChange={(e) => handleOnlyProdcChange(e.target.value)}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>
          {isProdc && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 제품 해당 위치 — 이것을 먼저 골라야 아래 판별 정보·지도편차·X표시 이미지가 열린다(게이트). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <span className="form-label" style={{ marginBottom: 0 }}>
                  {t('request.prodc_apply_region')} <span className="required">*</span>
                </span>
                {PRODC_SCOPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="radio-item" style={{ cursor: isMapRegistered ? 'not-allowed' : 'pointer' }}>
                    <input
                      type="radio"
                      name="prodc_scope"
                      checked={detail.prodc_scope === opt.value}
                      onChange={() => handleProdcScopeSelect(opt.value)}
                      disabled={isMapRegistered}
                    />
                    <span className="radio-custom" />
                    {t(`request.${opt.labelKey}`)}
                  </label>
                ))}
              </div>
              {!prodcScopeSet && (
                <span className={errors.prodc_scope ? 'form-error' : ''} style={errors.prodc_scope ? undefined : { fontSize: '13px', color: '#999' }}>
                  {t('request.prodc_scope_first')}
                </span>
              )}
              <ProdcRow region="top"    detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} onLineChange={handleProdcLineChange} lineOptions={lineOptions} processOptions={topProcessOptions}    productOptions={topProductOptions}    onProcessChange={handleProdcProcessChange} errors={errors} disabled={prodcLocked('top')} />
              <ProdcRow region="middle" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} onLineChange={handleProdcLineChange} lineOptions={lineOptions} processOptions={middleProcessOptions} productOptions={middleProductOptions}  onProcessChange={handleProdcProcessChange} errors={errors} disabled={prodcLocked('middle')} />
              <ProdcRow region="bottom" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} onLineChange={handleProdcLineChange} lineOptions={lineOptions} processOptions={bottomProcessOptions} productOptions={bottomProductOptions}  onProcessChange={handleProdcProcessChange} errors={errors} disabled={prodcLocked('bottom')} />
            </div>
          )}
        </div>

        {/* 지도 편차 */}
        {isProdc ? (
          <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label className="form-label">{t('request.map')}<GuideBadge fk="step2_map_deviation" tk={t('guide.feat.step2_map_deviation' as never)} /></label>
            {(['top', 'bottom'] as const).map((region) => {
              // 리전 지도편차는 '변경 없음/있음'을 개별 선택한다(고정값이 아니다).
              // X/Y 는 그 리전이 살아있고 '변경 있음'일 때만 입력·필수.
              const selectLocked = prodcLocked(region);
              const valueLocked = selectLocked || !regionHasMapChange(region);
              const required = regionHasMapChange(region);
              return (
                <div key={region} className="flex-row" style={{ alignItems: 'flex-start', gap: '12px' }}>
                  <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
                    <label className="form-label">{t(`request.prodc_${region}`)}</label>
                    <select
                      className="form-control"
                      name={`map_change_${region}`}
                      value={detail[`map_change_${region}`]}
                      onChange={(e) => handleRegionMapChangeChange(region, e.target.value)}
                      disabled={selectLocked}
                    >
                      <option value="변경 없음">{t('request.map_no_change')}</option>
                      <option value="변경 있음">{t('request.map_has_change')}</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">{t('request.map_value_x')} {required && <span className="required">*</span>}</label>
                    <input
                      className={`form-control${errors[`map_value_x_${region}`] ? ' error' : ''}`}
                      name={`map_value_x_${region}`}
                      value={detail[`map_value_x_${region}` as keyof DetailFormState] as string}
                      onChange={(e) => handleDetailSet(`map_value_x_${region}`, sanitizeSignedDecimal(e.target.value))}
                      inputMode="decimal"
                      disabled={valueLocked}
                    />
                    {errors[`map_value_x_${region}`] && <span className="form-error">{errors[`map_value_x_${region}`]}</span>}
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">{t('request.map_value_y')} {required && <span className="required">*</span>}</label>
                    <input
                      className={`form-control${errors[`map_value_y_${region}`] ? ' error' : ''}`}
                      name={`map_value_y_${region}`}
                      value={detail[`map_value_y_${region}` as keyof DetailFormState] as string}
                      onChange={(e) => handleDetailSet(`map_value_y_${region}`, sanitizeSignedDecimal(e.target.value))}
                      inputMode="decimal"
                      disabled={valueLocked}
                    />
                    {errors[`map_value_y_${region}`] && <span className="form-error">{errors[`map_value_y_${region}`]}</span>}
                  </div>
                </div>
              );
            })}
            <div className="form-group" style={{ flex: 3 }}>
              <label className="form-label">{t('request.map_reason')} {anyRegionMapChange && <span className="required">*</span>}</label>
              <input
                className={`form-control${errors.map_reason ? ' error' : ''}`}
                name="map_reason"
                value={detail.map_reason}
                onChange={handleDetailChange}
                disabled={isMapRegistered || !prodcScopeSet || !anyRegionMapChange}
              />
              {errors.map_reason && <span className="form-error">{errors.map_reason}</span>}
            </div>
          </div>
        ) : (
          <div className="full-width flex-row" data-tour="map-deviation">
            <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
              <label className="form-label">{t('request.map')}<GuideBadge fk="step2_map_deviation" tk={t('guide.feat.step2_map_deviation' as never)} /></label>
              <select className="form-control" name="map_change" value={detail.map_change} onChange={(e) => handleMapChangeChange(e.target.value)} disabled={isMapRegistered}>
                <option value="변경 없음">{t('request.map_no_change')}</option>
                <option value="변경 있음">{t('request.map_has_change')}</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_value_x')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_value_x ? ' error' : ''}`} name="map_value_x" value={detail.map_value_x} onChange={(e) => handleDetailSet('map_value_x', sanitizeSignedDecimal(e.target.value))} inputMode="decimal" disabled={isMapRegistered} />
              {errors.map_value_x && <span className="form-error">{errors.map_value_x}</span>}
            </div>
            <div className="form-group" style={{ flex: 1, visibility: hasMapChange ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_value_y')} <span className="required">*</span></label>
              <input className={`form-control${errors.map_value_y ? ' error' : ''}`} name="map_value_y" value={detail.map_value_y} onChange={(e) => handleDetailSet('map_value_y', sanitizeSignedDecimal(e.target.value))} inputMode="decimal" disabled={isMapRegistered} />
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
        <div className="full-width flex-row" data-tour="map-exception">
          <div className="form-group" style={{ width: SELECT_W, flexShrink: 0 }}>
            <label className="form-label">{t('request.ea_change')}<GuideBadge fk="step2_exception_zone" tk={t('guide.feat.step2_exception_zone' as never)} /></label>
            <select className="form-control" name="ea_change" value={detail.ea_change} onChange={(e) => handleEaChangeChange(e.target.value)} disabled={isMapRegistered}>
              <option value="변경 없음">{t('request.no_change')}</option>
              <option value="변경 있음">{t('request.has_change')}</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1.5, visibility: hasEaChange ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.ea_value')} <span className="required">*</span></label>
            <input className={`form-control${errors.ea_value ? ' error' : ''}`} name="ea_value" value={detail.ea_value} onChange={(e) => handleDetailSet('ea_value', sanitizeSignedDecimal(e.target.value))} inputMode="decimal" disabled={isMapRegistered} />
            {errors.ea_value && <span className="form-error">{errors.ea_value}</span>}
          </div>
          <div style={{ flex: 3.5 }} />
        </div>

        {/* X표시 변경 여부 */}
        <div className="form-group full-width" data-tour="map-xmark">
          <label className="form-label">{t('request.mshot_change_status')}<GuideBadge fk="step2_xmark" tk={t('guide.feat.step2_xmark' as never)} /></label>
          <div style={{ width: SELECT_W }}>
            <select className="form-control" name="mshot_change" value={detail.mshot_change} onChange={(e) => handleMshotChangeChange(e.target.value)} disabled={isMapRegistered}>
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
              {/* ONLY 스코프로 죽은 리전의 첨부칸은 회색 잠금으로 남긴다(값도 이미 비워져 있다). */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {(['top', 'bottom'] as const).map((region) => (
                  <div key={region} style={{ flex: 1, minWidth: '280px' }}>
                    <div className="form-label" style={{ marginBottom: '6px' }}>
                      {t(`request.prodc_${region}`)} {!prodcRegionOff(region) && <span className="required">*</span>}
                    </div>
                    <MshotImageUpload
                      fieldName={region === 'top' ? 'mshot_image_copy_top' : 'mshot_image_copy_bottom'}
                      value={region === 'top' ? detail.mshot_image_copy_top : detail.mshot_image_copy_bottom}
                      error={region === 'top' ? errors.mshot_image_copy_top : errors.mshot_image_copy_bottom}
                      disabled={prodcLocked(region)}
                      onPaste={handleImagePaste}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Inter (Map Option 위 별도 항목) — prodc_status 와 동일하게 제목 + YES/NO 드롭다운.
            YES 선택 시 아래로 IN 적용 O/X(in_apply) + Xs/Ys/XYs/없음(inter_select) 필수 선택 그룹 노출.
            NO 로 전환 시 확인 모달 없이 관련 값을 즉시 초기화한다(잘못된 값이 저장되지 않도록). */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group" style={{ width: SELECT_W, flexShrink: 0, marginBottom: 0 }}>
            <label className="form-label">{t('request.map_opt_inter')}</label>
            <select
              className="form-control"
              value={detail.inter}
              disabled={isMapRegistered}
              onChange={(e) => {
                const next = e.target.value;
                handleDetailSet('inter', next);
                if (next === 'NO') {
                  handleDetailSet('inter_xs', '미적용');
                  handleDetailSet('inter_ys', '미적용');
                  handleDetailSet('in_apply', '');
                  handleDetailSet('inter_select', '');
                }
              }}
            >
              <option value="NO">NO</option>
              <option value="YES">YES</option>
            </select>
          </div>
          {detail.inter === 'YES' && (
            <>
              <div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['O', 'X'] as const).map((val) => (
                    <button
                      key={val}
                      type="button"
                      className={`map-type-btn${detail.in_apply === val ? ' active' : ''}`}
                      style={{ padding: '10px 16px' }}
                      disabled={isMapRegistered}
                      onClick={() => handleDetailSet('in_apply', val)}
                    >
                      {t(val === 'O' ? 'request.in_apply_o' : 'request.in_apply_x')}
                    </button>
                  ))}
                </div>
                {errors.in_apply && <span className="form-error">{errors.in_apply}</span>}
              </div>
              <div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['xs', 'ys', 'xys', 'none'] as const).map((val) => {
                    const labelKey = val === 'xs' ? 'map_opt_inter_xs' : val === 'ys' ? 'map_opt_inter_ys' : val === 'xys' ? 'map_opt_inter_xys' : 'map_opt_inter_none';
                    return (
                      <button
                        key={val}
                        type="button"
                        className={`map-type-btn${detail.inter_select === val ? ' active' : ''}`}
                        style={{ padding: '10px 16px' }}
                        disabled={isMapRegistered}
                        onClick={() => handleDetailSet('inter_select', val)}
                      >
                        {t(`request.${labelKey}`)}
                      </button>
                    );
                  })}
                </div>
                {errors.inter_select && <span className="form-error">{errors.inter_select}</span>}
              </div>
            </>
          )}
        </div>

        {/* Map Option 선택 토글 버튼 */}
        {(() => {
          const mapOptions = [
            { label: t('request.map_opt_photo_backside'), name: 'photo_backside' as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
            { label: t('request.map_opt_eds_backside'),   name: 'eds_backside'   as keyof DetailFormState, activeValue: '적용', defaultValue: '미적용' },
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
                      className={`map-type-btn${isActive ? ' active' : ''}`}
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
