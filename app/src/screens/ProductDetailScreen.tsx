import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { callProductAdmin } from "../lib/functions";
import { supabase } from "../lib/supabase";
import {
  categoryLabel,
  COUNTRY_LABEL,
  IMAGE_TYPE_LABEL,
  skuLabel,
  type AttributeDefinition,
  type Category,
  type Color,
  type ProductDetail,
  type Size,
  type Tag,
} from "../lib/products";

export function ProductDetailScreen() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [skuSize, setSkuSize] = useState("");
  const [skuColor, setSkuColor] = useState("");
  const [attrId, setAttrId] = useState("");
  const [attrValue, setAttrValue] = useState("");
  const [tagName, setTagName] = useState("");
  const [imageType, setImageType] = useState("other");

  async function refresh() {
    const [payload, masters] = await Promise.all([
      callProductAdmin({ action: "get", id }),
      callProductAdmin({ action: "list-masters" }),
    ]);
    setDetail(payload as ProductDetail);
    setCategories((masters.categories ?? []) as Category[]);
    setSizes((masters.sizes ?? []) as Size[]);
    setColors((masters.colors ?? []) as Color[]);
    setAttributes((masters.attributes ?? []) as AttributeDefinition[]);
    setAllTags((masters.tags ?? []) as Tag[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [id]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "처리 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    await run(() =>
      callProductAdmin({
        action: "update",
        id,
        name: String(data.get("name") ?? ""),
        primary_category_id: String(data.get("primary_category_id") ?? "") || null,
        manufacturer_name: String(data.get("manufacturer_name") ?? ""),
        wholesaler_name: String(data.get("wholesaler_name") ?? ""),
        country_of_origin: String(data.get("country_of_origin") ?? "") || null,
        purchase_price: String(data.get("purchase_price") ?? "") || null,
        sale_price: String(data.get("sale_price") ?? "") || null,
        default_pack_quantity: Number(data.get("default_pack_quantity") || 10),
        memo: String(data.get("memo") ?? ""),
        is_active: data.get("is_active") === "on",
      }),
    );
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => {
      for (const file of [...files]) {
        const signed = await callProductAdmin({
          action: "sign-upload",
          product_id: id,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        });
        const { error } = await supabase.storage
          .from("product-images")
          .uploadToSignedUrl(signed.storage_path, signed.token, file, { contentType: file.type });
        if (error) throw error;
        await callProductAdmin({
          action: "complete-upload",
          product_id: id,
          storage_path: signed.storage_path,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
          image_type: imageType,
        });
      }
    });
  }

  if (!detail) {
    return (
      <div className="app-shell">
        <p className="muted">{message ?? "불러오는 중..."}</p>
      </div>
    );
  }

  const product = detail.product;
  const primary = detail.images.find((image) => image.is_primary) ?? detail.images[0];
  const selectedAttr = attributes.find((item) => item.id === attrId);

  return (
    <div className="app-shell wide">
      <div className="nav-row">
        <Link to="/products">← 상품 목록</Link>
        <div className="brand">상품 상세</div>
      </div>
      {primary?.signed_url ? <img className="hero-image" src={primary.signed_url} alt="" /> : null}
      <h1>{product.name}</h1>
      <p className="muted">
        상품코드 {product.product_code}
        {detail.category_path.length ? ` · ${detail.category_path.join(" > ")}` : ""}
      </p>
      {detail.tags.length > 0 ? (
        <div className="chip-row">
          {detail.tags.map((tag) => (
            <span className="badge" key={tag.id}>
              {tag.name}
            </span>
          ))}
        </div>
      ) : null}
      {message ? <div className="error">{message}</div> : null}

      <form className="card" key={`${product.id}-${product.updated_at ?? ""}`} onSubmit={(event) => void onSave(event)}>
        <h3 className="section-title">기본정보</h3>
        <label>상품명</label>
        <input name="name" defaultValue={product.name} required />
        <label>분류</label>
        <select name="primary_category_id" defaultValue={product.primary_category_id ?? ""}>
          <option value="">선택 안 함</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {categoryLabel(categories, cat.id)}
            </option>
          ))}
        </select>
        <div className="filters">
          <div>
            <label>제조사</label>
            <input name="manufacturer_name" defaultValue={product.manufacturer_name ?? ""} />
          </div>
          <div>
            <label>도매사</label>
            <input name="wholesaler_name" defaultValue={product.wholesaler_name ?? ""} />
          </div>
        </div>
        <label>제조국</label>
        <select name="country_of_origin" defaultValue={product.country_of_origin ?? ""}>
          <option value="">선택 안 함</option>
          {Object.entries(COUNTRY_LABEL).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <div className="filters">
          <div>
            <label>매입가</label>
            <input name="purchase_price" type="number" min="0" defaultValue={product.purchase_price ?? ""} />
          </div>
          <div>
            <label>판매가</label>
            <input name="sale_price" type="number" min="0" defaultValue={product.sale_price ?? ""} />
          </div>
        </div>
        <label>기본 포장단위</label>
        <input name="default_pack_quantity" type="number" min="1" defaultValue={product.default_pack_quantity} />
        <label>메모</label>
        <textarea name="memo" defaultValue={product.memo ?? ""} />
        <label className="check-row">
          <input name="is_active" type="checkbox" defaultChecked={product.is_active} />
          활성
        </label>
        <button type="submit" disabled={busy}>
          기본정보 저장
        </button>
      </form>

      <section className="card">
        <h3 className="section-title">SKU</h3>
        {detail.variants.map((variant) => (
          <div className="stack-row" key={variant.id}>
            <div>
              <strong>{skuLabel(variant)}</strong>
              <div className="muted">{variant.sku_code}</div>
            </div>
            <span className="badge">{variant.is_active ? "활성" : "비활성"}</span>
            <button
              className="tiny"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  callProductAdmin({
                    action: "update-variant",
                    id: variant.id,
                    is_active: !variant.is_active,
                  }),
                )
              }
            >
              {variant.is_active ? "비활성" : "활성"}
            </button>
          </div>
        ))}
        <div className="filters">
          <select value={skuSize} onChange={(e) => setSkuSize(e.target.value)}>
            <option value="">Size</option>
            {sizes.map((size) => (
              <option key={size.id} value={size.id}>
                {size.display_name}
              </option>
            ))}
          </select>
          <select value={skuColor} onChange={(e) => setSkuColor(e.target.value)}>
            <option value="">Color</option>
            {colors.map((color) => (
              <option key={color.id} value={color.id}>
                {color.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              callProductAdmin({
                action: "add-variant",
                product_id: id,
                size_id: skuSize || undefined,
                primary_color_id: skuColor || undefined,
              }),
            )
          }
        >
          SKU 추가
        </button>
      </section>

      <section className="card">
        <h3 className="section-title">Attributes</h3>
        {detail.attributes.map((row) => (
          <div className="stack-row" key={row.id}>
            <div>
              {row.attribute_definitions?.name}:{" "}
              {row.option_value ?? row.value_text ?? row.value_number ?? String(row.value_boolean)}
              {row.attribute_definitions?.unit ? ` ${row.attribute_definitions.unit}` : ""}
            </div>
          </div>
        ))}
        <select
          value={attrId}
          onChange={(e) => {
            setAttrId(e.target.value);
            setAttrValue("");
          }}
        >
          <option value="">속성 선택</option>
          {attributes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {selectedAttr?.value_type === "SELECT" ? (
          <select value={attrValue} onChange={(e) => setAttrValue(e.target.value)}>
            <option value="">값 선택</option>
            {selectedAttr.option_values.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : selectedAttr ? (
          <input
            value={attrValue}
            placeholder={selectedAttr.unit ? `${selectedAttr.name} (${selectedAttr.unit})` : selectedAttr.name}
            onChange={(e) => setAttrValue(e.target.value)}
          />
        ) : null}
        <button
          className="secondary"
          type="button"
          disabled={busy || !attrId || !attrValue}
          onClick={() =>
            void run(() =>
              callProductAdmin({
                action: "set-attribute",
                product_id: id,
                attribute_definition_id: attrId,
                value: attrValue,
                allow_update: true,
              }),
            )
          }
        >
          속성 저장
        </button>
      </section>

      <section className="card">
        <h3 className="section-title">Tags</h3>
        <div className="chip-row">
          {detail.tags.map((tag) => (
            <button
              className="chip active"
              type="button"
              key={tag.id}
              disabled={busy}
              onClick={() =>
                void run(() => callProductAdmin({ action: "remove-tag", product_id: id, tag_id: tag.id }))
              }
            >
              {tag.name} ×
            </button>
          ))}
        </div>
        <select value={tagName} onChange={(e) => setTagName(e.target.value)}>
          <option value="">기존 태그</option>
          {allTags.map((tag) => (
            <option key={tag.id} value={tag.name}>
              {tag.name}
            </option>
          ))}
        </select>
        <input placeholder="새 태그 이름" value={tagName} onChange={(e) => setTagName(e.target.value)} />
        <button
          className="secondary"
          type="button"
          disabled={busy || !tagName}
          onClick={() =>
            void run(() => callProductAdmin({ action: "add-tag", product_id: id, name: tagName }))
          }
        >
          태그 추가
        </button>
      </section>

      <section className="card">
        <h3 className="section-title">사진</h3>
        <div className="photo-grid">
          {detail.images.map((image) => (
            <figure key={image.id}>
              {image.signed_url ? <img src={image.signed_url} alt="" /> : null}
              <figcaption>
                {IMAGE_TYPE_LABEL[image.image_type] ?? image.image_type}
                {image.is_primary ? " · 대표" : ""}
              </figcaption>
              {!image.is_primary ? (
                <button
                  className="tiny"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => callProductAdmin({ action: "set-primary-image", id: image.id }))}
                >
                  대표로
                </button>
              ) : null}
              <button
                className="tiny danger"
                type="button"
                disabled={busy}
                onClick={() => void run(() => callProductAdmin({ action: "delete-image", id: image.id }))}
              >
                삭제
              </button>
            </figure>
          ))}
        </div>
        <select value={imageType} onChange={(e) => setImageType(e.target.value)}>
          {Object.entries(IMAGE_TYPE_LABEL).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <label className="file-label">
          사진 추가
          <input type="file" accept="image/*" multiple onChange={(e) => void onUpload(e.target.files)} />
        </label>
      </section>
    </div>
  );
}
