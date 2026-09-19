import { useCallback, useEffect, useState, type FormEvent } from "react";
import { callEventFinance } from "../lib/functions";
import { conflictMessage, formatWon, parseWon, PAYMENT_LABEL, type PaymentMethod } from "../lib/finance";
import { supabase } from "../lib/supabase";

type DayStatus = { business_date: string; status: "missing" | "zero" | "entered"; total: number };
type SaleRow = {
  id: string;
  business_date: string;
  card_amount: number;
  cash_amount: number;
  other_amount: number;
  memo: string | null;
  updated_at: string;
};
type Category = { id: string; code: string; name: string; is_active: boolean };
type Receipt = { id: string; signed_url?: string | null; original_filename: string };
type ExpenseRow = {
  id: string;
  expense_date: string;
  expense_category_id: string;
  amount: number;
  payment_method: PaymentMethod;
  description: string | null;
  updated_at: string;
  voided_at: string | null;
  receipts: Receipt[];
};
type Summary = {
  card_total: number;
  cash_total: number;
  other_total: number;
  sales_total: number;
  expense_total: number;
  estimated_product_cost?: number | null;
  commission_amount?: number;
  booth_fee?: number;
  estimated_profit?: number | null;
  profit_ready?: boolean;
  days?: DayStatus[];
};
type AuditRow = { id: string; entity_type: string; action: string; created_at: string };

function MoneyInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input
      inputMode="numeric"
      pattern="[0-9,]*"
      value={value ? value.toLocaleString("ko-KR") : ""}
      onChange={(e) => onChange(parseWon(e.target.value))}
    />
  );
}

export function EventFinancePanel({
  eventId,
  isAdmin,
  startsAt,
  endsAt,
}: {
  eventId: string;
  isAdmin: boolean;
  startsAt: string;
  endsAt: string;
}) {
  const [days, setDays] = useState<DayStatus[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [date, setDate] = useState("");
  const [card, setCard] = useState(0);
  const [cash, setCash] = useState(0);
  const [other, setOther] = useState(0);
  const [saleMemo, setSaleMemo] = useState("");
  const [saleUpdatedAt, setSaleUpdatedAt] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [expDate, setExpDate] = useState("");
  const [expCat, setExpCat] = useState("");
  const [expAmount, setExpAmount] = useState(0);
  const [expPay, setExpPay] = useState<PaymentMethod>("CARD");
  const [expDesc, setExpDesc] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cost, setCost] = useState("");
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [cats, saleRes, expRes, sumRes] = await Promise.all([
      callEventFinance({ action: "list-categories" }),
      callEventFinance({ action: "get-sales", event_id: eventId }),
      callEventFinance({ action: "list-expenses", event_id: eventId }),
      callEventFinance({ action: "get-financial-summary", event_id: eventId }),
    ]);
    setCategories(((cats.categories ?? []) as Category[]).filter((row) => row.is_active));
    setSales((saleRes.sales ?? []) as SaleRow[]);
    setDays((saleRes.days ?? sumRes.summary?.days ?? []) as DayStatus[]);
    setExpenses((expRes.expenses ?? []) as ExpenseRow[]);
    setSummary((sumRes.summary ?? null) as Summary | null);
    if (isAdmin) {
      const audit = await callEventFinance({ action: "get-audit-log", event_id: eventId });
      setLogs((audit.logs ?? []) as AuditRow[]);
      const c = sumRes.summary?.estimated_product_cost;
      setCost(c == null ? "" : String(c));
    }
  }, [eventId, isAdmin]);

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(conflictMessage(error)));
  }, [refresh]);

  useEffect(() => {
    if (!date && days[0]) setDate(days[0].business_date);
    if (!expDate) {
      const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(startsAt));
      setExpDate(start);
    }
    if (!expCat && categories[0]) setExpCat(categories[0].id);
  }, [days, date, expDate, startsAt, expCat, categories]);

  useEffect(() => {
    const row = sales.find((item) => item.business_date === date);
    setCard(Number(row?.card_amount ?? 0));
    setCash(Number(row?.cash_amount ?? 0));
    setOther(Number(row?.other_amount ?? 0));
    setSaleMemo(row?.memo ?? "");
    setSaleUpdatedAt(row?.updated_at ?? null);
  }, [date, sales]);

  const startKst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(startsAt));
  const endKst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(endsAt));

  async function onSaveSales(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callEventFinance({
        action: "save-daily-sales",
        event_id: eventId,
        business_date: date,
        card_amount: card,
        cash_amount: cash,
        other_amount: other,
        memo: saleMemo,
        updated_at: saleUpdatedAt,
      });
      await refresh();
    } catch (error) {
      setMessage(conflictMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveExpense(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await callEventFinance({
        action: "create-expense",
        event_id: eventId,
        expense_date: expDate,
        expense_category_id: expCat,
        amount: expAmount,
        payment_method: expPay,
        description: expDesc,
      });
      setExpAmount(0);
      setExpDesc("");
      await refresh();
      return created.expense?.id as string | undefined;
    } catch (error) {
      setMessage(conflictMessage(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function uploadReceipts(expenseId: string, files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const file of [...files]) {
        const signed = await callEventFinance({
          action: "sign-receipt-upload",
          event_id: eventId,
          expense_id: expenseId,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        });
        const { error } = await supabase.storage
          .from("expense-receipts")
          .uploadToSignedUrl(signed.storage_path, signed.token, file, { contentType: file.type });
        if (error) throw error;
        await callEventFinance({
          action: "complete-receipt-upload",
          event_id: eventId,
          expense_id: expenseId,
          storage_path: signed.storage_path,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        });
      }
      await refresh();
    } catch (error) {
      setMessage(conflictMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function onVoid(id: string) {
    setBusy(true);
    try {
      await callEventFinance({ action: "void-expense", id });
      await refresh();
    } catch (error) {
      setMessage(conflictMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function onCost(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await callEventFinance({
        action: "update-product-cost",
        event_id: eventId,
        estimated_product_cost: cost === "" ? null : parseWon(cost),
      });
      await refresh();
    } catch (error) {
      setMessage(conflictMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2 className="section-title tight">매출</h2>
        {message ? <div className="error">{message}</div> : null}
        <div className="muted">미입력과 0원 확인은 다릅니다.</div>
        <div className="chip-row">
          {days.map((day) => (
            <button
              key={day.business_date}
              type="button"
              className={date === day.business_date ? "chip active" : "chip"}
              onClick={() => setDate(day.business_date)}
            >
              {day.business_date.slice(5)}{" "}
              {day.status === "missing" ? "미입력" : day.status === "zero" ? "입력완료 · 0원" : `입력완료 · ${formatWon(day.total)}`}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => void onSaveSales(e)}>
          <label>영업일</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <label>카드</label>
          <MoneyInput value={card} onChange={setCard} />
          <label>현금</label>
          <MoneyInput value={cash} onChange={setCash} />
          <label>기타</label>
          <MoneyInput value={other} onChange={setOther} />
          <p>합계 {formatWon(card + cash + other) || "0원"}</p>
          <label>메모</label>
          <input value={saleMemo} onChange={(e) => setSaleMemo(e.target.value)} />
          <button type="submit" disabled={busy}>
            저장
          </button>
        </form>
      </section>

      <section className="card">
        <h2 className="section-title tight">지출</h2>
        <form
          onSubmit={(e) => {
            void onSaveExpense(e);
          }}
        >
          <label>날짜</label>
          <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} required />
          {expDate && (expDate < startKst || expDate > endKst) ? <p className="muted">행사기간 밖 지출</p> : null}
          <label>분류</label>
          <select value={expCat} onChange={(e) => setExpCat(e.target.value)}>
            {categories.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <label>금액</label>
          <MoneyInput value={expAmount} onChange={setExpAmount} />
          <label>결제</label>
          <select value={expPay} onChange={(e) => setExpPay(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((key) => (
              <option key={key} value={key}>
                {PAYMENT_LABEL[key]}
              </option>
            ))}
          </select>
          <label>내용</label>
          <input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} />
          <button type="submit" disabled={busy}>
            지출 추가
          </button>
        </form>
        {expenses.map((row) => (
          <article className="stack-row" key={row.id}>
            <div>
              <strong>
                {formatWon(Number(row.amount))} · {PAYMENT_LABEL[row.payment_method]}
              </strong>
              <div className="muted">
                {row.expense_date} {row.description ?? ""}
                {row.expense_date < startKst || row.expense_date > endKst ? " · 행사기간 밖" : ""}
                {row.voided_at ? " · 취소됨" : ""}
              </div>
              <div className="photo-grid">
                {row.receipts.map((receipt) =>
                  receipt.signed_url ? (
                    <figure key={receipt.id}>
                      <img src={receipt.signed_url} alt={receipt.original_filename} />
                    </figure>
                  ) : null,
                )}
              </div>
              {!row.voided_at ? (
                <label className="file-label">
                  사진 찍기
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    disabled={busy}
                    onChange={(e) => void uploadReceipts(row.id, e.target.files)}
                  />
                </label>
              ) : null}
            </div>
            {isAdmin && !row.voided_at ? (
              <button className="tiny danger" type="button" disabled={busy} onClick={() => void onVoid(row.id)}>
                취소
              </button>
            ) : null}
          </article>
        ))}
      </section>

      {isAdmin && summary ? (
        <section className="card">
          <h2 className="section-title tight">손익</h2>
          <p>카드매출 {formatWon(Number(summary.card_total))}</p>
          <p>현금매출 {formatWon(Number(summary.cash_total))}</p>
          <p>기타매출 {formatWon(Number(summary.other_total))}</p>
          <p>총매출 {formatWon(Number(summary.sales_total))}</p>
          <p>지출합계 {formatWon(Number(summary.expense_total))}</p>
          <p>매대수수료 {formatWon(Number(summary.commission_amount ?? 0))}</p>
          <p>입점비 {formatWon(Number(summary.booth_fee ?? 0))}</p>
          <form onSubmit={(e) => void onCost(e)}>
            <label>예상 상품원가 (비우면 미입력)</label>
            <input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} placeholder="미입력" />
            <button type="submit" disabled={busy}>
              원가 저장
            </button>
          </form>
          {summary.profit_ready ? (
            <p>
              예상 순이익 <strong>{formatWon(Number(summary.estimated_profit))}</strong>
            </p>
          ) : (
            <p className="muted">상품원가 미입력 — 예상 순이익 계산 미완료</p>
          )}
          <h3 className="section-title">변경이력</h3>
          {logs.map((row) => (
            <div className="muted" key={row.id}>
              {row.entity_type} {row.action}
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
