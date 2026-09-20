# Schema Inventory

Source: live `pg_catalog` after `npx supabase db reset` (migrations through `20260920160000_event_organizers.sql`).

Not derived from MASTER PLAN. Future tables (supplier, purchase order, shipment) are absent from this DB and are not listed.

## Counts

- public business tables: **43**
- public foreign keys: **101** (includes `profiles.id → auth.users.id`)
- public enum types: **7**

Excluded from table count: `auth`, `storage`, `realtime`, `vault`, `extensions`.

## Enum types

- `app_role`: ADMIN, STAFF, PART_TIMER
- `event_assignment_role`: MANAGER, STAFF, PART_TIMER
- `event_contact_type`: VENUE, HQ, OTHER
- `event_contract_type`: NONE, COMMISSION, FIXED_FEE, MIXED
- `event_status`: PREPARING, ACTIVE, ENDED, SETTLED, CANCELLED
- `preparation_item_type`: EQUIPMENT, CONSUMABLE
- `preparation_status`: NOT_READY, READY, ON_SITE, RETURNED

---

## assortment_set_rules

Purpose: Catalog comment: Simple AND filters per rule. Multiple rules are OR.
Primary Key: `id`
Foreign Keys:
- assortment_set_id → assortment_sets(id) ON DELETE CASCADE
- category_id → product_categories(id) ON DELETE RESTRICT
- color_id → colors(id) ON DELETE RESTRICT
- product_id → products(id) ON DELETE RESTRICT
- product_variant_id → product_variants(id) ON DELETE RESTRICT
- size_id → sizes(id) ON DELETE RESTRICT
- tag_id → tags(id) ON DELETE RESTRICT
Unique Constraints: none
Important Checks: `has_filter` — at least one of category/tag/size/color/product/variant is NOT NULL
Referenced By:
- event_assortment_items.source_rule_id

## assortment_sets

Purpose: Catalog comment: Reusable SKU-scope templates. Not preparation sets. No stock quantities.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id) ON DELETE SET NULL
Unique Constraints: none
Important Checks: name not blank
Referenced By:
- assortment_set_rules.assortment_set_id
- event_assortments.source_assortment_set_id

## attribute_definitions

Purpose: Product attribute master.
Primary Key: `id`
Foreign Keys: none
Unique Constraints: UNIQUE (code)
Important Checks: value_type in TEXT, NUMBER, BOOLEAN, SELECT
Referenced By:
- product_attribute_values.attribute_definition_id

## audit_logs

Purpose: Change history rows written by server RPCs.
Primary Key: `id`
Foreign Keys:
- actor_profile_id → profiles(id) ON DELETE SET NULL
- event_id → events(id) ON DELETE RESTRICT
Unique Constraints: none
Important Checks: action in CREATE, UPDATE, VOID; entity_type in DAILY_SALES, EXPENSE, PRODUCT_COST
Referenced By: none

## colors

Purpose: Color master.
Primary Key: `id`
Foreign Keys: none
Unique Constraints: UNIQUE (code)
Important Checks: none beyond type
Referenced By:
- assortment_set_rules.color_id
- product_variants.primary_color_id

## event_assortment_items

Purpose: Catalog comment: Per-event SKU snapshot.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id) ON DELETE SET NULL
- event_assortment_id → event_assortments(id) ON DELETE RESTRICT
- event_id → events(id) ON DELETE RESTRICT
- product_id → products(id) ON DELETE RESTRICT
- product_variant_id → product_variants(id) ON DELETE RESTRICT
- source_rule_id → assortment_set_rules(id) ON DELETE SET NULL
Unique Constraints: UNIQUE (event_assortment_id, product_variant_id)
Important Checks: source_type in TEMPLATE, MANUAL
Referenced By:
- event_inventory_check_items.event_assortment_item_id
- event_inventory_current.event_assortment_item_id

## event_assortments

Purpose: Catalog comment: One SKU-scope header per event. Re-apply is rejected.
Primary Key: `id`
Foreign Keys:
- applied_by → profiles(id) ON DELETE SET NULL
- event_id → events(id) ON DELETE RESTRICT
- source_assortment_set_id → assortment_sets(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (event_id)
Important Checks: none listed
Referenced By:
- event_assortment_items.event_assortment_id

## event_contacts

Purpose: Catalog comment: External venue/HQ contacts. Not app users.
Primary Key: `id`
Foreign Keys:
- event_id → events(id) ON DELETE CASCADE
Unique Constraints: none
Important Checks: name not blank; email optional
Referenced By: none

## event_daily_sales

Purpose: Catalog comment: Manual daily sales. Missing row = not entered. Zero amounts = confirmed zero.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id) ON DELETE SET NULL
- event_id → events(id) ON DELETE RESTRICT
- updated_by → profiles(id) ON DELETE SET NULL
Unique Constraints: UNIQUE (event_id, business_date)
Important Checks: card/cash/other amounts >= 0
Referenced By: none

## event_expense_receipts

Purpose: Receipt metadata. Binary is not in Postgres.
Primary Key: `id`
Foreign Keys:
- event_id → events(id) ON DELETE RESTRICT
- expense_id → event_expenses(id) ON DELETE RESTRICT
- uploaded_by → profiles(id) ON DELETE SET NULL
Unique Constraints: UNIQUE (storage_path)
Important Checks: storage_path not blank; file_size > 0
Referenced By: none

## event_expenses

Purpose: Catalog comment: Event operating expense. voided_at excludes from P&L.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id) ON DELETE SET NULL
- event_id → events(id) ON DELETE RESTRICT
- expense_category_id → expense_categories(id) ON DELETE RESTRICT
- updated_by → profiles(id) ON DELETE SET NULL
- voided_by → profiles(id) ON DELETE SET NULL
Unique Constraints: none
Important Checks: amount >= 0; payment_method in CARD, CASH, OTHER
Referenced By:
- event_expense_receipts.expense_id

## event_financial_inputs

Purpose: Catalog comment: NULL cost = not entered. 0 = confirmed zero. ADMIN only.
Primary Key: `event_id`
Foreign Keys:
- event_id → events(id) ON DELETE RESTRICT
- updated_by → profiles(id) ON DELETE SET NULL
Unique Constraints: PK is the uniqueness on event_id
Important Checks: estimated_product_cost IS NULL OR >= 0
Referenced By: none

## event_inventory_check_items

Purpose: Catalog comment: NULL pair = not checked. ZERO remainder = confirmed empty. Estimate is not stored.
Primary Key: `id`
Foreign Keys:
- checked_by → profiles(id) ON DELETE SET NULL
- event_assortment_item_id → event_assortment_items(id) ON DELETE RESTRICT
- event_id → events(id) ON DELETE RESTRICT
- inventory_check_id → event_inventory_checks(id) ON DELETE RESTRICT
- product_variant_id → product_variants(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (inventory_check_id, product_variant_id)
Important Checks: pack_size_snapshot > 0; packs >= 0 or NULL; remainder/full pack NULL together; remainder in ZERO, VERY_LOW, HALF, HIGH, FULL
Referenced By: none

## event_inventory_checks

Purpose: Catalog comment: On-site approximate stock check session. Not an inventory movement.
Primary Key: `id`
Foreign Keys:
- confirmed_by → profiles(id) ON DELETE SET NULL
- event_id → events(id) ON DELETE RESTRICT
- started_by → profiles(id) ON DELETE SET NULL
Unique Constraints: none
Important Checks: check_kind in OPENING, ROUTINE, CLOSING; check_scope in FULL, PARTIAL; status in DRAFT, CONFIRMED, CANCELLED
Referenced By:
- event_inventory_check_items.inventory_check_id
- event_inventory_current.source_check_id
- inventory_movements.source_event_inventory_check_id
- inventory_positions.last_physical_check_id

## event_inventory_current

Purpose: Catalog comment: Latest CONFIRMED approximate on-site stock.
Primary Key: `id`
Foreign Keys:
- event_assortment_item_id → event_assortment_items(id) ON DELETE RESTRICT
- event_id → events(id) ON DELETE RESTRICT
- product_variant_id → product_variants(id) ON DELETE RESTRICT
- source_check_id → event_inventory_checks(id) ON DELETE RESTRICT
- updated_by → profiles(id) ON DELETE SET NULL
Unique Constraints: UNIQUE (event_id, product_variant_id)
Important Checks: pack_size_snapshot > 0; full_pack_count >= 0; remainder in ZERO, VERY_LOW, HALF, HIGH, FULL
Referenced By: none

## event_members

Purpose: Catalog comment: N:M assignment. assignment_role independent from profiles.role.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id)
- event_id → events(id) ON DELETE RESTRICT
- profile_id → profiles(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (event_id, profile_id)
Important Checks: none listed
Referenced By: none

## event_organizer_contacts

Purpose: Catalog comment: Current organizer contact master. Copied to event_contacts at event create.
Primary Key: `id`
Foreign Keys:
- organizer_id → event_organizers(id) ON DELETE RESTRICT
Unique Constraints: none
Important Checks: name not blank
Referenced By: none

## event_organizer_terms

Purpose: Catalog comment: ADMIN-only default contract. Copied onto events at create; later edits do not rewrite existing events.
Primary Key: `organizer_id`
Foreign Keys:
- organizer_id → event_organizers(id) ON DELETE RESTRICT
- updated_by → profiles(id) ON DELETE SET NULL
Unique Constraints: PRIMARY KEY (organizer_id)
Important Checks: same contract value rules as events (NONE / COMMISSION / FIXED_FEE / MIXED)
Referenced By: none

## event_organizers

Purpose: Catalog comment: Event host / venue operator. Safe fields only (name, color). Not a product supplier.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id)
Unique Constraints: unique index lower(btrim(name))
Important Checks: name not blank; calendar_color HEX #RRGGBB
Referenced By:
- event_organizer_contacts.organizer_id
- event_organizer_terms.organizer_id
- events.organizer_id

## event_photos

Purpose: Catalog comment: Photo metadata only. Binary in Storage bucket event-photos.
Primary Key: `id`
Foreign Keys:
- event_id → events(id) ON DELETE RESTRICT
- uploaded_by → profiles(id)
Unique Constraints: unique index (storage_path)
Important Checks: storage_path not blank; file_size > 0
Referenced By: none

## event_preparation_items

Purpose: Catalog comment: Per-event snapshot. UI displays snapshot columns, not live master.
Primary Key: `id`
Foreign Keys:
- event_id → events(id) ON DELETE RESTRICT
- plan_id → event_preparation_plans(id) ON DELETE RESTRICT
- source_preparation_item_id → preparation_items(id) ON DELETE RESTRICT
- updated_by → profiles(id)
Unique Constraints: unique index (event_id, source_preparation_item_id) WHERE removed_at IS NULL AND source_preparation_item_id IS NOT NULL
Important Checks: consumable cannot be RETURNED unless requires_return; name snapshot not blank; planned_quantity >= 1
Referenced By: none

## event_preparation_plans

Purpose: Catalog comment: One preparation plan per event. Re-apply is rejected.
Primary Key: `id`
Foreign Keys:
- applied_by → profiles(id)
- event_id → events(id) ON DELETE RESTRICT
- source_preparation_set_id → preparation_sets(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (event_id)
Important Checks: none listed
Referenced By:
- event_preparation_items.plan_id

## events

Purpose: Catalog comment: External sales events. Contract fields stored here.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id)
- organizer_id → event_organizers(id) ON DELETE RESTRICT
Unique Constraints: none
Important Checks: name/venue/address not blank; ends_at >= starts_at; commission_rate 0–100 or NULL; fixed_fee >= 0 or NULL; contract_type values required for COMMISSION/FIXED_FEE/MIXED
Referenced By:
- audit_logs.event_id
- event_assortment_items.event_id
- event_assortments.event_id
- event_contacts.event_id
- event_daily_sales.event_id
- event_expense_receipts.event_id
- event_expenses.event_id
- event_financial_inputs.event_id
- event_inventory_check_items.event_id
- event_inventory_checks.event_id
- event_inventory_current.event_id
- event_members.event_id
- event_photos.event_id
- event_preparation_items.event_id
- event_preparation_plans.event_id
- inventory_locations.event_id

## expense_categories

Purpose: Expense category master.
Primary Key: `id`
Foreign Keys: none
Unique Constraints: UNIQUE (code)
Important Checks: code/name not blank
Referenced By:
- event_expenses.expense_category_id

## inventory_adjustments

Purpose: Catalog comment: Set operational stock to a confirmed approximate count. Does not rewrite movements.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id) ON DELETE SET NULL
- location_id → inventory_locations(id) ON DELETE RESTRICT
- product_variant_id → product_variants(id) ON DELETE RESTRICT
Unique Constraints: none
Important Checks: after_estimated_units >= 0; before_estimated_units NULL or >= 0; reason not blank
Referenced By: none

## inventory_locations

Purpose: Catalog comment: Stock place. EVENT is 1:1 with events.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id) ON DELETE SET NULL
- event_id → events(id) ON DELETE RESTRICT
Unique Constraints:
- unique index (event_id) WHERE location_type = 'EVENT' AND event_id IS NOT NULL
- unique index (location_type) WHERE location_type = 'HQ'
Important Checks: EVENT requires event_id; non-EVENT requires event_id NULL; name not blank; location_type in HQ, EVENT, TEMP, THIRD_PARTY
Referenced By:
- inventory_adjustments.location_id
- inventory_movement_items via movements
- inventory_movements.destination_location_id
- inventory_movements.source_location_id
- inventory_positions.location_id

## inventory_movement_counters

Purpose: Sequence helper keyed by day. No FKs.
Primary Key: `day`
Foreign Keys: none
Unique Constraints: PK
Important Checks: none listed
Referenced By: none

## inventory_movement_items

Purpose: Catalog comment: Sent vs received approximate quantities. Difference is not inferred as sales or loss.
Primary Key: `id`
Foreign Keys:
- inventory_movement_id → inventory_movements(id) ON DELETE RESTRICT
- product_variant_id → product_variants(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (inventory_movement_id, product_variant_id)
Important Checks: sent packs/units >= 0; sent remainder allowed; received triple NULL together or all set; received remainder allowed
Referenced By: none

## inventory_movements

Purpose: Catalog comment: Approximate stock transfer between two locations. One destination per movement.
Primary Key: `id`
Foreign Keys:
- cancelled_by → profiles(id) ON DELETE SET NULL
- created_by → profiles(id) ON DELETE SET NULL
- destination_location_id → inventory_locations(id) ON DELETE RESTRICT
- dispatched_by → profiles(id) ON DELETE SET NULL
- received_by → profiles(id) ON DELETE SET NULL
- source_event_inventory_check_id → event_inventory_checks(id) ON DELETE SET NULL
- source_location_id → inventory_locations(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (movement_no)
Important Checks: source_location_id <> destination_location_id; status in DRAFT, DISPATCHED, RECEIVED, CANCELLED
Referenced By:
- inventory_movement_items.inventory_movement_id

## inventory_positions

Purpose: Catalog comment: Operational approximate stock projection. History lives in checks, movements, adjustments.
Primary Key: `id`
Foreign Keys:
- last_physical_check_id → event_inventory_checks(id) ON DELETE SET NULL
- location_id → inventory_locations(id) ON DELETE RESTRICT
- product_variant_id → product_variants(id) ON DELETE RESTRICT
- updated_by → profiles(id) ON DELETE SET NULL
Unique Constraints: UNIQUE (location_id, product_variant_id)
Important Checks: estimated_units >= 0
Referenced By: none

## invites

Purpose: Catalog comment: One-time invite tokens. Store hash only.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id)
- profile_id → profiles(id) ON DELETE CASCADE
Unique Constraints:
- unique index (token_hash)
- unique index (profile_id) WHERE used_at IS NULL AND revoked_at IS NULL
Important Checks: none listed
Referenced By: none

## preparation_items

Purpose: Catalog comment: Equipment/consumable master. Not sellable product SKUs.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id)
Unique Constraints: none
Important Checks: name not blank; default_unit not blank
Referenced By:
- event_preparation_items.source_preparation_item_id
- preparation_set_items.preparation_item_id

## preparation_set_items

Purpose: Template line joining a set to a master item.
Primary Key: `id`
Foreign Keys:
- preparation_item_id → preparation_items(id) ON DELETE RESTRICT
- preparation_set_id → preparation_sets(id) ON DELETE CASCADE
Unique Constraints: UNIQUE (preparation_set_id, preparation_item_id)
Important Checks: planned_quantity >= 1
Referenced By: none

## preparation_sets

Purpose: Catalog comment: Reusable preparation templates. Applying a set copies rows into event snapshots.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id)
Unique Constraints: none
Important Checks: name not blank
Referenced By:
- event_preparation_plans.source_preparation_set_id
- preparation_set_items.preparation_set_id

## product_attribute_values

Purpose: Product-to-attribute values.
Primary Key: `id`
Foreign Keys:
- attribute_definition_id → attribute_definitions(id) ON DELETE RESTRICT
- product_id → products(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (product_id, attribute_definition_id)
Important Checks: none listed
Referenced By: none

## product_categories

Purpose: Category tree.
Primary Key: `id`
Foreign Keys:
- parent_id → product_categories(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (code)
Important Checks: parent_id IS DISTINCT FROM id
Referenced By:
- assortment_set_rules.category_id
- product_categories.parent_id
- products.primary_category_id

## product_images

Purpose: Product image metadata.
Primary Key: `id`
Foreign Keys:
- product_id → products(id) ON DELETE RESTRICT
- uploaded_by → profiles(id) ON DELETE SET NULL
Unique Constraints:
- UNIQUE (storage_path)
- unique index (product_id) WHERE is_primary
Important Checks: file_size > 0; image_type in front, back, pattern, package, other
Referenced By: none

## product_tags

Purpose: Product–tag join.
Primary Key: `(product_id, tag_id)`
Foreign Keys:
- product_id → products(id) ON DELETE RESTRICT
- tag_id → tags(id) ON DELETE RESTRICT
Unique Constraints: PK
Important Checks: none listed
Referenced By: none

## product_variants

Purpose: SKU row under a product.
Primary Key: `id`
Foreign Keys:
- primary_color_id → colors(id) ON DELETE RESTRICT
- product_id → products(id) ON DELETE RESTRICT
- size_id → sizes(id) ON DELETE RESTRICT
Unique Constraints: UNIQUE (sku_code)
Important Checks: sku_code not blank
Referenced By:
- assortment_set_rules.product_variant_id
- event_assortment_items.product_variant_id
- event_inventory_check_items.product_variant_id
- event_inventory_current.product_variant_id
- inventory_adjustments.product_variant_id
- inventory_movement_items.product_variant_id
- inventory_positions.product_variant_id

## products

Purpose: Sellable product master.
Primary Key: `id`
Foreign Keys:
- created_by → profiles(id) ON DELETE SET NULL
- primary_category_id → product_categories(id) ON DELETE SET NULL
Unique Constraints: UNIQUE (product_code)
Important Checks: product_code/name not blank; default_pack_quantity > 0; purchase_price/sale_price NULL or >= 0; country_of_origin NULL or KR, CN, JP, OTHER
Referenced By:
- assortment_set_rules.product_id
- event_assortment_items.product_id
- product_attribute_values.product_id
- product_images.product_id
- product_tags.product_id
- product_variants.product_id

## profiles

Purpose: Catalog comment: App identity and access window. Auth session alone does not grant access.
Primary Key: `id`
Foreign Keys:
- id → auth.users(id) ON DELETE CASCADE
Unique Constraints:
- unique index (phone)
- unique index (is_master) WHERE is_master
Important Checks: MASTER implies role ADMIN; phone length >= 10
Referenced By: multiple created_by/updated_by/actor columns; event_members.profile_id; invites.profile_id

## sizes

Purpose: Size master.
Primary Key: `id`
Foreign Keys: none
Unique Constraints: UNIQUE (code)
Important Checks: none listed
Referenced By:
- assortment_set_rules.size_id
- product_variants.size_id

## tags

Purpose: Tag master.
Primary Key: `id`
Foreign Keys: none
Unique Constraints: UNIQUE (name)
Important Checks: name not blank
Referenced By:
- assortment_set_rules.tag_id
- product_tags.tag_id
