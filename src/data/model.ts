export interface Project {
  id: string
  name: string
  /** 1-based index into the validated --series-N palette */
  color: number
  archived: boolean
  order: number
  createdAt: number
  updatedAt: number
}

export interface Task {
  id: string
  title: string
  notes: string
  projectId: string | null
  /** estimated pomodoros */
  est: number
  done: boolean
  doneAt: number | null
  order: number
  createdAt: number
  updatedAt: number
  /** soft delete: kept so past sessions still resolve their task name */
  deletedAt: number | null
}

export interface TemplateItem {
  title: string
  est: number
  projectId: string | null
  notes: string
}

export interface Template {
  id: string
  name: string
  items: TemplateItem[]
  createdAt: number
  updatedAt: number
}

export const PROJECT_COLORS = 6
export const projectColor = (n: number) => `var(--series-${((Math.max(1, n) - 1) % PROJECT_COLORS) + 1})`
