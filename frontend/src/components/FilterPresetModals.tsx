// claude 수정 (2026-11-09): 결재 현황 '나만의 필터' — 적용/표시 판정 헬퍼 + 저장·관리 창 (docs/APPROVAL.md 필터 바)
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ConfirmModal } from './Modal';
import { PersonalFilterPreset } from '../types';

/** 1인당 최대 저장 개수 — 백엔드 PersonalFilterPreset.MAX_PER_USER 와 같아야 한다. */
export const FILTER_PRESET_MAX = 10;
/** 이름 최대 길이 — 백엔드 PersonalFilterPreset.NAME_MAX_LENGTH 와 같아야 한다. */
export const FILTER_PRESET_NAME_MAX_LENGTH = 30;

/** 나만의 필터가 저장하는 3종 값(라인·목적·MAP 목적). */
export type PresetValues = Pick<PersonalFilterPreset, 'lines' | 'purposes' | 'map_purposes'>;

/** 필터 바에서 고를 수 있는 선택지. 여기 없는 저장값은 적용·판정 때 무시한다. */
export interface PresetFilterOptions {
  lines: readonly string[];
  purposes: readonly string[];
  mapPurposes: readonly string[];
}

/** 지금 필터 바에 걸린 3종 값. */
export interface PresetFilterState {
  lines: Set<string>;
  purposes: Set<string>;
  mapPurposes: Set<string>;
}

/** 요약 문구에 쓰는 라벨. */
export interface PresetSummaryLabels {
  line: string;
  purpose: string;
  map: string;
  all: string;
  missing: string;
  mapValue: (v: string) => string;
}

/** 저장값 중 지금 선택지에 있는 값만 남긴다(나중에 선택지에서 빠진 값은 적용하지 않는다). */
export const sanitizePresetValues = (preset: PresetValues, options: PresetFilterOptions): PresetValues => ({
  lines: preset.lines.filter((v) => options.lines.includes(v)),
  purposes: preset.purposes.filter((v) => options.purposes.includes(v)),
  map_purposes: preset.map_purposes.filter((v) => options.mapPurposes.includes(v)),
});

const isEmptyValues = (v: PresetValues): boolean =>
  v.lines.length === 0 && v.purposes.length === 0 && v.map_purposes.length === 0;

const sameSet = (set: Set<string>, values: string[]): boolean =>
  set.size === values.length && values.every((v) => set.has(v));

/** 지금 걸린 3종이 이 필터의 (유효한) 저장값과 정확히 같으면 true. 유효값이 하나도 없으면 항상 false. */
export const isPresetActive = (
  preset: PresetValues, options: PresetFilterOptions, current: PresetFilterState,
): boolean => {
  const valid = sanitizePresetValues(preset, options);
  if (isEmptyValues(valid)) return false;
  return sameSet(current.lines, valid.lines)
    && sameSet(current.purposes, valid.purposes)
    && sameSet(current.mapPurposes, valid.map_purposes);
};

/** 3종 중 하나라도 걸려 있으면 true — 저장·덮어쓰기 가능 조건. */
export const hasAnyPresetFilter = (current: PresetFilterState): boolean =>
  current.lines.size > 0 || current.purposes.size > 0 || current.mapPurposes.size > 0;

/** 예: "라인 라인1, 라인2 · 목적 신규 · MAP 목적 전체". 선택지에 없는 값 뒤에는 "(없는 값)"을 붙인다. */
export const buildPresetSummary = (
  preset: PresetValues, options: PresetFilterOptions, labels: PresetSummaryLabels,
): string => {
  const part = (label: string, values: string[], allowed: readonly string[], fmt: (v: string) => string) => {
    if (values.length === 0) return `${label} ${labels.all}`;
    const shown = values.map((v) => (allowed.includes(v) ? fmt(v) : `${fmt(v)} ${labels.missing}`));
    return `${label} ${shown.join(', ')}`;
  };
  const identity = (v: string) => v;
  return [
    part(labels.line, preset.lines, options.lines, identity),
    part(labels.purpose, preset.purposes, options.purposes, identity),
    part(labels.map, preset.map_purposes, options.mapPurposes, labels.mapValue),
  ].join(' · ');
};

type NameError = 'required' | 'duplicate' | null;

const validatePresetName = (name: string, presets: PersonalFilterPreset[], exceptId?: number): NameError => {
  if (!name) return 'required';
  if (presets.some((p) => p.name === name && p.id !== exceptId)) return 'duplicate';
  return null;
};

const NAME_ERROR_KEY = {
  required: 'approval.preset_name_required',
  duplicate: 'approval.preset_name_duplicate',
} as const;

// ===== 저장 창 =====

interface SavePresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  presets: PersonalFilterPreset[];
  /** 지금 걸린 3종 요약(저장될 내용). */
  summary: string;
  /** 저장. 성공하면 true 를 돌려주고 창이 닫힌다(실패 안내는 호출부가 토스트로 한다). */
  onSave: (name: string) => Promise<boolean>;
}

export function SavePresetModal({ isOpen, onClose, presets, summary, onSave }: SavePresetModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<NameError>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) { setName(''); setError(null); setSaving(false); }
  }, [isOpen]);

  const handleSave = async () => {
    const trimmed = name.trim();
    const err = validatePresetName(trimmed, presets);
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      if (await onSave(trimmed)) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('approval.preset_save_title')}
      size="sm"
      hideFullscreen
      footer={(
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{t('common.save')}</button>
        </>
      )}
    >
      <label className="form-label" htmlFor="filter-preset-name">{t('approval.preset_name_label')}</label>
      <input
        id="filter-preset-name"
        type="text"
        className={`form-control${error ? ' error' : ''}`}
        value={name}
        maxLength={FILTER_PRESET_NAME_MAX_LENGTH}
        placeholder={t('approval.preset_name_placeholder')}
        autoFocus
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSave(); }}
      />
      <div className="preset-field-hint">
        {t('approval.preset_name_hint', { maxLength: FILTER_PRESET_NAME_MAX_LENGTH, max: FILTER_PRESET_MAX })}
      </div>
      {error && <div className="preset-field-error">{t(NAME_ERROR_KEY[error])}</div>}
      <div className="preset-summary-box">{summary}</div>
      <div className="preset-field-hint">{t('approval.preset_not_saved_note')}</div>
    </Modal>
  );
}

// ===== 관리 창 =====

interface ManagePresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  presets: PersonalFilterPreset[];
  summaryOf: (preset: PersonalFilterPreset) => string;
  /** 지금 걸린 3종이 하나라도 있어야 덮어쓰기를 허용한다. */
  canOverwrite: boolean;
  onRename: (id: number, name: string) => Promise<boolean>;
  onOverwrite: (id: number) => void;
  onMove: (id: number, direction: -1 | 1) => void;
  onDelete: (id: number) => Promise<void>;
}

export function ManagePresetsModal({
  isOpen, onClose, presets, summaryOf, canOverwrite, onRename, onOverwrite, onMove, onDelete,
}: ManagePresetsModalProps): React.ReactElement {
  const { t } = useTranslation();
  // 입력 중인 이름(id → 값). 칸을 벗어날 때(blur) 검증 후 저장하고 비운다.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, NameError>>({});
  const [deleteTarget, setDeleteTarget] = useState<PersonalFilterPreset | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (isOpen) { setDrafts({}); setErrors({}); setDeleteTarget(null); }
  }, [isOpen]);

  const clearDraft = (id: number) => setDrafts((d) => {
    const next = { ...d };
    delete next[id];
    return next;
  });

  const commitRename = async (preset: PersonalFilterPreset) => {
    const draft = drafts[preset.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    if (trimmed === preset.name) { clearDraft(preset.id); return; }
    const err = validatePresetName(trimmed, presets, preset.id);
    setErrors((e) => ({ ...e, [preset.id]: err }));
    clearDraft(preset.id); // 실패해도 원래 이름으로 되돌린다
    if (err) return;
    try {
      await onRename(preset.id, trimmed);
    } catch {
      // onRename 이 실패를 직접 안내한다(토스트). 여기서는 원래 이름 표시만 유지한다.
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t('approval.preset_manage_title')}
        size="md"
        hideFullscreen
        footer={<button className="btn btn-secondary btn-sm" onClick={onClose}>{t('common.close')}</button>}
      >
        <p className="preset-manage-help">{t('approval.preset_manage_help')}</p>
        {presets.length === 0 ? (
          <div className="preset-empty">{t('approval.preset_empty')}</div>
        ) : (
          presets.map((preset, idx) => (
            <div key={preset.id} className="preset-manage-row">
              <div className="preset-manage-order">
                <button
                  type="button"
                  title={t('approval.preset_move_up')}
                  aria-label={t('approval.preset_move_up')}
                  disabled={idx === 0}
                  onClick={() => onMove(preset.id, -1)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  title={t('approval.preset_move_down')}
                  aria-label={t('approval.preset_move_down')}
                  disabled={idx === presets.length - 1}
                  onClick={() => onMove(preset.id, 1)}
                >
                  ▼
                </button>
              </div>
              <div className="preset-manage-main">
                <input
                  type="text"
                  className={`form-control${errors[preset.id] ? ' error' : ''}`}
                  value={drafts[preset.id] ?? preset.name}
                  maxLength={FILTER_PRESET_NAME_MAX_LENGTH}
                  aria-label={t('approval.preset_name_label')}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDrafts((d) => ({ ...d, [preset.id]: value }));
                    setErrors((er) => ({ ...er, [preset.id]: null }));
                  }}
                  onBlur={() => commitRename(preset)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); }}
                />
                <div className="preset-manage-summary">{summaryOf(preset)}</div>
                {errors[preset.id] && (
                  <div className="preset-field-error">{t(NAME_ERROR_KEY[errors[preset.id] as Exclude<NameError, null>])}</div>
                )}
              </div>
              <div className="preset-manage-btns">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!canOverwrite}
                  title={canOverwrite ? undefined : t('approval.preset_save_hint_empty')}
                  onClick={() => onOverwrite(preset.id)}
                >
                  {t('approval.preset_overwrite')}
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(preset)}>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))
        )}
      </Modal>
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t('approval.preset_delete_title')}
        message={t('approval.preset_delete_confirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        loading={deleting}
        topLevel
      />
    </>
  );
}
