"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Pill, rise } from "@/components/ui/kit";

interface Task {
  id: string;
  name: string;
  status: string;
  priority: string;
  category: string;
  dueDate?: string | null;
}

const columns = [
  { id: "Not started", label: "To Do" },
  { id: "Approved", label: "Approved" },
  { id: "In progress", label: "In Progress" },
  { id: "Done", label: "Done" },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
  }, []);

  async function fetchTasks() {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTasks(data.tasks || []);
      setError(null);
    } catch (e) {
      console.error("Failed to fetch tasks", e);
      setError("Couldn't load tasks — is the database awake? Refresh to retry.");
    } finally {
      setLoading(false);
    }
  }

  // Optimistic status move: update UI immediately, then persist.
  async function moveTask(taskId: string, newStatus: string) {
    const prev = tasks;
    if (prev.find((t) => t.id === taskId)?.status === newStatus) return;
    setTasks((ts) => ts.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setError(null);
    } catch (e) {
      console.error("Failed to update task", e);
      setTasks(prev); // roll back
      setError("Move didn't save — try again.");
    }
  }

  async function addTask() {
    const name = newTask.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status: "Not started" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.task) setTasks((ts) => [...ts, data.task]);
      setNewTask("");
      setShowAddTask(false);
      setError(null);
    } catch (e) {
      console.error("Failed to add task", e);
      setError("Couldn't add the task — try again.");
    }
  }

  async function deleteTask(taskId: string) {
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== taskId));
    try {
      const res = await fetch(`/api/tasks?id=${encodeURIComponent(taskId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error("Failed to delete task", e);
      setTasks(prev);
      setError("Delete didn't save — try again.");
    }
  }

  if (loading) {
    return (
      <div className="relative z-10 w-full mx-auto pt-4">
        <div className="flex justify-between items-center mb-10">
          <div>
            <div className="sk h-3 w-24 mb-3" />
            <div className="sk h-7 w-28" />
          </div>
          <div className="sk h-9 w-28 rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="panel p-4">
              <div className="sk h-4 w-16 mb-4" />
              <div className="space-y-2">
                {[...Array(i + 1)].map((_, j) => <div key={j} className="sk h-16 rounded-[var(--r-md)]" />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative z-10 h-full flex flex-col w-full mx-auto pt-4 pb-16">
        <div className="hq-rise flex justify-between items-end gap-4 mb-6" style={rise(0)}>
          <div>
            <div className="eyebrow mb-2">Saved to your database</div>
            <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Tasks</h1>
          </div>
          <Button variant="primary" onClick={() => setShowAddTask(true)}>+ Add Task</Button>
        </div>

        {error && (
          <div className="mb-4 rounded-[var(--r-md)] border px-4 py-2.5 text-[13px]"
            style={{ color: "var(--warn)", borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)", background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
            {error}
          </div>
        )}

        {showAddTask && (
          <div className="hq-rise elevated mb-8 p-5">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-md)] px-4 py-3 mb-3 text-[14px] focus:outline-none focus:border-[var(--line-strong)]"
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="primary" onClick={addTask} disabled={!newTask.trim()}>
                {newTask.trim() ? "Add Task" : "Type a name first"}
              </Button>
              <Button variant="ghost" onClick={() => setShowAddTask(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <p className="text-[12px] text-[var(--text-3)] mb-3 num">
          Drag a card between stages — changes save instantly. Hover a card for the stage menu or delete.
        </p>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
          {columns.map((column, idx) => {
            const colTasks = tasks.filter((t) => t.status === column.id);
            const count = colTasks.length;
            return (
              <div
                key={column.id}
                className={`hq-rise panel flex flex-col overflow-hidden transition-colors ${dragOverCol === column.id ? "outline outline-1 outline-[color-mix(in_srgb,var(--accent)_45%,transparent)]" : ""}`}
                style={rise(idx + 1)}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(column.id); }}
                onDragLeave={() => setDragOverCol((c) => (c === column.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  const id = e.dataTransfer.getData("text/task-id") || draggingId;
                  if (id) moveTask(id, column.id);
                  setDraggingId(null);
                }}
              >
                <div className="px-4 py-3.5 flex items-center justify-between">
                  <span className="eyebrow">{column.label}</span>
                  <span className="num text-[11px] text-[var(--text-3)]">{count}</span>
                </div>
                <div className="rule" />
                <div className="flex-1 p-2.5 space-y-2 min-h-[120px]">
                  {colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      done={column.id === "Done"}
                      onStatusChange={(status) => moveTask(task.id, status)}
                      onDelete={() => deleteTask(task.id)}
                      onDragStart={() => setDraggingId(task.id)}
                      onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                    />
                  ))}
                  {count === 0 && (
                    <p className="text-[var(--text-4)] text-[12.5px] text-center py-8">
                      {dragOverCol === column.id ? "Drop here…" : "No tasks"}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TaskCard({
  task,
  done,
  onStatusChange,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  done?: boolean;
  onStatusChange: (status: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const priorityTone: Record<string, "warn" | "neutral"> = {
    High: "warn",
    Medium: "neutral",
    Low: "neutral",
  };
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-1)] p-3.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] group ${done ? "opacity-80" : ""}`}
    >
      <p className={`font-medium text-[13px] mb-3 leading-relaxed ${done ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"}`}>
        {task.name}
      </p>
      {(task.priority || task.category || task.dueDate) && (
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {task.priority && <Pill tone={priorityTone[task.priority] || "neutral"}>{task.priority}</Pill>}
          {task.category && <span className="text-[11px] text-[var(--text-3)]">{task.category}</span>}
          {task.dueDate && <span className="num text-[11px] text-[var(--text-3)]">due {task.dueDate}</span>}
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-[var(--line)] flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <select
          className="flex-1 min-w-0 text-[12px] bg-[var(--surface-1)] text-[var(--text-2)] rounded-[var(--r-sm)] px-2 py-2 border border-[var(--line)] focus:outline-none focus:border-[var(--line-strong)]"
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {columns.map((col) => (
            <option key={col.id} value={col.id}>
              Move to {col.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={confirmDelete ? onDelete : () => setConfirmDelete(true)}
          onBlur={() => setConfirmDelete(false)}
          title={confirmDelete ? "Click again to confirm" : "Delete task"}
          className="shrink-0 text-[12px] px-2 py-2 rounded-[var(--r-sm)] border border-[var(--line)] transition-colors"
          style={{ color: confirmDelete ? "var(--down)" : "var(--text-3)" }}
        >
          {confirmDelete ? "Sure?" : "✕"}
        </button>
      </div>
    </div>
  );
}
