import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { callAssortmentAdmin } from "../lib/functions";
import { type AssortmentRule, type AssortmentSet } from "../lib/assortment";

export function AssortmentSetsScreen() {
  const [sets, setSets] = useState<AssortmentSet[]>([]);
  const [rules, setRules] = useState<AssortmentRule[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await callAssortmentAdmin({ action: "list-sets" });
    setSets((result.sets ?? []) as AssortmentSet[]);
    setRules((result.rules ?? []) as AssortmentRule[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callAssortmentAdmin({ action: "upsert-set", name, description });
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
        <Link to="/">← 홈</Link>
        <div className="brand">상품구성 세트</div>
      </div>
      <h1>상품구성 세트</h1>
      <p className="muted">취급 SKU 범위 템플릿입니다. 준비물 세트와 다릅니다. 수량은 넣지 않습니다.</p>
      <form className="card" onSubmit={(event) => void onCreate(event)}>
        <label>세트 이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="백화점 전체형" />
        <label>설명</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        {message ? <div className="error">{message}</div> : null}
        <button type="submit" disabled={busy}>
          세트 만들기
        </button>
      </form>
      {sets.map((set) => {
        const count = rules.filter((rule) => rule.assortment_set_id === set.id).length;
        return (
          <Link className="event-card-link" to={`/assortment-sets/${set.id}`} key={set.id}>
            <article className="card event-card">
              <strong>{set.name}</strong>
              <div className="muted">{set.description || "설명 없음"}</div>
              <div>
                <span className="badge">Rule {count}개</span>
                {set.is_active ? null : <span className="badge">비활성</span>}
              </div>
            </article>
          </Link>
        );
      })}
    </div>
  );
}
