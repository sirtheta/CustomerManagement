"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerInput } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useActionToast } from "@/hooks/use-action-toast";
import { submitKeepingInput } from "@/hooks/submit-keeping-input";
import { createTask, deleteTask, setTaskDone } from "./task-actions";

type TaskRecord = {
  id: number;
  title: string;
  dueDate: string; // "YYYY-MM-DD"
  overdue: boolean;
  done: boolean;
  assigneeName: string | null;
};
type UserOption = { id: number; name: string };
type Props = {
  customerId: number;
  tasks: TaskRecord[];
  users: UserOption[];
  canEdit: boolean;
};

function formatDay(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function NewTaskForm({ customerId, users }: { customerId: number; users: UserOption[] }) {
  const [state, formAction, isPending] = useActionState(createTask.bind(null, customerId), {});
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const prevTs = useRef<number | undefined>(undefined);

  useActionToast(state, "Aufgabe erstellt");

  useEffect(() => {
    if (state.success && state._ts !== prevTs.current) {
      prevTs.current = state._ts;
      formRef.current?.reset();
      setDueDate("");
      setAssigneeId("");
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} onSubmit={submitKeepingInput(formAction)} className="space-y-2">
      <Input
        name="title"
        placeholder="Aufgabe * (z.B. Rückruf wegen Offerte)"
        aria-label="Aufgabe"
        aria-required
        disabled={isPending}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="new-task-date">Fällig am *</Label>
          <DatePickerInput
            id="new-task-date"
            name="dueDate"
            value={dueDate}
            onChange={setDueDate}
            disabled={isPending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-task-assignee">Zuständig</Label>
          <Select
            name="assigneeId"
            value={assigneeId}
            onValueChange={(v) => setAssigneeId(v ?? "")}
            disabled={isPending}
          >
            <SelectTrigger id="new-task-assignee" className="w-full">
              <SelectValue>
                {(value: string | null) =>
                  value ? (users.find((u) => String(u.id) === value)?.name ?? value) : "Niemand"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Niemand</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Speichert…" : "Aufgabe erstellen"}
      </Button>
    </form>
  );
}

function TaskItem({ customerId, task, canEdit }: { customerId: number; task: TaskRecord; canEdit: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <li className="py-2 flex items-start gap-3">
      <input
        type="checkbox"
        checked={task.done}
        disabled={!canEdit || isPending}
        aria-label={task.done ? "Als offen markieren" : "Als erledigt markieren"}
        onChange={(e) => {
          const done = e.target.checked;
          startTransition(async () => {
            try {
              await setTaskDone(customerId, task.id, done);
            } catch {
              toast.error("Aufgabe konnte nicht geändert werden.");
            }
          });
        }}
        className="mt-1 h-4 w-4 rounded border-input accent-primary"
      />
      <div className="flex-1 min-w-0 text-sm">
        <p className={task.done ? "line-through text-muted-foreground" : "font-medium"}>{task.title}</p>
        <p className="text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>Fällig: {formatDay(task.dueDate)}</span>
          {task.assigneeName && <span>· {task.assigneeName}</span>}
          {task.overdue && !task.done && <Badge variant="destructive">Überfällig</Badge>}
        </p>
      </div>
      {canEdit && (
        <ConfirmDialog
          title="Aufgabe löschen"
          description="Soll diese Aufgabe wirklich gelöscht werden?"
          confirmLabel="Löschen"
          triggerVariant="ghost"
          triggerSize="sm"
          onConfirm={() => deleteTask(customerId, task.id)}
        >
          Löschen
        </ConfirmDialog>
      )}
    </li>
  );
}

export default function TasksSection({ customerId, tasks, users, canEdit }: Props) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aufgaben</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && <NewTaskForm customerId={customerId} users={users} />}
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">Keine offenen Aufgaben.</p>
        ) : (
          <ul className="divide-y divide-border">
            {open.map((t) => (
              <TaskItem key={t.id} customerId={customerId} task={t} canEdit={canEdit} />
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details>
            <summary className="text-sm text-muted-foreground cursor-pointer">Erledigt ({done.length})</summary>
            <ul className="divide-y divide-border">
              {done.map((t) => (
                <TaskItem key={t.id} customerId={customerId} task={t} canEdit={canEdit} />
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
