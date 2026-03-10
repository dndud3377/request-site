import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import { useToast } from '../components/Toast';
import { ConfirmModal } from '../components/Modal';

const INITIAL = {
  title: '',
  requester_name: '',
  requester_email: '',
  requester_department: '',
  requester_position: '',
  product_name: '',
  product_name_en: '',
  product_type: 'new',
  product_version: '',
  product_description: '',
  product_description_en: '',
  map_type: 'intro',
  target_audience: '',
  key_features: '',
  key_features_en: '',
  changes_from_previous: '',
  reference_materials: '',
  deadline: '',
  priority: 'medium',
  additional_notes: '',
};

const REQUIRED_FIELDS = [
  'title', 'requester_name', 'requester_email', 'requester_department',
  'product_name', 'product_type', 'product_description',
  'map_type', 'target_audience', 'key_features',
];

export default function RequestPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToast();

  const [form, setForm] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedId, setSavedId] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors = {};
    REQUIRED_FIELDS.forEach((field) => {
      if (!form[field]?.trim()) {
        newErrors[field] = t('request.required');
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      let res;
      if (savedId) {
        res = await documentsAPI.update(savedId, form);
      } else {
        res = await documentsAPI.create(form);
        setSavedId(res.data.id);
      }
      addToast(t('request.save_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitClick = () => {
    if (!validate()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let docId = savedId;
      if (!docId) {
        const res = await documentsAPI.create(form);
        docId = res.data.id;
        setSavedId(docId);
      } else {
        await documentsAPI.update(docId, form);
      }
      const submitRes = await documentsAPI.submit(docId);
      addToast(t('request.submit_success'), 'success');
      if (submitRes.data.email_sent) {
        setTimeout(() => addToast(t('request.submit_email_sent'), 'info'), 800);
      }
      setTimeout(() => navigate('/approval'), 1500);
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const F = ({ label, name, required, children }) => (
    <div className="form-group">
      <label className="form-label">
        {label}{required && <span className="required">*</span>}
      </label>
      {children}
      {errors[name] && <span className="form-error">{errors[name]}</span>}
    </div>
  );

  const productTypes = [
    { value: 'new', label: t('request.product_type_new') },
    { value: 'update', label: t('request.product_type_update') },
    { value: 'add_feature', label: t('request.product_type_add_feature') },
    { value: 'change', label: t('request.product_type_change') },
  ];

  const mapTypes = [
    { value: 'intro', label: t('request.map_type_intro') },
    { value: 'feature', label: t('request.map_type_feature') },
    { value: 'comparison', label: t('request.map_type_comparison') },
    { value: 'roadmap', label: t('request.map_type_roadmap') },
  ];

  const priorities = [
    { value: 'low', label: t('request.priority_low') },
    { value: 'medium', label: t('request.priority_medium') },
    { value: 'high', label: t('request.priority_high') },
    { value: 'urgent', label: t('request.priority_urgent') },
  ];

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('request.title')}</h1>
        <p>{t('request.subtitle')}</p>
      </div>

      {/* Requester */}
      <div className="form-section">
        <div className="form-section-title">👤 {t('request.section_requester')}</div>
        <div className="form-grid">
          <F label={t('request.name')} name="requester_name" required>
            <input
              className={`form-control ${errors.requester_name ? 'error' : ''}`}
              name="requester_name"
              value={form.requester_name}
              onChange={handleChange}
              placeholder={t('request.placeholder_name')}
            />
          </F>
          <F label={t('request.email')} name="requester_email" required>
            <input
              type="email"
              className={`form-control ${errors.requester_email ? 'error' : ''}`}
              name="requester_email"
              value={form.requester_email}
              onChange={handleChange}
              placeholder={t('request.placeholder_email')}
            />
          </F>
          <F label={t('request.department')} name="requester_department" required>
            <input
              className={`form-control ${errors.requester_department ? 'error' : ''}`}
              name="requester_department"
              value={form.requester_department}
              onChange={handleChange}
              placeholder={t('request.placeholder_department')}
            />
          </F>
          <F label={t('request.position')} name="requester_position">
            <input
              className="form-control"
              name="requester_position"
              value={form.requester_position}
              onChange={handleChange}
              placeholder={t('request.placeholder_position')}
            />
          </F>
        </div>
      </div>

      {/* Product Info */}
      <div className="form-section">
        <div className="form-section-title">📦 {t('request.section_product')}</div>

        <div className="form-group" style={{ marginBottom: 20 }}>
          <label className="form-label">
            {t('request.title')} <span className="required">*</span>
          </label>
          <input
            className={`form-control ${errors.title ? 'error' : ''}`}
            name="title"
            value={form.title}
            onChange={handleChange}
            placeholder="의뢰서 제목을 입력하세요"
          />
          {errors.title && <span className="form-error">{errors.title}</span>}
        </div>

        <div className="form-grid">
          <F label={t('request.product_name')} name="product_name" required>
            <input
              className={`form-control ${errors.product_name ? 'error' : ''}`}
              name="product_name"
              value={form.product_name}
              onChange={handleChange}
              placeholder={t('request.placeholder_product_name')}
            />
          </F>
          <F label={t('request.product_name_en')} name="product_name_en">
            <input
              className="form-control"
              name="product_name_en"
              value={form.product_name_en}
              onChange={handleChange}
            />
          </F>
          <F label={t('request.product_type')} name="product_type" required>
            <select
              className="form-control"
              name="product_type"
              value={form.product_type}
              onChange={handleChange}
            >
              {productTypes.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </F>
          <F label={t('request.product_version')} name="product_version">
            <input
              className="form-control"
              name="product_version"
              value={form.product_version}
              onChange={handleChange}
              placeholder="v1.0.0"
            />
          </F>
          <div className="form-group full-width">
            <label className="form-label">
              {t('request.product_description')} <span className="required">*</span>
            </label>
            <textarea
              className={`form-control ${errors.product_description ? 'error' : ''}`}
              name="product_description"
              value={form.product_description}
              onChange={handleChange}
              placeholder={t('request.placeholder_product_description')}
              rows={4}
            />
            {errors.product_description && <span className="form-error">{errors.product_description}</span>}
          </div>
          <div className="form-group full-width">
            <label className="form-label">{t('request.product_description_en')}</label>
            <textarea
              className="form-control"
              name="product_description_en"
              value={form.product_description_en}
              onChange={handleChange}
              rows={3}
            />
          </div>
        </div>
      </div>

      {/* Detail */}
      <div className="form-section">
        <div className="form-section-title">📋 {t('request.section_detail')}</div>
        <div className="form-grid">
          <F label={t('request.map_type')} name="map_type" required>
            <select
              className="form-control"
              name="map_type"
              value={form.map_type}
              onChange={handleChange}
            >
              {mapTypes.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </F>
          <F label={t('request.priority')} name="priority">
            <select
              className="form-control"
              name="priority"
              value={form.priority}
              onChange={handleChange}
            >
              {priorities.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </F>
          <F label={t('request.deadline')} name="deadline">
            <input
              type="date"
              className="form-control"
              name="deadline"
              value={form.deadline}
              onChange={handleChange}
            />
          </F>
          <div className="form-group full-width">
            <label className="form-label">
              {t('request.target_audience')} <span className="required">*</span>
            </label>
            <textarea
              className={`form-control ${errors.target_audience ? 'error' : ''}`}
              name="target_audience"
              value={form.target_audience}
              onChange={handleChange}
              rows={3}
            />
            {errors.target_audience && <span className="form-error">{errors.target_audience}</span>}
          </div>
          <div className="form-group full-width">
            <label className="form-label">
              {t('request.key_features')} <span className="required">*</span>
            </label>
            <textarea
              className={`form-control ${errors.key_features ? 'error' : ''}`}
              name="key_features"
              value={form.key_features}
              onChange={handleChange}
              placeholder={t('request.placeholder_key_features')}
              rows={4}
            />
            {errors.key_features && <span className="form-error">{errors.key_features}</span>}
          </div>
          <div className="form-group full-width">
            <label className="form-label">{t('request.key_features_en')}</label>
            <textarea
              className="form-control"
              name="key_features_en"
              value={form.key_features_en}
              onChange={handleChange}
              rows={3}
            />
          </div>
          <div className="form-group full-width">
            <label className="form-label">{t('request.changes_from_previous')}</label>
            <textarea
              className="form-control"
              name="changes_from_previous"
              value={form.changes_from_previous}
              onChange={handleChange}
              rows={3}
            />
          </div>
          <div className="form-group full-width">
            <label className="form-label">{t('request.reference_materials')}</label>
            <textarea
              className="form-control"
              name="reference_materials"
              value={form.reference_materials}
              onChange={handleChange}
              rows={2}
            />
          </div>
          <div className="form-group full-width">
            <label className="form-label">{t('request.additional_notes')}</label>
            <textarea
              className="form-control"
              name="additional_notes"
              value={form.additional_notes}
              onChange={handleChange}
              placeholder={t('request.placeholder_additional_notes')}
              rows={3}
            />
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button
          className="btn btn-secondary"
          onClick={handleSaveDraft}
          disabled={saving}
        >
          💾 {saving ? t('common.loading') : t('request.save_draft')}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSubmitClick}
          disabled={submitting}
        >
          📤 {submitting ? t('common.loading') : t('request.submit')}
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleSubmit}
        title={t('request.submit')}
        message={t('request.submit_confirm')}
        confirmLabel={t('request.submit')}
      />
    </div>
  );
}
