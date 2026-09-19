import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { callPrepAdmin } from "../lib/functions";
import {
  ITEM_TYPE_LABEL,
  PREP_STATUS_LABEL,
  daysUntil,
  formatQty,
  prepProgress,
  statusesFor,
  type EventPrepItem,
  type EventPrepPlan,
  type PreparationItem,
  type PreparationSet,
  type PrepStatus,
} from "../lib/preparation";

type PreviewLine = {
  planned_quantity: number;
  item: PreparationItem | null;
};

export function EventPrepPanel({ eventId, isAdmin, startsAt }: { eventId: string; isAdmin: boolean; startsAt: string }) {
  const [plan, setPlan] = useState<EventPrepPlan | null>(null);
  const [items, setItems] = useState<EventPrepItem[]>([]);
  const [sets, setSets] = useState<PreparationSet[]>([]);
  const [masters, setMasters] = useState<PreparationItem[]>([]);
  const [setId, setSetId] = useState("");
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);
  const [addItemId, setAddItemId] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await callPrepAdmin({ action: "get-event", event_id: eventId });
    setPlan(result.plan as EventPrepPlan | null);
    setItems((result.items ?? []) as EventPrepItem[]);
  }, [eventId]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([
      callPrepAdmin({ action: "list-sets" }),
      callPrepAdmin({ action: "list-items" }),
    ])
      .then(([setResult, itemResult]) => {
        setSets(((setResult.sets ?? []) as PreparationSet[]).filter((row) => row.is_active));
        setMasters(((itemResult.items ?? []) as PreparationItem[]).filter((row) => row.is_active));
      })
      .catch((error: Error) => setMessage(error.message));
  }, [isAdmin]);

  const active = useMemo(() => items.filter((item) => !item.removed_at), [items]);
  const progress = prepProgress(items);
  const dday = daysUntil(startsAt);

  async function onPreview(event: FormEvent) {
    event.preventDefault();
    if (!setId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await callPrepAdmin({ action: "preview-apply", preparation_set_id: setId });
      setPreview((result.lines ?? []) as PreviewLine[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "미리보기 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!setId) return;
    setBusy(true);
    setMessage(null);
    try {
      await callPrepAdmin({ action: "apply-set", event_id: eventId, preparation_set_id: setId });
      setPreview(null);
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "적용 실패";
      setMessage(text === "plan_exists" ? "이미 준비목록이 있습니다. 재적용하면 기존 체크가 사라지므로 MVP에서는 막습니다." : text);
    } finally {
      setBusy(false);
    }
  }

  async function onStatus(id: string, status: PrepStatus) {
    setBusy(true);
    setMessage(null);
    try {
      await callPrepAdmin({ action: "set-status", id, status });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상태 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onQty(id: string, value: string) {
    const planned_quantity = Number(value);
    if (planned_quantity < 1) return;
    setBusy(true);
    try {
      await callPrepAdmin({ action: "update-event-item", id, planned_quantity });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "수량 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    setBusy(true);
    try {
      await callPrepAdmin({ action: "remove-event-item", id });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "제외 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!addItemId) return;
    setBusy(true);
    setMessage(null);
    try {
      await callPrepAdmin({
        action: "add-event-item",
        event_id: eventId,
        preparation_item_id: addItemId,
        planned_quantity: Number(addQty),
      });
      setAddItemId("");
      setAddQty("1");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "추가 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="section-title">준비물</h2>
      {progress.total > 0 ? (
        <div className="card">
          <div>준비완료 {progress.ready} / {progress.total}</div>
          <div>현장확인 {progress.onSite} / {progress.total}</div>
          {progress.returnTarget > 0 ? <div>회수대상 {progress.returnTarget}개 중 {progress.returned}개 회수완료</div> : null}
          {dday >= 0 && progress.incomplete.length > 0 ? (
            <p className="muted">
              {dday === 0 ? "오늘 시작" : `시작 D-${dday}`} · 미완료 {progress.incomplete.map((item) => item.item_name_snapshot).join(", ")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="placeholder">아직 준비세트가 적용되지 않았습니다.</div>
      )}
      {message ? <div className="error">{message}</div> : null}

      {isAdmin && !plan ? (
        <form className="card" onSubmit={(event) => void onPreview(event)}>
          <h3 className="section-title tight">준비물 세트 적용</h3>
          <select value={setId} onChange={(e) => setSetId(e.target.value)} required>
            <option value="">세트 선택</option>
            {sets.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>
            미리보기
          </button>
        </form>
      ) : null}

      {isAdmin && plan ? <p className="muted">이미 준비목록이 있습니다. 다른 세트로 덮어쓰지 않습니다.</p> : null}

      {preview ? (
        <div className="card">
          <h3 className="section-title tight">적용 내용</h3>
          {preview.map((line, index) => (
            <div key={index} className="stack-row">
              {line.item?.name} {formatQty(line.planned_quantity, line.item?.default_unit || "개")}
            </div>
          ))}
          <button type="button" disabled={busy} onClick={() => void onApply()}>
            확정 적용
          </button>
        </div>
      ) : null}

      {active.map((item) => (
        <article className="card prep-item" key={item.id}>
          <strong>
            {item.item_name_snapshot} {formatQty(item.planned_quantity, item.unit_snapshot)}
          </strong>
          <div>
            <span className="badge">{ITEM_TYPE_LABEL[item.item_type_snapshot]}</span>
            <span className="badge">{PREP_STATUS_LABEL[item.status]}</span>
          </div>
          <div className="status-row">
            {statusesFor(item).map((status) => (
              <button
                key={status}
                type="button"
                className={item.status === status ? "status-btn active" : "status-btn"}
                disabled={busy}
                onClick={() => void onStatus(item.id, status)}
              >
                {PREP_STATUS_LABEL[status]}
              </button>
            ))}
          </div>
          {isAdmin ? (
            <div className="qty-row">
              <input
                type="number"
                min={1}
                defaultValue={Number(item.planned_quantity)}
                onBlur={(e) => void onQty(item.id, e.target.value)}
              />
              <button type="button" className="tiny danger" disabled={busy} onClick={() => void onRemove(item.id)}>
                제외
              </button>
            </div>
          ) : null}
        </article>
      ))}

      {isAdmin && plan ? (
        <form className="card" onSubmit={(event) => void onAdd(event)}>
          <h3 className="section-title tight">이 행사만 항목 추가</h3>
          <select value={addItemId} onChange={(e) => setAddItemId(e.target.value)} required>
            <option value="">준비물 선택</option>
            {masters.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <input type="number" min={1} value={addQty} onChange={(e) => setAddQty(e.target.value)} />
          <button type="submit" disabled={busy}>
            추가
          </button>
        </form>
      ) : null}
    </section>
  );
}
