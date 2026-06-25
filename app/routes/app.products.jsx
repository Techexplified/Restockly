import { useLoaderData, useRevalidator } from "react-router";
import { Link } from "react-router";
import { useState, useMemo } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import dashStyles from "../styles/dashboard.css?url";
import productsStyles from "../styles/products.css?url";

export const links = () => [
  { rel: "stylesheet", href: dashStyles },
  { rel: "stylesheet", href: productsStyles },
];

/* ─── Loader ─── */
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch settings for low-stock threshold
  const settings = await prisma.settings.findUnique({ where: { shop } });
  const threshold = settings ? (settings.lowStockThreshold ?? 10) : 10;

  // Fetch all pending subscriptions grouped by productId
  const allPending = await prisma.subscription.findMany({
    where: { shop, status: "PENDING" },
    select: { productId: true, variantId: true },
  });

  // Build per-product subscriber count map
  const subCountMap = {};
  for (const s of allPending) {
    subCountMap[s.productId] = (subCountMap[s.productId] || 0) + 1;
  }

  // Fetch products from Shopify with inventory info
  let products = [];
  try {
    const res = await admin.graphql(`
      query {
        products(first: 250) {
          edges {
            node {
              id
              title
              handle
              status
              featuredImage {
                url
                altText
              }
              variants(first: 20) {
                edges {
                  node {
                    id
                    title
                    inventoryQuantity
                    availableForSale
                    inventoryItem {
                      tracked
                    }
                    price
                  }
                }
              }
            }
          }
        }
      }
    `);
    const data = await res.json();
    const edges = data.data?.products?.edges || [];

    for (const { node: p } of edges) {
      const variants = p.variants.edges.map((e) => e.node);

      let totalQty = 0;
      let allUntracked = true;
      let anyOutOfStock = false;
      let anyLowStock = false;
      let anyAvailable = false;

      for (const v of variants) {
        const isTracked = v.inventoryItem?.tracked ?? false;
        const qty = v.inventoryQuantity ?? 0;
        if (isTracked) {
          allUntracked = false;
          totalQty += qty;
          if (!v.availableForSale || qty <= 0) {
            anyOutOfStock = true;
          } else if (qty <= threshold) {
            anyLowStock = true;
            anyAvailable = true;
          } else {
            anyAvailable = true;
          }
        } else {
          anyAvailable = true;
        }
      }

      let stockStatus = "in_stock";
      if (!allUntracked) {
        // If total tracked quantity is 0 or less → always out of stock
        if (totalQty <= 0) {
          stockStatus = "out_of_stock";
        } else if (anyLowStock && !anyOutOfStock) {
          stockStatus = "low_stock";
        } else if (anyOutOfStock && anyAvailable) {
          // Mixed: some variants out of stock but others available → low stock
          stockStatus = "low_stock";
        } else if (anyOutOfStock) {
          stockStatus = "out_of_stock";
        }
      }

      const shopifyNumericId = p.id.replace("gid://shopify/Product/", "");
      const subscriberCount = subCountMap[shopifyNumericId] || 0;

      products.push({
        id: shopifyNumericId,
        gid: p.id,
        title: p.title,
        handle: p.handle,
        status: p.status,
        image: p.featuredImage?.url || null,
        imageAlt: p.featuredImage?.altText || p.title,
        totalQty: allUntracked ? null : totalQty,
        stockStatus,
        variantCount: variants.length,
        subscriberCount,
      });
    }

    // Sort: out_of_stock → low_stock → in_stock, then by subscribers desc
    const order = { out_of_stock: 0, low_stock: 1, in_stock: 2 };
    products.sort((a, b) => {
      const statusDiff = order[a.stockStatus] - order[b.stockStatus];
      if (statusDiff !== 0) return statusDiff;
      return b.subscriberCount - a.subscriberCount;
    });
  } catch (err) {
    console.warn("Could not fetch products:", err.message);
  }

  const totalProducts = products.length;
  const outOfStockCount = products.filter((p) => p.stockStatus === "out_of_stock").length;
  const lowStockCount = products.filter((p) => p.stockStatus === "low_stock").length;

  return Response.json({
    products,
    totalProducts,
    outOfStockCount,
    lowStockCount,
    threshold,
  });
};

/* ─── SVG Icons ─── */
const IconBox = ({ size = 13, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

const IconBell = ({ size = 13, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const IconRefresh = ({ size = 14, color = "currentColor", spinning = false }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transition: "transform 0.6s linear", transform: spinning ? "rotate(360deg)" : "none" }}
  >
    <polyline points="23 4 23 10 17 10"/>
    <polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
);

const IconSearch = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

const IconX = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconShoppingBag = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
    <path d="M16 10a4 4 0 01-8 0"/>
  </svg>
);

/* ─── Stock Badge ─── */
function StockBadge({ status }) {
  if (status === "out_of_stock")
    return <span className="prod-badge prod-badge-red">Out of Stock</span>;
  if (status === "low_stock")
    return <span className="prod-badge prod-badge-amber">Low Stock</span>;
  return <span className="prod-badge prod-badge-green">In Stock</span>;
}

/* ─── Stock Bar ─── */
function StockBar({ qty, threshold }) {
  if (qty === null) return null;
  const max = Math.max(threshold * 3, qty, 1);
  const pct = Math.min(100, Math.round((qty / max) * 100));
  const color = qty <= 0 ? "#ef4444" : qty <= threshold ? "#f59e0b" : "#22c55e";
  return (
    <div className="prod-stock-bar-track">
      <div className="prod-stock-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ─── Page Component ─── */
export default function ProductsPage() {
  const { products, totalProducts, outOfStockCount, lowStockCount, threshold } = useLoaderData();
  const { revalidate, state: revalidatorState } = useRevalidator();
  const isRefreshing = revalidatorState === "loading";

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = products;

    // Apply stock filter
    if (activeFilter === "low_stock") {
      list = list.filter((p) => p.stockStatus === "low_stock");
    } else if (activeFilter === "out_of_stock") {
      list = list.filter((p) => p.stockStatus === "out_of_stock");
    }

    // Apply search
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => p.title.toLowerCase().includes(q));
    }

    return list;
  }, [products, search, activeFilter]);

  return (
    <div className="dash-root">
      {/* ── Hero ── */}
      <div className="dash-hero" style={{ padding: "32px 40px 72px" }}>
        <div className="dash-hero-inner">
          <div className="dash-hero-text">
            <h1 style={{ margin: "0 0 14px" }}>Your Products</h1>
            <div className="dash-hero-pills">
              {outOfStockCount > 0 && (
                <span className="hero-pill hero-pill-orange">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  {outOfStockCount} out of stock
                </span>
              )}
              {lowStockCount > 0 && (
                <span className="hero-pill hero-pill-amber">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  {lowStockCount} low stock
                </span>
              )}
              {outOfStockCount === 0 && lowStockCount === 0 && (
                <span className="hero-pill hero-pill-green">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  All products in stock
                </span>
              )}
            </div>
          </div>
          {/* Refresh button */}
          <button
            onClick={revalidate}
            disabled={isRefreshing}
            className="prod-refresh-btn"
            title="Refresh inventory data from Shopify"
          >
            <IconRefresh size={14} color="currentColor" spinning={isRefreshing} />
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Main Canvas ── */}
      <div className="dash-canvas" style={{ marginTop: "-40px" }}>
        <div className="dash-card" style={{ marginBottom: "20px" }}>
          {/* Search + Filter bar */}
          <div className="prod-toolbar">
            {/* Search input */}
            <div className="prod-search-wrap">
              <span className="prod-search-icon"><IconSearch size={15} /></span>
              <input
                className="prod-search-input"
                type="text"
                placeholder="Search products, SKU, tags..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="prod-search-clear" onClick={() => setSearch("")}><IconX size={11} /></button>
              )}
            </div>

            {/* Filter pills */}
            <div className="prod-filter-pills">
              <button
                className={`prod-filter-pill ${activeFilter === "all" ? "prod-filter-active" : ""}`}
                onClick={() => setActiveFilter("all")}
              >
                All
              </button>
              <button
                className={`prod-filter-pill prod-filter-pill-amber ${activeFilter === "low_stock" ? "prod-filter-active-amber" : ""}`}
                onClick={() => setActiveFilter(activeFilter === "low_stock" ? "all" : "low_stock")}
              >
                <span className="prod-filter-dot prod-filter-dot-amber" />
                Low Stock
              </button>
              <button
                className={`prod-filter-pill prod-filter-pill-red ${activeFilter === "out_of_stock" ? "prod-filter-active-red" : ""}`}
                onClick={() => setActiveFilter(activeFilter === "out_of_stock" ? "all" : "out_of_stock")}
              >
                <span className="prod-filter-dot prod-filter-dot-red" />
                Out Of Stock
              </button>
            </div>
          </div>
        </div>

        {/* Product count label */}
        {filtered.length > 0 && (
          <div className="prod-section-header">
            <span className="prod-section-title">
              {activeFilter === "all" ? "All Products" : activeFilter === "low_stock" ? "Low Stock Products" : "Out of Stock Products"}
            </span>
            <span className="prod-section-count">{filtered.length} product{filtered.length !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Empty state */}
        {filtered.length === 0 ? (
          <div className="dash-card">
            <div className="dash-empty">
              <div className="dash-empty-icon"><IconShoppingBag size={44} /></div>
              <h3 className="dash-empty-title">
                {search ? "No products match your search" : "No products found"}
              </h3>
              <p className="dash-empty-text">
                {search
                  ? `Try a different search term.`
                  : `Add products to your Shopify store and they will appear here.`}
              </p>
              {search && (
                <button className="dash-empty-btn" onClick={() => setSearch("")}>
                  Clear search
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Product grid */
          <div className="prod-grid">
            {filtered.map((product) => (
              <div
                key={product.id}
                className={`prod-card ${
                  product.stockStatus === "out_of_stock"
                    ? "prod-card-oos"
                    : product.stockStatus === "low_stock"
                    ? "prod-card-low"
                    : ""
                }`}
              >
                {/* Product image */}
                <div className="prod-card-img-wrap">
                  {product.image ? (
                    <img src={product.image} alt={product.imageAlt} className="prod-card-img" />
                  ) : (
                    <div className="prod-card-img-placeholder"><IconShoppingBag size={44} /></div>
                  )}
                  <div className="prod-card-badge-overlay">
                    <StockBadge status={product.stockStatus} />
                  </div>
                </div>

                {/* Card body */}
                <div className="prod-card-body">
                  <div className="prod-card-title" title={product.title}>
                    {product.title}
                  </div>

                  {/* Units remaining */}
                  <div className="prod-card-stock-info">
                    {product.totalQty === null ? (
                      <span className="prod-stock-label prod-stock-label-gray">
                        <IconBox size={12} color="#0f172a" /> Inventory not tracked
                      </span>
                    ) : product.totalQty <= 0 ? (
                      <span className="prod-stock-label prod-stock-label-red">
                        <IconBox size={12} color="#0f172a" /> 0 units remaining
                      </span>
                    ) : (
                      <span
                        className={`prod-stock-label ${
                          product.totalQty <= threshold
                            ? "prod-stock-label-amber"
                            : "prod-stock-label-green"
                        }`}
                      >
                        <IconBox size={12} color="#0f172a" />
                        {product.totalQty} unit{product.totalQty !== 1 ? "s" : ""} remaining
                      </span>
                    )}
                    <StockBar qty={product.totalQty} threshold={threshold} />
                  </div>

                  {/* Subscriber count */}
                  <div className="prod-card-subs">
                    <div className="prod-subs-icon"><IconBell size={13} color="#475569" /></div>
                    <div className="prod-subs-info">
                      <span className="prod-subs-count">{product.subscriberCount}</span>
                      <span className="prod-subs-label">
                        {product.subscriberCount === 1 ? "person" : "people"} subscribed for restock
                      </span>
                    </div>
                    {product.subscriberCount > 0 && (
                      <div className="prod-subs-dot-wrap">
                        {Array.from({ length: Math.min(product.subscriberCount, 5) }).map((_, i) => (
                          <div
                            key={i}
                            className="prod-subs-avatar"
                            style={{
                              background: `hsl(${(i * 67 + 180) % 360}, 60%, 65%)`,
                              marginLeft: i > 0 ? "-6px" : 0,
                              zIndex: 5 - i,
                            }}
                          />
                        ))}
                        {product.subscriberCount > 5 && (
                          <div
                            className="prod-subs-avatar prod-subs-avatar-more"
                            style={{ marginLeft: "-6px", zIndex: 0 }}
                          >
                            +{product.subscriberCount - 5}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
