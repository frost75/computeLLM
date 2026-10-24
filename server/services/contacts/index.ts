// ============================================================
// Contacts Provider Factory
//
// DEFAULT: DingTalk contacts (reads from DingTalk org directory)
//
// HOW TO SWITCH:
//   To use self-hosted Supabase contacts, comment out the
//   DingtalkContactsProvider line and uncomment the
//   SupabaseContactsProvider line below. That's it.
//
// AGENT INSTRUCTION:
//   When user says "switch to self-hosted contacts" / "use Supabase
//   contacts" / "don't use DingTalk contacts":
//     1. Comment out the dingtalk line
//     2. Uncomment the supabase line
//   When user says "switch back to DingTalk contacts":
//     1. Comment out the supabase line
//     2. Uncomment the dingtalk line
// ============================================================

import { IContactsProvider } from './interface.js';

import { SupabaseContactsProvider } from './supabase_contacts_provider.js'
import {DingtalkContactsProvider} from "./dingtalk_provider.js";

/**
 * Extract Supabase JWT from request Authorization header.
 * Expected format: "Bearer <token>"
 * 兼容 Cookie 中的 access_token 作为降级来源。
 */
function extractSupabaseJwt(req: any): string {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  let token: string | undefined;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      throw new Error('Invalid Authorization header format. Expected: Bearer <token>');
    }
    token = parts[1];
  }
  if (!token) {
    token = req.cookies?.access_token;
  }
  if (!token) {
    throw new Error('Missing Authorization header or access_token cookie');
  }
  return token;
}

/**
 * Create DingtalkContactsProvider with Supabase JWT.
 * Each request has its own JWT, so we create a new provider per request.
 */
function createDingtalkProvider(req: any): DingtalkContactsProvider {
  const supabaseJwt = extractSupabaseJwt(req);
  return new DingtalkContactsProvider(supabaseJwt);
}

export function createContactsProvider(req: any): IContactsProvider {
  // CONTACTS_PROVIDER_START — do not remove this comment

  // ✅ Active: DingTalk contacts (default)
  return createDingtalkProvider(req);

  // ⬜ Inactive: Self-hosted Supabase contacts
  // return new SupabaseContactsProvider(req.supabase, req.user.corp_id);

  // CONTACTS_PROVIDER_END — do not remove this comment
}

export type { IContactsProvider, Employee, Department, DepartmentNode, DepartmentTreeResult, DeptSearchItem, DeptSearchResult, SearchResult } from './interface.js';
