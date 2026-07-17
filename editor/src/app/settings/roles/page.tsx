'use client';

/**
 * Roles & users administration: system + custom roles, user list, and
 * role assignments (org-wide or per space).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { ConfirmDialog, Modal, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { Role, UserSummary } from '@/lib/types';

export default function RolesPage() {
  const toast = useToast();
  const { spaces, can } = useWorkspace();
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [editingRole, setEditingRole] = useState<Role | 'new' | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [inviting, setInviting] = useState(false);
  const [assigning, setAssigning] = useState<UserSummary | null>(null);

  const isAdmin = can('manage_users');

  const load = useCallback(() => {
    api<Role[]>('/roles').then(setRoles).catch(() => {});
    api<{ capabilities: string[] }>('/permissions/catalog')
      .then((d) => setCapabilities(d.capabilities))
      .catch(() => {});
    if (isAdmin) {
      api<UserSummary[]>('/users').then(setUsers).catch(() => setUsers([]));
    }
  }, [isAdmin]);

  useEffect(load, [load]);

  const spaceName = (id: string | null) =>
    id === null ? 'Organization' : spaces.find((s) => s.id === id)?.name ?? 'Unknown space';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Roles & users</h1>
          <p className="subtitle">Capability-based access control, scoped org-wide or per space.</p>
        </div>
        <span className="spacer" />
        {isAdmin && (
          <>
            <button className="btn secondary" onClick={() => setEditingRole('new')}>+ Custom role</button>
            <button className="btn" onClick={() => setInviting(true)}>+ Add user</button>
          </>
        )}
      </div>

      <h2>Roles</h2>
      <div className="card-grid">
        {roles.map((role) => (
          <div key={role.id} className="card type-card">
            <div className="row">
              <div className="type-title">{role.name}</div>
              {role.is_system && <span className="chip">system</span>}
            </div>
            <div className="type-meta">{role.description}</div>
            <div className="row wrap" style={{ gap: 4 }}>
              {role.permissions.map((p) => (
                <span key={p} className="chip" style={{ fontSize: 11 }}>{p}</span>
              ))}
            </div>
            {isAdmin && !role.is_system && (
              <div className="type-actions">
                <button className="btn secondary small" onClick={() => setEditingRole(role)}>Edit</button>
                <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => setDeletingRole(role)}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdmin && (
        <>
          <h2 style={{ marginTop: 26 }}>Users</h2>
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.full_name || user.email}</strong>
                      <div className="muted small">{user.email}</div>
                    </td>
                    <td>
                      {user.assignments.length === 0 && <span className="muted">no roles</span>}
                      {user.assignments.map((a) => (
                        <span key={a.id} className="chip" style={{ marginRight: 4 }}>
                          {a.role.name} @ {spaceName(a.space_id)}
                          <button
                            title="Revoke"
                            onClick={async () => {
                              await api(`/role-assignments/${a.id}`, { method: 'DELETE' });
                              load();
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className={`badge plain ${user.is_active ? 'published' : 'draft'}`}>
                        {user.is_active ? 'active' : 'disabled'}
                      </span>
                    </td>
                    <td className="actions">
                      <button className="btn ghost small" onClick={() => setAssigning(user)}>Assign role</button>
                      <button
                        className="btn ghost small"
                        onClick={async () => {
                          await api(`/users/${user.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ is_active: !user.is_active }),
                          });
                          load();
                        }}
                      >
                        {user.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editingRole && (
        <RoleModal
          role={editingRole === 'new' ? null : editingRole}
          capabilities={capabilities}
          onClose={() => setEditingRole(null)}
          onSaved={() => {
            setEditingRole(null);
            toast('Role saved');
            load();
          }}
        />
      )}
      {deletingRole && (
        <ConfirmDialog
          title={`Delete role "${deletingRole.name}"?`}
          message="Users assigned this role lose the capabilities it granted."
          onClose={() => setDeletingRole(null)}
          onConfirm={async () => {
            await api(`/roles/${deletingRole.id}`, { method: 'DELETE' });
            load();
          }}
        />
      )}
      {inviting && (
        <InviteUserModal
          roles={roles}
          spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
          onClose={() => setInviting(false)}
          onCreated={() => {
            setInviting(false);
            toast('User created');
            load();
          }}
        />
      )}
      {assigning && (
        <AssignRoleModal
          user={assigning}
          roles={roles}
          spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
          onClose={() => setAssigning(null)}
          onSaved={() => {
            setAssigning(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function RoleModal({
  role,
  capabilities,
  onClose,
  onSaved,
}: {
  role: Role | null;
  capabilities: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = { name, description, permissions: perms };
      if (role) await api(`/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/roles', { method: 'POST', body: JSON.stringify(payload) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role');
    }
  }

  return (
    <Modal title={role ? `Edit role: ${role.name}` : 'New custom role'} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">Name</label>
        <input className="input" value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
        <label className="field-label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="field-label">Capabilities</label>
        {capabilities.map((cap) => (
          <label key={cap} className="checkbox-row" style={{ margin: '4px 0' }}>
            <input
              type="checkbox"
              checked={perms.includes(cap)}
              onChange={(e) => setPerms(e.target.checked ? [...perms, cap] : perms.filter((p) => p !== cap))}
            />
            <code>{cap}</code>
          </label>
        ))}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn">Save role</button>
        </div>
      </form>
    </Modal>
  );
}

function InviteUserModal({
  roles,
  spaces,
  onClose,
  onCreated,
}: {
  roles: Role[];
  spaces: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          full_name: fullName,
          password,
          role_id: roleId || null,
          space_id: spaceId || null,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">Email</label>
        <input className="input" type="email" value={email} required autoFocus onChange={(e) => setEmail(e.target.value)} />
        <label className="field-label">Full name</label>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <label className="field-label">Password (min 8 chars)</label>
        <input className="input" type="password" value={password} required minLength={8} onChange={(e) => setPassword(e.target.value)} />
        <label className="field-label">Initial role</label>
        <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">— none —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        {roleId && (
          <>
            <label className="field-label">Scope</label>
            <select className="input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              <option value="">Organization-wide</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>Space: {s.name}</option>
              ))}
            </select>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn">Create user</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignRoleModal({
  user,
  roles,
  spaces,
  onClose,
  onSaved,
}: {
  user: UserSummary;
  roles: Role[];
  spaces: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [spaceId, setSpaceId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/role-assignments', {
        method: 'POST',
        body: JSON.stringify({ user_id: user.id, role_id: roleId, space_id: spaceId || null }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign role');
    }
  }

  return (
    <Modal title={`Assign role to ${user.email}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">Role</label>
        <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <label className="field-label">Scope</label>
        <select className="input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          <option value="">Organization-wide</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>Space: {s.name}</option>
          ))}
        </select>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn">Assign</button>
        </div>
      </form>
    </Modal>
  );
}
