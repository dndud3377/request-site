import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DemoControls, useDemoTimeline } from './parts';

type Phase =
  | 'open_user'
  | 'search_user'
  | 'add_user'
  | 'open_group'
  | 'fill_group'
  | 'create_group';

const USERS = ['김철수', '이영희', '박민수'];
const ADD_USERS = ['김철수', '이영희'];
const GROUP_NAME = '개발팀';
const GROUP_MEMBER = '박민수';

const PermissionUserGroupDemo: React.FC = () => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('open_user');
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [resultsShown, setResultsShown] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [addedUsers, setAddedUsers] = useState<string[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [createdGroups, setCreatedGroups] = useState<string[]>([]);

  const refs = useRef<Record<string, HTMLElement | null>>({});
  const setRef = (key: string) => (el: HTMLElement | null) => { refs.current[key] = el; };

  const { stageRef, cursorLayer, done, replay } = useDemoTimeline(
    async ({ moveTo, click, sleep, cancelled }) => {
      const typeInto = async (setter: (v: string) => void, text: string): Promise<boolean> => {
        for (let i = 0; i < text.length; i += 1) {
          if (cancelled()) return false;
          setter(text.slice(0, i + 1));
          await sleep(90);
        }
        return true;
      };

      // reset
      setPhase('open_user');
      setUserModalOpen(false);
      setUserSearch('');
      setResultsShown(false);
      setSelectedUsers(new Set());
      setAddedUsers([]);
      setGroupModalOpen(false);
      setGroupName('');
      setMemberSearch('');
      setGroupMembers([]);
      setCreatedGroups([]);
      await sleep(550);

      // ① + 사용자 추가 → 모달 열기
      await moveTo(refs.current.addUserBtn);
      await click(refs.current.addUserBtn);
      setUserModalOpen(true);
      await sleep(650);

      // ② 검색 → 사용자 선택
      setPhase('search_user');
      await moveTo(refs.current.userSearch);
      await click(refs.current.userSearch);
      if (!(await typeInto(setUserSearch, '사용자'))) return;
      setResultsShown(true);
      await sleep(450);
      for (const u of ADD_USERS) {
        if (cancelled()) return;
        await moveTo(refs.current[`u_${u}`]);
        await click(refs.current[`u_${u}`]);
        setSelectedUsers((prev) => new Set(prev).add(u));
        await sleep(300);
      }
      await sleep(300);

      // ③ 추가 → 역할 목록에 반영
      setPhase('add_user');
      await moveTo(refs.current.addUserConfirm);
      await click(refs.current.addUserConfirm);
      setAddedUsers([...ADD_USERS]);
      setUserModalOpen(false);
      setUserSearch('');
      setResultsShown(false);
      setSelectedUsers(new Set());
      await sleep(800);

      // ④ + 그룹 만들기 → 모달 열기
      setPhase('open_group');
      await moveTo(refs.current.createGroupBtn);
      await click(refs.current.createGroupBtn);
      setGroupModalOpen(true);
      await sleep(650);

      // ⑤ 그룹명 + 멤버 입력
      setPhase('fill_group');
      await moveTo(refs.current.groupName);
      await click(refs.current.groupName);
      if (!(await typeInto(setGroupName, GROUP_NAME))) return;
      await sleep(250);
      await moveTo(refs.current.memberSearch);
      await click(refs.current.memberSearch);
      if (!(await typeInto(setMemberSearch, GROUP_MEMBER))) return;
      await sleep(300);
      await moveTo(refs.current.memberResult);
      await click(refs.current.memberResult);
      setGroupMembers([GROUP_MEMBER]);
      setMemberSearch('');
      await sleep(450);

      // ⑥ 만들기 → 그룹 생성
      setPhase('create_group');
      await moveTo(refs.current.createGroupConfirm);
      await click(refs.current.createGroupConfirm);
      setCreatedGroups([GROUP_NAME]);
      setGroupModalOpen(false);
      await sleep(900);
    }
  );

  const pk = (k: string) => `guide.demo.permission_user_group.${k}` as never;

  return (
    <div>
      <p className="guide-demo-lead">{t('guide.demo.permission_user_group.lead')}</p>

      <div className="guide-demo-stage" ref={stageRef} style={{ minHeight: 440 }}>
        <div className="guide-demo-phase">
          <span className="guide-demo-phase-dot" />
          {t(pk(`phase_${phase}`))}
        </div>

        {/* 미니 툴바 */}
        <div className="guide-demo-toolbar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="guide-demo-btn primary sm" ref={setRef('addUserBtn') as React.Ref<HTMLButtonElement>}>
            + {t('permission.add_user')}
          </button>
          <button type="button" className="guide-demo-btn secondary sm" ref={setRef('createGroupBtn') as React.Ref<HTMLButtonElement>}>
            + {t('group.create')}
          </button>
        </div>

        {/* 사용자 목록 */}
        <div className="guide-demo-section-label">{t(pk('user_list_title'))}</div>
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
                <div className="guide-demo-modal-title">{t(pk('add_user_title'))}</div>
                <div className="guide-demo-kwbox single" ref={setRef('userSearch')}>
                  {userSearch ? <span className="val">{userSearch}</span> : <span className="ph">{t('group.add_member_placeholder')}</span>}
                </div>
                <AnimatePresence>
                  {resultsShown && (
                    <motion.div className="guide-demo-userlist" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      {USERS.map((u) => (
                        <div
                          key={u}
                          ref={setRef(`u_${u}`)}
                          className={`guide-demo-userrow${selectedUsers.has(u) ? ' on' : ''}`}
                        >
                          <input type="checkbox" readOnly checked={selectedUsers.has(u)} /> {u}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="guide-demo-modal-footer">
                  <button type="button" className="guide-demo-btn primary sm" ref={setRef('addUserConfirm') as React.Ref<HTMLButtonElement>}>
                    {t('permission.add_user')} ({selectedUsers.size})
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
                  <span className="lbl">{t('group.create_placeholder')}</span>
                  <div className="guide-demo-kwbox single" ref={setRef('groupName')}>
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
                        <div className="guide-demo-userrow" ref={setRef('memberResult')}>👤 {GROUP_MEMBER}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="guide-demo-kwchips">
                    <AnimatePresence>
                      {groupMembers.map((m) => (
                        <motion.span key={m} className="guide-demo-kwchip" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}>
                          {m} ✕
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="guide-demo-modal-footer">
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
