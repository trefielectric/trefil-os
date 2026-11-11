import { Check } from "lucide-react";
import {
  markLabel,
  workDuration,
  type DailyTask,
  type DirectoryPerson,
  type Shift,
} from "@/lib/workforce";
import { Badge } from "./ui";

const taskLabels = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Completada",
  cancelled: "Cancelada",
} as const;
const taskTones = {
  pending: "orange",
  in_progress: "blue",
  done: "green",
  cancelled: "neutral",
} as const;

export function ShiftList({
  shifts,
  day,
  now,
}: {
  shifts: Shift[];
  day: string;
  now: string;
}) {
  if (!shifts.length)
    return (
      <p className="workforce-empty">No hay marcaciones para esta fecha.</p>
    );
  return (
    <>
      <ul className="workforce-shifts">
        {shifts.map((shift) => (
          <li key={shift.id}>
            <span>
              Llegada <strong>{markLabel(shift.arrived_at)}</strong>
            </span>
            <span>
              Salida{" "}
              <strong>
                {shift.left_at ? markLabel(shift.left_at) : "Pendiente"}
              </strong>
            </span>
          </li>
        ))}
      </ul>
      <div className="workforce-total">
        <span>Tiempo registrado en el día</span>
        <strong>{workDuration(shifts, day, now)}</strong>
      </div>
    </>
  );
}

export function TaskList({
  tasks,
  busy,
  change,
  names,
  manage,
  edit,
  interactive = true,
  canCancel = true,
}: {
  tasks: DailyTask[];
  busy: boolean;
  change: (id: string, status: "in_progress" | "done" | "cancelled") => void;
  names?: ReadonlyMap<string, DirectoryPerson>;
  manage?: boolean;
  edit?: (task: DailyTask) => void;
  interactive?: boolean;
  canCancel?: boolean;
}) {
  if (!tasks.length)
    return (
      <p className="workforce-empty">
        No hay tareas programadas para esta fecha.
      </p>
    );
  return (
    <ul className="workforce-tasks">
      {tasks.map((task) => {
        const open = task.status === "pending" || task.status === "in_progress";
        return (
          <li key={task.id}>
            <div className="workforce-task-head">
              <h3>{task.title}</h3>
              <Badge tone={taskTones[task.status]}>
                {taskLabels[task.status]}
              </Badge>
            </div>
            {(task.due_at || names) && (
              <p className="workforce-task-meta">
                {names?.get(task.person_id)?.full_name}
                {names && task.due_at ? " · " : ""}
                {task.due_at?.slice(0, 5)}
              </p>
            )}
            {task.details && (
              <p className="workforce-task-details">{task.details}</p>
            )}
            {open && interactive && (
              <div className="workforce-actions">
                {manage ? (
                  <>
                    {task.status === "pending" && edit && (
                      <button
                        className="button button-secondary"
                        onClick={() => edit(task)}
                        disabled={busy}
                      >
                        Editar tarea
                      </button>
                    )}
                    {canCancel && (
                      <button
                        className="text-button"
                        onClick={() => change(task.id, "cancelled")}
                        disabled={busy}
                      >
                        Cancelar tarea
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {task.status === "pending" && (
                      <button
                        className="button button-secondary"
                        onClick={() => change(task.id, "in_progress")}
                        disabled={busy}
                      >
                        Iniciar
                      </button>
                    )}
                    <button
                      className="button button-primary"
                      onClick={() => change(task.id, "done")}
                      disabled={busy}
                    >
                      <Check size={16} /> Completar
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
