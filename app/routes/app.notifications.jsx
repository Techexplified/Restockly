import { useLoaderData } from "react-router";
import { Link } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import dashStyles from "../styles/dashboard.css?url";

export const links = () => [
  { rel: "stylesheet", href: dashStyles },
];

/* ─── Loader: fetch all notifications data ─── */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Fetch last 250 subscriptions for building the complete history
  const allRecent = await prisma.subscription.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 250,
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

  // Build activity list
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

  return Response.json({
    activityFeed: activityItems,
  });
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

/* ─── Page Component ─── */
export default function NotificationsPage() {
  const { activityFeed } = useLoaderData();

  return (
    <div class="dash-root">
      {/* ── Hero Header ── */}
      <div class="dash-hero" style={{ padding: "32px 40px 64px" }}>
        <div class="dash-hero-inner">
          <div class="dash-hero-text">
            <h1 style={{ display: "flex", alignItems: "center", gap: "16px", margin: 0 }}>
              <Link 
                to="/app" 
                style={{ 
                  color: "#ffffff", 
                  textDecoration: "none", 
                  display: "inline-flex", 
                  alignItems: "center",
                  justifyContent: "center",
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                  fontSize: "20px",
                  transition: "background 0.2s"
                }}
                onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.25)"}
                onMouseOut={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
              >
                ←
              </Link>
              All Notifications
            </h1>
          </div>
        </div>
      </div>

      {/* ── Main Canvas ── */}
      <div class="dash-canvas" style={{ marginTop: "-32px" }}>
        <div class="dash-card">
          <div class="dash-card-header">
            <div>
              <p class="dash-card-title">Notification History</p>
              <p class="dash-card-subtitle">Full list of waitlist signups and sent restock alerts</p>
            </div>
          </div>

          {activityFeed.length === 0 ? (
            <div class="dash-empty">
              <div class="dash-empty-icon">📭</div>
              <h3 class="dash-empty-title">No notifications yet</h3>
              <p class="dash-empty-text">
                Once customers begin signing up for out-of-stock products, updates will appear here.
              </p>
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
                      "🛍️"
                    )}
                  </div>

                  {/* Text */}
                  <div class="activity-text">
                    <div class="activity-title">{item.title}</div>
                    <div class="activity-subtitle">{item.subtitle}</div>
                  </div>

                  {/* Time */}
                  <div class="activity-time">🕐 {timeAgo(item.date)}</div>
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
