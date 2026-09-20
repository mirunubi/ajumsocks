import { supabase } from "./supabase";

const functionsUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function call(path: string, body: unknown, withAuth: boolean) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: publishableKey,
  };
  if (withAuth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인이 필요합니다.");
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${functionsUrl}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "요청에 실패했습니다.");
  }
  return json;
}

export function callUserAdmin(body: Record<string, unknown>) {
  return call("user-admin", body, true);
}

export function callInviteAccept(body: Record<string, unknown>) {
  return call("invite-accept", body, false);
}

export function callEventAdmin(body: Record<string, unknown>) {
  return call("event-admin", body, true);
}

export function callEventPhotos(body: Record<string, unknown>) {
  return call("event-photos", body, true);
}

export function callPrepAdmin(body: Record<string, unknown>) {
  return call("prep-admin", body, true);
}

export function callProductAdmin(body: Record<string, unknown>) {
  return call("product-admin", body, true);
}

export function callAssortmentAdmin(body: Record<string, unknown>) {
  return call("assortment-admin", body, true);
}

export function callEventInventory(body: Record<string, unknown>) {
  return call("event-inventory", body, true);
}

export function callInventoryMovement(body: Record<string, unknown>) {
  return call("inventory-movement", body, true);
}

export function callEventFinance(body: Record<string, unknown>) {
  return call("event-finance", body, true);
}

export function callOrganizerAdmin(body: Record<string, unknown>) {
  return call("organizer-admin", body, true);
}
