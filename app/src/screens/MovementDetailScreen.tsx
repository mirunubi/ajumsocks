import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { callInventoryMovement } from "../lib/functions";
import { REMAINDER_OPTIONS, deltaLabel, stockLabel, type RemainderLevel } from "../lib/inventory";
import { MOVEMENT_STATUS_LABEL, approxLabel, type InventoryLocation, type MovementRecord } from "../lib/movement";

type Item = {
  id: string;
  product_variant_id: string;
  product_name: string;
  sku_code: string;
  sent_full_pack_count: number;
  sent_remainder_level: RemainderLevel;
  sent_estimated_units: number;
  received_full_pack_count: number | null;
  received_remainder_level: RemainderLevel | null;
  received_estimated_units: number | null;
  qty_delta: number | null;
};

type SkuHit = { product_variant_id: string; product_name: string; sku_code: string };

export function MovementDetailScreen() {
  const { id = "" } = useParams();
  const [movement, setMovement] = useState<MovementRecord | null>(null);
  const [source, setSource] = useState<InventoryLocation | null>(null);
  const [destination, setDestination] = useState<InventoryLocation | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [skuQuery, setSkuQuery] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [variantId, setVariantId] = useState("");
  const [full, setFull] = useState(0);
  const [remainder, setRemainder] = useState<RemainderLevel>("HALF");
  const [receiveFull, setReceiveFull] = useState<Record<string, number>>({});
  const [receiveRem, setReceiveRem] = useState<Record<string, RemainderLevel>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await callInventoryMovement({ action: "get-movement", id });
    setMovement(result.movement as MovementRecord);
    setSource(result.source as InventoryLocation);
    setDestination(result.destination as InventoryLocation);
    const next = (result.items ?? []) as Item[];
    setItems(next);
    const fullMap: Record<string, number> = {};
    const remMap: Record<string, RemainderLevel> = {};
    for (const item of next) {
      fullMap[item.id] = item.received_full_pack_count ?? item.sent_full_pack_count;
      remMap[item.id] = item.received_remainder_level ?? item.sent_remainder_level;
    }
    setReceiveFull(fullMap);
    setReceiveRem(remMap);
  }, [id]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [refresh]);

  async function searchSku() {
    const result = await callInventoryMovement({ action: "search-skus", q: skuQuery });
    setHits((result.skus ?? []) as SkuHit[]);
  }

  async function addItem() {
    if (!variantId) return;
    setBusy(true);
    setMessage(null);
    try {
      await callInventoryMovement({
        action: "add-item",
        inventory_movement_id: id,
        product_variant_id: variantId,
        sent_full_pack_count: full,
        sent_remainder_level: remainder,
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    setBusy(true);
    try {
      await callInventoryMovement({ action: "remove-item", id: itemId });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onDispatch() {
    setBusy(true);
    setMessage(null);
    try {
      await callInventoryMovement({ action: "dispatch", id });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "출발 확인 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onReceive(same: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await callInventoryMovement({
        action: "receive",
        id,
        same_as_sent: same,
        items: items.map((item) => ({
          id: item.id,
          received_full_pack_count: receiveFull[item.id],
          received_remainder_level: receiveRem[item.id],
        })),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "도착 확인 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    try {
      await callInventoryMovement({ action: "cancel-draft", id });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "취소 실패");
    } finally {
      setBusy(false);
    }
  }

  if (!movement) {
    return (
      <div className="app-shell">
        <p className="muted">{message ?? "불러오는 중..."}</p>
      </div>
    );
  }

  const draft = movement.status === "DRAFT";
  const dispatched = movement.status === "DISPATCHED";

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/movements">← 재고 보내기</Link>
        <div className="brand">{movement.movement_no}</div>
      </div>
      <h1>
        {source?.name} → {destination?.name}
      </h1>
      <span className="badge">{MOVEMENT_STATUS_LABEL[movement.status]}</span>
      {message ? <div className="error">{message}</div> : null}

      {items.map((item) => (
        <article className="card" key={item.id}>
          <strong>{item.product_name}</strong>
          <div className="muted">{item.sku_code}</div>
          <div>발송 {stockLabel(item.sent_full_pack_count, item.sent_remainder_level)} ({approxLabel(item.sent_estimated_units)})</div>
          {item.received_estimated_units != null ? (
            <div>
              수령 {approxLabel(item.received_estimated_units)} · 차이 {deltaLabel(item.qty_delta)} (판매량이 아닙니다)
            </div>
          ) : null}
          {draft ? (
            <button className="tiny danger" type="button" disabled={busy} onClick={() => void removeItem(item.id)}>
              빼기
            </button>
          ) : null}
          {dispatched ? (
            <>
              <div className="muted">받은 묶음</div>
              <div className="stepper">
                <button className="stepper-btn" type="button" onClick={() => setReceiveFull((prev) => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] ?? 0) - 1) }))}>
                  −
                </button>
                <strong className="stepper-value">{receiveFull[item.id] ?? 0}</strong>
                <button className="stepper-btn" type="button" onClick={() => setReceiveFull((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }))}>
                  +
                </button>
              </div>
              <div className="remainder-row">
                {REMAINDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={receiveRem[item.id] === option.id ? "remainder-btn active" : "remainder-btn"}
                    onClick={() => setReceiveRem((prev) => ({ ...prev, [item.id]: option.id }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </article>
      ))}

      {draft ? (
        <>
          <h2 className="section-title">상품 추가</h2>
          <input placeholder="상품명, SKU" value={skuQuery} onChange={(e) => setSkuQuery(e.target.value)} />
          <button className="secondary" type="button" onClick={() => void searchSku()}>
            검색
          </button>
          {hits.map((hit) => (
            <button key={hit.product_variant_id} className="stack-row" type="button" onClick={() => setVariantId(hit.product_variant_id)}>
              {hit.product_name} · {hit.sku_code}
              {variantId === hit.product_variant_id ? " ✓" : ""}
            </button>
          ))}
          <div className="stepper">
            <button className="stepper-btn" type="button" onClick={() => setFull((n) => Math.max(0, n - 1))}>
              −
            </button>
            <strong className="stepper-value">{full}</strong>
            <button className="stepper-btn" type="button" onClick={() => setFull((n) => n + 1)}>
              +
            </button>
          </div>
          <div className="remainder-row">
            {REMAINDER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={remainder === option.id ? "remainder-btn active" : "remainder-btn"}
                onClick={() => setRemainder(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy || !variantId} onClick={() => void addItem()}>
            추가
          </button>
          <div className="btn-row">
            <button className="secondary" type="button" disabled={busy} onClick={() => void onCancel()}>
              작성 취소
            </button>
            <button type="button" disabled={busy} onClick={() => void onDispatch()}>
              출발 확인
            </button>
          </div>
        </>
      ) : null}

      {dispatched ? (
        <div className="btn-row">
          <button className="secondary" type="button" disabled={busy} onClick={() => void onReceive(true)}>
            발송량과 동일
          </button>
          <button type="button" disabled={busy} onClick={() => void onReceive(false)}>
            도착 확인
          </button>
        </div>
      ) : null}
    </div>
  );
}
