import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { UserRole } from '../../types';
import { DemoControls, useDemoTimeline } from './parts';

// 전체가이드 "권한관리" 단계 전용 데모. /permissions 페이지의 "영상 가이드" 패널은
// PermissionUserGroupDemo를 그대로 쓰고, 이 컴포넌트는 전체가이드에서만 쓰인다.
type Phase =
  | 'first_access'
  | 'open_user'
  | 'search_user'
  | 'select_user'
  | 'add_user'
  | 'group_intro'
  | 'open_group'
  | 'fill_group'
  | 'create_group';

interface Candidate {
  name: string;
  role: UserRole;
}
interface CreatedGroup {
  name: string;
  members: string[];
}

const ROLE_TABS: UserRole[] = ['PL', 'TE_R', 'TE_P', 'MASTER', 'NONE'];
const ACTIVE_ROLE: UserRole = 'PL';
const BASE_COUNT: Record<string, number> = { TE_R: 3, TE_P: 1, MASTER: 1 };

const USERS: Candidate[] = [
  { name: '김철수', role: 'NONE' },
  { name: '이영희', role: 'TE_R' },
  { name: '박민수', role: 'NONE' },
];
// 최초 로그인으로 '권한 없음' 목록에 나타나는 사용자 (순서대로 도착)
const NONE_ARRIVALS = ['김철수', '박민수'];
const ADDED = ['김철수', '박민수'];
const GROUP_NAME = '개발팀';
const MEMBERS = ['정수진', '한지민'];
const FINAL_MEMBERS = ['정수진'];

const MEMBER_INFO: Record<string, { loginid: string; mail: string; dept: string }> = {
  '정수진': { loginid: 'sj_jung', mail: 'sj.jung@company.com', dept: 'PA2' },
  '한지민': { loginid: 'jm_han', mail: 'jm.han@company.com', dept: 'PA3' },
};
const SELF_INFO = { loginid: 'my_pl', mail: 'my.pl@company.com', dept: 'PA1' };

const PermissionTourDemo: React.FC<{ embedded?: boolean; paused?: boolean }> = ({ embedded = false, paused = false }) => {
  const { t } = useTranslation();
  const selfLabel = t('guide.demo.permission_tour.self_member' as never) as string;

  const [showIntro, setShowIntro] = useState(true);
  const [phase, setPhase] = useState<Phase>('first_access');
  const [activeTab, setActiveTab] = useState<UserRole>('NONE');
  const [noneUsers, setNoneUsers] = useState<string[]>([]);
  const [showLoginInfo, setShowLoginInfo] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [resultsShown, setResultsShown] = useState(false);
  const [userSelected, setUserSelected] = useState<string[]>([]);
  const [addedUsers, setAddedUsers] = useState<string[]>([]);
  const [showGroupIntro, setShowGroupIntro] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSelected, setMemberSelected] = useState<string[]>([]);
  const [createdGroup, setCreatedGroup] = useState<CreatedGroup | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const refs = useRef<Record<string, HTMLElement | null>>({});
  const setRef = (key: string) => (el: HTMLElement | null) => { refs.current[key] = el; };

  const roleLabel = (r: UserRole) => t(`permission.role_${r}` as never);

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      const typeInto = async (setter: (v: string) => void, text: string): Promise<boolean> => {
        for (let i = 0; i < text.length; i += 1) {
          if (cancelled()) return false;
          setter(text.slice(0, i + 1));
          await sleep(85);
        }
        return true;
      };
      const pickUser = async (name: string): Promise<boolean> => {
        await moveTo(refs.current[`u_${name}`]);
        await click(refs.current[`u_${name}`]);
        setUserSelected((prev) => [...prev, name]);
        await sleep(320);
        return !cancelled();
      };

      // reset
      setShowIntro(true);
      setPhase('first_access');
      setActiveTab('NONE');
      setNoneUsers([]);
      setShowLoginInfo(false);
      setUserModalOpen(false);
      setUserSearch('');
      setResultsShown(false);
      setUserSelected([]);
      setAddedUsers([]);
      setShowGroupIntro(false);
      setGroupModalOpen(false);
      setGroupName('');
      setMemberSearch('');
      setMemberSelected([]);
      setCreatedGroup(null);
      setActiveGroup(null);
      await sleep(550);

      // ⓪ 인트로 — 이 데모의 핵심 규칙 3가지
      await sleep(5000);
      if (cancelled()) return;
      setShowIntro(false);
      await sleep(400);

      // ① 최초 1회 접속 — 로그인 이벤트로 '권한 없음' 탭에 사용자가 하나씩 나타난다
      setPhase('first_access');
      setShowLoginInfo(true);
      await sleep(900);
      for (const name of NONE_ARRIVALS) {
        if (cancelled()) return;
        setNoneUsers((prev) => [...prev, name]);
        await sleep(900);
      }
      await sleep(1400);
      if (cancelled()) return;
      setShowLoginInfo(false);
      await sleep(400);

      // ② + 사용자 추가 → 모달(제목에 역할) — 대상 탭을 PL로 전환
      setActiveTab(ACTIVE_ROLE);
      setPhase('open_user');
      await sleep(300);
      await moveTo(refs.current.addUserBtn);
      await click(refs.current.addUserBtn);
      setUserModalOpen(true);
      await sleep(650);

      // ③ 검색
      setPhase('search_user');
      await moveTo(refs.current.userSearch);
      await click(refs.current.userSearch);
      if (!(await typeInto(setUserSearch, '사용자'))) return;
      setResultsShown(true);
      await sleep(450);

      // ④ 여러 명 선택 + ✕ 제거
      setPhase('select_user');
      if (!(await pickUser('김철수'))) return;
      if (!(await pickUser('이영희'))) return;
      await moveTo(refs.current['ux_이영희']);
      await click(refs.current['ux_이영희']);
      setUserSelected((prev) => prev.filter((n) => n !== '이영희'));
      await sleep(350);
      if (!(await pickUser('박민수'))) return;
      await sleep(300);

      // ⑤ 추가 → PL 탭에 역할 배정, '권한 없음' 목록에서는 제외(실제 role 변경과 동일)
      setPhase('add_user');
      await moveTo(refs.current.addUserConfirm);
      await click(refs.current.addUserConfirm);
      setAddedUsers(ADDED);
      setNoneUsers((prev) => prev.filter((n) => !ADDED.includes(n)));
      setUserModalOpen(false);
      await sleep(850);

      // ⑥ 그룹 만들기 — 클릭 전에 기능 설명 먼저
      setPhase('group_intro');
      await moveTo(refs.current.createGroupBtn);
      setShowGroupIntro(true);
      await sleep(2300);
      if (cancelled()) return;

      // ⑦ + 그룹 만들기 → 모달
      setPhase('open_group');
      await click(refs.current.createGroupBtn);
      setShowGroupIntro(false);
      setGroupModalOpen(true);
      await sleep(650);

      // ⑧ 그룹명 + 멤버 다중 선택(칩/✕)
      setPhase('fill_group');
      await moveTo(refs.current.groupName);
      await click(refs.current.groupName);
      if (!(await typeInto(setGroupName, GROUP_NAME))) return;
      await sleep(250);
      await moveTo(refs.current.memberSearch);
      await click(refs.current.memberSearch);
      if (!(await typeInto(setMemberSearch, '멤버'))) return;
      await sleep(350);
      for (const m of MEMBERS) {
        if (cancelled()) return;
        await moveTo(refs.current[`m_${m}`]);
        await click(refs.current[`m_${m}`]);
        setMemberSelected((prev) => [...prev, m]);
        await sleep(300);
      }
      await moveTo(refs.current['mx_한지민']);
      await click(refs.current['mx_한지민']);
      setMemberSelected((prev) => prev.filter((n) => n !== '한지민'));
      await sleep(400);

      // ⑨ 만들기 → 그룹 탭 생성 + 이동(생성자 본인 자동 포함)
      setPhase('create_group');
      await moveTo(refs.current.createGroupConfirm);
      await click(refs.current.createGroupConfirm);
      setCreatedGroup({ name: GROUP_NAME, members: [selfLabel, ...FINAL_MEMBERS] });
      setGroupModalOpen(false);
      await sleep(400);
      setActiveGroup(GROUP_NAME);
      await sleep(1400);
    },
    4000,
    paused
  );

  const pk = (k: string) => `guide.demo.permission_tour.${k}` as never;

  const chip = (name: string, refKey: string) => (
    <span key={name} className="guide-demo-kwchip">
      {name}
      <span ref={setRef(refKey)} className="chip-x">✕</span>
    </span>
  );

  const roleCount = (r: UserRole): number => {
    if (r === 'NONE') return noneUsers.length;
    return r === ACTIVE_ROLE ? addedUsers.length : BASE_COUNT[r] ?? 0;
  };
  const onNoneTab = activeGroup === null && activeTab === 'NONE';
  const listRows = activeGroup ? (createdGroup?.members ?? []) : onNoneTab ? noneUsers : addedUsers;
  const listLabel = activeGroup
    ? `${activeGroup} · ${t('group.members_label')}`
    : `${roleLabel(onNoneTab ? 'NONE' : ACTIVE_ROLE)} · ${t(pk('user_list_title'))}`;

  return (
    <div>
      {!embedded && <p className="guide-demo-lead">{t('guide.demo.permission_tour.lead')}</p>}

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 470 }}>
        {/* ⓪ 인트로 — 데모 시작 전 핵심 규칙 3가지를 먼저 설명 */}
        <AnimatePresence>
          {showIntro && (
            <motion.div
              className="guide-demo-intro"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="guide-demo-intro-title">{t(pk('intro_title'))}</div>
              <ul className="guide-demo-intro-list">
                <li>{t(pk('intro_b1'))}</li>
                <li>{t(pk('intro_b2'))}</li>
                <li>{t(pk('intro_b3'))}</li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(pk(`phase_${phase}`))}
        </div>

        {/* 상단 툴바 — 실제 페이지 헤더와 동일하게 "+ 사용자 추가"만 최상단에 둔다 */}
        <div className="guide-demo-toolbar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="guide-demo-btn primary sm" ref={setRef('addUserBtn') as React.Ref<HTMLButtonElement>}>
            + {t('permission.add_user')}
          </button>
        </div>

        {/* 탭 (역할 + 그룹) — 실제 페이지처럼 '권한 없음' 탭도 맨 끝에 둔다 */}
        <div className="guide-demo-tabs">
          {ROLE_TABS.map((r) => (
            <button key={r} type="button" className={`guide-demo-tab${activeGroup === null && activeTab === r ? ' on' : ''}`}>
              {roleLabel(r)}<span className="cnt">{roleCount(r)}</span>
            </button>
          ))}
          {createdGroup && (
            <motion.button
              type="button"
              className={`guide-demo-tab${activeGroup === createdGroup.name ? ' on' : ''}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              👥 {createdGroup.name}<span className="cnt">{createdGroup.members.length}</span>
            </motion.button>
          )}
        </div>

        {/* 콘텐츠 패널 헤더 — 그룹 탭이면 그룹 관리 버튼, PL 탭이면 그룹 만들기 버튼, 권한없음 탭이면 없음 */}
        <div className="guide-demo-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
          <span>{listLabel}</span>
          {activeGroup ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="guide-demo-btn secondary sm">{t('group.rename')}</button>
              <button type="button" className="guide-demo-btn danger sm">{t('group.delete')}</button>
              <button type="button" className="guide-demo-btn primary sm">+ {t('group.add_member')}</button>
            </div>
          ) : !onNoneTab ? (
            <button type="button" className="guide-demo-btn secondary sm" ref={setRef('createGroupBtn') as React.Ref<HTMLButtonElement>}>
              + {t('group.create')}
            </button>
          ) : null}

          {/* 최초 접속 설명(권한없음 탭) */}
          <AnimatePresence>
            {showLoginInfo && (
              <motion.div
                className="guide-demo-feature-info"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                <div className="fi-title">🔓 {t(pk('first_access_info_title'))}</div>
                <div className="fi-desc">{t(pk('first_access_info_desc'))}</div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 그룹 기능 설명 (클릭 전) */}
          <AnimatePresence>
            {showGroupIntro && (
              <motion.div
                className="guide-demo-feature-info"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                <div className="fi-title">📨 {t(pk('group_intro_title'))}</div>
                <div className="fi-desc">{t(pk('group_intro_desc'))}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 목록 (권한없음 사용자 / 역할 사용자 / 그룹 멤버) */}
        <table className="guide-demo-table sm">
          {activeGroup && (
            <thead>
              <tr>
                <th>{t('permission.field_loginid')}</th>
                <th>{t('permission.field_name')}</th>
                <th>{t('permission.field_email')}</th>
                <th>{t('permission.field_department')}</th>
                <th></th>
              </tr>
            </thead>
          )}
          <tbody>
            {listRows.length === 0 ? (
              <tr><td className="muted">{onNoneTab ? t(pk('first_access_empty')) : t(pk('no_users'))}</td></tr>
            ) : activeGroup ? (
              <AnimatePresence>
                {listRows.map((u) => {
                  const isSelf = u === selfLabel;
                  const info = isSelf ? SELF_INFO : (MEMBER_INFO[u] ?? { loginid: '-', mail: '-', dept: '-' });
                  return (
                    <motion.tr key={u} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                      <td>{info.loginid}</td>
                      <td>👤 {u}</td>
                      <td>{info.mail}</td>
                      <td>{info.dept}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="guide-demo-btn danger sm">
                          {isSelf ? t('group.leave_group') : t('group.remove_member')}
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            ) : (
              <AnimatePresence>
                {listRows.map((u) => (
                  <motion.tr key={u} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                    <td>
                      👤 {u}
                      {onNoneTab && <span className="role"> ({roleLabel('NONE')})</span>}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </tbody>
        </table>

        {/* 사용자 추가 모달 */}
        <AnimatePresence>
          {userModalOpen && (
            <motion.div className="guide-demo-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div className="guide-demo-modal" initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }}>
                <div className="guide-demo-modal-title">{t('permission.add_user')} — {roleLabel(ACTIVE_ROLE)}</div>
                <div className="guide-demo-kwbox single" ref={setRef('userSearch')}>
                  {userSearch ? <span className="val">{userSearch}</span> : <span className="ph">{t('permission.select_user_placeholder')}</span>}
                </div>
                <AnimatePresence>
                  {resultsShown && (
                    <motion.div className="guide-demo-userlist" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      {USERS.filter((u) => !userSelected.includes(u.name)).map((u) => (
                        <div key={u.name} ref={setRef(`u_${u.name}`)} className="guide-demo-userrow">
                          👤 {u.name} <span className="role">({roleLabel(u.role)})</span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                {userSelected.length > 0 && (
                  <div className="guide-demo-kwchips" style={{ marginTop: 8 }}>
                    <AnimatePresence>
                      {userSelected.map((n) => chip(n, `ux_${n}`))}
                    </AnimatePresence>
                  </div>
                )}
                <div className="guide-demo-modal-footer">
                  <span className="guide-demo-btn ghost sm">{t('common.cancel')}</span>
                  <button type="button" className="guide-demo-btn primary sm" ref={setRef('addUserConfirm') as React.Ref<HTMLButtonElement>}>
                    {t('permission.add_user')} ({userSelected.length})
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 그룹 만들기 모달 */}
        <AnimatePresence>
          {groupModalOpen && (
            <motion.div className="guide-demo-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div className="guide-demo-modal" initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }}>
                <div className="guide-demo-modal-title">{t('group.create_modal_title')}</div>

                <div className="guide-demo-modal-field">
                  <span className="lbl">{t('group.create_placeholder')} <span style={{ color: '#ef4444' }}>*</span></span>
                  <div className="guide-demo-kwbox single name" ref={setRef('groupName')}>
                    {groupName ? <span className="val">{groupName}</span> : <span className="ph">{t('group.create_placeholder')}</span>}
                  </div>
                </div>

                <div className="guide-demo-modal-field">
                  <span className="lbl">{t('group.add_member')}</span>
                  <div className="guide-demo-kwbox single" ref={setRef('memberSearch')}>
                    {memberSearch ? <span className="val">{memberSearch}</span> : <span className="ph">{t('group.add_member_placeholder')}</span>}
                  </div>
                  <AnimatePresence>
                    {memberSearch && (
                      <motion.div className="guide-demo-userlist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {MEMBERS.filter((m) => !memberSelected.includes(m)).map((m) => (
                          <div key={m} ref={setRef(`m_${m}`)} className="guide-demo-userrow">👤 {m}</div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {memberSelected.length > 0 && (
                    <div className="guide-demo-kwchips">
                      <AnimatePresence>
                        {memberSelected.map((m) => chip(m, `mx_${m}`))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                <div className="guide-demo-modal-footer">
                  <span className="guide-demo-btn ghost sm">{t('common.cancel')}</span>
                  <button type="button" className="guide-demo-btn primary sm" ref={setRef('createGroupConfirm') as React.Ref<HTMLButtonElement>}>
                    {t('group.create')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {cursorLayer}
      </div>

      {!embedded && <div className="guide-demo-callout">{t('guide.demo.permission_tour.callout')}</div>}

      {!embedded && <DemoControls done={done} onReplay={replay} />}
    </div>
  );
};

export default PermissionTourDemo;
