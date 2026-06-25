import { useLoaderData } from "react-router";
import { Link } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import dashStyles from "../styles/dashboard.css?url";

export const links = () => [
  { rel: "stylesheet", href: dashStyles },
];

/* ─── Loader: fetch all dashboard data ─── */
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const shopName = shop.replace(".myshopify.com", "");

  // Date boundaries
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    totalSignups,
    lastMonthSignups,
    pushSentThisMonth,
    pushSentLastMonth,
    totalSent,
    settings,
  ] = await Promise.all([
    // Total waitlist signups (all time, all statuses)
    prisma.subscription.count({ where: { shop } }),
    // Last month's signups (for trend)
    prisma.subscription.count({
      where: { shop, createdAt: { gte: lastMonthStart, lt: thisMonthStart } },
    }),
    // Push sent this month
    prisma.subscription.count({
      where: { shop, status: "SENT", channel: { contains: "push" }, createdAt: { gte: thisMonthStart } },
    }),
    // Push sent last month (for trend)
    prisma.subscription.count({
      where: { shop, status: "SENT", channel: { contains: "push" }, createdAt: { gte: lastMonthStart, lt: thisMonthStart } },
    }),
    // All sent (for conversion rate)
    prisma.subscription.count({ where: { shop, status: "SENT" } }),
    prisma.settings.findUnique({ where: { shop } }),
  ]);

  // Trend helper: % change vs last period
  function trendPct(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  const thisMonthSignups = await prisma.subscription.count({
    where: { shop, createdAt: { gte: thisMonthStart } },
  });

  const conversionRate = totalSignups > 0
    ? parseFloat(((totalSent / totalSignups) * 100).toFixed(1))
    : 0;
  const lastMonthConvRate = lastMonthSignups > 0
    ? parseFloat((pushSentLastMonth / lastMonthSignups * 100).toFixed(1))
    : 0;

  const stats = {
    totalSignups,
    totalSignupsTrend: trendPct(thisMonthSignups, lastMonthSignups),
    pushSentThisMonth,
    pushSentTrend: trendPct(pushSentThisMonth, pushSentLastMonth),
    conversionRate,
    conversionTrend: trendPct(conversionRate, lastMonthConvRate),
  };

  // ── Shopify Inventory: low stock + out of stock product counts ──
  const threshold = settings ? (settings.lowStockThreshold ?? 0) : 12;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  try {
    const inventoryRes = await admin.graphql(`
      query {
        products(first: 250) {
          edges {
            node {
              id
              variants(first: 20) {
                edges {
                  node {
                    inventoryQuantity
                    availableForSale
                    inventoryItem {
                      tracked
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
    const inventoryData = await inventoryRes.json();
    const products = inventoryData.data?.products?.edges || [];
    for (const { node: product } of products) {
      const variants = product.variants.edges.map((e) => e.node);
      let hasOutOfStock = false;
      let hasLowStock = false;

      for (const v of variants) {
        const isTracked = v.inventoryItem?.tracked ?? false;
        const qty = v.inventoryQuantity ?? 0;
        
        const variantOutOfStock = !v.availableForSale || (isTracked && qty <= 0);
        const variantLowStock = isTracked && qty > 0 && qty <= threshold && v.availableForSale;

        if (variantOutOfStock) {
          hasOutOfStock = true;
        }
        if (variantLowStock) {
          hasLowStock = true;
        }
      }

      if (hasOutOfStock) {
        outOfStockCount++;
      }
      if (hasLowStock) {
        lowStockCount++;
      }
    }
  } catch (err) {
    console.warn("Could not fetch inventory:", err.message);
  }

  // Keep for app status panel
  const totalSubscribers = await prisma.subscription.count({ where: { shop, status: "PENDING" } });
  const notificationsSent = totalSent;
  const pushSubscribers = await prisma.subscription.count({ where: { shop, status: "PENDING", channel: { contains: "push" } } });

  // Fetch last 50 subscriptions for building the activity feed
  const allRecent = await prisma.subscription.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      productId: true,
      productTitle: true,
      productImage: true,
      variantTitle: true,
      channel: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Build activity feed items from raw subscription data
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const activityItems = [];
  
  // Group signups by product and day
  const signupGroups = {};
  // Group sent alerts by product and restock minute (to batch them)
  const sentGroups = {};

  for (const sub of allRecent) {
    const prodId = sub.productId;
    const prodTitle = sub.productTitle || "Unnamed Product";
    const prodImg = sub.productImage || null;
    
    // 1. Every subscription record represents a waitlist signup at sub.createdAt
    const signupDateStr = new Date(sub.createdAt).toDateString();
    const signupKey = `${prodId}_${signupDateStr}`;
    if (!signupGroups[signupKey]) {
      signupGroups[signupKey] = {
        productId: prodId,
        productTitle: prodTitle,
        productImage: prodImg,
        date: sub.createdAt,
        count: 0,
      };
    }
    signupGroups[signupKey].count++;
    if (new Date(sub.createdAt) > new Date(signupGroups[signupKey].date)) {
      signupGroups[signupKey].date = sub.createdAt;
    }

    // 2. If status is SENT, it also represents a restock notification event at sub.updatedAt
    if (sub.status === "SENT") {
      const restockDate = sub.updatedAt || sub.createdAt;
      const restockTimeMs = new Date(restockDate).getTime();
      const restockMinute = Math.floor(restockTimeMs / 60000); // group within the same minute
      const sentKey = `${prodId}_${restockMinute}`;
      
      if (!sentGroups[sentKey]) {
        sentGroups[sentKey] = {
          productId: prodId,
          productTitle: prodTitle,
          productImage: prodImg,
          date: restockDate,
          count: 0,
        };
      }
      sentGroups[sentKey].count++;
      if (new Date(restockDate) > new Date(sentGroups[sentKey].date)) {
        sentGroups[sentKey].date = restockDate;
      }
    }
  }

  // Convert groups to activity items
  for (const group of Object.values(signupGroups)) {
    const todaySignups = new Date(group.date) >= todayStart ? group.count : 0;
    activityItems.push({
      type: "signup",
      dot: "green",
      title: group.productTitle,
      subtitle:
        todaySignups > 0
          ? `${todaySignups} new waitlist signup${todaySignups !== 1 ? "s" : ""} today`
          : `${group.count} waitlist subscriber${group.count !== 1 ? "s" : ""}`,
      image: group.productImage,
      date: group.date,
    });
  }

  for (const group of Object.values(sentGroups)) {
    activityItems.push({
      type: "restock_sent",
      dot: "green",
      title: `Restock alert sent — ${group.productTitle}`,
      subtitle: `${group.count} customer${group.count !== 1 ? "s" : ""} notified`,
      image: group.productImage,
      date: group.date,
    });
  }

  // Sort by date descending
  activityItems.sort((a, b) => new Date(b.date) - new Date(a.date));
  const activityFeed = activityItems.slice(0, 4);

  // Top products by subscriber count
  const productCountMap = {};
  for (const sub of allRecent) {
    if (sub.status !== "PENDING") continue;
    const key = sub.productId;
    if (!productCountMap[key]) {
      productCountMap[key] = {
        productId: sub.productId,
        productTitle: sub.productTitle || "Unnamed Product",
        productImage: sub.productImage || null,
        count: 0,
      };
    }
    productCountMap[key].count++;
  }
  const topProducts = Object.values(productCountMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return Response.json({
    shop,
    shopName,
    stats,
    statusPanel: { totalSubscribers, pushSubscribers, notificationsSent },
    activityFeed,
    topProducts,
    settings,
    inventory: { lowStockCount, outOfStockCount },
  });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

/* ─── Helpers ─── */
function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 30) return `${diffDay}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ─── Dashboard Component ─── */
export default function Dashboard() {
  const { shopName, stats, statusPanel, activityFeed, topProducts, settings, inventory } = useLoaderData();

  const maxCount = topProducts.length > 0 ? topProducts[0].count : 1;

  // Format number with commas
  const fmt = (n) => Number(n).toLocaleString();
  const isSetupDone = settings && settings.pushEnabled;

  return (
    <div class="dash-root">

      {/* ── Hero Header ── */}
      <div class="dash-hero">
        <div class="dash-hero-inner">
          <div class="dash-hero-text">
            <h1>Welcome, Merchant</h1>
            <div class="dash-hero-pills">
              {inventory.lowStockCount > 0 && (
                <span class="hero-pill hero-pill-amber">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  {inventory.lowStockCount} product{inventory.lowStockCount !== 1 ? "s" : ""} with low stock
                </span>
              )}
              {inventory.outOfStockCount > 0 && (
                <span class="hero-pill hero-pill-orange">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  {inventory.outOfStockCount} product{inventory.outOfStockCount !== 1 ? "s" : ""} out of stock
                </span>
              )}
              {inventory.lowStockCount === 0 && inventory.outOfStockCount === 0 && (
                <span class="hero-pill hero-pill-green">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  All products in stock
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Canvas ── */}
      <div class="dash-canvas">

        {/* ── Setup Banner (only if not configured) ── */}
        {!isSetupDone && (
          <div class="setup-banner">
            <span class="setup-banner-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 1 0 4.93 19.07"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>
            </span>
            <div class="setup-banner-text">
              <strong>Complete your setup</strong>
              <span>Enable push notifications to start collecting subscribers.</span>
            </div>
            <Link to="/app/settings?page=out-of-stock" class="setup-banner-btn">
              Configure →
            </Link>
          </div>
        )}

        {/* ── Stat Cards ── */}
        <div class="dash-stats">

          {/* Card 1: Total Waitlist Signups */}
          <div class="stat-card">
            <div class="stat-card-head">
              <div class="stat-card-icon stat-icon-teal">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <span class={`stat-trend ${stats.totalSignupsTrend >= 0 ? "trend-up" : "trend-down"}`}>
                {stats.totalSignupsTrend >= 0 ? "↑" : "↓"} {Math.abs(stats.totalSignupsTrend)}%
              </span>
            </div>
            <div class="stat-card-value">{fmt(stats.totalSignups)}</div>
            <div class="stat-card-label">Total Waitlist Signups</div>
            <div class="stat-card-bar"><div class="stat-card-bar-fill" style={{ width: "72%" }}></div></div>
          </div>

          {/* Card 3: Push Notifications Sent This Month */}
          <div class="stat-card">
            <div class="stat-card-head">
              <div class="stat-card-icon stat-icon-violet">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              </div>
              <span class={`stat-trend ${stats.pushSentTrend >= 0 ? "trend-up" : "trend-down"}`}>
                {stats.pushSentTrend >= 0 ? "↑" : "↓"} {Math.abs(stats.pushSentTrend)}%
              </span>
            </div>
            <div class="stat-card-value">{fmt(stats.pushSentThisMonth)}</div>
            <div class="stat-card-label">Push Notifications Sent This Month</div>
            <div class="stat-card-bar"><div class="stat-card-bar-fill" style={{ width: "55%" }}></div></div>
          </div>

          {/* Card 4: Conversion Rate */}
          <div class="stat-card">
            <div class="stat-card-head">
              <div class="stat-card-icon stat-icon-amber">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <span class={`stat-trend ${stats.conversionTrend >= 0 ? "trend-up" : "trend-down"}`}>
                {stats.conversionTrend >= 0 ? "↑" : "↓"} {Math.abs(stats.conversionTrend)}%
              </span>
            </div>
            <div class="stat-card-value">{stats.conversionRate}%</div>
            <div class="stat-card-label">Conversion Rate</div>
            <div class="stat-card-bar"><div class="stat-card-bar-fill" style={{ width: `${Math.min(stats.conversionRate, 100)}%` }}></div></div>
          </div>

        </div>

        {/* ── Recent Activity Feed (Full Width) ── */}
        <div class="dash-card">
          <div class="dash-card-header">
            <div>
              <p class="dash-card-title">Recent Activity</p>
              <p class="dash-card-subtitle">Live updates from your Restockly campaigns</p>
            </div>
            {activityFeed.length > 0 && (
              <Link to="/app/notifications" class="view-all-link">
                View all <span style={{ marginLeft: "2px" }}>→</span>
              </Link>
            )}
          </div>

          {activityFeed.length === 0 ? (
            <div class="dash-empty">
              <div class="dash-empty-icon">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.3}}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </div>
              <h3 class="dash-empty-title">No activity yet</h3>
              <p class="dash-empty-text">
                Once your storefront widget is active and customers sign up, activity will appear here.
              </p>
              <Link to="/app/settings" class="dash-empty-btn">
                Set up your widget →
              </Link>
            </div>
          ) : (
            <div class="activity-feed">
              {activityFeed.map((item, idx) => (
                <div class="activity-row" key={idx}>
                  {/* Dot + line */}
                  <div class="activity-timeline">
                    <span class={`activity-dot ${item.dot === "amber" ? "activity-dot-amber" : "activity-dot-green"}`}></span>
                    {idx < activityFeed.length - 1 && <span class="activity-line"></span>}
                  </div>

                  {/* Thumbnail */}
                    <div class="activity-thumb">
                    {item.image ? (
                      <img src={item.image} alt={item.title} />
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.4}}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                    )}
                    </div>

                  {/* Text */}
                  <div class="activity-text">
                    <div class="activity-title">{item.title}</div>
                    <div class="activity-subtitle">{item.subtitle}</div>
                  </div>

                  {/* Time */}
                  <div class="activity-time">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:"4px",verticalAlign:"middle"}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {timeAgo(item.date)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
