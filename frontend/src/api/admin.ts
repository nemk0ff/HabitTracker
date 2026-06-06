import { api } from './client';
import type { AdminUserGroup } from '../types';

export function fetchAllHabits(): Promise<AdminUserGroup[]> {
  return api<AdminUserGroup[]>('/api/admin/habits');
}
