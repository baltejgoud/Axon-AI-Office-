import type { TaskItem } from '../../shared/types';

/**
 * The task records in the saved state. Every change is announced with the full list, which stays
 * small; saving to disk rides on the service's own saves.
 */
export class TaskStore {
  constructor(
    private readonly state: { tasks: TaskItem[] },
    private readonly id: () => string,
    private readonly emit: (tasks: TaskItem[]) => void,
    private readonly now: () => number = Date.now
  ) {}

  list(): TaskItem[] {
    return this.state.tasks;
  }

  find(predicate: (task: TaskItem) => boolean): TaskItem | undefined {
    return this.state.tasks.find(predicate);
  }

  add(input: Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt'>): TaskItem {
    const at = this.now();
    const task: TaskItem = { ...input, id: this.id(), createdAt: at, updatedAt: at };
    this.state.tasks.push(task);
    this.changed();
    return task;
  }

  /** Applies `patch` in place; a field set to `undefined` is removed. */
  update(id: string, patch: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): TaskItem {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task) throw new Error('Task not found.');
    for (const [key, value] of Object.entries(patch) as [keyof TaskItem, unknown][]) {
      if (value === undefined) delete task[key];
      else (task as unknown as Record<string, unknown>)[key] = value;
    }
    task.updatedAt = this.now();
    this.changed();
    return task;
  }

  remove(id: string): void {
    const index = this.state.tasks.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Task not found.');
    this.state.tasks.splice(index, 1);
    this.changed();
  }

  private changed(): void {
    this.emit(this.state.tasks.map((task) => ({ ...task })));
  }
}
