import { useLoaderData, Link, useSearchParams, useSubmit, useNavigation } from "react-router";
import { useState, useEffect } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/settings.css?url";

export const links = () => [
  { rel: "stylesheet", href: styles }
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const shopName = shop.replace(".myshopify.com", "");

  let settings = await prisma.settings.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await prisma.settings.create({
      data: { shop },
    });
  }

  return Response.json({ shop, shopName, settings });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const formType = formData.get("formType");

  if (formType === "out-of-stock") {
    const buttonText = formData.get("buttonText");
    const confirmMsg = formData.get("confirmMsg");
    const theme = formData.get("theme");
    const pushEnabled = formData.get("pushEnabled") === "true";

    const settings = await prisma.settings.upsert({
      where: { shop },
      update: {
        buttonText,
        confirmMsg,
        theme,
        pushEnabled,
      },
      create: {
        shop,
        buttonText,
        confirmMsg,
        theme,
        pushEnabled,
      },
    });

    return Response.json({ success: true, settings });
  } else if (formType === "push-notifications") {
    const pushTitle = formData.get("pushTitle");
    const pushBody = formData.get("pushBody");
    const pushCta = formData.get("pushCta");
    const pushReminderEnabled = formData.get("pushReminderEnabled") === "true";
    const pushReminderDelay = formData.get("pushReminderDelay");
    const pushReminderMax = Number(formData.get("pushReminderMax"));

    const settings = await prisma.settings.upsert({
      where: { shop },
      update: {
        pushTitle,
        pushBody,
        pushCta,
        pushReminderEnabled,
        pushReminderDelay,
        pushReminderMax,
      },
      create: {
        shop,
        pushTitle,
        pushBody,
        pushCta,
        pushReminderEnabled,
        pushReminderDelay,
        pushReminderMax,
      },
    });

    return Response.json({ success: true, settings });
  } else if (formType === "low-stock") {
    const rawThreshold = formData.get("lowStockThreshold");
    const lowStockThreshold = (rawThreshold === null || rawThreshold === "") ? null : Number(rawThreshold);
    const lowStockText = formData.get("lowStockText");
    const lowStockTheme = formData.get("lowStockTheme");

    const settings = await prisma.settings.upsert({
      where: { shop },
      update: {
        lowStockThreshold,
        lowStockText,
        lowStockTheme,
      },
      create: {
        shop,
        lowStockThreshold,
        lowStockText,
        lowStockTheme,
      },
    });

    return Response.json({ success: true, settings });
  }

  return Response.json({ success: false });
};

export default function SettingsIndex() {
  const { shop, shopName, settings: initialSettings } = useLoaderData();
  const [searchParams] = useSearchParams();
  const page = searchParams.get("page");
  
  const initialStep = searchParams.get("step") === "2" ? 2 : 1;
  const [step, setStep] = useState(initialStep);
  const [isEmbedded, setIsEmbedded] = useState(false);

  // Sync step if search params step changes
  useEffect(() => {
    const paramStep = searchParams.get("step");
    if (paramStep === "2") {
      setStep(2);
    } else if (paramStep === "1") {
      setStep(1);
    }
  }, [searchParams]);

  // Deep link to theme customizer App Embed tab
  const themeEditorUrl = `https://admin.shopify.com/store/${shopName}/themes/current/editor?context=apps`;

  const handleEmbedClick = () => {
    window.open(themeEditorUrl, "_blank");
    setIsEmbedded(true); // Automatically mark as embedded to help user proceed
  };

  if (page === "out-of-stock") {
    return <OutOfStockSettings initialSettings={initialSettings} />;
  }

  if (page === "low-stock") {
    return <LowStockSettings initialSettings={initialSettings} />;
  }

  if (page === "push-notifications") {
    return <PushNotificationsSettings initialSettings={initialSettings} />;
  }



  return (
    <div class="restockly-container">
      {/* Main Content Area */}
      <main class="app-main">
        {step === 1 ? (
          /* Step 1: Welcome & Embed App */
          <div class="onboarding-card">
            <h1 class="card-title">Welcome aboard!</h1>
            <p class="card-subtitle">Let's get your app up and running in just a few steps.</p>
            
            <div class="card-divider"></div>
            
            <div class="embed-section">
              <h2 class="section-title">Embed App</h2>
              <p class="section-text">Activate your app in the Shopify theme editor to display it on your storefront.</p>
              
              <button class="btn-embed" onClick={handleEmbedClick}>
                Embed App in Your Store
              </button>
            </div>

            <div class="card-footer">
              <button 
                class="btn-next" 
                onClick={() => setStep(2)}
              >
                Next Step →
              </button>
            </div>
          </div>
        ) : (
          /* Step 2: Start setting up settings */
          <div class="onboarding-card">
            <h1 class="card-title">Start Setting up your app!</h1>
            <p class="card-subtitle">Start by setting up settings for...</p>
            
            <div class="router-cards-grid">
              <Link to="/app/settings?page=out-of-stock" class="router-card">
                Out Of Stock
                <br />
                Product Settings
              </Link>
              <Link to="/app/settings?page=low-stock" class="router-card">
                Low Stock
                <br />
                Product Settings
              </Link>
            </div>
            
            <div class="card-divider"></div>
            
            <div class="card-footer" style={{ justifyContent: "flex-start" }}>
              <button class="btn-next" onClick={() => setStep(1)} style={{ backgroundColor: "#f1f5f9", color: "#64748b" }}>
                ← Back
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* --- Sub-Components --- */

function OutOfStockSettings({ initialSettings }) {
  const submit = useSubmit();
  const navigation = useNavigation();

  const [buttonText, setButtonText] = useState(initialSettings.buttonText);
  const [confirmMsg, setConfirmMsg] = useState(initialSettings.confirmMsg);
  const [theme, setTheme] = useState(initialSettings.theme);
  const [pushEnabled, setPushEnabled] = useState(initialSettings.pushEnabled);
  const [showToast, setShowToast] = useState(false);

  const isSaving = navigation.state === "submitting";

  const handleSave = (e) => {
    e.preventDefault();
    submit({
      formType: "out-of-stock",
      buttonText,
      confirmMsg,
      theme,
      pushEnabled: String(pushEnabled),
    }, { method: "post" });
  };

  useEffect(() => {
    if (navigation.state === "loading" && navigation.formData && navigation.formData.get("formType") === "out-of-stock") {
      setShowToast(true);
      const timer = setTimeout(() => {
        setShowToast(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [navigation.state, navigation.formData]);

  useEffect(() => {
    setButtonText(initialSettings.buttonText);
    setConfirmMsg(initialSettings.confirmMsg);
    setTheme(initialSettings.theme);
    setPushEnabled(initialSettings.pushEnabled);
  }, [initialSettings]);

  return (
    <div class="settings-layout">
      {/* Breadcrumb Navigation */}
      <nav class="settings-breadcrumb">
        <Link to="/app/settings?step=2" class="settings-breadcrumb-link">Settings</Link> &gt; Out Of Stock
      </nav>

      {/* Main Title */}
      <h1 class="settings-title">Out Of Stock Product Settings</h1>



            {/* Page Actions Row */}
      <div class="settings-page-actions">
        <Link to="/app/settings?step=2" class="btn-back-footer">← Back</Link>
      </div>

      <form id="oos-form" onSubmit={handleSave}>
        {/* Unified Card for all Out Of Stock Settings */}
        <div class="settings-card">
          {/* Section 1: Notify Me Configuration */}
          <h2 class="settings-section-title">Notify Me Configuration</h2>
          <div class="settings-card-section" style={{ borderBottom: "none", paddingBottom: "0px", marginBottom: "0px" }}>
            {/* Widget Button Text */}
            <div class="form-group">
              <label class="form-label form-label-required" for="widget-button-text">Widget button text</label>
              <div class="input-icon-wrapper">
                <div class="input-prefix-box">T</div>
                <input
                  id="widget-button-text"
                  type="text"
                  class="input-field"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  placeholder="Notify Me When Available"
                  required
                />
              </div>
              <p class="helper-text">This text appears on the button shown to customers on the product page.</p>
            </div>

            {/* Confirmation Message */}
            <div class="form-group" style={{ marginTop: "16px" }}>
              <label class="form-label" for="confirmation-message">Confirmation message</label>
              <div class="input-icon-wrapper">
                <div class="input-prefix-box">✓</div>
                <input
                  id="confirmation-message"
                  type="text"
                  class="input-field"
                  value={confirmMsg}
                  onChange={(e) => setConfirmMsg(e.target.value)}
                  placeholder="You're on the list!"
                />
              </div>
              <p class="helper-text">Shown after a customer subscribes.</p>
            </div>

          </div>

          {/* Section Divider */}
          <hr class="section-divider" />

          {/* Section 2: Alert Settings */}
          <h2 class="settings-section-title" style={{ marginTop: "0px" }}>Alert Settings</h2>
          <div class="settings-card-section" style={{ borderBottom: "none", paddingBottom: "0px", marginBottom: "0px" }}>
            {/* Push Notifications Toggle */}
            <div class="toggle-left-container">
              <div class="toggle-left-row">
                <label class="ios-switch">
                  <input
                    type="checkbox"
                    checked={pushEnabled}
                    onChange={(e) => setPushEnabled(e.target.checked)}
                  />
                  <span class="ios-slider"></span>
                </label>
                <span class="toggle-left-label">Push Notifications</span>
              </div>
              <span class="toggle-left-subtext">Send automatic web push alerts when variants are restocked.</span>
              <div style={{ paddingLeft: "62px", marginTop: "8px" }}>
                <Link to="/app/settings?page=push-notifications" class="chevron-link-button">
                  Push Notifications Settings
                </Link>
              </div>
            </div>

          </div>
        </div>

        {/* Page Footer Action */}
        <div class="settings-footer" style={{ marginTop: "24px" }}>
          <button type="submit" class="btn-save" disabled={isSaving}>
            {isSaving ? "SAVING..." : "SAVE"}
          </button>
        </div>

      </form>

      {/* Floating Save Toast */}
      {showToast && (
        <div class="toast-msg">
          <span>✓ Settings saved successfully</span>
        </div>
      )}
    </div>
  );
}

function LowStockSettings({ initialSettings }) {
  const submit = useSubmit();
  const navigation = useNavigation();

  const [threshold, setThreshold] = useState(
    initialSettings.lowStockThreshold !== null && initialSettings.lowStockThreshold !== undefined
      ? String(initialSettings.lowStockThreshold)
      : ""
  );

  // Parse widgetStyle into prefix + suffix around {quantity}
  const rawText = initialSettings.lowStockText || "Only {quantity} units remaining";
  const splitText = (text) => {
    const idx = text.indexOf("{quantity}");
    if (idx === -1) return { prefix: text, suffix: "" };
    return { prefix: text.slice(0, idx), suffix: text.slice(idx + 10) };
  };
  const parsed = splitText(rawText);
  const [prefix, setPrefix] = useState(parsed.prefix);
  const [suffix, setSuffix] = useState(parsed.suffix);
  const widgetStyle = `${prefix}{quantity}${suffix}`;

  const [theme, setTheme] = useState(initialSettings.lowStockTheme);
  const [showToast, setShowToast] = useState(false);

  const isSaving = navigation.state === "submitting";

  const handleSave = (e) => {
    e.preventDefault();
    submit({
      formType: "low-stock",
      lowStockThreshold: threshold === "" ? "" : String(parseInt(threshold, 10) || 0),
      lowStockText: widgetStyle,
      lowStockTheme: theme,
    }, { method: "post" });
  };

  useEffect(() => {
    if (navigation.state === "loading" && navigation.formData && navigation.formData.get("formType") === "low-stock") {
      setShowToast(true);
      const timer = setTimeout(() => {
        setShowToast(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [navigation.state, navigation.formData]);

  useEffect(() => {
    const raw = initialSettings.lowStockText || "Only {quantity} units remaining";
    const p = splitText(raw);
    setPrefix(p.prefix);
    setSuffix(p.suffix);
    setThreshold(
      initialSettings.lowStockThreshold !== null && initialSettings.lowStockThreshold !== undefined
        ? String(initialSettings.lowStockThreshold)
        : ""
    );
    setTheme(initialSettings.lowStockTheme);
  }, [initialSettings]);

  return (
    <div class="settings-layout">
      {/* Breadcrumb Navigation */}
      <nav class="settings-breadcrumb">
        <Link to="/app/settings?step=2" class="settings-breadcrumb-link">Setting</Link> &gt; Low Stock
      </nav>

      {/* Main Title */}
      <h1 class="settings-title">Low Stock Product Settings</h1>



            {/* Page Actions Row */}
      <div class="settings-page-actions">
        <Link to="/app/settings?step=2" class="btn-back-footer">← Back</Link>
      </div>

      <form id="ls-form" onSubmit={handleSave}>
        {/* Unified Card for all Low Stock Settings */}
        <div class="settings-card">
          {/* Section 1: SetUp */}
          <h2 class="settings-section-title">SetUp</h2>
          <div class="settings-card-section" style={{ borderBottom: "none", paddingBottom: "0px", marginBottom: "0px" }}>
            {/* Low Stock Threshold */}
            <div class="form-group">
              <label class="form-label" for="low-stock-threshold">Low Stock Threshold</label>
              <div class="input-icon-wrapper">

                <input
                  id="low-stock-threshold"
                  type="number"
                  class="input-field"
                  style={{ paddingLeft: "12px" }}
                  value={threshold}
                  onChange={(e) => {
                    const raw = e.target.value;
                    // Allow empty string (user clearing the field) or strip leading zeros
                    if (raw === "") {
                      setThreshold("");
                    } else {
                      const parsed = parseInt(raw, 10);
                      setThreshold(isNaN(parsed) ? "" : String(parsed));
                    }
                  }}
                  min="0"
                />
              </div>
              <p class="helper-text">Low Stock Widget Shows when inventory reaches this threshold</p>
            </div>
          </div>

          {/* Section Divider */}
          <hr class="section-divider" />

          {/* Section 2: Low Stock Widget Configuration */}
          <h2 class="settings-section-title" style={{ marginTop: "0px" }}>Low Stock Widget Configuration</h2>
          <div class="settings-card-section" style={{ borderBottom: "none", paddingBottom: "0px", marginBottom: "0px" }}>
            {/* Urgency Widget Style */}
            <div class="form-group">
              <label class="form-label" for="urgency-widget-style">Urgency Widget Style</label>
              {/* Split field: editable prefix | locked {quantity} chip | editable suffix */}
              <div class="widget-style-row">
                <input
                  id="urgency-widget-prefix"
                  type="text"
                  class="input-field widget-style-part widget-style-prefix"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="Only"
                  size={Math.max(prefix.length || 4, 4)}
                />
                <div class="widget-quantity-chip">
                  {"{"}quantity{"}"}  
                </div>
                <input
                  id="urgency-widget-suffix"
                  type="text"
                  class="input-field widget-style-part"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                  placeholder=" units remaining"
                />
              </div>
              <p class="helper-text" style={{marginTop:"6px"}}>
                The <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:"4px",fontSize:"11px",fontFamily:"monospace"}}>&#123;quantity&#125;</code> token is locked — it will be replaced by the actual stock count on the storefront.
              </p>
            </div>
          </div>
        </div>

        {/* Page Footer Action */}
        <div class="settings-footer" style={{ marginTop: "24px" }}>
          <button type="submit" class="btn-save" disabled={isSaving}>
            {isSaving ? "SAVING..." : "SAVE"}
          </button>
        </div>

      </form>

      {/* Floating Save Toast */}
      {showToast && (
        <div class="toast-msg">
          <span>✓ Settings saved successfully</span>
        </div>
      )}
    </div>
  );
}

function PushNotificationsSettings({ initialSettings }) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [title, setTitle] = useState(initialSettings?.pushTitle || "{product_name} is back in stock!");
  const [body, setBody] = useState(initialSettings?.pushBody || "Grab it before it sells out again — tap to shop now.");
  const [cta, setCta] = useState(initialSettings?.pushCta || "Direct to product page (default)");

  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [tempBody, setTempBody] = useState("");
  const [tempCta, setTempCta] = useState("");

  const [sendReminder, setSendReminder] = useState(initialSettings?.pushReminderEnabled ?? false);
  const [reminderDelay, setReminderDelay] = useState(initialSettings?.pushReminderDelay ?? "3 days");
  const [maxReminders, setMaxReminders] = useState(initialSettings?.pushReminderMax ?? 2);
  const [showToast, setShowToast] = useState(false);

  const handleOpenModal = () => {
    const cleanTitle = title.startsWith("{product_name}")
      ? title.substring("{product_name}".length)
      : title;
    setTempTitle(cleanTitle);
    setTempBody(body);
    setTempCta(cta);
    setIsEditModalOpen(true);
  };

  const handleSaveModal = () => {
    setTitle("{product_name}" + tempTitle);
    setBody(tempBody);
    setCta(tempCta);
    setIsEditModalOpen(false);
  };

  const handleCancel = () => {
    setIsEditModalOpen(false);
  };

  const handleSave = (e) => {
    e.preventDefault();
    submit({
      formType: "push-notifications",
      pushTitle: title,
      pushBody: body,
      pushCta: cta,
      pushReminderEnabled: String(sendReminder),
      pushReminderDelay: reminderDelay,
      pushReminderMax: String(maxReminders),
    }, { method: "post" });
  };

  useEffect(() => {
    if (navigation.state === "loading" && navigation.formData && navigation.formData.get("formType") === "push-notifications") {
      setShowToast(true);
      const timer = setTimeout(() => {
        setShowToast(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [navigation.state, navigation.formData]);

  useEffect(() => {
    if (initialSettings) {
      setTitle(initialSettings.pushTitle || "{product_name} is back in stock!");
      setBody(initialSettings.pushBody || "Grab it before it sells out again — tap to shop now.");
      setCta(initialSettings.pushCta || "Direct to product page (default)");
      setSendReminder(initialSettings.pushReminderEnabled ?? false);
      setReminderDelay(initialSettings.pushReminderDelay || "3 days");
      setMaxReminders(initialSettings.pushReminderMax ?? 2);
    }
  }, [initialSettings]);

  return (
    <div class="settings-layout" style={{ maxWidth: "1000px" }}>
      {/* Breadcrumb Navigation */}
      <nav class="settings-breadcrumb">
        <Link to="/app/settings?step=2" class="settings-breadcrumb-link">Settings</Link> &gt;{" "}
        <Link to="/app/settings?page=out-of-stock" class="settings-breadcrumb-link">Out Of Stock</Link> &gt;{" "}
        Push Notifications Settings
      </nav>

      {/* Main Title */}
      <h1 class="settings-title">Push Notifications Settings</h1>



            {/* Page Actions Row */}
      <div class="settings-page-actions">
        <Link to="/app/settings?page=out-of-stock" class="btn-back-footer">← Back</Link>
      </div>

      <form id="push-form" onSubmit={handleSave}>
        {/* Editor & Preview Split Grid */}
        <div class="editor-preview-grid">
          
          {/* Column 1: Format Form */}
          <div class="editor-panel-card" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <div class="editor-header-row">
              <span class="settings-section-title" style={{ margin: 0 }}>Push Notifications Format</span>
              <button
                type="button"
                class="btn-edit-badge"
                onClick={handleOpenModal}
                style={{
                  backgroundColor: "#f0fdfa",
                  color: "#0d9488",
                  border: "1px solid #ccfbf1",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600"
                }}
              >
                <span>✏️</span> Edit
              </button>
            </div>

            {/* Notification Title */}
            <div class="form-group">
              <label class="form-label" style={{ color: "var(--text-muted)", fontSize: "12px" }}>Notification Title</label>
              <div style={{
                backgroundColor: "#ffffff",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "12px 16px",
                fontSize: "14px",
                fontWeight: "500",
                color: "#1e293b",
                wordBreak: "break-word"
              }}>
                "{title}"
              </div>
            </div>

            {/* Notification Body */}
            <div class="form-group">
              <label class="form-label" style={{ color: "var(--text-muted)", fontSize: "12px" }}>Notification Body</label>
              <div style={{
                backgroundColor: "#ffffff",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "12px 16px",
                fontSize: "14px",
                fontWeight: "500",
                color: "#1e293b",
                wordBreak: "break-word",
                lineHeight: "1.4"
              }}>
                "{body}"
              </div>
            </div>

            {/* Button Action (CTA) */}
            <div class="form-group">
              <label class="form-label" style={{ color: "var(--text-muted)", fontSize: "12px" }}>Button Action (CTA)</label>
              <div style={{
                backgroundColor: "#ffffff",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "16px",
                fontSize: "13px",
                lineHeight: "1.6",
                color: "#475569",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}>
                <div>• Action text: "Shop Now"</div>
                <div>• Destination: "{cta}"</div>
              </div>
            </div>
          </div>

          {/* Column 2: Phone Lockscreen Preview */}
          <div class="preview-panel-card">
            <h2 class="preview-header-title">Preview</h2>
            
            <div class="preview-center-content">
              {/* iOS Phone Mockup */}
              <div class="phone-mockup">
                <div class="phone-dynamic-island"></div>
                
                {/* Simulated Locked Screen Background */}
                <div class="phone-lockscreen">
                  <div class="lockscreen-time">9:41</div>
                  <div class="lockscreen-date">Friday, June 19</div>
                  
                  {/* Floating Notification Banner */}
                  <div class="push-banner">
                    <div class="push-banner-header">
                      <div class="push-banner-app-info">
                        <div class="push-banner-app-icon">🔔</div>
                        <span>Restockly</span>
                      </div>
                      <span class="push-banner-time">now</span>
                    </div>
                    
                    <h4 class="push-banner-title">
                      {title.replace("{product_name}", "Blue Hoodie M")}
                    </h4>
                    <p class="push-banner-body">{body}</p>

                    {/* Product Preview box inside push */}
                    <div class="push-product-preview-row">
                      <span style={{ fontSize: "16px" }}>🧥</span>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyItems: "center", gap: "4px" }}>
                          <span style={{ fontSize: "9px", fontWeight: "700" }}>Blue Hoodie — Size M</span>
                          <span class="push-product-badge">Limited stock</span>
                        </div>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <span style={{ fontSize: "9px", fontWeight: "800", color: "#0f172a" }}>$79.99</span>
                          <span style={{ fontSize: "8px", color: "#10b981", fontWeight: "700" }}>✓ Back in stock</span>
                        </div>
                      </div>
                    </div>

                    {/* CTA Button */}
                    <div class="push-cta-action">
                      <span>🛍️</span> Shop Now
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Send Reminder Settings */}
        <div class="settings-card">
          <div class="settings-card-section" style={{ borderBottom: "none", paddingBottom: "0px", marginBottom: "0px" }}>
            {/* Reminder Toggle */}
            <div class="toggle-left-container">
              <div class="toggle-left-row">
                <label class="ios-switch">
                  <input
                    type="checkbox"
                    checked={sendReminder}
                    onChange={(e) => setSendReminder(e.target.checked)}
                  />
                  <span class="ios-slider"></span>
                </label>
                <span class="toggle-left-label">Send Reminder</span>
              </div>
            </div>

            {/* Permanent Reminder Configurations */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              marginTop: "20px",
              opacity: sendReminder ? 1 : 0.5,
              pointerEvents: sendReminder ? "auto" : "none",
              transition: "opacity 0.2s ease"
            }}>
              
              {/* Reminder Delay */}
              <div class="form-group">
                <label class="form-label" for="reminder-delay">Reminder Delay</label>
                <select
                  id="reminder-delay"
                  class="select-field"
                  value={reminderDelay}
                  onChange={(e) => setReminderDelay(e.target.value)}
                  disabled={!sendReminder}
                >
                  <option value="1 day">1 day</option>
                  <option value="2 days">2 days</option>
                  <option value="3 days">3 days</option>
                  <option value="5 days">5 days</option>
                </select>
                <p class="helper-text">After how much time reminder will be send</p>
              </div>

              {/* Maximum Reminder */}
              <div class="form-group">
                <label class="form-label" for="max-reminders">Maximum Reminder</label>
                <div class="input-icon-wrapper">
                  <div class="input-prefix-box">#</div>
                  <input
                    id="max-reminders"
                    type="number"
                    class="input-field"
                    value={maxReminders}
                    onChange={(e) => setMaxReminders(Number(e.target.value))}
                    min="1"
                    disabled={!sendReminder}
                  />
                </div>
                <p class="helper-text">Maximum how many reminder per user</p>
              </div>

              {/* Stop Reminder */}
              <div class="form-group">
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#0f766e",
                  fontWeight: "600",
                  backgroundColor: "#f0fdfa",
                  padding: "10px 14px",
                  borderRadius: "6px",
                  border: "1px solid #ccfbf1",
                  width: "fit-content"
                }}>
                  <span>✓</span> Reminders automatically stop when the customer purchases the product
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Page Footer Action */}
        <div class="settings-footer" style={{ marginTop: "24px" }}>
          <button type="submit" class="btn-save" disabled={isSaving}>
            {isSaving ? "SAVING..." : "SAVE"}
          </button>
        </div>

      </form>

      {/* Floating Save Toast */}
      {showToast && (
        <div class="toast-msg">
          <span>✓ Settings saved successfully</span>
        </div>
      )}

      {/* Edit Push Notifications Format Modal */}
      {isEditModalOpen && (
        <div class="modal-backdrop" onClick={handleCancel}>
          <div class="modal-container" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h2 class="modal-title">Push Notifications Format</h2>
              <div class="modal-actions">
                <button type="button" class="btn-cancel" onClick={handleCancel}>
                  Cancel
                </button>
                <button type="button" class="btn-save-changes" onClick={handleSaveModal}>
                  ✓ Save changes
                </button>
              </div>
            </div>

            <div class="modal-body">
              {/* Title */}
              <div class="form-group">
                <label class="form-label" for="modal-title">Notification Title</label>
                <div class="input-icon-wrapper" style={{ display: "flex", width: "100%", border: "1px solid var(--border-color)", borderRadius: "8px", overflow: "hidden", backgroundColor: "#ffffff", height: "40px" }}>
                  <div style={{
                    backgroundColor: "#f8fafc",
                    borderRight: "1px solid var(--border-color)",
                    padding: "0 12px",
                    color: "#64748b",
                    fontSize: "13px",
                    fontWeight: "600",
                    userSelect: "none",
                    display: "flex",
                    alignItems: "center",
                    whiteSpace: "nowrap",
                    height: "100%"
                  }}>
                    {"{product_name}"}
                  </div>
                  <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", height: "100%" }}>
                    <input
                      id="modal-title"
                      type="text"
                      style={{
                        border: "none",
                        width: "100%",
                        padding: "0 40px 0 12px",
                        fontSize: "14px",
                        color: "var(--text-dark)",
                        outline: "none",
                        backgroundColor: "transparent",
                        height: "100%"
                      }}
                      value={tempTitle}
                      onChange={(e) => setTempTitle(e.target.value)}
                      placeholder=" is back in stock!"
                    />
                    {tempTitle && (
                      <button
                        type="button"
                        onClick={() => setTempTitle("")}
                        style={{
                          position: "absolute",
                          right: "12px",
                          background: "none",
                          border: "none",
                          fontSize: "16px",
                          color: "#94a3b8",
                          cursor: "pointer",
                          padding: 0
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                {/* Suggestions row */}
                <div class="suggestion-tags-row">
                  <span class="suggestion-tag-label">Try:</span>
                  <button
                    type="button"
                    class="suggestion-tag-btn"
                    onClick={() => setTempTitle(" is back in stock!")}
                  >
                    Back in stock! 🎉
                  </button>
                  <button
                    type="button"
                    class="suggestion-tag-btn"
                    onClick={() => setTempTitle(" Restock Alert")}
                  >
                    Restock Alert
                  </button>
                </div>
              </div>

              {/* Body */}
              <div class="form-group">
                <label class="form-label" for="modal-body">Notification Body</label>
                <div class="textarea-wrapper">
                  <textarea
                    id="modal-body"
                    class="textarea-field"
                    style={{ minHeight: "80px" }}
                    value={tempBody}
                    onChange={(e) => {
                      if (e.target.value.length <= 150) {
                        setTempBody(e.target.value);
                      }
                    }}
                    maxLength={150}
                    placeholder="Enter notification message..."
                  />
                  <div class="textarea-footer">
                    <span>{tempBody.length} / 150</span>
                  </div>
                </div>
                {/* Suggestions row */}
                <div class="suggestion-tags-row">
                  <span class="suggestion-tag-label">Try:</span>
                  <button
                    type="button"
                    class="suggestion-tag-btn"
                    onClick={() => setTempBody("Grab it before it sells out again — tap to shop now.")}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    class="suggestion-tag-btn"
                    onClick={() => setTempBody("Hurry! Limited stock available. Tap here to purchase yours immediately.")}
                  >
                    Urgent
                  </button>
                </div>
              </div>

              {/* Destination CTA */}
              <div class="form-group">
                <label class="form-label" for="modal-cta">Button Destination (CTA)</label>
                <div class="input-icon-wrapper">
                  <div class="input-prefix-box">🔗</div>
                  <input
                    id="modal-cta"
                    type="text"
                    class="input-field"
                    value="Direct to product page (default)"
                    disabled={true}
                  />
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
