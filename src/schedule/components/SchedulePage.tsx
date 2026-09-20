// src/schedule/components/SchedulePage.tsx

import { confirm } from '@tauri-apps/plugin-dialog';
import {
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import {
  createSchedule,
  deleteSchedule,
  deleteScheduleLog,
  clearScheduleLogs,
  listScheduleLogs,
  listSchedules,
  updateSchedule,
} from '../storage';
import type {
  ScheduleItem,
  ScheduleKind,
  ScheduleRecurrence,
  ScheduleRunLog,
} from '../types';
import {
  listAvailableAgents,
  type AvailableAgent,
} from '../../chat/agent/agent-loader';
import './schedule.css';

type Draft = {
  title: string;
  kind: ScheduleKind;
  date: string;
  time: string;
  recurrence: ScheduleRecurrence;
  reminderText: string;
  agentName: string;
  agentInput: string;
};

type CalendarCell = {
  date: Date;
  key: string;
  inMonth: boolean;
};

const pad = (value: number): string => String(value).padStart(2, '0');

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function localTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDraft(item: ScheduleItem | null, selectedDay: string): Draft {
  const date = item?.time.slice(0, 10) || selectedDay;
  const time = item?.time.slice(11, 16) || localTime(new Date());
  return {
    title: item?.title ?? '',
    kind: item?.kind ?? 'reminder',
    date,
    time,
    recurrence: item?.recurrence ?? 'none',
    reminderText: item?.reminderText ?? '',
    agentName: item?.agentName ?? '',
    agentInput: item?.agentInput ?? '',
  };
}

function formatDayHeading(key: string): string {
  return dateFromKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusLabel(status: ScheduleItem['status']): string {
  return status === 'pending' ? 'Upcoming' : status.charAt(0).toUpperCase() + status.slice(1);
}

function logDuration(log: ScheduleRunLog): string {
  if (!log.finishedAt) return 'In progress';
  const duration = Math.max(
    0,
    new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime(),
  );
  if (duration < 1000) return '< 1s';
  return `${Math.round(duration / 1000)}s`;
}

export function SchedulePage() {
  const today = dateKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(today);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [logs, setLogs] = useState<ScheduleRunLog[]>([]);
  const [agents, setAgents] = useState<AvailableAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editor, setEditor] = useState<{ item: ScheduleItem | null; draft: Draft } | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    try {
      setSchedules(await listSchedules());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load schedules.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await listScheduleLogs());
    } catch (loadError) {
      console.error('[Schedule Page] Could not load logs:', loadError);
    }
  }, []);

  useEffect(() => {
    void loadSchedules();
    void loadLogs();
    void listAvailableAgents()
      .then(setAgents)
      .catch((loadError) => console.error('[Schedule Page] Could not load agents:', loadError));
  }, [loadLogs, loadSchedules]);

  useEffect(() => {
    const refreshSchedules = () => void loadSchedules();
    const refreshLogs = () => void loadLogs();
    window.addEventListener('mocu-schedules-changed', refreshSchedules);
    window.addEventListener('mocu-schedule-logs-changed', refreshLogs);
    return () => {
      window.removeEventListener('mocu-schedules-changed', refreshSchedules);
      window.removeEventListener('mocu-schedule-logs-changed', refreshLogs);
    };
  }, [loadLogs, loadSchedules]);

  const calendarCells = useMemo<CalendarCell[]>(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        date,
        key: dateKey(date),
        inMonth: date.getMonth() === month.getMonth(),
      };
    });
  }, [month]);

  const itemsByDay = useMemo(() => {
    const grouped = new Map<string, ScheduleItem[]>();
    for (const item of schedules) {
      const key = item.time.slice(0, 10);
      const dayItems = grouped.get(key) ?? [];
      dayItems.push(item);
      grouped.set(key, dayItems);
    }
    for (const dayItems of grouped.values()) {
      dayItems.sort((a, b) => a.time.localeCompare(b.time));
    }
    return grouped;
  }, [schedules]);

  const selectedItems = itemsByDay.get(selectedDay) ?? [];
  const monthItems = schedules.filter((item) => item.time.startsWith(
    `${month.getFullYear()}-${pad(month.getMonth() + 1)}`,
  ));

  const openNewEditor = () => {
    setEditor({ item: null, draft: toDraft(null, selectedDay) });
  };

  const openEditEditor = (item: ScheduleItem) => {
    setEditor({ item, draft: toDraft(item, selectedDay) });
  };

  const handleDelete = async (item: ScheduleItem) => {
    const shouldDelete = await confirm(`Delete "${item.title}"?`, {
      title: 'Delete schedule',
      kind: 'warning',
    });
    if (!shouldDelete) return;
    await deleteSchedule(item.id);
    await loadSchedules();
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor) return;

    const { draft, item } = editor;
    const title = draft.title.trim();
    if (!title || !draft.date || !draft.time) {
      setError('Add a title, date, and time before saving.');
      return;
    }
    if (draft.kind === 'agent' && (!draft.agentName || !draft.agentInput.trim())) {
      setError('Agent schedules need an agent and an instruction.');
      return;
    }

    const payload: Partial<ScheduleItem> & Pick<ScheduleItem, 'title' | 'kind' | 'time'> = {
      title,
      kind: draft.kind,
      time: `${draft.date}T${draft.time}`,
      recurrence: draft.recurrence,
      reminderText: draft.kind === 'reminder' ? draft.reminderText.trim() || title : undefined,
      agentName: draft.kind === 'agent' ? draft.agentName : undefined,
      agentInput: draft.kind === 'agent' ? draft.agentInput.trim() : undefined,
      status: item?.status === 'running' ? 'running' : 'pending',
    };

    try {
      if (item) {
        await updateSchedule(item.id, payload);
      } else {
        await createSchedule(payload);
      }
      setEditor(null);
      setError(null);
      setSelectedDay(draft.date);
      const nextMonth = dateFromKey(draft.date);
      setMonth(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1));
      await loadSchedules();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save schedule.');
    }
  };

  const changeMonth = (amount: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const toggleLog = (id: string) => {
    setExpandedLogs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteLog = async (log: ScheduleRunLog) => {
    const shouldDelete = await confirm(`Delete the log for "${log.scheduleTitle}"?`, {
      title: 'Delete task log',
      kind: 'warning',
    });
    if (!shouldDelete) return;
    await deleteScheduleLog(log.id);
    await loadLogs();
  };

  const handleClearLogs = async () => {
    if (logs.length === 0) return;
    const shouldDelete = await confirm(`Delete all ${logs.length} agent task logs?`, {
      title: 'Clear task history',
      kind: 'warning',
    });
    if (!shouldDelete) return;
    await clearScheduleLogs();
    await loadLogs();
  };

  return (
    <section className="schedule-page">
      <header className="schedule-page-header">
        <div>
          <p className="schedule-page-eyebrow">Planner</p>
          <h1>Schedule</h1>
          <p>Plan reminders and let your agents work automatically when the time comes.</p>
        </div>
        <button type="button" className="schedule-new-button" onClick={openNewEditor}>
          <Plus size={17} />
          New schedule
        </button>
      </header>

      {error ? <div className="schedule-error">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={14} /></button></div> : null}

      <div className="schedule-layout">
        <section className="schedule-calendar-card" aria-label="Calendar">
          <div className="schedule-calendar-toolbar">
            <div>
              <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
              <p>{monthItems.length} scheduled {monthItems.length === 1 ? 'item' : 'items'} this month</p>
            </div>
            <div className="schedule-calendar-actions">
              <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDay(today); }} className="schedule-today-button">Today</button>
              <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button>
              <button type="button" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight size={17} /></button>
            </div>
          </div>

          <div className="schedule-weekdays" aria-hidden="true">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="schedule-calendar-grid">
            {calendarCells.map((cell) => {
              const dayItems = itemsByDay.get(cell.key) ?? [];
              const isToday = cell.key === today;
              const isSelected = cell.key === selectedDay;
              return (
                <button
                  type="button"
                  key={cell.key}
                  className={`schedule-calendar-day ${cell.inMonth ? '' : 'schedule-calendar-day-muted'} ${isToday ? 'schedule-calendar-day-today' : ''} ${isSelected ? 'schedule-calendar-day-selected' : ''}`}
                  onClick={() => setSelectedDay(cell.key)}
                >
                  <span className="schedule-day-number">{cell.date.getDate()}</span>
                  {dayItems.length > 0 ? (
                    <span className="schedule-day-events">
                      {dayItems.slice(0, 3).map((item) => <span key={item.id} className={`schedule-dot schedule-dot-${item.kind}`} />)}
                      {dayItems.length > 3 ? <small>+{dayItems.length - 3}</small> : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="schedule-calendar-legend">
            <span><i className="schedule-dot schedule-dot-reminder" /> Reminder</span>
            <span><i className="schedule-dot schedule-dot-agent" /> Agent task</span>
          </div>
        </section>

        <aside className="schedule-day-panel">
          <div className="schedule-day-panel-header">
            <div>
              <p className="schedule-panel-eyebrow">Agenda</p>
              <h2>{formatDayHeading(selectedDay)}</h2>
            </div>
            <button type="button" className="schedule-icon-button" onClick={openNewEditor} aria-label="Add schedule" title="Add schedule"><Plus size={17} /></button>
          </div>
          {isLoading ? <p className="schedule-muted-message">Loading schedules…</p> : selectedItems.length === 0 ? (
            <div className="schedule-empty-day"><CalendarDays size={25} /><strong>Nothing planned</strong><span>Add a reminder or an agent task for this day.</span><button type="button" onClick={openNewEditor}>Add schedule</button></div>
          ) : (
            <div className="schedule-agenda-list">
              {selectedItems.map((item) => (
                <article className={`schedule-agenda-item schedule-agenda-item-${item.kind}`} key={item.id}>
                  <div className="schedule-agenda-time"><Clock3 size={13} />{item.time.slice(11, 16)}</div>
                  <div className="schedule-agenda-content">
                    <h3>{item.title}</h3>
                    <div className="schedule-agenda-meta"><span className={`schedule-kind-badge schedule-kind-${item.kind}`}>{item.kind === 'agent' ? <Bot size={11} /> : <CalendarDays size={11} />}{item.kind === 'agent' ? item.agentName || 'Agent task' : 'Reminder'}</span>{item.recurrence !== 'none' ? <span className="schedule-repeat-badge">↻ {item.recurrence}</span> : null}</div>
                    {item.kind === 'agent' && item.agentInput ? <p>{item.agentInput}</p> : item.kind === 'reminder' && item.reminderText ? <p>{item.reminderText}</p> : null}
                  </div>
                  <span className={`schedule-status schedule-status-${item.status}`}>{statusLabel(item.status)}</span>
                  <div className="schedule-agenda-actions"><button type="button" onClick={() => openEditEditor(item)} aria-label={`Edit ${item.title}`} title="Edit"><Pencil size={14} /></button><button type="button" onClick={() => void handleDelete(item)} aria-label={`Delete ${item.title}`} title="Delete"><Trash2 size={14} /></button></div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>

      <section className="schedule-logs-section">
        <header className="schedule-logs-header">
          <div><p className="schedule-page-eyebrow">Agent activity</p><h2>Completed agent tasks</h2><p>See what scheduled agents did, including their tools and final results.</p></div>
          <button type="button" className="schedule-clear-button" onClick={() => void handleClearLogs()} disabled={logs.length === 0}>Clear history</button>
        </header>
        {logs.length === 0 ? <div className="schedule-empty-logs"><FileText size={25} /><strong>No agent runs yet</strong><span>When an automatic agent task runs, its complete activity log will appear here.</span></div> : (
          <div className="schedule-log-list">
            {logs.map((log) => {
              const expanded = expandedLogs.has(log.id);
              return <article className="schedule-log-card" key={log.id}>
                <button type="button" className="schedule-log-summary" onClick={() => toggleLog(log.id)} aria-expanded={expanded}>
                  <span className={`schedule-log-status schedule-log-status-${log.status}`} />
                  <span className="schedule-log-main"><strong>{log.scheduleTitle}</strong><span>{log.agentName || 'Agent'} · {formatLogTime(log.startedAt)}</span></span>
                  <span className={`schedule-log-result schedule-log-result-${log.status}`}>{log.status}</span>
                  <span className="schedule-log-duration">{logDuration(log)}</span>
                  <ChevronDown size={16} className={expanded ? 'schedule-chevron-open' : ''} />
                </button>
                {expanded ? <div className="schedule-log-details"><div className="schedule-log-input"><strong>Input</strong><span>{log.triggerInput}</span></div><div className="schedule-log-entries">{log.entries.map((entry, index) => <div className={`schedule-log-entry schedule-log-entry-${entry.kind}`} key={`${log.id}-${index}`}><time>{new Date(entry.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time><span>{entry.message}</span></div>)}</div>{log.output ? <div className="schedule-log-output"><strong>Final result</strong><p>{log.output}</p></div> : null}<button type="button" className="schedule-log-delete" onClick={() => void handleDeleteLog(log)}><Trash2 size={13} /> Delete log</button></div> : null}
              </article>;
            })}
          </div>
        )}
      </section>

      {editor ? <div className="schedule-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
        <form className="schedule-editor-modal" onSubmit={(event) => void handleSave(event)}>
          <div className="schedule-modal-header"><div><p className="schedule-page-eyebrow">{editor.item ? 'Edit plan' : 'New plan'}</p><h2>{editor.item ? 'Update schedule' : 'Create a schedule'}</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="Close"><X size={18} /></button></div>
          <label>Title<input value={editor.draft.title} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, title: event.target.value } } : current)} placeholder="e.g. Daily news analysis" autoFocus /></label>
          <div className="schedule-kind-toggle" role="radiogroup" aria-label="Schedule type"><button type="button" className={editor.draft.kind === 'reminder' ? 'active' : ''} onClick={() => setEditor((current) => current ? { ...current, draft: { ...current.draft, kind: 'reminder' } } : current)}><CalendarDays size={15} /><span><strong>Reminder</strong><small>Mocu tells me at this time</small></span></button><button type="button" className={editor.draft.kind === 'agent' ? 'active' : ''} onClick={() => setEditor((current) => current ? { ...current, draft: { ...current.draft, kind: 'agent' } } : current)}><Bot size={15} /><span><strong>Agent task</strong><small>Run an agent automatically</small></span></button></div>
          <div className="schedule-form-row"><label>Date<input type="date" value={editor.draft.date} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, date: event.target.value } } : current)} /></label><label>Time<input type="time" value={editor.draft.time} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, time: event.target.value } } : current)} /></label></div>
          <label>Repeat<select value={editor.draft.recurrence} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, recurrence: event.target.value as ScheduleRecurrence } } : current)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>
          {editor.draft.kind === 'reminder' ? <label>Reminder message <span className="schedule-label-optional">Optional</span><textarea value={editor.draft.reminderText} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, reminderText: event.target.value } } : current)} placeholder="What should Mocu remind you about?" rows={3} /></label> : <><label>Agent<select value={editor.draft.agentName} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, agentName: event.target.value } } : current)}><option value="">Select a saved agent</option>{agents.map((agent) => <option value={agent.agentName} key={agent.path}>{agent.agentName}</option>)}</select></label><label>Agent instruction<textarea value={editor.draft.agentInput} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, agentInput: event.target.value } } : current)} placeholder="What should the agent do when it runs?" rows={3} /></label></>}
          <div className="schedule-modal-footer"><button type="button" className="schedule-cancel-button" onClick={() => setEditor(null)}>Cancel</button><button type="submit" className="schedule-save-button">{editor.item ? 'Save changes' : 'Create schedule'}</button></div>
        </form>
      </div> : null}
    </section>
  );
}
