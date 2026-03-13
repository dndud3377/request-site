import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { agentRouteAPI } from '../api/client';
import { useToast } from '../components/Toast';
import { AgentMember, AgentType } from '../types';

// ===== Team Node Component =====

interface TeamNodeProps {
  team: AgentType;
  label: string;
  members: AgentMember[];
  onAdd: (team: AgentType, name: string) => void;
  onDelete: (id: string) => void;
  addLabel: string;
  addConfirm: string;
  addCancel: string;
  addPlaceholder: string;
}

function TeamNode({
  team,
  label,
  members,
  onAdd,
  onDelete,
  addLabel,
  addConfirm,
  addCancel,
  addPlaceholder,
}: TeamNodeProps): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpenAdd = () => {
    setAdding(true);
    setName('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(team, trimmed);
    setAdding(false);
    setName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') { setAdding(false); setName(''); }
  };

  return (
    <div className={`route-node route-node-${team.toLowerCase()}`}>
      <div className="route-node-header">
        <span className="route-node-title">AGENT {team}</span>
        <span className="route-node-label">{label}</span>
      </div>
      <div className="route-member-list">
        {members.map((m) => (
          <span key={m.id} className="member-chip">
            {m.name}
            <button
              className="member-chip-delete"
              onClick={() => onDelete(m.id)}
              title="삭제"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {adding ? (
        <div className="route-add-row">
          <input
            ref={inputRef}
            className="route-add-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={addPlaceholder}
          />
          <button className="btn btn-primary btn-sm" onClick={handleConfirm}>
            {addConfirm}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setAdding(false); setName(''); }}
          >
            {addCancel}
          </button>
        </div>
      ) : (
        <button className="route-add-btn" onClick={handleOpenAdd}>
          {addLabel}
        </button>
      )}
    </div>
  );
}

// ===== Main Page =====

export default function ApprovalRoutePage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const [members, setMembers] = useState<AgentMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentRouteAPI
      .getMembers()
      .then((r) => setMembers(r.data))
      .catch(() => addToast('데이터를 불러오지 못했습니다.', 'error'))
      .finally(() => setLoading(false));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const teamMembers = (team: AgentType) =>
    members.filter((m) => m.team === team);

  const handleAdd = async (team: AgentType, name: string) => {
    try {
      const res = await agentRouteAPI.addMember(team, name);
      setMembers((prev) => [...prev, res.data]);
      addToast(`${name} 추가되었습니다.`, 'success');
    } catch {
      addToast('추가 중 오류가 발생했습니다.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    const target = members.find((m) => m.id === id);
    try {
      await agentRouteAPI.deleteMember(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
      if (target) addToast(`${target.name} 삭제되었습니다.`, 'success');
    } catch {
      addToast('삭제 중 오류가 발생했습니다.', 'error');
    }
  };

  const nodeProps = {
    onAdd: handleAdd,
    onDelete: handleDelete,
    addLabel: t('approval_route.add_member'),
    addConfirm: t('approval_route.add_confirm'),
    addCancel: t('approval_route.add_cancel'),
    addPlaceholder: t('approval_route.add_placeholder'),
  };

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('approval_route.title')}</h1>
        <p>{t('approval_route.subtitle')}</p>
      </div>

      {loading ? (
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      ) : (
        <div className="route-flow">
          {/* 상신됨 */}
          <div className="route-start-node">
            <span>📤 {t('approval_route.start')}</span>
          </div>

          <div className="route-connector" />

          {/* AGENT R */}
          <TeamNode
            team="R"
            label={t('approval_route.team_r_label')}
            members={teamMembers('R')}
            {...nodeProps}
          />

          <div className="route-connector" />

          {/* AGENT J + O 병렬 */}
          <div className="route-parallel-wrapper">
            <div className="route-parallel-label">{t('approval_route.parallel_label')}</div>
            <div className="route-parallel-group">
              <TeamNode
                team="J"
                label={t('approval_route.team_j_label')}
                members={teamMembers('J')}
                {...nodeProps}
              />
              <TeamNode
                team="O"
                label={t('approval_route.team_o_label')}
                members={teamMembers('O')}
                {...nodeProps}
              />
            </div>
          </div>

          <div className="route-connector" />

          {/* AGENT E */}
          <div className="route-e-wrapper">
            <div className="route-condition-label">
              <span className="route-condition-badge">조건</span>
              {t('approval_route.sugar_condition')}
            </div>
            <TeamNode
              team="E"
              label={t('approval_route.team_e_label')}
              members={teamMembers('E')}
              {...nodeProps}
            />
          </div>

          <div className="route-connector" />

          {/* 결재완료 */}
          <div className="route-final-node">
            <span>✅ {t('approval_route.final')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
