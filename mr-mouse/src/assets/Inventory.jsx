import React, { useState, useMemo } from "react";
import {
  Search,
  Plus,
  X,
  ArrowLeft,
  ArrowUpDown,
  ChevronRight,
  Calendar,
  FileText,
  Package,
  AlertTriangle,
  PackagePlus,
  PackageMinus,
  Repeat,
  Tag,
} from "lucide-react";
import { useLedger } from "./booksofacc/Ledgercontext";
import {
  uid,
  todayISO,
  formatDate,
  GlobalStyle,
  TopNav,
  PageHeader,
  Field,
  Modal,
  SummaryCard,
  EmptyState,
} from "./booksofacc/ui";

/* ---------------------------------------------------------------
   Helpers
--------------------------------------------------------------- */

const lastActivity = (product) => {
  if (!product.entries.length) return product.createdAt;
  return product.entries.reduce((latest, e) => (e.date > latest ? e.date : latest), product.entries[0].date);
};

const sortedEntries = (product) =>
  [...product.entries].sort((a, b) => (a.date === b.date ? 0 : a.date > b.date ? 1 : -1));

const emptyProductForm = { name: "", description: "", sku: "", date: todayISO(), amount: "" };

/* Item code (SKU). Optional. Matching codes are how a linked HordeMart
   store keeps its stock in step with Mr Mouse, so they must be unique. */
const SKU_MAX = 64;
function skuProblem(value, products, exceptId = null) {
  const sku = value.trim();
  if (!sku) return null;
  if (sku.length > SKU_MAX) return `Keep it to ${SKU_MAX} characters`;
  if (products.some((p) => p.id !== exceptId && (p.sku || "").trim() === sku)) return "Another product already uses this code";
  return null;
}
const emptyAdjustForm = { productId: "", newProductName: "", type: "", date: todayISO(), amount: "", note: "" };

/* ---------------------------------------------------------------
   Main component
--------------------------------------------------------------- */

export default function InventoryPage({ onNavigate }) {
  const { business, products, setProducts, computeStock } = useLedger();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [adjustForm, setAdjustForm] = useState(emptyAdjustForm);
  const [adjustStep, setAdjustStep] = useState("select"); // 'select' | 'form' | 'success'
  const [savedSummary, setSavedSummary] = useState(null);
  const [formErrors, setFormErrors] = useState({});

  const selectedProduct = products.find((p) => p.id === selectedId) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = !q
      ? products
      : products.filter(
          (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
        );
    list = [...list].sort((a, b) => {
      let av, bv;
      if (sortKey === "name") {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sortKey === "stock") {
        av = computeStock(a);
        bv = computeStock(b);
      } else {
        av = lastActivity(a);
        bv = lastActivity(b);
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [products, query, sortKey, sortDir, computeStock]);

  const totalProducts = products.length;
  const totalUnits = products.reduce((s, p) => s + computeStock(p), 0);
  const lowStockCount = products.filter((p) => computeStock(p) <= 5).length;

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const resetAddForm = () => {
    setProductForm(emptyProductForm);
    setFormErrors({});
  };
  const resetAdjustForm = (productId = "") => {
    setAdjustForm({ ...emptyAdjustForm, productId });
    setFormErrors({});
    setAdjustStep("select");
    setSavedSummary(null);
  };

  const setProductField = (key, value) => {
    setProductForm((f) => ({ ...f, [key]: value }));
    if (formErrors[key]) setFormErrors((e) => ({ ...e, [key]: undefined }));
  };
  const setAdjustField = (key, value) => {
    setAdjustForm((f) => ({ ...f, [key]: value }));
    if (formErrors[key]) setFormErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submitAddProduct = (e) => {
    e.preventDefault();
    const errs = {};
    if (!productForm.name.trim()) errs.name = "Enter a product name";
    else if (products.some((p) => p.name.trim().toLowerCase() === productForm.name.trim().toLowerCase()))
      errs.name = "A product with this name already exists";
    if (!productForm.date) errs.date = "Enter a date";
    const amt = Number(productForm.amount);
    if (productForm.amount === "" || isNaN(amt) || amt < 0) errs.amount = "Enter a valid amount";
    const skuError = skuProblem(productForm.sku, products);
    if (skuError) errs.sku = skuError;

    setFormErrors(errs);
    if (Object.keys(errs).length) return;

    const newProduct = {
      id: uid(),
      name: productForm.name.trim(),
      description: productForm.description.trim(),
      sku: productForm.sku.trim(),
      createdAt: productForm.date,
      entries: [{ id: uid(), type: "load", amount: amt, date: productForm.date, note: "Initial stock" }],
    };
    setProducts((p) => [newProduct, ...p]);
    setShowAddModal(false);
    resetAddForm();
  };

  const submitAdjustStock = (e) => {
    e.preventDefault();
    const errs = {};
    const isNewProduct = adjustForm.productId === "__new__";

    if (isNewProduct) {
      const typedName = adjustForm.newProductName.trim();
      if (!typedName) errs.productId = "Enter a name for the new product";
      else if (products.some((p) => p.name.trim().toLowerCase() === typedName.toLowerCase()))
        errs.productId = "That product already exists — choose it from the list instead";
    } else if (!adjustForm.productId) {
      errs.productId = "Choose a product";
    }

    if (!adjustForm.date) errs.date = "Enter a date";
    const amt = Number(adjustForm.amount);
    if (adjustForm.amount === "" || isNaN(amt) || amt <= 0) errs.amount = "Enter a valid amount";

    const existingProduct = !isNewProduct ? products.find((p) => p.id === adjustForm.productId) : null;
    if (existingProduct && adjustForm.type === "offload" && !errs.amount) {
      const current = computeStock(existingProduct);
      if (amt > current) errs.amount = `Only ${current} currently in stock`;
    }

    setFormErrors(errs);
    if (Object.keys(errs).length) return;

    if (isNewProduct) {
      const typedName = adjustForm.newProductName.trim();
      const newProduct = {
        id: uid(),
        name: typedName,
        description: "",
        createdAt: adjustForm.date,
        entries: [
          { id: uid(), type: "load", amount: amt, date: adjustForm.date, note: adjustForm.note.trim() || "Initial stock" },
        ],
      };
      setProducts((prev) => [newProduct, ...prev]);
      setSavedSummary({ productName: typedName, type: "load", amount: amt, newTotal: amt });
    } else {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === adjustForm.productId
            ? {
                ...p,
                entries: [
                  ...p.entries,
                  {
                    id: uid(),
                    type: adjustForm.type,
                    amount: amt,
                    date: adjustForm.date,
                    note: adjustForm.note.trim(),
                  },
                ],
              }
            : p
        )
      );
      const newTotal = computeStock(existingProduct) + (adjustForm.type === "load" ? amt : -amt);
      setSavedSummary({ productName: existingProduct.name, type: adjustForm.type, amount: amt, newTotal });
    }

    setAdjustStep("success");
  };

  // Returns an error message, or null once saved.
  const saveSku = (productId, value) => {
    const problem = skuProblem(value, products, productId);
    if (problem) return problem;
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, sku: value.trim() } : p)));
    return null;
  };

  const closeAdjustModal = () => {
    setShowAdjustModal(false);
    resetAdjustForm();
  };

  const openAdjustFor = (productId) => {
    resetAdjustForm(productId);
    setShowAdjustModal(true);
  };

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-28">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />

      {selectedProduct ? (
        <ProductLedgerView
          product={selectedProduct}
          computeStock={computeStock}
          onBack={() => setSelectedId(null)}
          onAdjust={() => openAdjustFor(selectedProduct.id)}
          onSaveSku={(value) => saveSku(selectedProduct.id, value)}
        />
      ) : (
        <>
          <PageHeader business={business} icon={Package} title="Inventory" subtitle="Stock on hand — deductions from sales and additions from purchases post here automatically." />

          <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative">
            <button
              onClick={() => onNavigate("books")}
              className="flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink mb-6"
            >
              <ArrowLeft size={14} /> All books
            </button>

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
              <SummaryCard label="Products" value={totalProducts} />
              <SummaryCard label="Total units in stock" value={totalUnits} />
              <SummaryCard label="Low stock" value={lowStockCount} warn={lowStockCount > 0} />
            </div>

            {/* Search */}
            <div className="mb-5">
              <div className="flex items-center gap-2.5 rounded-lg border border-rule bg-white px-4 py-3">
                <Search size={16} className="text-ink/40 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products by name or description…"
                  className="w-full bg-transparent outline-none text-sm text-ink placeholder:text-ink/35 font-body"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-ink/35 hover:text-ink" aria-label="Clear search">
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* Product list */}
            {filtered.length === 0 ? (
              <EmptyState
                title={query ? "No products match your search" : "No products yet"}
                subtitle={query ? "Try a different name or clear the search." : "Add your first stock record to get started."}
                action={
                  !query && (
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-action text-white font-body text-sm font-medium px-5 py-2.5 hover:bg-action-deep transition-colors"
                    >
                      <Plus size={15} /> Add a product
                    </button>
                  )
                }
              />
            ) : (
              <div className="rounded-lg border border-rule bg-white overflow-hidden">
                <div className="hidden sm:grid grid-cols-[2.2fr_1fr_1fr_auto] gap-4 px-5 py-3 bg-paper-sunk font-body text-[13px] text-ink-soft">
                  <SortHeader label="Product" active={sortKey === "name"} onClick={() => toggleSort("name")} />
                  <SortHeader label="In stock" active={sortKey === "stock"} onClick={() => toggleSort("stock")} />
                  <SortHeader label="Last activity" active={sortKey === "activity"} onClick={() => toggleSort("activity")} />
                  <span />
                </div>

                <div className="divide-y divide-rule">
                  {filtered.map((p) => {
                    const stock = computeStock(p);
                    const low = stock <= 5;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className="w-full text-left grid grid-cols-2 sm:grid-cols-[2.2fr_1fr_1fr_auto] gap-2 sm:gap-4 items-center px-5 py-4 hover:bg-paper transition-colors"
                      >
                        <div className="col-span-2 sm:col-span-1 min-w-0">
                          <p className="font-display text-base text-ink truncate">{p.name}</p>
                          {p.description && <p className="font-body text-xs text-ink/50 truncate mt-0.5">{p.description}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-sm ${low ? "text-clay" : "text-ink"}`}>{stock}</span>
                          {low && <AlertTriangle size={13} className="text-clay" />}
                        </div>
                        <span className="font-body text-xs text-ink/50">{formatDate(lastActivity(p))}</span>
                        <ChevronRight size={16} className="hidden sm:block text-ink/30 justify-self-end" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Floating action buttons */}
      <div className="fixed bottom-6 right-5 sm:right-8 z-30 flex flex-col items-end gap-3">
        <button
          onClick={() => openAdjustFor(selectedProduct ? selectedProduct.id : "")}
          title="Add or remove stock from an existing product"
          className="flex items-center gap-2 rounded-full bg-white border border-ink/15 text-ink pl-4 pr-5 py-3 hover:border-action hover:text-moss transition-colors"
        >
          <Repeat size={17} className="text-moss" />
          <span className="font-body text-sm font-medium whitespace-nowrap">Adjust stock</span>
        </button>
        <button
          onClick={() => {
            resetAddForm();
            setShowAddModal(true);
          }}
          title="Create a stock record for a new product"
          className="flex items-center gap-2 rounded-full bg-action text-white pl-4 pr-5 py-3.5 hover:bg-action-deep transition-colors"
        >
          <PackagePlus size={19} />
          <span className="font-body text-sm font-medium whitespace-nowrap">New product</span>
        </button>
      </div>

      {/* Add product modal */}
      {showAddModal && (
        <Modal
          title="New stock record"
          icon={PackagePlus}
          onClose={() => {
            setShowAddModal(false);
            resetAddForm();
          }}
        >
          <form onSubmit={submitAddProduct} noValidate className="space-y-5">
            <Field icon={Package} label="Product name" error={formErrors.name}>
              <input
                className="ledger-input w-full py-2 text-sm"
                placeholder="e.g., Bag of Rice (50kg)"
                value={productForm.name}
                onChange={(e) => setProductField("name", e.target.value)}
              />
            </Field>
            <Field icon={FileText} label="Description" optional>
              <input
                className="ledger-input w-full py-2 text-sm"
                placeholder="Short description of the product"
                value={productForm.description}
                onChange={(e) => setProductField("description", e.target.value)}
              />
            </Field>
            <Field icon={Tag} label="Item code (SKU)" optional error={formErrors.sku}>
              <input
                className="ledger-input w-full py-2 text-sm"
                placeholder="e.g., RICE-50KG"
                maxLength={SKU_MAX}
                value={productForm.sku}
                onChange={(e) => setProductField("sku", e.target.value)}
              />
            </Field>
            <p className="font-body text-[12px] text-ink/45 -mt-3">
              Selling on HordeMart? Use the same code there to keep stock in step.
            </p>
            <Field icon={Calendar} label="Date loaded" error={formErrors.date}>
              <input
                type="date"
                className="ledger-input w-full py-2 text-sm"
                value={productForm.date}
                onChange={(e) => setProductField("date", e.target.value)}
              />
            </Field>
            <Field icon={PackagePlus} label="Amount of goods loaded" error={formErrors.amount}>
              <input
                type="number"
                min="0"
                className="ledger-input w-full py-2 text-sm"
                placeholder="e.g., 80"
                value={productForm.amount}
                onChange={(e) => setProductField("amount", e.target.value)}
              />
            </Field>
            <button
              type="submit"
              className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-action text-white font-body text-sm font-medium py-3 hover:bg-action-deep transition-colors"
            >
              Create stock record
            </button>
          </form>
        </Modal>
      )}

      {/* Update stock modal */}
      {showAdjustModal && (
        <Modal title="Update stock" icon={Repeat} onClose={closeAdjustModal}>
          {adjustStep === "select" && (
            <div className="space-y-5">
              <div>
                <label className="font-body text-[13px] text-ink-soft mb-2 block">
                  What's happening to this stock?
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAdjustForm((f) => ({ ...f, type: "load", productId: "", newProductName: "" }))}
                    aria-pressed={adjustForm.type === "load"}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 py-5 transition-all ${
                      adjustForm.type === "load"
                        ? "border-moss bg-moss text-white"
                        : "border-rule bg-white text-ink/45 hover:border-ink/25"
                    }`}
                  >
                    <PackagePlus size={22} />
                    <span className="font-body text-sm font-semibold">Stock In</span>
                    <span className={`font-body text-[11px] text-center px-2 ${adjustForm.type === "load" ? "text-white/80" : "text-ink/40"}`}>
                      New goods arrived
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustForm((f) => ({ ...f, type: "offload", productId: "", newProductName: "" }))}
                    aria-pressed={adjustForm.type === "offload"}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 py-5 transition-all ${
                      adjustForm.type === "offload"
                        ? "border-clay bg-clay text-white"
                        : "border-rule bg-white text-ink/45 hover:border-ink/25"
                    }`}
                  >
                    <PackageMinus size={22} />
                    <span className="font-body text-sm font-semibold">Stock Out</span>
                    <span className={`font-body text-[11px] text-center px-2 ${adjustForm.type === "offload" ? "text-white/80" : "text-ink/40"}`}>
                      Sold or removed
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={!adjustForm.type}
                onClick={() => setAdjustStep("form")}
                className={`w-full flex items-center justify-center gap-2 rounded-lg font-body text-sm font-medium py-3 transition-colors ${
                  !adjustForm.type
                    ? "bg-ink/8 text-ink/35 cursor-not-allowed"
                    : adjustForm.type === "load"
                    ? "bg-moss text-white hover:bg-ink"
                    : "bg-clay text-white hover:bg-ink"
                }`}
              >
                {adjustForm.type === "offload" ? "Remove from stock" : "Add to stock"}
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {adjustStep === "form" && (
            <form onSubmit={submitAdjustStock} noValidate className="space-y-5">
              <button
                type="button"
                onClick={() => setAdjustStep("select")}
                className="flex items-center gap-1.5 font-body text-[13px] text-ink-soft hover:text-ink -mt-1"
              >
                <ArrowLeft size={12} /> Change movement type
              </button>

              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 font-body text-sm font-medium ${
                  adjustForm.type === "load" ? "bg-moss/12 text-moss" : "bg-clay/12 text-clay"
                }`}
              >
                {adjustForm.type === "load" ? <PackagePlus size={16} /> : <PackageMinus size={16} />}
                {adjustForm.type === "load" ? "Stock In — new goods arrived" : "Stock Out — sold or removed"}
              </div>

              <Field
                icon={Package}
                label={adjustForm.type === "offload" ? "Which product is being sold?" : "Product name"}
                error={formErrors.productId}
              >
                {adjustForm.productId === "__new__" ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      className="ledger-input w-full py-2 text-sm"
                      placeholder="e.g., Bag of Beans (25kg)"
                      value={adjustForm.newProductName}
                      onChange={(e) => setAdjustField("newProductName", e.target.value)}
                    />
                    <button type="button" onClick={() => setAdjustField("productId", "")} className="font-body text-xs text-moss hover:underline">
                      Choose an existing product instead
                    </button>
                  </div>
                ) : (
                  <select
                    className="ledger-input w-full py-2 text-sm appearance-none"
                    value={adjustForm.productId}
                    onChange={(e) => setAdjustField("productId", e.target.value)}
                  >
                    <option value="" disabled>
                      Select a product
                    </option>
                    {adjustForm.type === "load" && <option value="__new__">+ Add a new product</option>}
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {computeStock(p)} in stock
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field icon={Calendar} label={adjustForm.type === "load" ? "Date added" : "Date sold"} error={formErrors.date}>
                <input
                  type="date"
                  className="ledger-input w-full py-2 text-sm"
                  value={adjustForm.date}
                  onChange={(e) => setAdjustField("date", e.target.value)}
                />
              </Field>
              <Field
                icon={adjustForm.type === "load" ? PackagePlus : PackageMinus}
                label={adjustForm.type === "load" ? "Amount of product added" : "Amount being sold"}
                error={formErrors.amount}
              >
                <input
                  type="number"
                  min="0"
                  className="ledger-input w-full py-2 text-sm"
                  placeholder="e.g., 15"
                  value={adjustForm.amount}
                  onChange={(e) => setAdjustField("amount", e.target.value)}
                />
              </Field>
              <Field icon={FileText} label="Note" optional>
                <input
                  className="ledger-input w-full py-2 text-sm"
                  placeholder="e.g., Sold to retailers"
                  value={adjustForm.note}
                  onChange={(e) => setAdjustField("note", e.target.value)}
                />
              </Field>

              <button
                type="submit"
                className={`mt-2 w-full flex items-center justify-center gap-2 rounded-lg text-white font-body text-sm font-medium py-3 transition-colors ${
                  adjustForm.type === "load" ? "bg-moss hover:bg-ink" : "bg-clay hover:bg-ink"
                }`}
              >
                Save and update inventory
              </button>
            </form>
          )}

          {adjustStep === "success" && savedSummary && (
            <div className="text-center py-2">
              <div
                className={`mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center ${
                  savedSummary.type === "load" ? "bg-moss/15 text-moss" : "bg-clay/15 text-clay"
                }`}
              >
                {savedSummary.type === "load" ? <PackagePlus size={22} /> : <PackageMinus size={22} />}
              </div>
              <p className="font-display text-lg text-ink mb-1">
                {savedSummary.type === "load"
                  ? `${savedSummary.amount} added to ${savedSummary.productName}`
                  : `${savedSummary.amount} sold from ${savedSummary.productName}`}
              </p>
              <p className="font-body text-sm text-ink/50 mb-6">Inventory has been updated.</p>

              <div className="rounded-xl border border-ink/10 bg-paper-sunk px-5 py-4 mb-6">
                <p className="font-body text-[13px] text-ink-soft mb-1">New total in stock</p>
                <p className="font-display text-3xl text-ink">{savedSummary.newTotal}</p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => resetAdjustForm(adjustForm.productId)}
                  className="flex-1 rounded-lg border border-ink/15 text-ink font-body text-sm font-medium py-2.5 hover:border-action hover:text-moss transition-colors"
                >
                  Record another
                </button>
                <button
                  type="button"
                  onClick={closeAdjustModal}
                  className="flex-1 rounded-lg bg-action text-white font-body text-sm font-medium py-2.5 hover:bg-action-deep transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function SortHeader({ label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 hover:text-ink transition-colors text-left">
      {label}
      <ArrowUpDown size={11} className={active ? "text-moss" : "text-ink/25"} />
    </button>
  );
}

/* ---------------------------------------------------------------
   Per-product ledger page
--------------------------------------------------------------- */

function ProductLedgerView({ product, computeStock, onBack, onAdjust, onSaveSku }) {
  const stock = computeStock(product);
  const [editingSku, setEditingSku] = useState(false);
  const [skuDraft, setSkuDraft] = useState(product.sku || "");
  const [skuError, setSkuError] = useState(null);

  const startSkuEdit = () => {
    setSkuDraft(product.sku || "");
    setSkuError(null);
    setEditingSku(true);
  };
  const submitSku = (e) => {
    e.preventDefault();
    const problem = onSaveSku(skuDraft);
    if (problem) setSkuError(problem);
    else setEditingSku(false);
  };
  const entries = sortedEntries(product);
  let running = 0;

  return (
    <div className="max-w-4xl mx-auto px-5 sm:px-8 pt-8">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink mb-6"
      >
        <ArrowLeft size={14} /> All products
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl text-ink mb-1.5">{product.name}</h1>
          {product.description && <p className="font-body text-sm text-ink/55 max-w-lg">{product.description}</p>}
          <p className="font-mono text-[11px] text-ink/40 mt-2">Record opened {formatDate(product.createdAt)}</p>
          {editingSku ? (
            <form onSubmit={submitSku} className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="product-sku" className="font-body text-[13px] text-ink-soft">
                Item code
              </label>
              <input
                id="product-sku"
                autoFocus
                className="ledger-input py-1.5 text-sm w-44"
                maxLength={SKU_MAX}
                value={skuDraft}
                onChange={(e) => setSkuDraft(e.target.value)}
                aria-invalid={skuError ? "true" : undefined}
              />
              <button type="submit" className="rounded-lg bg-action text-white text-[13px] font-medium px-3 py-1.5 hover:bg-action-deep">
                Save
              </button>
              <button type="button" onClick={() => setEditingSku(false)} className="text-[13px] text-ink-soft hover:text-ink px-2">
                Cancel
              </button>
              {skuError && <p className="w-full font-body text-xs text-clay">{skuError}</p>}
            </form>
          ) : (
            <p className="font-body text-[13px] text-ink-soft mt-2 flex items-center gap-1.5">
              <Tag size={12} />
              {product.sku ? <span className="font-mono text-ink">{product.sku}</span> : <span>No item code</span>}
              <button type="button" onClick={startSkuEdit} className="underline text-action ml-1">
                {product.sku ? "Change" : "Add one"}
              </button>
            </p>
          )}
        </div>

        <div className="rounded-lg border border-rule bg-white px-5 py-4 text-right shrink-0">
          <p className="font-body text-[13px] text-ink-soft mb-1">Current stock</p>
          <p className={`font-display text-3xl ${stock <= 5 ? "text-clay" : "text-ink"}`}>{stock}</p>
        </div>
      </div>

      <button
        onClick={onAdjust}
        className="mb-6 inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-4 py-2.5 font-body text-sm text-ink hover:border-action hover:text-moss transition-colors"
      >
        <Repeat size={15} /> Record stock in / out
      </button>

      <div className="rounded-lg border border-rule bg-white overflow-hidden mb-10">
        <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1fr_1.4fr] gap-4 px-5 py-3 bg-paper-sunk font-body text-[13px] text-ink-soft">
          <span>Date</span>
          <span>Movement</span>
          <span>Quantity</span>
          <span>Balance</span>
          <span>Note</span>
        </div>
        <div className="divide-y divide-rule">
          {entries.map((e) => {
            running += e.type === "load" ? e.amount : -e.amount;
            const isLoad = e.type === "load";
            return (
              <div key={e.id} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_1.4fr] gap-2 sm:gap-4 items-center px-5 py-3.5">
                <span className="font-body text-sm text-ink">{formatDate(e.date)}</span>
                <span
                  className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 font-body text-[12px] font-medium ${
                    isLoad ? "bg-moss/12 text-moss" : "bg-clay/12 text-clay"
                  }`}
                >
                  {isLoad ? <PackagePlus size={11} /> : <PackageMinus size={11} />}
                  {isLoad ? "Loaded" : "Offloaded"}
                </span>
                <span className="font-mono text-sm text-ink">
                  {isLoad ? "+" : "−"}
                  {e.amount}
                </span>
                <span className="font-mono text-sm text-ink/70">{running}</span>
                <span className="font-body text-xs text-ink/50 truncate col-span-2 sm:col-span-1">{e.note || "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}