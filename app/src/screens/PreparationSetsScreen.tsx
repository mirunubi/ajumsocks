import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { callPrepAdmin } from "../lib/functions";
import { type PreparationSet, type PreparationSetItem } from "../lib/preparation";

export function PreparationSetsScreen() {
  const [sets, setSets] = useState<PreparationSet[]>([]);
  const [lines, setLines] = useState<PreparationSetItem[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await callPrepAdmin({ action: "list-sets" });
    setSets((result.sets ?? []) as PreparationSet[]);
    setLines((result.set_items ?? []) as PreparationSetItem[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callPrepAdmin({ action: "upsert-set", name, description });
      setName("");
      setDescription("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/preparations">← 준비물</Link>
        <div className="brand">준비물 세트</div>
      </div>
      <h1>준비물 세트</h1>
      <p className="muted">세트는 템플릿입니다. 행사에 적용하면 그때 내용이 복사됩니다.</p>
      <form className="card" onSubmit={(event) => void onCreate(event)}>
        <label>세트 이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="백화점 기본세트" />
        <label>설명</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        {message ? <div className="error">{message}</div> : null}
        <button type="submit" disabled={busy}>
          세트 만들기
        </button>
      </form>
      {sets.map((set) => {
        const count = lines.filter((line) => line.preparation_set_id === set.id).length;
        return (
          <Link className="event-card-link" to={`/preparation-sets/${set.id}`} key={set.id}>
            <article className="card event-card">
              <strong>{set.name}</strong>
              <div className="muted">{set.description || "설명 없음"}</div>
              <div>
                <span className="badge">{count}개 항목</span>
                {set.is_active ? null : <span className="badge">비활성</span>}
              </div>
            </article>
          </Link>
        );
      })}
    </div>
  );
}
