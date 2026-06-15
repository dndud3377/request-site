import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { UserRole } from '../../types';
import { DemoControls, useDemoTimeline } from './parts';

type Phase =
  | 'open_user'
  | 'search_user'
  | 'select_user'
  | 'add_user'
  | 'open_group'
  | 'fill_group'
  | 'create_group';

interface Candidate {
  name: string;
  role: UserRole;
}

const ROLE_TABS: UserRole[] = ['PL', 'TE_R', 'TE_P', 'MASTER'];
const ACTIVE_ROLE: UserRole = 'PL';

const USERS: Candidate[] = [
  { name: '김철수', role: 'NONE' },
  { name: '이영희', role: 'TE_R' },
  { name: '박민수', role: 'NONE' },
];
const GROUP_NAME = '개발팀';
const MEMBERS = ['정수진', '한지민'];

const PermissionUserGroupDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('open_user');
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [resultsShown, setResultsShown] = useState(false);
  const [userSelected, setUserSelected] = useState<string[]>([]);
  const [addedUsers, setAddedUsers] = useState<string[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSelected, setMemberSelected] = useState<string[]>([]);
  const [createdGroups, setCreatedGroups] = useState<string[]>([]);

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
      setPhase('open_user');
      setUserModalOpen(false);
      setUserSearch('');
      setResultsShown(false);
      setUserSelected([]);
      setAddedUsers([]);
      setGroupModalOpen(false);
      setGroupName('');
      setMemberSearch('');
      setMemberSelected([]);
      setCreatedGroups([]);
      await sleep(550);

      // ① + 사용자 추가 → 모달(제목에 역할)
      await moveTo(refs.current.addUserBtn);
      await click(refs.current.addUserBtn);
      setUserModalOpen(true);
      await sleep(650);

      // ② 검색 → 후보(현재 역할 표시)
      setPhase('search_user');
      await moveTo(refs.current.userSearch);
      await click(refs.current.userSearch);
      if (!(await typeInto(setUserSearch, '사용자'))) return;
      setResultsShown(true);
      await sleep(450);

      // ③ 여러 명 선택 + ✕ 제거 후 재선택
      setPhase('select_user');
      if (!(await pickUser('김철수'))) return;
      if (!(await pickUser('이영희'))) return;
      await moveTo(refs.current['ux_이영희']);
      await click(refs.current['ux_이영희']);
      setUserSelected((prev) => prev.filter((n) => n !== '이영희'));
      await sleep(350);
      if (!(await pickUser('박민수'))) return;
      await sleep(300);

      // ④ 추가 → 현재 역할 목록 반영
      setPhase('add_user');
      await moveTo(refs.current.addUserConfirm);
      await click(refs.current.addUserConfirm);
      setAddedUsers(['김철수', '박민수']);
      setUserModalOpen(false);
      await sleep(850);

      // ⑤ + 그룹 만들기
      setPhase('open_group');
      await moveTo(refs.current.createGroupBtn);
      await click(refs.current.createGroupBtn);
      setGroupModalOpen(true);
      await sleep(650);

      // ⑥ 그룹명 + 멤버 다중 선택(칩/✕)
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

      // ⑦ 만들기 → 그룹 생성
      setPhase('create_group');
      await moveTo(refs.current.createGroupConfirm);
      await click(refs.current.createGroupConfirm);
      setCreatedGroups([GROUP_NAME]);
      setGroupModalOpen(false);
      await sleep(900);
    }
  );

  const pk = (k: string) => `guide.demo.permission_user_group.${k}` as never;

  const chip = (name: string, refKey: string) => (
    <span key={name} className="guide-demo-kwchip">
      {name}
      <span ref={setRef(refKey)} className="chip-x">✕</span>
    </span>
  );

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.permission_user_group.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 460 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(pk(`phase_${phase}`))}
        </div>

        {/* 역할 탭 */}
        <div className="guide-demo-tabs">
          {ROLE_TABS.map((r) => (
            <button key={r} type="button" className={`guide-demo-tab${r === ACTIVE_ROLE ? ' on' : ''}`}>
              {roleLabel(r)}
            </button>
          ))}
        </div>

        {/* 툴바 */}
        <div className="guide-demo-toolbar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="guide-demo-btn primary sm" ref={setRef('addUserBtn') as React.Ref<HTMLButtonElement>}>
            + {t('permission.add_user')}
          </button>
          <button type="button" className="guide-demo-btn secondary sm" ref={setRef('createGroupBtn') as React.Ref<HTMLButtonElement>}>
            + {t('group.create')}
          </button>
        </div>

        {/* 사용자 목록 (현재 역할) */}
        <div className="guide-demo-section-label">{roleLabel(ACTIVE_ROLE)} · {t(pk('user_list_title'))}</div>
        <table className="guide-demo-table sm">
          <tbody>
            {addedUsers.length === 0 ? (
              <tr><td className="muted">{t(pk('no_users'))}</td></tr>
            ) : (
              <AnimatePresence>
                {addedUsers.map((u) => (
                  <motion.tr key={u} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                    <td>👤 {u}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </tbody>
        </table>

        {/* 그룹 영역 */}
        <div className="guide-demo-section-label" style={{ marginTop: 12 }}>{t(pk('group_title'))}</div>
        <div className="guide-demo-pill-row">
          {createdGroups.length === 0 ? (
            <span className="guide-demo-saved-empty">{t(pk('no_groups'))}</span>
          ) : (
            <AnimatePresence>
              {createdGroups.map((g) => (
                <motion.span key={g} className="guide-demo-savedchip" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
                  👥 {g}
                </motion.span>
              ))}
            </AnimatePresence>
          )}
        </div>

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
                  <span className="lbl">{t('group.add_member')} <span className="guide-demo-cond-badge">{t(pk('same_role_note'))}</span></span>
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

      <div className="guide-demo-callout">{t('guide.demo.permission_user_group.callout')}</div>

      <DemoControls done={done} onReplay={replay} />
    </div>
  );
};

export default PermissionUserGroupDemo;
