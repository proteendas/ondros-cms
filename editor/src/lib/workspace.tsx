'use client';

/**
 * Workspace context: current user + space + environment selection.
 *
 * The selected space/environment persist in localStorage and are exposed via
 * useWorkspace(). Every content page builds its API paths from
 * `envPath()` so switching space/environment re-scopes the whole editor.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

import { api, getToken } from '@/lib/api';
import type { CurrentUser, Environment, Space } from '@/lib/types';

const SPACE_KEY = 'cms_space_id';
const ENV_KEY = 'cms_env_key';

interface WorkspaceState {
  loading: boolean;
  user: CurrentUser | null;
  spaces: Space[];
  space: Space | null;
  environment: Environment | null;
  selectSpace: (spaceId: string) => void;
  selectEnvironment: (envKey: string) => void;
  refresh: () => Promise<void>;
  /** Coarse capability check (org-wide caps; server enforces per-space). */
  can: (capability: string) => boolean;
  /** `/spaces/{id}/environments/{key}` prefix for the current selection. */
  envPath: string | null;
  spacePath: string | null;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [envKey, setEnvKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    try {
      const [me, spaceList] = await Promise.all([
        api<CurrentUser>('/auth/me'),
        api<Space[]>('/spaces'),
      ]);
      setUser(me);
      setSpaces(spaceList);

      const storedSpace = window.localStorage.getItem(SPACE_KEY);
      const initialSpace =
        spaceList.find((s) => s.id === storedSpace) ?? spaceList[0] ?? null;
      setSpaceId(initialSpace?.id ?? null);

      const storedEnv = window.localStorage.getItem(ENV_KEY);
      const envs = initialSpace?.environments ?? [];
      const initialEnv =
        envs.find((e) => e.key === storedEnv) ?? envs.find((e) => e.is_default) ?? envs[0] ?? null;
      setEnvKey(initialEnv?.key ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pathname === '/login') {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, pathname]);

  const space = useMemo(
    () => spaces.find((s) => s.id === spaceId) ?? null,
    [spaces, spaceId],
  );
  const environment = useMemo(() => {
    const envs = space?.environments ?? [];
    return envs.find((e) => e.key === envKey) ?? envs.find((e) => e.is_default) ?? envs[0] ?? null;
  }, [space, envKey]);

  const selectSpace = useCallback(
    (id: string) => {
      setSpaceId(id);
      window.localStorage.setItem(SPACE_KEY, id);
      const target = spaces.find((s) => s.id === id);
      const def = target?.environments.find((e) => e.is_default) ?? target?.environments[0];
      if (def) {
        setEnvKey(def.key);
        window.localStorage.setItem(ENV_KEY, def.key);
      }
    },
    [spaces],
  );

  const selectEnvironment = useCallback((key: string) => {
    setEnvKey(key);
    window.localStorage.setItem(ENV_KEY, key);
  }, []);

  const can = useCallback(
    (capability: string) => {
      const caps = user?.capabilities ?? [];
      return caps.includes('*') || caps.includes(capability);
    },
    [user],
  );

  const value: WorkspaceState = useMemo(
    () => ({
      loading,
      user,
      spaces,
      space,
      environment,
      selectSpace,
      selectEnvironment,
      refresh,
      can,
      envPath:
        space && environment
          ? `/spaces/${space.id}/environments/${environment.key}`
          : null,
      spacePath: space ? `/spaces/${space.id}` : null,
    }),
    [loading, user, spaces, space, environment, selectSpace, selectEnvironment, refresh, can],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
